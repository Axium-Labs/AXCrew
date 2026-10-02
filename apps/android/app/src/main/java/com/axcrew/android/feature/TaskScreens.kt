package com.axcrew.android.feature

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.axcrew.android.data.model.*
import com.axcrew.android.ui.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

@Composable fun TaskList(state: ClientState, open: (String) -> Unit, create: () -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("") }
    val snapshot = state.crew.snapshot
    val tasks = snapshot.tasks.filter { (filter.isEmpty() || it.status == filter) && it.title.contains(search, true) }.reversed()
    Page("任务", "TASKS / ${snapshot.tasks.count { it.active }} ACTIVE") {
        item { Button(onClick = create) { Text("＋ 创建任务") } }
        item { Field("搜索任务", search, { search = it }) }
        item { Picker("状态", filter, listOf("" to "全部") + listOf("pending", "ready", "running", "waiting_permission", "waiting_user", "completed", "failed", "cancelled").map { it to it }) { filter = it } }
        items(tasks, key = { it.id }) { task -> Entry(task.title, "${snapshot.members.find { it.id == task.assigned_member }?.name ?: "Agent"} · ${snapshot.devices.find { it.id == task.assigned_device }?.name ?: task.assigned_device}", task.status) { open(task.id) } }
        if (tasks.isEmpty()) item { Text(if (state.crew.loaded) "没有匹配的任务" else "正在同步任务…") }
    }
}

@Composable fun ConversationsScreen(state: ClientState, open: (String) -> Unit, create: () -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    val groups = conversations(state.crew.snapshot).filter { it.root.title.contains(search, true) }
    Page("会话", "AX CREW / REMOTE WORKSPACE") {
        item { Button(onClick = create) { Text("＋ 新任务 / 会话") } }
        item { Field("搜索会话", search, { search = it }) }
        items(groups, key = { it.root.id }) { group -> Entry(group.root.title, state.crew.snapshot.members.find { it.id == group.latest.assigned_member }?.name.orEmpty(), group.latest.status) { open(group.latest.id) } }
        if (groups.isEmpty()) item { Panel { Text("从一项任务开始"); Text("选择设备上的 Agent，把任务交给 AX 执行。", style = MaterialTheme.typography.bodySmall) } }
    }
}

@Composable fun CreateTaskScreen(vm: CrewViewModel, state: ClientState, deviceId: String, open: (String) -> Unit) {
    val snapshot = state.crew.snapshot
    var device by rememberSaveable { mutableStateOf(deviceId) }
    var crew by rememberSaveable { mutableStateOf("") }
    var member by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    var prompt by rememberSaveable { mutableStateOf("") }
    var priority by rememberSaveable { mutableStateOf("0") }
    var dependencies by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var start by rememberSaveable { mutableStateOf(true) }
    val available = snapshot.members.filter { (device.isEmpty() || it.device_id == device) && (crew.isEmpty() || it.crew_id == crew) }
    val selected = available.find { it.id == member }
    LaunchedEffect(available.map { it.id }) { if (selected == null) member = available.firstOrNull()?.id.orEmpty() }
    val previous = snapshot.tasks.filter { it.crew_id == selected?.crew_id }
    LaunchedEffect(selected?.crew_id) { dependencies = emptyList() }
    Page("创建任务", "提交给 Gateway，由远程 AX 执行") {
        item { Picker("设备", device, listOf("" to "全部设备") + snapshot.devices.map { it.id to "${it.name} · ${it.status}" }) { device = it; member = "" } }
        item { Picker("Crew", crew, listOf("" to "全部团队") + snapshot.crews.map { it.id to it.name }) { crew = it; member = "" } }
        item { Picker("Agent", member, available.map { it.id to "${it.name} · ${it.role}" }) { member = it } }
        if (available.isEmpty()) item { Text("所选设备或团队还没有 Agent。请先在「团队」中添加 Agent 并指定电脑上的工作目录。") }
        selected?.let { agent -> item { Panel { Text("${agent.name} → ${snapshot.devices.find { it.id == agent.device_id }?.name ?: agent.device_id}"); Code(agent.cwd); Text("权限：${if (agent.permission_profile == "deny") "Deny" else "Ask"} · ${agent.model ?: "AX 默认模型"}", style = MaterialTheme.typography.bodySmall) } } }
        item { Field("任务标题", title, { title = it }) }
        item { Field("交给 AX 的任务", prompt, { prompt = it }, 5) }
        item { Field("优先级（整数）", priority, { priority = it }) }
        if (previous.isNotEmpty()) item { Panel {
            Text("前置任务（可选）")
            Picker("添加依赖", "", previous.filter { it.id !in dependencies }.map { it.id to it.title }) { dependencies = dependencies + it }
            dependencies.forEach { id -> TextButton(onClick = { dependencies = dependencies - id }) { Text("移除 · ${previous.find { it.id == id }?.title ?: id}") } }
            Text("依赖完成后由 Gateway 自动调度，并把前置任务输出加入提示词。", style = MaterialTheme.typography.bodySmall)
        } }
        item { Row { Checkbox(start, { start = it }); Text("创建后立即开始（无依赖任务）", Modifier.padding(top = 12.dp)) } }
        item { Button(enabled = selected != null && title.isNotBlank() && prompt.isNotBlank() && priority.toIntOrNull() != null && !state.busy, onClick = {
            val target = selected ?: return@Button
            vm.perform {
                val task = createTask(target, title.trim(), prompt.trim(), dependencies, priority.toInt())
                requestRefresh(); open(task.id)
                if (start && dependencies.isEmpty()) taskAction(task.id, "start")
            }
        }, modifier = Modifier.fillMaxWidth()) { Text(if (state.busy) "提交中…" else "创建任务") } }
    }
}

