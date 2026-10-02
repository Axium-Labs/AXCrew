package com.axcrew.android.feature

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.axcrew.android.data.model.*
import com.axcrew.android.ui.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import java.time.*
import java.time.format.DateTimeFormatter

private fun stamp(value: Long?) = value?.let { Instant.ofEpochSecond(it).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MM-dd HH:mm")) } ?: "—"
private fun frequency(item: Automation) = when (item.schedule_kind) {
    "daily" -> "每天 ${item.daily_time}"
    "weekly" -> "每周 ${item.weekdays} · ${item.daily_time}"
    else -> "每 ${item.interval_minutes} 分钟"
}
@Composable fun ScheduleScreen(vm: CrewViewModel, state: ClientState, openTask: (String) -> Unit) {
    var plans by remember { mutableStateOf(emptyList<Automation>()) }
    var runs by remember { mutableStateOf(emptyList<AutomationRun>()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var revision by remember { mutableIntStateOf(0) }
    var view by rememberSaveable { mutableStateOf("list") }
    var search by rememberSaveable { mutableStateOf("") }
    var editor by remember { mutableStateOf<Automation?>(null) }
    var deleting by remember { mutableStateOf<Automation?>(null) }
    LaunchedEffect(state.configured, state.crew.connection, revision) {
        if (!state.configured || state.crew.connection == "后台暂停") return@LaunchedEffect
        while (true) {
            try { plans = vm.automations(); runs = vm.automationRuns(); error = null; loaded = true }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message }
            delay(10_000)
        }
    }
    val filtered = plans.filter { it.name.contains(search, true) || it.message.contains(search, true) }
    Page("计划", "让 AX 按你的时间安排工作") {
        item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(enabled = state.configured, onClick = { editor = Automation() }) { Icon(Icons.Outlined.Add, null); Text("新建计划") }
            OutlinedButton(onClick = { revision++ }, enabled = state.configured) { Text("刷新") }
        } }
        item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("list" to "计划", "calendar" to "日历", "runs" to "执行记录").forEach { (key, label) -> FilterChip(selected = view == key, onClick = { view = key }, label = { Text(label) }) }
        } }
        error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
        if (view != "runs") item { Field("搜索计划", search, { search = it }) }
        if (view == "list") {
            if (plans.isEmpty() && (loaded || !state.configured)) item { Panel {
                Text("让重复的工作自动进行", style = MaterialTheme.typography.titleMedium)
                Text("创建每日检查、固定间隔任务，或工作日简报。执行由电脑端安排。")
                listOf("每晚构建监控" to "构建并测试项目，报告失败项和修复建议。", "站会简报" to "汇总昨天的提交、测试状态和阻塞项。", "依赖巡检" to "检查项目依赖的新版本与安全公告。").forEachIndexed { i, (name, message) ->
                    TextButton(enabled = state.configured, onClick = { editor = Automation(name = name, message = message, schedule_kind = if (i == 1) "weekly" else "daily", daily_time = if (i == 0) "02:00" else "09:00") }) { Text(name) }
                }
            } }
            items(filtered, key = { it.id }) { item -> Panel {
                Text(item.name, style = MaterialTheme.typography.titleMedium)
                Text(item.message, maxLines = 3)
                Text("${frequency(item)} · ${if (item.enabled) "已启用" else "已暂停"}", color = MaterialTheme.colorScheme.primary)
                Text("下次 ${stamp(item.next_run_at)} · 已运行 ${item.run_count} 次", style = MaterialTheme.typography.bodySmall)
                Row {
                    TextButton(enabled = !state.busy, onClick = { editor = item }) { Text("编辑") }
                    TextButton(enabled = !state.busy, onClick = { vm.perform { toggleAutomation(item); revision++ } }) { Text(if (item.enabled) "暂停" else "启用") }
                    TextButton(enabled = !state.busy, onClick = { vm.perform { val task = runAutomation(item.id); revision++; openTask(task.id) } }) { Text("运行") }
                    IconButton(enabled = !state.busy, onClick = { deleting = item }) { Icon(Icons.Outlined.DeleteOutline, "删除计划") }
                }
            } }
        } else if (view == "runs") {
            if (runs.isEmpty()) item { Text("暂无执行记录") }
            items(runs, key = { it.id }) { run -> Entry(run.name ?: "计划执行", "${stamp(run.started_at)} · ${run.status}\n${run.detail.orEmpty()}") { run.task_id?.let(openTask) } }
        } else {
            item { Text("未来七个日期 · 时间均按计划时区显示", style = MaterialTheme.typography.bodySmall) }
            (0..6).forEach { day ->
                val date = LocalDate.now().plusDays(day.toLong())
                item { Text(date.format(DateTimeFormatter.ofPattern("MM-dd EEEE")), style = MaterialTheme.typography.titleMedium) }
                val dated = filtered.filter { plan -> plan.enabled && if (plan.schedule_kind == "interval") true else {
                    plan.schedule_kind == "daily" || date.dayOfWeek.value.toString() in plan.weekdays.split(',')
                } }
                if (dated.isEmpty()) item { Text("没有计划", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(dated, key = { "$day:${it.id}" }) { plan -> Entry(plan.name, frequency(plan) + if (plan.schedule_kind == "interval") " · 持续运行" else " · UTC${ZoneOffset.ofTotalSeconds(plan.utc_offset_minutes * 60)}") { editor = plan } }
            }
        }
    }
    editor?.let { initial -> ScheduleEditor(initial, state, close = { editor = null }) { item -> vm.perform { saveAutomation(item); editor = null; revision++ } } }
    deleting?.let { item -> AlertDialog(onDismissRequest = { deleting = null }, title = { Text("删除计划？") }, text = { Text("将删除“${item.name}”的计划配置，已创建的任务保留。") }, confirmButton = { TextButton(enabled = !state.busy, onClick = { vm.perform { deleteAutomation(item.id); deleting = null; revision++ } }) { Text("删除") } }, dismissButton = { TextButton(onClick = { deleting = null }) { Text("取消") } }) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ScheduleEditor(initial: Automation, state: ClientState, close: () -> Unit, save: (Automation) -> Unit) {
    var draft by remember(initial) { mutableStateOf(initial) }
    var interval by remember(initial) { mutableStateOf(initial.interval_minutes.toString()) }
    val valid = draft.name.isNotBlank() && draft.message.isNotBlank() && when (draft.schedule_kind) {
        "interval" -> (interval.toIntOrNull() ?: 0) > 0
        "weekly" -> draft.weekdays.isNotBlank() && runCatching { LocalTime.parse(draft.daily_time) }.isSuccess
        else -> runCatching { LocalTime.parse(draft.daily_time) }.isSuccess
    }
    ModalBottomSheet(onDismissRequest = close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxHeight(.93f).imePadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (draft.id.isBlank()) "新建计划" else "编辑计划", style = MaterialTheme.typography.headlineSmall)
            Field("名称", draft.name, { draft = draft.copy(name = it) })
            OutlinedTextField(draft.message, { draft = draft.copy(message = it) }, Modifier.fillMaxWidth(), label = { Text("每次运行的指令") }, minLines = 3)
            Picker("运行频率", draft.schedule_kind, listOf("interval" to "固定间隔", "daily" to "每天", "weekly" to "每周")) { draft = draft.copy(schedule_kind = it) }
            if (draft.schedule_kind == "interval") Field("间隔（分钟）", interval, { interval = it }) else Field("时间（HH:mm）", draft.daily_time, { draft = draft.copy(daily_time = it) })
            if (draft.schedule_kind == "weekly") Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                (1..7).forEach { day -> val selected = day.toString() in draft.weekdays.split(',')
                    TextButton(onClick = { val days = draft.weekdays.split(',').filter(String::isNotBlank).toMutableSet(); if (selected) days.remove(day.toString()) else days.add(day.toString()); draft = draft.copy(weekdays = days.sorted().joinToString(",")) }, contentPadding = PaddingValues(0.dp), modifier = Modifier.weight(1f)) { Text((if (selected) "✓" else "") + listOf("一", "二", "三", "四", "五", "六", "日")[day - 1]) }
                }
            }
            Text("计划时区：UTC${ZoneOffset.ofTotalSeconds(draft.utc_offset_minutes * 60)}", style = MaterialTheme.typography.bodySmall)
            Picker("执行环境", draft.member_id.orEmpty(), listOf("" to "电脑端默认") + state.crew.snapshot.members.map { it.id to "${it.name} · ${it.cwd}" }) { draft = draft.copy(member_id = it.ifBlank { null }) }
            Text("工具审批沿用 AX 权限系统。手机创建的计划使用询问模式。", style = MaterialTheme.typography.bodySmall)
            Row { Checkbox(draft.silent, { draft = draft.copy(silent = it) }); Text("静默模式") }
            Row { Checkbox(draft.strict_schedule, { draft = draft.copy(strict_schedule = it) }); Text("严格按计划触发") }
            Row { Checkbox(draft.hide_from_chat, { draft = draft.copy(hide_from_chat = it) }); Text("在会话中隐藏") }
            Row { Checkbox(draft.lean_context, { draft = draft.copy(lean_context = it) }); Text("精简上下文") }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(enabled = valid && !state.busy, onClick = { save(draft.copy(interval_minutes = interval.toIntOrNull() ?: 60)) }, modifier = Modifier.fillMaxWidth()) { Text("保存计划") }
            Spacer(Modifier.height(16.dp))
        }
    }
}
