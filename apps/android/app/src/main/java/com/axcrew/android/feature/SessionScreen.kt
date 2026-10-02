package com.axcrew.android.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.axcrew.android.data.model.*
import com.axcrew.android.ui.*
import com.axcrew.android.data.AttachmentReader
import androidx.compose.ui.platform.LocalContext
import kotlinx.serialization.json.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.filterNotNull

/** The landing surface is always a conversation, even before a Gateway is configured. */
@Composable fun SessionScreen(
    vm: CrewViewModel, state: ClientState, id: String?, deviceId: String,
    connect: () -> Unit, open: (String) -> Unit,
) {
    val snapshot = state.crew.snapshot
    // 这些派生值被每帧都读一次（输入框每次按键都会让本页重组），必须按数据缓存：
    // conversations() 要遍历全部任务、做分组与深度排序，逐帧重算就是打字/切页卡顿的来源。
    val (original, task, members) = remember(snapshot, id, deviceId) {
        val original = snapshot.tasks.find { it.id == id }
        val originalBinding = snapshot.sessions.find { it.task_id == id }
        val task = if (id == null) null else conversations(snapshot).find { group ->
            group.root.id == id || originalBinding?.let { source ->
                snapshot.sessions.any { it.task_id == group.latest.id && it.device_id == source.device_id && it.ax_session_id == source.ax_session_id }
            } == true
        }?.latest ?: original
        Triple(original, task, snapshot.members.filter { it.device_id == deviceId })
    }
    val effectiveId = task?.id ?: id
    var memberId by rememberSaveable(deviceId) { mutableStateOf("") }
    val member = if (task != null) snapshot.members.find { it.id == task.assigned_member } else members.find { it.id == memberId } ?: members.firstOrNull()
    var draft by rememberSaveable(id ?: "new") { mutableStateOf("") }
    val context = LocalContext.current
    var uris by rememberSaveable(id ?: "new") { mutableStateOf(emptyList<String>()) }
    var chooseModel by remember { mutableStateOf(false) }
    var provider by rememberSaveable(deviceId, member?.id) { mutableStateOf("") }
    var model by rememberSaveable(deviceId, member?.id) { mutableStateOf("") }
    var thinking by rememberSaveable(deviceId, member?.id) { mutableStateOf("") }
    val cwd = member?.cwd ?: snapshot.settings.default_cwd
    var catalog by remember(deviceId, cwd) { mutableStateOf<JsonObject?>(null) }
    var modelError by remember { mutableStateOf<String?>(null) }
    var loadingModels by remember { mutableStateOf(false) }
    LaunchedEffect(chooseModel, deviceId, cwd) {
        if (chooseModel && state.configured && id == null && cwd.isNotBlank()) {
            loadingModels = true; modelError = null
            try { catalog = vm.capabilities(deviceId, cwd) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { modelError = e.message }
            finally { loadingModels = false }
        }
    }
    var history by remember(effectiveId) { mutableStateOf<History?>(null) }
    var historyError by remember(effectiveId) { mutableStateOf<String?>(null) }
    var settled by remember(effectiveId) { mutableStateOf(false) }
    var refresh by remember(id) { mutableIntStateOf(0) }
    val binding = remember(snapshot, effectiveId) { snapshot.sessions.find { it.task_id == effectiveId } }
    val list = rememberLazyListState()
    var following by remember(id) { mutableStateOf(true) }
    var mounted by remember { mutableStateOf(true) }
    DisposableEffect(Unit) { mounted = true; onDispose { mounted = false } }
    LaunchedEffect(effectiveId, binding?.ax_session_id, task?.status, state.crew.connection, refresh) {
        if (effectiveId == null || binding == null || state.crew.connection != "已连接") return@LaunchedEffect
        do {
            try { history = vm.history(effectiveId); settled = task?.active == false; historyError = null }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { historyError = e.message ?: "历史暂不可用" }
            if (task?.active != true) break
            delay(15_000)
        } while (true)
    }
    // 合并历史与实时流是 O(行数²) 的匹配，并且只在数据变化时才需要重算：
    // 之前它在每次重组（包括每次按键）都跑一遍。
    val live = task?.let { state.crew.streams[it.id] }.orEmpty()
    val lines = remember(history, live, task, settled) {
        task?.let { reconcile(history, live, it, settled) }.orEmpty()
    }
    LaunchedEffect(list) { snapshotFlow { if (list.isScrollInProgress) !list.canScrollForward else null }.filterNotNull().collect { following = it } }
    LaunchedEffect(id, lines.size, lines.lastOrNull()?.text, task?.status) {
        delay(60)
        if (following && list.layoutInfo.totalItemsCount > 0) list.scrollToItem(list.layoutInfo.totalItemsCount - 1)
    }
    fun submit(message: String, clearDraft: Boolean) {
        if (message.isBlank() || state.busy) return
        if (!state.configured) { connect(); return }
        vm.perform {
            val attached = AttachmentReader.read(context, uris)
            val next = if (task != null) reply(task.id, message, attached)
                else chat(member, deviceId, cwd, provider.ifBlank { null }, model.ifBlank { null }, thinking.ifBlank { null }, message, attached)
            if (clearDraft && draft.trim() == message) draft = ""
            uris = emptyList()
            if (mounted) open(next.id)
        }
    }
    fun send() = submit(draft.trim(), true)
    fun sendVoiceText(text: String) = submit(text, false)
    Column(Modifier.fillMaxSize()) {
        if (id == null) {
            Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp, vertical = 24.dp), verticalArrangement = Arrangement.Center) {
                Box(Modifier.size(68.dp).background(Brush.linearGradient(listOf(MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.secondary)), RoundedCornerShape(22.dp)), contentAlignment = Alignment.Center) {
                    Text("AX", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.height(24.dp))
                Text("想让 AX 做些什么？", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(10.dp))
                Text(if (state.configured) "在你的电脑和远程设备上，让工作继续。" else "先写下想法，随时从左上角连接你的 Crew。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(24.dp))
                listOf("梳理当前项目，规划下一步", "检查最近改动和测试结果", "总结已完成的工作").forEach { suggestion ->
                    SuggestionChip(onClick = { draft = suggestion }, label = { Text(suggestion) }, icon = { Icon(Icons.Outlined.NorthEast, null, Modifier.size(16.dp)) })
                }
            }
        } else {
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                item {
                    Text(original?.title ?: task?.title ?: "正在同步会话…", style = MaterialTheme.typography.titleLarge)
                    task?.let { Status(it.status) }
                    TextButton(onClick = { refresh++; vm.refresh() }) { Text("同步记录") }
                }
                if (historyError != null) item { Text(historyError.orEmpty(), color = MaterialTheme.colorScheme.error) }
                itemsIndexed(lines) { _, line ->
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (line.role == "你") Alignment.End else Alignment.Start) {
                        Text(line.role + if (line.status.isNotEmpty()) " · ${line.status}" else "", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(6.dp))
                        Surface(color = if (line.role == "你") MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surface, shape = RoundedCornerShape(16.dp)) {
                            SelectionContainer { MarkdownMessage(line.text, Modifier.padding(14.dp)) }
                        }
                    }
                }
                if (task?.status == "failed") item { Panel { Text(task.output?.str("error").orEmpty(), color = MaterialTheme.colorScheme.error) } }
                if (task?.status == "completed" && lines.none { it.role == "AX" }) item { SelectionContainer { MarkdownMessage(task.output?.str("text").orEmpty()) } }
                if (task?.status in listOf("pending", "failed", "cancelled")) item {
                    Button(enabled = !state.busy, onClick = { vm.perform {
                        if (task!!.status != "pending") taskAction(task.id, "retry")
                        taskAction(task.id, "start")
                    } }) { Text(if (task?.status == "pending") "开始任务" else "重试任务") }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp), horizontalArrangement = Arrangement.End) {
            TextButton(enabled = !state.busy, onClick = {
                if (!state.configured) connect() else vm.beginCall(task?.id,
                    member, member?.device_id ?: deviceId, cwd,
                    provider.ifBlank { null }, model.ifBlank { null }, thinking.ifBlank { null })
            }) { Icon(Icons.Outlined.Call, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("语音通话") }
        }
        Composer(draft, { draft = it }, uris, { uris = it }, model.ifBlank { member?.model ?: "选择模型" },
            { if (!state.configured) connect() else chooseModel = true }, thinking,
            { thinking = it },
            (draft.isNotBlank() || uris.isNotEmpty()) && (id == null || binding != null), state.busy, task?.active == true,
            ::send, { task?.let { vm.perform { taskAction(it.id, "cancel") } } }, ::sendVoiceText)
    }
    if (chooseModel) AlertDialog(onDismissRequest = { chooseModel = false }, title = { Text("选择模型") }, confirmButton = { TextButton(onClick = { chooseModel = false }) { Text("完成") } }, text = {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            if (id != null) {
                Text("当前会话：${member?.model ?: "AX 默认"}")
                Text("已有会话继续使用创建时的模型。新建会话可选择其他模型。")
            } else {
                if (members.size > 1) Picker("工作目录", member?.id.orEmpty(), members.map { it.id to "${it.cwd} · ${it.model ?: "默认"}" }) { memberId = it }
                Text(cwd.ifBlank { "请在电脑端配置工作目录" }, style = MaterialTheme.typography.bodySmall)
                if (loadingModels) LinearProgressIndicator(Modifier.fillMaxWidth())
                modelError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                TextButton(onClick = { provider = ""; model = ""; chooseModel = false }) { Text("继承电脑端模型") }
                val providers = (catalog?.get("models").obj()["providers"] as? JsonArray).orEmpty()
                providers.forEach { value -> val source = value.obj()
                    if (source["configured"] != JsonPrimitive(false)) (source["models"] as? JsonArray).orEmpty().forEach { entry -> val option = entry.obj()
                        TextButton(onClick = { provider = source.str("id"); model = option.str("id"); chooseModel = false }) { Text("${option.str("display_name").ifBlank { option.str("id") }} · ${source.str("id")}") }
                    }
                }
                if (!loadingModels && providers.isEmpty()) Text("没有可用模型，请检查电脑端模型配置。")
            }
        }
    })
}
