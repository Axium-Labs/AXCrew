package com.axcrew.android.data.network

import com.axcrew.android.data.model.*
import com.axcrew.android.data.model.Connection
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * 判断主机是否属于私网/回环地址。局域网直连场景允许对私网地址使用明文 HTTP，
 * 公网地址仍强制 HTTPS。纯字符串解析，不做 DNS 解析，避免输入校验时触发网络查询。
 */
fun isPrivateHost(host: String): Boolean {
    if (host.equals("localhost", ignoreCase = true)) return true
    if (host.indexOf(':') >= 0) return false // IPv6 字面量不自动放行明文（保守）
    val parts = host.split('.')
    if (parts.size != 4) return false
    val nums = parts.map { it.toIntOrNull() }
    if (nums.any { it == null || it !in 0..255 }) return false
    val b0 = nums[0]!!
    if (b0 == 127) return true                      // 127.0.0.0/8 回环
    if (b0 == 10) return true                       // 10.0.0.0/8
    if (b0 == 172 && nums[1]!! in 16..31) return true // 172.16.0.0/12
    if (b0 == 192 && nums[1]!! == 168) return true    // 192.168.0.0/16
    return false
}

/** No credential in URLs, redirects, logs, or a trust-all TLS configuration. */
fun validatedEndpoint(value: String): HttpUrl {
    val url = value.trim().toHttpUrl()
    if (!url.isHttps) {
        // 局域网直连：仅私网地址允许明文 HTTP；公网必须 HTTPS（事件流使用 WSS）
        require(isPrivateHost(url.host)) { "非私网地址必须使用 HTTPS（事件流使用 WSS）" }
    }
    require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) { "地址中不能包含凭据、查询或片段" }
    require(url.encodedPath == "/") { "请输入 Gateway 根地址，不包含 /api 或子路径" }
    return url
}

sealed interface SocketFrame {
    data object Open : SocketFrame
    data class Event(val event: CrewEvent) : SocketFrame
}

class GatewayApi(val connection: Connection, val client: OkHttpClient = defaultClient()) {
    private val base = validatedEndpoint(connection.endpoint)
    init { require(connection.token.isNotBlank()) { "请输入 Gateway Token" } }

    fun url(vararg segments: String, query: Map<String, String> = emptyMap()): HttpUrl = base.newBuilder().apply {
        addPathSegment("api")
        segments.forEach { addPathSegment(it) }
        query.forEach { (key, value) -> addQueryParameter(key, value) }
    }.build()
    private fun request(url: HttpUrl) = Request.Builder().url(url).header("Authorization", "Bearer ${connection.token}")

    suspend fun raw(url: HttpUrl, method: String = "GET", body: String? = null): String = suspendCancellableCoroutine { continuation ->
        val call = client.newCall(request(url).method(method, body?.toRequestBody("application/json; charset=utf-8".toMediaType())).build())
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(IOException("无法连接 Gateway，请检查网络、地址和证书", e)) }
            override fun onResponse(call: Call, response: Response) {
                response.use {
                    try {
                        val text = it.body?.string().orEmpty()
                        if (!it.isSuccessful) {
                            val detail = runCatching { wireJson.parseToJsonElement(text).obj().str("error") }.getOrDefault("")
                            throw IOException("Gateway ${it.code}: ${detail.take(300).replace(connection.token, "[redacted]")}")
                        }
                        if (continuation.isActive) continuation.resume(text)
                    } catch (error: Exception) { if (continuation.isActive) continuation.resumeWithException(error) }
                }
            }
        })
    }
    suspend inline fun <reified T> get(vararg segments: String): T = wireJson.decodeFromString(raw(url(*segments)))
    suspend inline fun <reified T, reified B> post(vararg segments: String, body: B): T = wireJson.decodeFromString(raw(url(*segments), "POST", wireJson.encodeToString(body)))
    suspend fun action(vararg segments: String) = raw(url(*segments), "POST", "{}")

    fun events() = callbackFlow {
        val socket = client.newWebSocket(request(url("ws")).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { trySend(SocketFrame.Open) }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val event = runCatching { wireJson.decodeFromString<CrewEvent>(text) }.getOrNull()
                if (event == null || trySend(SocketFrame.Event(event)).isFailure) {
                    close(IOException("事件流需要重新同步")); webSocket.cancel()
                }
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { close(IOException("事件连接中断")) }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(code, null); close(IOException("事件连接关闭")) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { close(IOException("事件连接关闭")) }
        })
        awaitClose { socket.cancel() }
    }
    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS).pingInterval(20, TimeUnit.SECONDS).build()

        /** 配对阶段尚无设备凭证：直接用一次性配对码完成 redeem（提交后待桌面确认）。 */
        suspend fun redeem(endpoint: String, code: String, name: String, platform: String): PairingRedeem {
            val url = validatedEndpoint(endpoint).newBuilder().addPathSegment("api")
                .addPathSegment("pairing").addPathSegment("client").addPathSegment("redeem").build()
            val text = bareRequest(url, "POST", wireJson.encodeToString(mapOf("code" to code, "name" to name, "platform" to platform)))
            return wireJson.decodeFromString(text)
        }

        /** 手机轮询配对状态：confirmed 时返回一次性下发的设备凭证。 */
        suspend fun claim(endpoint: String, code: String): PairingClaim {
            val url = validatedEndpoint(endpoint).newBuilder().addPathSegment("api")
                .addPathSegment("pairing").addPathSegment("client").addPathSegment("status").build()
            val text = bareRequest(url, "POST", wireJson.encodeToString(mapOf("code" to code)))
            return wireJson.decodeFromString(text)
        }

        private suspend fun bareRequest(url: HttpUrl, method: String, body: String?): String = suspendCancellableCoroutine { continuation ->
            val request = Request.Builder().url(url).method(method, body?.toRequestBody("application/json; charset=utf-8".toMediaType())).build()
            val call = defaultClient().newCall(request)
            continuation.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { if (continuation.isActive) continuation.resumeWithException(IOException("无法连接 Gateway，请检查网络和地址", e)) }
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        val text = it.body?.string().orEmpty()
                        if (!it.isSuccessful) {
                            val detail = runCatching { wireJson.parseToJsonElement(text).obj().str("error") }.getOrDefault("")
                            if (continuation.isActive) continuation.resumeWithException(IOException("Gateway ${it.code}: ${detail.take(300)}"))
                        } else if (continuation.isActive) continuation.resume(text)
                    }
                }
            })
        }
    }
}
