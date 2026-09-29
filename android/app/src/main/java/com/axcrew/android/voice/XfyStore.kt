package com.axcrew.android.voice

import com.axcrew.android.data.model.XfyConfig
import com.axcrew.android.data.network.GatewayApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 讯飞语音识别密钥缓存：连接网关后从桌面端配置拉取，识别时若缺失会再次实时拉取。
 * 密钥只保存在电脑端与网关，手机端仅在内存中短暂持有用于识别。
 */
object XfyStore {
    data class Config(val appid: String, val apiKey: String, val apiSecret: String)

    @Volatile var current: Config? = null
        private set
    @Volatile var lastError: String? = null
        private set
    private var apiRef: GatewayApi? = null

    /** 连接网关后调用：拉取桌面端保存的讯飞配置。失败时记录原因并保留上次结果。 */
    suspend fun refresh(api: GatewayApi): Boolean = withContext(Dispatchers.IO) {
        apiRef = api
        try {
            val cfg = api.get<XfyConfig>("xfy")
            current = if (!cfg.appid.isNullOrBlank() && !cfg.api_key.isNullOrBlank() && !cfg.api_secret.isNullOrBlank())
                Config(cfg.appid, cfg.api_key, cfg.api_secret).also { lastError = null }
            else null.also { lastError = "电脑端还没有保存讯飞语音识别密钥。" }
            current != null
        } catch (e: Exception) {
            current = null
            lastError = "获取讯飞配置失败：${e.message ?: "无法连接电脑"}。请确认手机已连接电脑。"
            false
        }
    }

    /** 识别前调用：已配置则直接可用；未配置则实时重试拉取一次，避免连接早于桌面保存导致拿不到 key。 */
    suspend fun ensure(): Boolean {
        val api = apiRef ?: return false
        return if (current != null) true else refresh(api)
    }

    fun clear() { current = null; apiRef = null; lastError = null }
}
