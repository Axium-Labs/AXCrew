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
 *
 * 讯飞按 appid 限制同时在线的连接数，并且日调用量有上限。超过限制时连接会被
 * 拒绝（10800 / 11200 / 11201），表现就是“怎么都连不上，杀掉一端才恢复”。
 * 因此这里做了两件事：全进程同一时刻只允许一路识别，并且在释放时立刻断开
 * 底层 socket，而不是等 okhttp 自己慢慢关。
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
        // 抢占用同一把讯飞通道：上一次识别若还在收尾（socket 未完全关闭、服务端仍记着这条
        // 连接），新连接就会被计入并发数而失败。这里直接让旧的立即断开。
        ActiveSession.claim(this)
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
                        if (code != 0) { fail(xfyError(code, json.optString("message", ""))); return }
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
                    if (!released) fail(handshakeError(t, response))
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
        // cancel() 而不是 close()：close() 只排队一个关闭帧，服务端不回应时连接会继续
        // 记在讯飞的并发数上，下一次识别就被判超限。cancel() 立即断开。
        socket?.cancel(); socket = null
        ActiveSession.release(this)
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

    companion object {
        /**
         * 共用一个 OkHttpClient。
         *
         * 之前每次识别（通话每一轮、每次按住说话）都新建一个客户端并且从不关闭，
         * 线程池与连接池随之累积；语音通话一轮一句，几分钟就能堆出几十个。
         * 客户端本身是线程安全、可复用的。
         */
        private val client: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS) // 流式长连接不读超时
                .build()
        }
    }
}

/**
 * 全进程唯一的讯飞连接槽位。
 *
 * 讯飞对同一个 appid 限制并发连接数，超出后新连接会被直接拒绝，而表现只是“连不上”，
 * 用户只能靠杀掉其中一端来恢复。语音通话与按住说话共用同一套密钥，因此这里保证同一
 * 时刻只有一路识别，后发起的直接接管先前的。
 */
private object ActiveSession {
    private val lock = Any()
    private var current: XfyRecognizer? = null

    fun claim(recognizer: XfyRecognizer) {
        // 先在锁内换手、再在锁外取消旧会话：cancel() 会回调 release() 重新进入这里，
        // 若持锁调用就与 release() 形成反向加锁顺序（讯飞在另一线程报错时可能死锁）。
        val previous = synchronized(lock) { current.also { current = recognizer } }
        if (previous != null && previous !== recognizer) previous.cancel()
    }

    fun release(recognizer: XfyRecognizer) {
        synchronized(lock) { if (current === recognizer) current = null }
    }
}

/** 讯飞错误码 → 可操作的提示。保留原始 message，便于和讯飞控制台日志对上。 */
private fun xfyError(code: Int, message: String): String {
    val hint = when (code) {
        10800 -> "讯飞同时在线连接数已满（同一 APPID 的其它设备，或上一通语音还没断开）。请结束其它端上的语音后再试。"
        11200 -> "该 APPID 没有语音听写授权，或总调用量已用尽。请在讯飞控制台开通「语音听写（流式版）」。"
        11201 -> "讯飞当日调用量已超限，请明天再试或提升配额。"
        10005 -> "讯飞拒绝了该 APPID：请确认已开通语音听写服务。"
        10114 -> "识别会话超过 60 秒上限，请重新说话。"
        10200 -> "超过 10 秒没有收到音频，识别已被服务端断开，请重新说话。"
        10101 -> "讯飞已结束本会话，请重新说话。"
        10163, 10160, 10161 -> "讯飞拒绝了请求参数（可能是 APPID / APIKey / APISecret 不匹配），请在电脑端重新保存语音密钥。"
        else -> "讯飞识别错误（$code）"
    }
    return "$hint ${message.take(120)}".trim()
}

/** 握手失败时的提示：带上 HTTP 状态与响应体，否则只剩 “Expected HTTP 101” 这种无从下手的报错。 */
private fun handshakeError(t: Throwable, response: Response?): String {
    if (response == null) return "讯飞连接失败：${t.message ?: "网络不可达"}。请检查手机网络后重试。"
    val status = response.code
    val body = try { response.body?.string()?.take(200).orEmpty() } catch (_: Exception) { "" }
    val reason = when (status) {
        401, 403 -> "鉴权被拒绝：APPID / APIKey / APISecret 可能不匹配，请在电脑端重新保存语音密钥。"
        429 -> "请求过于频繁或并发超限，请稍后再试。"
        else -> "HTTP $status。"
    }
    return "讯飞握手失败（$reason）${body.trim()}".trim()
}
