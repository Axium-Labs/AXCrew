package com.axcrew.android.feature

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import com.axcrew.android.data.model.*
import com.axcrew.android.ui.*
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.*
import java.text.DateFormat
import java.util.Date

@Composable fun DevicesScreen(state: ClientState, open: (String) -> Unit) {
    Page("设备", "DEVICES / AX RUNTIMES") {
        items(state.crew.snapshot.devices, key = { it.id }) { device -> Entry(device.name, "${device.hostname} · ${device.platform}/${device.arch}", device.status) { open(device.id) } }
        if (state.crew.loaded && state.crew.snapshot.devices.isEmpty()) item { Text("没有注册的 AX 设备。请先在电脑端配置 AX。") }
    }
}
@Composable fun DeviceScreen(vm: CrewViewModel, state: ClientState, id: String, create: () -> Unit, task: (String) -> Unit) {
    val snapshot = state.crew.snapshot
    val device = snapshot.devices.find { it.id == id }
    var name by rememberSaveable(id) { mutableStateOf("") }
    var cwd by rememberSaveable(id) { mutableStateOf("") }
    var catalog by remember(id) { mutableStateOf<JsonObject?>(null) }
    LaunchedEffect(device?.name) { name = device?.name.orEmpty() }
    LaunchedEffect(snapshot.members, id) { if (cwd.isEmpty()) cwd = snapshot.members.find { it.device_id == id }?.cwd ?: if (id == "local") snapshot.settings.default_cwd else "" }
    Page(device?.name ?: "设备", "DEVICE / $id") {
        device?.let { d -> item { Panel {
            Status(d.status); Code("${d.hostname}\n${d.platform}/${d.arch}\nAX ${d.ax_version} · Protocol ${d.protocol_version}")
            Text("最近在线：${DateFormat.getDateTimeInstance().format(Date(d.last_seen * 1000))}", style = MaterialTheme.typography.bodySmall)
            Button(onClick = create) { Text("在此设备创建任务") }
        } } }
        item { Panel { Field("设备名称", name, { name = it }); OutlinedButton(enabled = name.isNotBlank() && !state.busy, onClick = { vm.perform { renameDevice(id, name.trim()) } }) { Text("保存名称") } } }
        item { Panel {
            Field("此设备上的绝对工作目录", cwd, { cwd = it; catalog = null })
            OutlinedButton(enabled = cwd.isNotBlank() && device?.status in listOf("online", "busy") && !state.busy, onClick = { vm.perform { catalog = capabilities(id, cwd) } }) { Text("读取 AX 能力") }
            catalog?.let { Code(wireJson.encodeToString(JsonObject.serializer(), it)) }
        } }
        item { Text("设备任务", style = MaterialTheme.typography.titleMedium) }
        items(snapshot.tasks.filter { it.assigned_device == id }.reversed(), key = { it.id }) { t -> Entry(t.title, "", t.status) { task(t.id) } }
    }
}

