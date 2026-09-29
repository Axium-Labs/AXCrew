package com.axcrew.android.data.repository

import com.axcrew.android.data.model.*
import com.axcrew.android.data.network.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import kotlin.random.Random

data class CrewState(
    val snapshot: Snapshot = Snapshot(), val connection: String = "连接中", val error: String? = null,
    val loaded: Boolean = false, val events: List<CrewEvent> = emptyList(),
    val streams: Map<String, List<JsonObject>> = emptyMap(), val historyRevision: Int = 0,
)

/** 两次全量同步之间至少间隔的时间：把事件风暴合并成一次拉取。 */
private const val REFRESH_COALESCE = 700L

class CrewRepository(val api: GatewayApi) {
    private val mutable = MutableStateFlow(CrewState())
    val state = mutable.asStateFlow()
    private val refreshes = Channel<Unit>(Channel.CONFLATED)
    private val mutex = Mutex()
    private val seen = LinkedHashSet<String>()
    fun requestRefresh() { refreshes.trySend(Unit) }

    suspend fun refresh() = mutex.withLock {
        val snapshot = coroutineScope {
            val devices = async { api.get<List<Device>>("devices") }
            val tasks = async { api.get<List<Task>>("tasks") }
            val sessions = async { api.get<List<Session>>("sessions") }
            val permissions = async { api.get<List<Permission>>("permissions") }
            val settings = async { api.get<Settings>("settings") }
            val crews = api.get<List<Crew>>("crews")
            val members = crews.map { async { api.get<List<Member>>("crews", it.id, "members") } }.awaitAll().flatten()
            Snapshot(devices.await(), crews, members, tasks.await(), sessions.await(), permissions.await(), settings.await())
        }
        mutable.update { previous ->
            val changed = snapshot.tasks.any { t -> previous.snapshot.tasks.find { it.id == t.id }?.status != t.status }
            previous.copy(snapshot = snapshot, loaded = true, error = null, historyRevision = previous.historyRevision + if (changed) 1 else 0)
        }
    }

    /** Runs only while the process is foreground. Cancellation closes the socket and HTTP calls. */
    suspend fun run() = coroutineScope {
        launch {
            requestRefresh()
            for (ignored in refreshes) {
                try { refresh() } catch (e: CancellationException) { throw e }
                catch (e: Exception) { mutable.update { it.copy(error = e.message ?: "同步失败") } }
                // 一次 refresh 是六个以上 HTTP 请求。事件密集时（工具输出、审批、任务状态）
                // 之前会在请求刚返回就立刻发起下一次，把网络和重组占满，表现为整机卡顿。
                // 这里留出合并窗口：期间到达的刷新请求会被 CONFLATED 通道压成一次。
                delay(REFRESH_COALESCE)
            }
        }
        launch { while (isActive) { delay(8_000); requestRefresh() } }
        var attempt = 0
        try {
            while (isActive) {
                mutable.update { it.copy(connection = if (attempt == 0) "连接中" else "重连中") }
                try {
                    api.events().collect { frame ->
                        when (frame) {
                            SocketFrame.Open -> {
                                attempt = 0
                                mutable.update { it.copy(connection = "已连接", historyRevision = it.historyRevision + 1) }
                                requestRefresh()
                                launch {
                                    try {
                                        val history = api.get<List<CrewEvent>>("events")
                                        mutable.update { it.copy(events = (it.events + history).distinctBy(CrewEvent::event_id).take(300)) }
                                    } catch (e: CancellationException) { throw e } catch (_: Exception) { /* snapshot has error reporting */ }
                                }
                            }
                            is SocketFrame.Event -> consume(frame.event)
                        }
                    }
                } catch (e: CancellationException) { throw e } catch (_: Exception) { /* bounded reconnect below */ }
                attempt = (attempt + 1).coerceAtMost(5)
                mutable.update { it.copy(connection = "重连中") }
                delay((1000L shl attempt).coerceAtMost(30_000) + Random.nextLong(500))
            }
        } finally { mutable.update { it.copy(connection = "后台暂停") } }
    }

