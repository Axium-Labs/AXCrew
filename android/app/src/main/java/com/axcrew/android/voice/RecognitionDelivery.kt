package com.axcrew.android.voice

/** Call mode submits on server end-of-speech; push-to-talk waits for release. */
internal class RecognitionDelivery(
    private val automatic: Boolean,
    private val result: (String) -> Unit,
    private val error: (String) -> Unit,
) {
    private var stopped = false
    private var terminal = false
    private var finalText: String? = null

    @Synchronized fun serverFinal(text: String) {
        if (terminal || finalText != null) return
        finalText = text
        deliver()
    }

    @Synchronized fun stop() { stopped = true; deliver() }
    @Synchronized fun cancel() { terminal = true }
    @Synchronized fun fail(message: String) {
        if (terminal) return
        terminal = true
        error(message)
    }

    private fun deliver() {
        val text = finalText ?: return
        if (terminal || (!automatic && !stopped)) return
        terminal = true
        if (text.isBlank()) error("没有听清，请再试一次。") else result(text)
    }
}