@Composable fun CrewsScreen(vm: CrewViewModel, state: ClientState, open: (String) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    Page("团队", "CREWS / AGENTS") {
        item { Panel { Field("新 Crew 名称", name, { name = it }); Button(enabled = name.isNotBlank() && !state.busy, onClick = { vm.perform { val crew = createCrew(name); name = ""; open(crew.id) } }) { Text("创建 Crew") } } }
        items(state.crew.snapshot.crews, key = { it.id }) { crew -> Entry(crew.name, "${state.crew.snapshot.members.count { it.crew_id == crew.id }} Agents · ${state.crew.snapshot.tasks.count { it.crew_id == crew.id }} Tasks") { open(crew.id) } }
    }
}
@Composable fun CrewScreen(state: ClientState, id: String, addAgent: () -> Unit, openAgent: (String) -> Unit, openTask: (String) -> Unit) {
    val snapshot = state.crew.snapshot
    Page(snapshot.crews.find { it.id == id }?.name ?: "Crew", "CREW WORKSPACE") {
        item { Button(onClick = addAgent) { Text("＋ 添加 Agent") } }
        items(snapshot.members.filter { it.crew_id == id }, key = { it.id }) { agent -> Entry(agent.name, "${agent.role} · ${agent.cwd}", snapshot.devices.find { it.id == agent.device_id }?.status ?: "offline") { openAgent(agent.id) } }
        item { Text("团队任务", style = MaterialTheme.typography.titleMedium) }
        items(snapshot.tasks.filter { it.crew_id == id }.reversed(), key = { it.id }) { t -> Entry(t.title, "", t.status) { openTask(t.id) } }
    }
}
@Composable fun AgentScreen(state: ClientState, id: String, open: (String) -> Unit) {
    val snapshot = state.crew.snapshot
    val agent = snapshot.members.find { it.id == id }
    Page(agent?.name ?: "Agent", "AGENT WORKSPACE") {
        agent?.let { a -> item { Panel { Text(a.role); Code("${a.device_id}\n${a.cwd}\n${a.provider ?: "AX default"} / ${a.model ?: "default"}"); Text("Permission: ${a.permission_profile} · Concurrency: ${a.max_concurrency}"); Text("Skills: ${a.skills.joinToString()}\nMCP: ${a.mcp_servers.joinToString()}", style = MaterialTheme.typography.bodySmall) } } }
        items(snapshot.tasks.filter { it.assigned_member == id }.reversed(), key = { it.id }) { task -> Entry(task.title, "", task.status) { open(task.id) } }
    }
}
@Composable fun CreateAgentScreen(vm: CrewViewModel, state: ClientState, crew: String, done: () -> Unit) {
    val snapshot = state.crew.snapshot
    var device by rememberSaveable { mutableStateOf("local") }
    var name by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("") }
    var cwd by rememberSaveable { mutableStateOf(snapshot.settings.default_cwd) }
    var provider by rememberSaveable { mutableStateOf("") }
    var model by rememberSaveable { mutableStateOf("") }
    var skills by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var mcp by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var concurrency by rememberSaveable { mutableStateOf("1") }
    var policy by rememberSaveable { mutableStateOf("ask") }
    var catalog by remember { mutableStateOf<JsonObject?>(null) }
    var catalogKey by remember { mutableStateOf("") }
    val validCatalog = catalog != null && catalogKey == "$device:$cwd"
    val providers = (catalog?.get("models").obj()["providers"] as? JsonArray).orEmpty().map { it.obj() }
    val models = (providers.find { it.str("id") == provider }?.get("models") as? JsonArray).orEmpty().map { it.obj() }
    val availableSkills = (catalog?.get("skills").obj()["skills"] as? JsonArray).orEmpty().map { it.obj().str("name") }
    val availableMcp = (catalog?.get("mcp").obj()["servers"] as? JsonArray).orEmpty().map { it.obj() }.filter { it["enabled"] == JsonPrimitive(true) }.map { it.str("name") }
    Page("添加 Agent", "复用设备上已配置的 AX 模型、技能和 MCP") {
        item { Field("Agent 名称", name, { name = it }) }
        item { Field("职责", role, { role = it }) }
        item { Picker("设备", device, snapshot.devices.map { it.id to "${it.name} · ${it.status}" }) { device = it; cwd = snapshot.members.find { a -> a.device_id == it }?.cwd.orEmpty(); catalog = null; provider = ""; model = ""; skills = emptyList(); mcp = emptyList() } }
        item { Field("设备上的绝对工作目录", cwd, { cwd = it; catalog = null; provider = ""; model = ""; skills = emptyList(); mcp = emptyList() }) }
        item { Button(enabled = cwd.isNotBlank() && !state.busy && snapshot.devices.find { it.id == device }?.status in listOf("online", "busy"), onClick = {
            val requestedDevice = device; val requestedCwd = cwd
            vm.perform { val result = capabilities(requestedDevice, requestedCwd); catalogKey = "$requestedDevice:$requestedCwd"; catalog = result }
        }) { Text("读取此工作区能力") } }
        if (validCatalog) {
            item { Picker("Provider", provider, listOf("" to "AX 默认") + providers.map { it.str("id") to it.str("id") }) { provider = it; model = "" } }
            item { Picker("Model", model, listOf("" to "AX 默认") + models.map { it.str("id") to it.str("display_name").ifEmpty { it.str("id") } }) { model = it } }
            item { Panel { Text("Skills"); availableSkills.forEach { skill -> Row { Checkbox(skill in skills, { checked -> skills = if (checked) skills + skill else skills - skill }); Text(skill) } }; if (availableSkills.isEmpty()) Text("无已安装技能") } }
            item { Panel { Text("MCP"); availableMcp.forEach { server -> Row { Checkbox(server in mcp, { checked -> mcp = if (checked) mcp + server else mcp - server }); Text(server) } }; if (availableMcp.isEmpty()) Text("无已启用 MCP") } }
        }
        item { Picker("权限", policy, listOf("ask" to "Ask · 使用现有 AX 审批", "deny" to "Deny · 拒绝受限工具")) { policy = it } }
        item { Field("最大并发", concurrency, { concurrency = it }) }
        item { Button(enabled = validCatalog && name.isNotBlank() && (provider.isBlank() == model.isBlank()) && (concurrency.toIntOrNull() ?: 0) > 0 && !state.busy, onClick = {
            vm.perform { createMember(crew, NewMember(name.trim(), role.trim(), device, cwd.trim(), provider.ifBlank { null }, model.ifBlank { null }, skills, mcp, policy, concurrency.toInt())); done() }
        }, modifier = Modifier.fillMaxWidth()) { Text("创建 Agent") } }
    }
}

