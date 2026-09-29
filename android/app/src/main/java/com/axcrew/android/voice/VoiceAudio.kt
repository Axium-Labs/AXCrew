package com.axcrew.android.voice

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import java.util.Locale

data class AudioState(val phase: String = "idle", val partial: String = "", val level: Float = 0f, val error: String? = null, val ttsReady: Boolean = false)

/** Main-thread audio owner. Half-duplex: recognition and playback never run together. */
class VoiceAudio(private val context: Context, private val interrupted: () -> Unit) {
    private val handler = Handler(Looper.getMainLooper())
    private val mutable = MutableStateFlow(AudioState())
    val state = mutable.asStateFlow()
    private val results = Channel<String>(Channel.BUFFERED)
    val recognized = results.receiveAsFlow()
    private var xfy: XfyRecognizer? = null
    private var tts: TextToSpeech? = null
    private val epochs = AudioEpoch()
    private var closed = false
    private var timeout: Runnable? = null
    private val manager = context.getSystemService(AudioManager::class.java)
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(attributes).setOnAudioFocusChangeListener({ value ->
            // 讯飞识别（XfyRecognizer）与系统朗读都会申请音频焦点；仅播报阶段
            // 的焦点丢失才按“被其他音频打断”处理：停止朗读并暂停通话。
            if (value < 0 && mutable.value.phase !in setOf("listening", "recognizing")) { stop(); interrupted() }
        }, handler).build()
    init {
        tts = TextToSpeech(context) { status -> handler.post {
            if (!closed) {
                val language = if (status == TextToSpeech.SUCCESS) tts?.setLanguage(Locale.getDefault()) else null
                val ready = language != null && language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED
                tts?.setAudioAttributes(attributes)
                mutable.value = mutable.value.copy(ttsReady = ready, error = if (ready) null else "系统朗读服务不可用或缺少当前语言，请安装语音数据后重试。")
            }
        } }
    }
    private fun focus(): Boolean {
        if (manager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            fail("暂时无法使用音频，请结束其他通话后继续。")
            return false
        }; return true
    }
    fun stop() {
        epochs.invalidate()
        timeout?.let(handler::removeCallbacks); timeout = null
        xfy?.cancel(); xfy = null
        tts?.stop(); manager.abandonAudioFocusRequest(focus)
        mutable.value = mutable.value.copy(phase = "idle", level = 0f)
    }
    private fun fail(message: String) {
        stop(); mutable.value = mutable.value.copy(phase = "error", error = message)
    }
    fun listen() {
        if (closed) return
        stop()
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { fail("需要麦克风权限才能通话"); return }
        if (!focus()) return
        val turn = epochs.current
        mutable.value = mutable.value.copy(phase = "listening", partial = "", error = null)
        if (!XfyStore.isFresh()) {
            // 电脑端保存/更新 key 可能早于或晚于手机连接：这里按需再取一次（有缓存则立即返回）。
            ioScope.launch {
                val ok = XfyStore.ensure()
                handler.post {
                    if (!closed && epochs.isCurrent(turn)) {
                        if (ok && XfyStore.current != null) listenNow(turn)
                        else fail(XfyStore.lastError ?: "电脑端未配置讯飞语音识别密钥。")
                    }
                }
            }
            return
        }
        listenNow(turn)
    }
    private fun listenNow(turn: Int) {
        val config = XfyStore.current ?: return
        xfy = XfyRecognizer(config.appid, config.apiKey, config.apiSecret, automatic = true).apply {
            start(
                partial = { text -> handler.post { if (!closed && epochs.isCurrent(turn)) mutable.value = mutable.value.copy(partial = text) } },
                result = { text -> handler.post {
                    if (closed || !epochs.finish(turn)) return@post
                    stop()
                    if (text.isBlank()) { fail("没有听清，请点继续再说一次。"); return@post }
                    mutable.value = mutable.value.copy(phase = "submitted", partial = text)
                    results.trySend(text)
                } },
                error = { message -> handler.post { if (!closed && epochs.isCurrent(turn)) fail(message) } }
            )
        }
        timeout = Runnable { if (epochs.isCurrent(turn)) fail("语音识别超时，请点继续重试。") }.also { handler.postDelayed(it, 90_000) }
    }
    fun speak(text: String) {
        if (closed) return
        stop()
        if (!mutable.value.ttsReady) { fail("朗读服务尚未就绪，可以查看文字结果或稍后继续。"); return }
        if (!focus()) return
        val turn = epochs.current
        val utterance = "ax-call-$turn"
        mutable.value = mutable.value.copy(phase = "speaking", error = null)
        tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { }
            override fun onDone(utteranceId: String?) { handler.post { if (!closed && epochs.isCurrent(turn) && utteranceId == utterance) stop() } }
            @Deprecated("Platform callback") override fun onError(utteranceId: String?) { handler.post { if (!closed && epochs.isCurrent(turn)) fail("朗读中断，请查看文字结果或点继续。") } }
        })
        if (tts?.speak(voiceReply(text), TextToSpeech.QUEUE_FLUSH, Bundle(), utterance) != TextToSpeech.SUCCESS) fail("系统无法朗读此回复，请查看文字结果。")
        else timeout = Runnable { if (epochs.isCurrent(turn)) fail("朗读超时，已停止播放。") }.also { handler.postDelayed(it, 240_000) }
    }
    fun clearError() { mutable.value = mutable.value.copy(error = null, phase = "idle") }
    fun close() {
        closed = true; stop(); ioScope.cancel(); tts?.shutdown(); tts = null; results.close()
    }
}
