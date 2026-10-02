package com.axcrew.android.feature

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.zxing.BinaryBitmap
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import java.util.concurrent.Executors

/** 解析桌面端生成的配对二维码：axcrew://pair?host=...&code=...（兼容旧的 axcrew://connect?host=...&token=...）。返回 (地址, 配对码)。 */
fun parseConnectCode(text: String): Pair<String, String>? {
    val trimmed = text.trim()
    if (!trimmed.startsWith("axcrew://")) return null
    if (!trimmed.startsWith("axcrew://connect") && !trimmed.startsWith("axcrew://pair")) return null
    val query = trimmed.substringAfter("?", "").ifEmpty { return null }
    val params = query.split("&").mapNotNull { part ->
        val kv = part.split("=", limit = 2)
        if (kv.size != 2) null else kv[0] to Uri.decode(kv[1])
    }.toMap()
    val host = params["host"]?.takeIf { it.isNotBlank() } ?: return null
    val code = params["code"]?.takeIf { it.isNotBlank() } ?: params["token"]?.takeIf { it.isNotBlank() } ?: return null
    return host to code
}

/** 从 CameraX 帧解码二维码文本（仅 Y 亮度平面，未转 Bitmap，开销低）。 */
private fun decodeQrText(image: ImageProxy): String? {
    val plane = image.planes[0]
    if (plane.pixelStride != 1) return null
    val width = image.width
    val height = image.height
    val rowStride = plane.rowStride
    val bytes = ByteArray(width * height)
    plane.buffer.rewind()
    if (rowStride == width) {
        plane.buffer.get(bytes)
    } else {
        for (row in 0 until height) {
            plane.buffer.position(row * rowStride)
            plane.buffer.get(bytes, row * width, width)
        }
    }
    return try {
        val source = PlanarYUVLuminanceSource(bytes, width, height, 0, 0, width, height, false)
        QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source))).text
    } catch (_: Exception) {
        null
    }
}

/** 全屏扫码页：识别到配对二维码后通过 onResult(host, token) 回调。 */
@Composable
fun ScanQrOverlay(onDismiss: () -> Unit, onResult: (host: String, token: String) -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }
    var granted by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }
    var finished by remember { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed -> granted = allowed }

    DisposableEffect(Unit) { onDispose { cameraExecutor.shutdown() } }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Box(Modifier.fillMaxSize()) {
            if (granted) {
                val previewView = remember { PreviewView(context) }
                AndroidView(factory = { previewView }) { pv ->
                    val providerFuture = ProcessCameraProvider.getInstance(context)
                    providerFuture.addListener({
                        val provider = providerFuture.get()
                        val preview = Preview.Builder().build().also { it.setSurfaceProvider(pv.surfaceProvider) }
                        val analysis = ImageAnalysis.Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                        analysis.setAnalyzer(cameraExecutor) { image ->
                            val text = decodeQrText(image)
                            image.close()
                            if (text != null && !finished) {
                                val parsed = parseConnectCode(text)
                                if (parsed != null) {
                                    finished = true
                                    ContextCompat.getMainExecutor(context).execute { onResult(parsed.first, parsed.second) }
                                }
                            }
                        }
                        provider.unbindAll()
                        provider.bindToLifecycle(lifecycleOwner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                    }, ContextCompat.getMainExecutor(context))
                }
                // 中央取景框 + 遮罩
                Box(Modifier.fillMaxSize()) {
                    val frame = Modifier.align(Alignment.Center).size(240.dp).clip(RoundedCornerShape(20.dp))
                        .border(2.dp, MaterialTheme.colorScheme.primary)
                    Box(frame)
                    Text("将二维码放入框内", Modifier.align(Alignment.Center).offset(y = 150.dp),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onBackground)
                }
            } else {
                Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    Icon(Icons.Outlined.QrCodeScanner, null, Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.height(16.dp))
                    Text("需要相机权限来扫描二维码", style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(8.dp))
                    Text("用于扫描桌面端「连接手机」页的配对二维码", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(20.dp))
                    Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) { Text("授予相机权限") }
                }
            }

            // 顶部返回栏
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "取消") }
                Text("扫描二维码连接", style = MaterialTheme.typography.titleMedium)
            }
            if (granted) Text("识别后自动填好地址与 Token 并连接", Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 34.dp),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onBackground.copy(alpha = .7f))
        }
    }
}
