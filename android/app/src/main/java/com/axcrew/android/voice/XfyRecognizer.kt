package com.axcrew.android.voice

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.annotation.SuppressLint
import android.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * 讯飞语音听写（流式版，API 调用）。
 * 手机麦克风采集 16k 单声道 PCM → wss://iat-api.xfyun.cn/v2/iat → 返回识别文本。
 * 与按住说话、语音通话共用；不依赖手机厂商的 SpeechRecognizer 服务。
 */
@SuppressLint("MissingPermission") // RECORD_AUDIO 由调用方（VoiceAudio / Composer）检查并申请
class XfyRecognizer(private val appId: String, private val apiKey: String, private val apiSecret: String,
    private val automatic: Boolean = false) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var socket: WebSocket? = null
    private var record: AudioRecord? = null
    private var recordJob: Job? = null
    private var delivery: RecognitionDelivery? = null
    private val sentences = sortedMapOf<Int, StringBuilder>()
    private var lastSn = 0
    private var currentText = ""
    private var onPartial: ((String) -> Unit)? = null
    @Volatile private var released = false
    @Volatile private var stopping = false
    private var opened = false
    private var endSent = false

    /** 开始识别：立即建立讯飞连接并录音，音频持续上传直到 stop()/cancel()。 */
    fun start(partial: (String) -> Unit, result: (String) -> Unit, error: (String) -> Unit) {
        onPartial = partial
        delivery = RecognitionDelivery(automatic, result, error)
        val client = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS) // 流式长连接不读超时
            .build()
        try {
            socket = client.newWebSocket(Request.Builder().url(signedUrl()).build(), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    synchronized(this@XfyRecognizer) {
                        if (released) { webSocket.close(1000, null); return }
                        socket = webSocket
                        opened = true
                        sendFrame(0, "") // 首帧：声明应用与音频格式
                        if (stopping) sendFrame(2, "") else startRecording()
                    }
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (released) return
                    try {
                        val json = JSONObject(text)
                        val code = json.optInt("code", -1)
                        if (code != 0) { fail(json.optString("message", "讯飞识别错误（$code）")); return }
                        val data = json.optJSONObject("data")
                        val result = data?.optJSONObject("result")
                        if (result != null) {
                            val sn = result.optInt("sn", lastSn)
                            val pgs = result.optString("pgs", "apd") // rpl 替换 rg 指定的片段；apd 追加。
                            val chunk = StringBuilder()
                            val ws = result.optJSONArray("ws")
                            if (ws != null) for (i in 0 until ws.length()) {
                                val cw = ws.optJSONObject(i).optJSONArray("cw")
                                cw?.optJSONObject(0)?.let { chunk.append(it.optString("w")) }
                            }
                            if (pgs == "rpl") result.optJSONArray("rg")?.let { range ->
                                if (range.length() == 2) for (replaced in range.optInt(0)..range.optInt(1)) sentences.remove(replaced)
                            }
                            sentences[sn] = chunk
                            lastSn = sn
                            currentText = sentences.values.joinToString("")
                            onPartial?.invoke(currentText)
                        }
                        if (data?.optInt("status", 1) == 2) { // 结束帧：服务端判定静音结束
                            currentText = sentences.values.joinToString("")
                            release()
                            delivery?.serverFinal(currentText)
                        }
                    } catch (_: Exception) { fail("无法解析语音识别结果，请重试。") }
                }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    android.util.Log.e("XfyRecognizer", "ws failure: ${t.message}; code=${response?.code}", t)
                    if (!released) fail("讯飞连接失败：${t.message ?: "网络错误"}")
                }
                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    if (!released) fail("语音连接提前结束，请重试。")
                    webSocket.close(code, reason)
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (!released) fail("语音连接提前结束，请重试。")
                }
            })
        } catch (_: Exception) { fail("无法启动讯飞识别。") }
    }

    /** 松手：发送结束帧，等服务端返回最终文本后回调 result。 */
    @Synchronized fun stop() {
        delivery?.stop()
        if (released || stopping) return
        stopping = true
        stopRecording()
        sendFrame(2, "")
        scope.launch {
            delay(8_000)
            fail("语音识别超时，请重试。")
        }
    }

    /** 取消（上滑 / 切键盘 / 挂断）：直接断开，不返回结果。 */
    fun cancel() {
        delivery?.cancel()
        release()
    }

    @Synchronized private fun startRecording() {
        if (released || stopping) return
        try {
            val record = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16_000,
                AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, 4096)
            if (record.state != AudioRecord.STATE_INITIALIZED) { record.release(); fail("无法打开麦克风录音。"); return }
            this.record = record
            record.startRecording()
            recordJob = scope.launch {
                val buffer = ByteArray(1280) // 40ms @ 16k mono 16bit
                while (isActive && !released && !stopping) {
                    val read = try { record.read(buffer, 0, buffer.size) } catch (_: Exception) { -1 }
                    if (read > 0) {
                        val payload = if (read == buffer.size) buffer else buffer.copyOf(read)
                        sendFrame(1, Base64.encodeToString(payload, Base64.NO_WRAP))
                    } else if (read < 0) {
                        if (!released && !stopping) fail("麦克风录音中断，请重试。")
                        break
                    }
                }
            }
        } catch (_: Exception) { fail("无法打开麦克风录音。") }
    }

    @Synchronized private fun sendFrame(status: Int, audioBase64: String) {
        if (released || (status == 1 && stopping)) return
        if (!opened || (status == 2 && endSent)) return
        if (status == 2) endSent = true
        val payload = JSONObject()
        if (status == 0) {
            payload.put("common", JSONObject().put("app_id", appId))
            payload.put("business", JSONObject().put("language", "zh_cn").put("domain", "iat")
                .put("accent", "mandarin").put("vad_eos", if (automatic) 1200 else 10_000).put("dwa", "wpgs"))
        }
        payload.put("data", JSONObject().put("status", status).put("format", "audio/L16;rate=16000")
            .put("encoding", "raw").put("audio", audioBase64))
        socket?.send(payload.toString())
    }

    @Synchronized private fun stopRecording() {
        recordJob?.cancel(); recordJob = null
        record?.runCatching { if (recordingState == AudioRecord.RECORDSTATE_RECORDING) stop() }
        record?.release(); record = null
    }

    private fun fail(message: String) {
        release()
        delivery?.fail(message)
    }

    @Synchronized private fun release() {
        if (released) return
        released = true
        stopRecording()
        socket?.close(1000, null); socket = null
        scope.cancel()
    }

    /** 讯飞鉴权 URL：HMAC-SHA256 签名（语音听写流式版 v2）。 */
    private fun signedUrl(): String {
        val host = "iat-api.xfyun.cn"
        val path = "/v2/iat"
        val date = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss 'GMT'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("GMT") }.format(Date())
        val origin = "host: $host\ndate: $date\nGET $path HTTP/1.1"
        val signature = Base64.encodeToString(hmacSha256(apiSecret, origin), Base64.NO_WRAP)
        val authorization = Base64.encodeToString(
            "api_key=\"$apiKey\", algorithm=\"hmac-sha256\", headers=\"host date request-line\", signature=\"$signature\"".toByteArray(),
            Base64.NO_WRAP)
        // URL 参数必须用 %20 编码空格：URLEncoder 生成的 + 会被服务端当作字面字符导致鉴权 401。
        fun enc(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        return "wss://$host$path" +
            "?authorization=${enc(authorization)}" +
            "&date=${enc(date)}&host=$host"
    }

    private fun hmacSha256(secret: String, data: String): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(), "HmacSHA256"))
        return mac.doFinal(data.toByteArray())
    }
}
