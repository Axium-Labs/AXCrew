package com.axcrew.android.voice

import com.axcrew.android.data.model.XfyConfig
import com.axcrew.android.data.network.GatewayApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 讯飞语音识别密钥缓存：连接网关后从桌面端配置拉取，识别前若缺失或已过期会重新拉取。
 * 密钥只保存在电脑端与网关，手机端仅在内存中短暂持有用于识别。
 */
object XfyStore {
    data class Config(val appid: String, val apiKey: String, val apiSecret: String)

    /** 缓存有效期：超过后就重新向电脑取一次，这样在电脑端改了密钥不必重连手机。 */
    private const val STALE_AFTER_MS = 5 * 60 * 1000L

    @Volatile var current: Config? = null
        private set
    @Volatile var lastError: String? = null
        private set
    /** 写入发生在 IO 线程（refresh），读取在主线程（isFresh），必须可见。 */
    @Volatile private var fetchedAt = 0L
    private var apiRef: GatewayApi? = null

    /** 连接网关后调用：拉取桌面端保存的讯飞配置。失败时记录原因并保留上次结果。 */
    suspend fun refresh(api: GatewayApi): Boolean = withContext(Dispatchers.IO) {
        apiRef = api
        try {
            val cfg = api.get<XfyConfig>("xfy")
            current = if (!cfg.appid.isNullOrBlank() && !cfg.api_key.isNullOrBlank() && !cfg.api_secret.isNullOrBlank())
                Config(cfg.appid, cfg.api_key, cfg.api_secret).also { lastError = null }
            else null.also { lastError = "电脑端还没有保存讯飞语音识别密钥。" }
            fetchedAt = System.currentTimeMillis()
            current != null
        } catch (e: Exception) {
            current = null
            lastError = "获取讯飞配置失败：${e.message ?: "无法连接电脑"}。请确认手机已连接电脑。"
            false
        }
    }

    /** 缓存是否可直接使用（存在且未过期）；用于需要同步判断的按键/通话路径。 */
    fun isFresh(): Boolean = current != null && System.currentTimeMillis() - fetchedAt < STALE_AFTER_MS

    /**
     * 识别前调用：配置缺失或已过期就重新取一次。
     *
     * 之前只在 `current == null` 时才重取，于是“先在手机连接、再到电脑改密钥”这条路径下，
     * 手机一直用着旧密钥，只能靠断开重连（甚至重启 App）才能生效。
     */
    suspend fun ensure(): Boolean {
        val api = apiRef ?: return false
        if (isFresh()) return true
        return refresh(api)
    }

    fun clear() { current = null; apiRef = null; lastError = null; fetchedAt = 0L }
}
