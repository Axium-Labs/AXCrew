package com.axcrew.android.feature

import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.axcrew.android.data.model.*
import com.axcrew.android.ui.MarkdownMessage
import com.axcrew.android.ui.Panel
import com.axcrew.android.voice.*
import kotlinx.coroutines.delay

@Composable fun VoiceCallScreen(vm: CrewViewModel, state: ClientState, call: CallSession, close: () -> Unit) {
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val audio = remember(call.key) { VoiceAudio(context.applicationContext, vm::pauseCall) }
    val sound by audio.state.collectAsStateWithLifecycle()
    var foreground by remember { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    var permissionError by remember { mutableStateOf<String?>(null) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) { permissionError = null; audio.clearError(); vm.resumeCall() }
        else { permissionError = "未获得麦克风权限。可在系统设置中允许后继续。"; vm.pauseCall() }
    }
    fun resume() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            permissionError = null; audio.clearError(); vm.resumeCall()
        } else permission.launch(Manifest.permission.RECORD_AUDIO)
    }
    DisposableEffect(audio, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            foreground = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
            if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP) { audio.stop(); vm.pauseCall() }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); audio.close(); vm.pauseCall() }
    }
    LaunchedEffect(audio) { audio.recognized.collect {
        if (!vm.sendVoice(it)) { audio.stop(); vm.pauseCall(); permissionError = "当前状态不能提交语音，这句话未发送。请检查连接、执行中的任务或待处理审批后继续。" }
        else audio.speak("收到，正在发送给电脑。")
    } }
    val task = state.crew.snapshot.tasks.find { it.id == call.taskId }
    val waiting = task?.active == true || call.taskId != null && task == null
    val connected = state.crew.connection == "已连接"
    val approvals = state.crew.snapshot.permissions
    val response = when (task?.status) {
        "failed" -> "任务失败。${task.output?.str("error").orEmpty()}"
        "cancelled" -> "任务已停止。"
        else -> task?.output?.str("text").orEmpty().ifBlank {
            transcript(state.crew.streams[call.taskId].orEmpty()).lastOrNull { it.role == "AX" }?.text.orEmpty()
        }
    }
    // 语音只念精简摘要，完整工作内容保留在上面的文字面板与会话里。
    val spoken = voiceSummary(response, "任务已完成，详细结果请查看会话。")
    LaunchedEffect(connected) { if (!connected) { audio.stop(); vm.pauseCall() } }
    LaunchedEffect(sound.phase) { if (sound.phase == "error") vm.pauseCall() }
    LaunchedEffect(call.paused, call.sending, call.taskId, call.spokenTaskId, waiting, connected, foreground, state.busy, approvals.size, sound.phase, sound.ttsReady) {
        if (!foreground || call.paused || !connected) {
            if (sound.phase != "idle" && sound.phase != "error") audio.stop()
            return@LaunchedEffect
        }
        if (call.sending || waiting || state.busy || approvals.isNotEmpty()) {
            // Waiting stops capture, but must not cut off acknowledgement/progress playback.
            if (sound.phase in setOf("listening", "recognizing", "submitted")) audio.stop()
            return@LaunchedEffect
        }
        if (sound.phase == "error" || !sound.ttsReady) return@LaunchedEffect
        if (task != null && call.spokenTaskId != task.id) {
            vm.markCallSpoken(task.id)
            audio.speak(spoken)
        } else if (sound.phase == "idle") {
            // Let the speaker finish before opening the microphone, preventing reply echo.
            delay(650)
            audio.listen()
        }
    }
    // 执行中的进度播报：按“工具开始/待审批”事件提示当前步骤，限频避免刷屏。
    // 执行期间麦克风不收音（见上面的等待分支），播报不会被误识别成指令。
    var announced by remember(call.key) { mutableStateOf(setOf<String>()) }
    var lastProgress by remember(call.key) { mutableLongStateOf(0L) }
    LaunchedEffect(call.key, state.crew.events, approvals, task?.status, sound.phase, call.paused, connected, foreground) {
        if (call.paused || call.sending || !connected || !foreground || task?.active != true || sound.phase != "idle") return@LaunchedEffect
        val now = SystemClock.elapsedRealtime()
        if (now - lastProgress < 20_000) return@LaunchedEffect
        val step = nextProgress(call.taskId, state.crew.events, approvals, announced) ?: return@LaunchedEffect
        announced = (announced + step.second).toList().takeLast(200).toSet()
        lastProgress = now
        audio.speak(step.first)
    }
    // 心跳：任务长时间没有新进展时提示仍在执行；完成、暂停或断线即退出。
    LaunchedEffect(call.key, task?.status, waiting, call.paused, sound.phase) {
        while (waiting && !call.paused && !call.sending) {
            delay(90_000)
            if (!waiting || call.paused || call.sending) break
            if (sound.phase != "idle") continue
            val now = SystemClock.elapsedRealtime()
            if (now - lastProgress < 80_000) continue
            val done = state.crew.events.filter { it.task_id == call.taskId && it.kind == "tool.completed" }.map { it.payload.str("toolCallId") }.distinct().size
            lastProgress = now
            audio.speak(if (done > 0) "已完成 $done 个步骤，任务还在进行中。" else "任务还在进行中，请稍候。")
        }
    }
    val started = rememberSaveable(call.key) { SystemClock.elapsedRealtime() }
    var elapsed by remember { mutableLongStateOf(0) }
    LaunchedEffect(call.key) { while (true) { elapsed = ((SystemClock.elapsedRealtime() - started) / 1000).coerceAtLeast(0); delay(1000) } }
    val title = when {
        call.error != null -> "请检查提交结果"
        !connected -> "等待 Gateway 连接"
        approvals.isNotEmpty() -> "电脑正在等待审批"
        call.paused -> "通话已暂停"
        call.sending -> "正在发送给电脑"
        waiting -> "电脑正在执行"
        sound.phase == "speaking" -> "AX 正在回复"
        sound.phase == "recognizing" -> "正在识别"
        sound.phase == "listening" -> "正在听，请说话"
        !sound.ttsReady -> "正在准备语音服务"
        else -> "准备下一轮对话"
    }
    val level by animateFloatAsState(if (sound.phase == "listening") .7f + sound.level * .3f else .75f, label = "voice-level")
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.safeDrawingPadding().padding(22.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("AX 语音通话", style = MaterialTheme.typography.titleLarge)
                Text(state.crew.snapshot.devices.find { it.id == call.device }?.name ?: call.device, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("%02d:%02d".format(elapsed / 60, elapsed % 60), style = MaterialTheme.typography.labelMedium)
                Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
                    Spacer(Modifier.height(30.dp))
                    Box(Modifier.size(144.dp).background(MaterialTheme.colorScheme.primaryContainer.copy(alpha = level), CircleShape), contentAlignment = Alignment.Center) {
                        Box(Modifier.size((100 * level).dp).background(Brush.linearGradient(listOf(MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.secondary)), CircleShape), contentAlignment = Alignment.Center) { Text("AX", color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold) }
                    }
                    Spacer(Modifier.height(24.dp))
                    Text(title, style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(16.dp))
                    Text("说完会自动发送给电脑；工具操作仍需审批。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(16.dp))
                    (permissionError ?: call.error ?: sound.error)?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    if (sound.partial.isNotBlank() || call.heard.isNotBlank()) Panel { Text("你说", style = MaterialTheme.typography.labelMedium); Text(sound.partial.ifBlank { call.heard }) }
                    if (response.isNotBlank()) { Spacer(Modifier.height(12.dp)); Panel {
                        Text("AX", style = MaterialTheme.typography.labelMedium); MarkdownMessage(response.take(6000))
                        TextButton(enabled = !waiting && !call.paused && !state.busy && connected && approvals.isEmpty(), onClick = { audio.speak(spoken) }) { Text("重播回复") }
                    } }
                    approvals.forEach { approval ->
                        Spacer(Modifier.height(12.dp))
                        Panel {
                            Text("权限请求", style = MaterialTheme.typography.labelMedium)
                            Text(approval.request.toolCall.title)
                            Text(approval.request.toolCall.rawInput.toString().take(1800), style = MaterialTheme.typography.bodySmall)
                            listOf("allow_once" to "Allow Once · 允许一次", "allow_session" to "Allow Session · 本会话允许", "reject_once" to "Reject · 拒绝").forEach { (id, label) ->
                                if (approval.request.options.any { it.optionId == id }) OutlinedButton(enabled = !state.busy, onClick = { vm.perform { resolve(approval.request_id, id) } }, modifier = Modifier.fillMaxWidth()) { Text(label) }
                            }
                        }
                    }
                    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    Spacer(Modifier.height(20.dp))
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        FilledTonalIconButton(enabled = call.error == null && connected && !call.sending, onClick = { if (call.paused) resume() else { vm.pauseCall(); audio.stop() } }, modifier = Modifier.size(58.dp)) { Icon(if (call.paused) Icons.Outlined.Mic else Icons.Outlined.MicOff, if (call.paused) "继续通话" else "暂停通话") }
                        Text(if (call.paused) "开始 / 继续" else "暂停", style = MaterialTheme.typography.labelSmall)
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        FilledIconButton(onClick = close, colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.error), modifier = Modifier.size(66.dp)) { Icon(Icons.Outlined.CallEnd, "挂断语音") }
                        Text("挂断", style = MaterialTheme.typography.labelSmall)
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        FilledTonalIconButton(enabled = task?.active == true && !state.busy, onClick = { task?.let { vm.perform { taskAction(it.id, "cancel") } } }, modifier = Modifier.size(58.dp)) { Icon(Icons.Outlined.Stop, "停止电脑任务") }
                        Text("停止任务", style = MaterialTheme.typography.labelSmall)
                    }
                }
                Spacer(Modifier.height(12.dp))
                Text("挂断只结束语音，已提交的电脑任务继续运行。", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