    private fun consume(event: CrewEvent) {
        if (!seen.add(event.event_id)) return
        if (seen.size > 4000) seen.remove(seen.first())
        mutable.update { current ->
            val streams = current.streams.toMutableMap()
            val id = event.task_id
            if (id != null && event.payload.str("sessionUpdate").isNotEmpty()) {
                val updates = streams[id].orEmpty().toMutableList()
                val last = updates.lastOrNull()
                val payload = event.payload
                if (last != null && payload.str("sessionUpdate") in listOf("agent_message_chunk", "agent_thought_chunk") && last.str("sessionUpdate") == payload.str("sessionUpdate") && last["messageId"] == payload["messageId"]) {
                    updates[updates.lastIndex] = JsonObject(payload + ("content" to buildJsonObject { put("text", (last["content"].obj().str("text") + payload["content"].obj().str("text")).takeLast(200_000)) }))
                } else updates.add(payload)
                streams[id] = updates.takeLast(500)
                while (streams.size > 30) streams.remove(streams.keys.first())
            }
            current.copy(events = (listOf(event) + current.events).take(300), streams = streams)
        }
        if (!event.kind.startsWith("agent.") && !event.kind.startsWith("tool.")) requestRefresh()
    }
    suspend fun history(id: String): History = api.get("sessions", id, "history")
    suspend fun createCrew(name: String): Crew = api.post("crews", body = NewCrew(name.trim()))
    suspend fun createMember(crew: String, body: NewMember): Member = api.post("crews", crew, "members", body = body)
    suspend fun createTask(member: Member, title: String, prompt: String, dependencies: List<String>, priority: Int): Task {
        // Never upgrade deny. Existing allow members use an ask override for mobile submissions.
        val input = buildJsonObject { put("prompt", prompt); put("include_dependencies", dependencies.isNotEmpty()); if (member.permission_profile != "deny") put("permission_profile", "ask") }
        return api.post("tasks", body = NewTask(member.crew_id, title, member.id, input, dependencies, priority))
    }
    suspend fun taskAction(id: String, action: String) { require(action in listOf("start", "cancel", "retry")); api.action("tasks", id, action) }
    suspend fun resolve(id: String, choice: String) {
        require(choice in listOf("allow_once", "allow_session", "reject_once"))
        api.post<JsonObject, Map<String, String>>("permissions", id, "resolve", body = mapOf("option_id" to choice))
    }
    suspend fun followUp(id: String, message: String): Task {
        val member = state.value.snapshot.tasks.find { it.id == id }?.let { t -> state.value.snapshot.members.find { it.id == t.assigned_member } }
        val body = buildJsonObject { put("text", message); if (member?.permission_profile != "deny") put("permission_profile", "ask") }
        return api.post("sessions", id, "message", body = body)
    }
    suspend fun chat(member: Member?, device: String, cwd: String, provider: String?, model: String?, reasoningEffort: String?, message: String, attachments: List<Attachment>): Task {
        require(attachments.isEmpty() || device == "local") { "附件目前支持 Gateway 所在电脑，请切换到本机设备" }
        var target = member
        if (target != null && provider != null && model != null && (target.provider != provider || target.model != model)) {
            val base = target
            target = state.value.snapshot.members.find { it.device_id == base.device_id && it.cwd == base.cwd && it.provider == provider && it.model == model && it.permission_profile == base.permission_profile && it.skills == base.skills && it.mcp_servers == base.mcp_servers }
                ?: createMember(base.crew_id, NewMember(base.name, base.role, base.device_id, base.cwd, provider, model, base.skills, base.mcp_servers, base.permission_profile, base.max_concurrency))
        }
        require(target != null || device == "local") { "请先在电脑端配置此设备的执行环境" }
        val body = buildJsonObject {
            put("text", message); put("title", message.take(60).ifBlank { attachments.firstOrNull()?.name ?: "新会话" })
            if (target != null) put("member_id", target.id) else {
                put("cwd", cwd); provider?.let { put("provider", it) }; model?.let { put("model", it) }
            }
            reasoningEffort?.let { put("reasoning_effort", it) }
            if (target?.permission_profile != "deny") put("permission_profile", "ask")
            attachmentFields(attachments)
        }
        return api.post("sessions", body = body)
    }
    suspend fun reply(id: String, message: String, attachments: List<Attachment>): Task {
        val task = state.value.snapshot.tasks.find { it.id == id } ?: error("会话尚未同步")
        require(attachments.isEmpty() || task.assigned_device == "local") { "附件目前支持 Gateway 所在电脑" }
        val member = state.value.snapshot.members.find { it.id == task.assigned_member }
        val body = buildJsonObject {
            put("text", message); if (member?.permission_profile != "deny") put("permission_profile", "ask")
            attachmentFields(attachments)
        }
        return api.post("sessions", id, "message", body = body)
    }
    private fun JsonObjectBuilder.attachmentFields(items: List<Attachment>) {
        require(items.none { !it.mime.startsWith("image/") } || state.value.snapshot.settings.session_files) { "此 Gateway 尚未支持文件附件，请先更新电脑端后端；草稿和附件已保留" }
        put("images", wireJson.encodeToJsonElement(items.filter { it.mime.startsWith("image/") }))
        if (items.any { !it.mime.startsWith("image/") }) put("files", wireJson.encodeToJsonElement(items.filter { !it.mime.startsWith("image/") }))
    }
    suspend fun automations(): List<Automation> = api.get("automations")
    suspend fun automationRuns(): List<AutomationRun> = api.get("automations", "runs")
    suspend fun saveAutomation(item: Automation) {
        val body = wireJson.encodeToString(item)
        if (item.id.isEmpty()) api.raw(api.url("automations"), "POST", body)
        else api.raw(api.url("automations", item.id), "PUT", body)
    }
    suspend fun toggleAutomation(item: Automation) { api.post<Automation, Map<String, Boolean>>("automations", item.id, "toggle", body = mapOf("enabled" to !item.enabled)) }
    suspend fun runAutomation(id: String): Task = api.post("automations", id, "run", body = emptyMap<String, String>())
    suspend fun deleteAutomation(id: String) { api.raw(api.url("automations", id), "DELETE") }
    suspend fun renameDevice(id: String, name: String) { api.post<JsonObject, Map<String, String>>("devices", id, "rename", body = mapOf("name" to name)) }
    suspend fun capabilities(id: String, cwd: String): JsonObject = wireJson.decodeFromString(api.raw(api.url("devices", id, "capabilities", query = mapOf("cwd" to cwd))))
}