@Composable fun PermissionsScreen(vm: CrewViewModel, state: ClientState) {
    val snapshot = state.crew.snapshot
    Page("权限审批", "PERMISSIONS / AX TOOL REQUESTS") {
        if (snapshot.permissions.isEmpty()) item { Panel { Text("没有待处理审批"); Text("请求由 AX 发起；未回答的请求会在五分钟后拒绝。") } }
        items(snapshot.permissions, key = { it.request_id }) { permission -> Panel {
            val session = snapshot.sessions.find { it.ax_session_id == permission.request.sessionId }
            val task = snapshot.tasks.find { it.id == session?.task_id }
            Text(permission.request.toolCall.title, style = MaterialTheme.typography.titleMedium)
            Text(task?.title ?: "AX Session ${permission.request.sessionId}")
            Code(permission.request.toolCall.rawInput.toString())
            Text("批准范围由 AX 的 PermissionStore 执行，Allow Session 仅作用于该 AX 会话。", style = MaterialTheme.typography.bodySmall)
            listOf("allow_once" to "Allow Once", "allow_session" to "Allow Session", "reject_once" to "Reject").forEach { (choice, label) ->
                OutlinedButton(enabled = !state.busy && state.crew.connection == "已连接", onClick = { vm.perform { resolve(permission.request_id, choice) } }, modifier = Modifier.fillMaxWidth()) { Text(label) }
            }
        } }
    }
}

@Composable fun ActivityScreen(state: ClientState, open: (String) -> Unit) {
    Page("动态", "ACTIVITY / 最近 300 条事件") {
        items(state.crew.events, key = { it.event_id }) { event -> Entry(event.kind, "${DateFormat.getTimeInstance().format(Date(event.timestamp * 1000))} · ${event.task_id ?: event.device_id ?: "Gateway"}") { event.task_id?.let(open) } }
        if (state.crew.events.isEmpty()) item { Text("暂无事件") }
    }
}
@Composable fun ArtifactsScreen(state: ClientState, open: (String) -> Unit) {
    Page("产物", "ARTIFACTS / 已完成任务的输出") {
        items(state.crew.snapshot.tasks.filter { !it.output?.str("text").isNullOrBlank() }.reversed(), key = { it.id }) { task -> Entry(task.title, task.output?.str("text").orEmpty().take(400), task.status) { open(task.id) } }
    }
}