@Composable fun TaskScreen(vm: CrewViewModel, state: ClientState, id: String, open: (String) -> Unit) {
    val snapshot = state.crew.snapshot
    val task = snapshot.tasks.find { it.id == id }
    var history by remember(id) { mutableStateOf<History?>(null) }
    var historyError by remember(id) { mutableStateOf<String?>(null) }
    var settled by remember(id) { mutableStateOf(false) }
    var message by rememberSaveable(id) { mutableStateOf("") }
    var refresh by remember(id) { mutableIntStateOf(0) }
    val binding = snapshot.sessions.find { it.task_id == id }
    // A periodic AX snapshot recovers deltas missed while offline; event metadata is not a transcript.
    LaunchedEffect(id, binding?.ax_session_id, task?.status, state.crew.connection, refresh) {
        if (binding == null || state.crew.connection != "已连接") return@LaunchedEffect
        do {
            try { history = vm.history(id); settled = task?.active == false; historyError = null }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { historyError = e.message ?: "无法读取 AX 历史" }
            if (task?.active != true) break
            delay(15_000)
        } while (true)
    }
    val latest = conversations(snapshot).find { it.root.id == id || snapshot.sessions.find { s -> s.task_id == it.latest.id }?.let { b -> b.ax_session_id == binding?.ax_session_id && b.device_id == binding?.device_id } == true }?.latest
    if (task == null) { Page("任务", "正在同步") { item { Text("任务尚未载入或已删除"); TextButton(onClick = vm::refresh) { Text("刷新") } } }; return }
    val lines = reconcile(history, state.crew.streams[id].orEmpty(), task, settled)
    Page(task.title, "TASK / ${id.take(8)}") {
        item { Panel {
            Status(task.status)
            Text("${snapshot.members.find { it.id == task.assigned_member }?.name ?: task.assigned_member} · ${snapshot.devices.find { it.id == task.assigned_device }?.name ?: task.assigned_device}")
            Text("第 ${task.retry_count + 1} 次执行 · ${task.dependencies.size} 项依赖", style = MaterialTheme.typography.bodySmall)
            if (task.status == "pending" && task.dependencies.all { dep -> snapshot.tasks.find { it.id == dep }?.status == "completed" }) Button(onClick = { vm.perform { taskAction(id, "start") } }, enabled = !state.busy) { Text("开始") }
            if (task.active) OutlinedButton(onClick = { vm.perform { taskAction(id, "cancel") } }, enabled = !state.busy) { Text("停止任务") }
            if (task.status in listOf("failed", "cancelled")) Button(onClick = { vm.perform { taskAction(id, "retry") } }, enabled = !state.busy) { Text("重试") }
            task.dependencies.forEach { dep -> TextButton(onClick = { open(dep) }) { Text("依赖 · ${snapshot.tasks.find { it.id == dep }?.title ?: dep}") } }
        } }
        if (historyError != null) item { Text("历史暂不可用：$historyError", color = MaterialTheme.colorScheme.error) }
        item { TextButton(onClick = { refresh++; vm.refresh() }) { Text("同步 AX 会话记录") } }
        items(lines.withIndex().toList(), key = { "${it.index}-${it.value.key}" }) { (_, line) -> Panel {
            Text(line.role + if (line.status.isBlank()) "" else " · ${line.status}", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
            SelectionContainer { MarkdownMessage(line.text) }
        } }
        task.output?.let { output -> item { Panel { Text("任务结果", style = MaterialTheme.typography.titleSmall); SelectionContainer { MarkdownMessage(output.str("error").ifEmpty { output.str("text") }) } } } }
        if (binding != null && latest?.id != null && latest.id != id) item { Button(onClick = { open(latest.id) }) { Text("打开此会话最新一轮") } }
        if (binding != null && !task.active && (latest == null || latest.id == id)) item { Panel {
            Field("继续此会话", message, { message = it }, 3)
            Button(enabled = message.isNotBlank() && !state.busy, onClick = { vm.perform { val next = followUp(id, message.trim()); message = ""; open(next.id) } }) { Text("发送") }
        } }
    }
}
