package com.axcrew.android.feature

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.axcrew.android.data.AttachmentReader
import com.axcrew.android.voice.XfyRecognizer
import com.axcrew.android.voice.XfyStore
import kotlinx.coroutines.launch
import java.io.File

@Composable fun Composer(
    draft: String, change: (String) -> Unit, uris: List<String>, attachments: (List<String>) -> Unit,
    model: String, selectModel: () -> Unit, thinking: String, selectThinking: (String) -> Unit,
    enabled: Boolean, busy: Boolean, running: Boolean,
    send: () -> Unit, stop: () -> Unit, sendVoice: (String) -> Unit,
) {
    val context = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    var thinkingMenu by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var photo by rememberSaveable { mutableStateOf<String?>(null) }
    fun add(values: List<Uri>) {
        if (uris.size + values.size > 4) { error = "每条消息最多 4 个附件"; return }
        attachments((uris + values.map(Uri::toString)).distinct()); error = null
    }
    val files = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { add(it) }
    val images = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { add(it) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        if (success) photo?.let { add(listOf(Uri.parse(it))) }; photo = null
    }
    // 讯飞语音识别：不依赖手机厂商识别服务，与语音通话共用同一模块。
    // 按住录音 → 讯飞实时听写 → 松开直接发送；上滑取消。
    val handler = remember { Handler(Looper.getMainLooper()) }
    val scope = rememberCoroutineScope()
    var listening by remember { mutableStateOf(false) }
    var pressing by remember { mutableStateOf(false) }
    var voiceMode by remember { mutableStateOf(false) }
    var voiceHint by remember { mutableStateOf<String?>(null) }
    var cancelledTurn by remember { mutableStateOf(false) }
    val lastRequestAt = remember { java.util.concurrent.atomic.AtomicLong(0L) }
    val xfyRef = remember { arrayOfNulls<XfyRecognizer>(1) }
    DisposableEffect(Unit) { onDispose { xfyRef[0]?.cancel(); xfyRef[0] = null } }
    fun launch(action: () -> Unit) { try { action(); error = null } catch (_: Exception) { error = "没有可用的相机或文件应用" } }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) { listening = false; voiceHint = "权限已开启，按住说话即可输入。" }
        else error = "需要麦克风权限才能语音输入。请到系统设置中允许后重试。"
    }
    fun tryBeginListening() {
        val config = XfyStore.current ?: return
        try {
            xfyRef[0]?.cancel(); xfyRef[0] = null
            cancelledTurn = false
            pressing = true
            listening = true
            voiceHint = "正在听，请说话…"
            xfyRef[0] = XfyRecognizer(config.appid, config.apiKey, config.apiSecret).apply {
                start(
                    partial = { text -> handler.post { if (!cancelledTurn) voiceHint = text.ifBlank { "正在听，请说话…" } } },
                    result = { text -> handler.post {
                        if (cancelledTurn) { cancelledTurn = false; return@post }
                        listening = false; pressing = false; voiceHint = null
                        if (text.isNotBlank()) sendVoice(text.trim())
                        else voiceHint = "没有听清，请再按住说一次。"
                    } },
                    error = { message -> handler.post {
                        if (cancelledTurn) { cancelledTurn = false; return@post }
                        listening = false; pressing = false; voiceHint = message
                    } }
                )
            }
        } catch (_: Exception) { pressing = false; listening = false; voiceHint = "无法启动讯飞语音识别。" }
    }
    fun startPressListening() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { micPermission.launch(Manifest.permission.RECORD_AUDIO); return }
        if (System.currentTimeMillis() - lastRequestAt.get() < 1500) { voiceHint = "操作太快了，稍等一下再按住说话。"; return }
        if (XfyStore.isFresh()) { tryBeginListening(); return }
        // 桌面端保存或更新 key 可能早于/晚于手机连接：按住时按需再取一次。
        pressing = true; listening = true
        voiceHint = "正在获取讯飞配置…"
        scope.launch {
            val ok = XfyStore.ensure()
            handler.post {
                if (!ok) { pressing = false; listening = false; voiceHint = XfyStore.lastError ?: "电脑端未配置讯飞语音识别密钥。" }
                else if (pressing) tryBeginListening()
                else voiceHint = null
            }
        }
    }
    fun stopPressListening() {
        pressing = false
        try { xfyRef[0]?.stop(); xfyRef[0] = null } catch (_: Exception) { xfyRef[0]?.cancel(); xfyRef[0] = null; listening = false; voiceHint = null }
        lastRequestAt.set(System.currentTimeMillis())
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
        if (uris.isNotEmpty()) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items(uris) { value -> val label = remember(value) { AttachmentReader.name(context, Uri.parse(value)) }
                InputChip(selected = true, enabled = !busy, onClick = { attachments(uris - value) }, label = { Text(label.take(22)) }, trailingIcon = { Icon(Icons.Outlined.Close, "移除附件", Modifier.size(16.dp)) })
            }
        }
        Surface(shape = RoundedCornerShape(28.dp), tonalElevation = 2.dp, shadowElevation = 2.dp) {
            Column(Modifier.padding(8.dp)) {
                if (voiceMode) {
                    Box(Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(28.dp))
                        .background(if (pressing) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant)
                        .pointerInput(Unit) {
                            val threshold = 80.dp.toPx()
                            awaitEachGesture {
                                val down = awaitFirstDown()
                                val startY = down.position.y
                                startPressListening()
                                var cancelling = false
                                while (true) {
                                    val event = awaitPointerEvent()
                                    val change = event.changes.firstOrNull { it.id == down.id } ?: break
                                    if (!cancelling && change.position.y < startY - threshold) {
                                        cancelling = true; pressing = false; voiceHint = "松开取消"
                                    }
                                    if (!change.pressed) {
                                        if (cancelling) { cancelledTurn = true; xfyRef[0]?.cancel(); xfyRef[0] = null; listening = false; pressing = false; voiceHint = null }
                                        else stopPressListening()
                                        break
                                    }
                                }
                            }
                        },
                        contentAlignment = Alignment.Center) {
                        Text(if (pressing) "正在听，请说话…" else if (voiceHint == "松开取消") "松开取消" else "按住说话",
                            color = if (voiceHint == "松开取消") MaterialTheme.colorScheme.error else Color.Unspecified,
                            style = MaterialTheme.typography.bodyLarge)
                    }
                } else {
                    TextField(draft, change, Modifier.fillMaxWidth(), enabled = !busy, placeholder = { Text("发消息…") }, minLines = 2, maxLines = 5,
                        colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent, disabledContainerColor = Color.Transparent, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, disabledIndicatorColor = Color.Transparent))
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (voiceMode) {
                        IconButton(enabled = !busy, onClick = { voiceMode = false; xfyRef[0]?.cancel(); xfyRef[0] = null; listening = false; pressing = false; voiceHint = null }) { Icon(Icons.Outlined.Keyboard, "切换键盘输入") }
                    } else {
                        IconButton(enabled = !busy, onClick = { voiceMode = true }) { Icon(Icons.Outlined.Mic, "语音输入") }
                    }
                    Box {
                        OutlinedButton(onClick = { thinkingMenu = true }, enabled = !busy, contentPadding = PaddingValues(horizontal = 10.dp), shape = RoundedCornerShape(16.dp)) {
                            Text(thinkingLabel(thinking), maxLines = 1, style = MaterialTheme.typography.labelLarge)
                            Icon(Icons.Outlined.ExpandMore, null, Modifier.size(16.dp))
                        }
                        DropdownMenu(expanded = thinkingMenu, onDismissRequest = { thinkingMenu = false }) {
                            thinkingOptions.forEach { (value, label) ->
                                DropdownMenuItem(text = { Text(label) }, onClick = { selectThinking(value); thinkingMenu = false })
                            }
                        }
                    }
                    TextButton(onClick = selectModel, enabled = !busy, modifier = Modifier.weight(1f)) { Text(model, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis); Icon(Icons.Outlined.ExpandMore, null, Modifier.size(18.dp)) }
                    Box {
                        IconButton(enabled = !busy, onClick = { menu = true }) { Icon(Icons.Outlined.Add, "添加照片或文件") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("拍照") }, leadingIcon = { Icon(Icons.Outlined.PhotoCamera, null) }, onClick = { menu = false; launch {
                                val folder = File(context.cacheDir, "camera").apply { mkdirs() }
                                folder.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86_400_000 }?.forEach { it.delete() }
                                val file = File.createTempFile("photo-", ".jpg", folder)
                                photo = FileProvider.getUriForFile(context, context.packageName + ".attachments", file).toString()
                                camera.launch(Uri.parse(photo))
                            } })
                            DropdownMenuItem(text = { Text("选择图片") }, leadingIcon = { Icon(Icons.Outlined.Image, null) }, onClick = { menu = false; launch { images.launch(arrayOf("image/png", "image/jpeg", "image/webp", "image/gif")) } })
                            DropdownMenuItem(text = { Text("添加文件") }, leadingIcon = { Icon(Icons.Outlined.AttachFile, null) }, onClick = { menu = false; launch { files.launch(arrayOf("*/*")) } })
                        }
                    }
                    FilledIconButton(enabled = !busy && (running || enabled), onClick = if (running) stop else send) { Icon(if (running) Icons.Outlined.Stop else Icons.AutoMirrored.Outlined.Send, if (running) "停止" else "发送") }
                }
            }
        }
        (error ?: voiceHint)?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
}

/** 思考程度档位：空值=自动（跟随模型默认），low/medium/high 为显式推理预算。 */
val thinkingOptions = listOf("" to "自动", "low" to "快速", "medium" to "标准", "high" to "深度")
fun thinkingLabel(value: String): String = thinkingOptions.firstOrNull { it.first == value }?.second ?: value
