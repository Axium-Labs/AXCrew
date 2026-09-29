package com.axcrew.android.feature

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.axcrew.android.data.SecureConnectionStore
import com.axcrew.android.data.model.*
import com.axcrew.android.data.network.*
import com.axcrew.android.data.repository.*
import com.axcrew.android.voice.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*

data class ClientState(val endpoint: String = "", val configured: Boolean = false, val connecting: Boolean = false, val pairing: Boolean = false, val busy: Boolean = false, val error: String? = null, val crew: CrewState = CrewState())
class CrewViewModel(application: Application) : AndroidViewModel(application) {
    private val secure = SecureConnectionStore(application)
    private val mutable = MutableStateFlow(ClientState())
    val state = mutable.asStateFlow()
    private var repository: CrewRepository? = null
    private var observer: Job? = null
    private var runner: Job? = null
    private var foreground = false
    private val callMutable = MutableStateFlow<CallSession?>(null)
    val call = callMutable.asStateFlow()
    fun beginCall(taskId: String?, member: Member?, device: String, cwd: String, provider: String?, model: String?, reasoningEffort: String? = null) {
        if (!state.value.configured || state.value.busy || callMutable.value != null) return
        callMutable.value = CallSession(taskId, member, device, cwd, provider, model, reasoningEffort)
    }
    fun pauseCall() { callMutable.update { it?.copy(paused = true) } }
    fun resumeCall() { callMutable.update { if (it?.error == null) it?.copy(paused = false) else it } }
    fun markCallSpoken(id: String) { callMutable.update { it?.copy(spokenTaskId = id) } }
    fun endCall(): String? = callMutable.value?.taskId.also { callMutable.value = null }
    fun sendVoice(text: String): Boolean {
        val current = callMutable.value ?: return false
        val snapshot = state.value.crew.snapshot
        val task = snapshot.tasks.find { it.id == current.taskId }
        if (text.isBlank() || !canSendVoice(current.paused, current.sending, state.value.crew.connection == "已连接", state.value.busy, (task?.active == true || current.taskId != null && task == null), snapshot.permissions.isNotEmpty())) return false
        val repo = repository ?: return false
        callMutable.value = current.copy(sending = true, heard = text, error = null)
        mutable.update { it.copy(busy = true) }
        viewModelScope.launch {
            try {
                val next = if (current.taskId == null) repo.chat(current.member, current.device, current.cwd, current.provider, current.model, current.reasoningEffort, text, emptyList())
                    else repo.reply(current.taskId, text, emptyList())
                // If the user hangs up during the POST, the accepted task remains in normal history.
                callMutable.update { if (it?.key == current.key) it.copy(taskId = next.id, sending = false) else it }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) {
                callMutable.update { if (it?.key == current.key) it.copy(sending = false, paused = true, error = (e.message ?: "提交失败") + "。请挂断并检查会话记录，确认是否已受理；不会自动重发。") else it }
                mutable.update { it.copy(error = "语音任务提交未确认，请检查会话记录后再发送。") }
            } finally { repo.requestRefresh(); mutable.update { it.copy(busy = false) } }
        }
        return true
    }
    init {
        try { secure.load()?.let { install(it) } }
        catch (_: Exception) { mutable.update { it.copy(error = "无法解密已保存的凭据，请重新连接") } }
    }
    private fun install(connection: Connection) {
        runner?.cancel(); observer?.cancel()
        val repo = CrewRepository(GatewayApi(connection))
        repository = repo
        mutable.value = ClientState(endpoint = connection.endpoint, configured = true)
        observer = viewModelScope.launch { repo.state.collect { crew -> mutable.update { it.copy(crew = crew) } } }
        if (foreground) runner = viewModelScope.launch { repo.run() }
        viewModelScope.launch { XfyStore.refresh(repo.api) }
    }
    fun connect(endpoint: String, token: String) {
        if (state.value.connecting) return
        viewModelScope.launch {
            mutable.update { it.copy(connecting = true, error = null) }
            try {
                val connection = Connection(validatedEndpoint(endpoint).toString().trimEnd('/'), token.trim())
                val api = GatewayApi(connection)
                val settings = api.get<Settings>("settings")
                require(settings.protocol_version == 1) { "Gateway 协议版本不兼容" }
                api.get<List<Device>>("devices")
                withContext(Dispatchers.IO) { secure.save(connection) }
                install(connection)
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutable.update { it.copy(error = e.message ?: "连接失败") } }
            finally { mutable.update { it.copy(connecting = false) } }
        }
    }

    /**
     * 设备配对流程：一次性配对码 → redeem（提交桌面确认）→ 轮询领取设备凭证 → 授权连接。
     * 配对码 5 分钟、一次性；成功授权后保存的是长期设备凭证（相当于 refresh credential），
     * 后续认证不再使用配对码。桌面拒绝/配对码过期时 claim 会返回错误。
     */
    fun pair(endpoint: String, code: String, name: String, platform: String) {
        if (state.value.connecting || state.value.pairing) return
        val ep = endpoint.trim()
        val pairingCode = code.trim()
        if (ep.isEmpty() || pairingCode.isEmpty()) { mutable.update { it.copy(error = "请填写 Gateway 地址与配对码") }; return }
        viewModelScope.launch {
            mutable.update { it.copy(pairing = true, error = null) }
            try {
                val base = validatedEndpoint(ep).toString().trimEnd('/')
                GatewayApi.redeem(base, pairingCode, name, platform)
                // 桌面点击「允许」前轮询（配对码最长 5 分钟；最多等待 60 秒）
                var confirmed = false
                repeat(30) {
                    val claim = GatewayApi.claim(base, pairingCode)
                    if (claim.status == "confirmed") {
                        val credential = requireNotNull(claim.credential) { "配对失败：未获得设备凭证" }
                        val connection = Connection(base, credential)
                        withContext(Dispatchers.IO) { secure.save(connection) }
                        install(connection)
                        confirmed = true
                        return@launch
                    }
                    delay(2000)
                }
                if (!confirmed) mutable.update { it.copy(error = "等待电脑确认超时，请确认桌面端已点击「允许」") }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutable.update { it.copy(error = e.message ?: "配对失败") } }
            finally { mutable.update { it.copy(pairing = false) } }
        }
    }
    fun setForeground(value: Boolean) {
        if (foreground == value) return
        foreground = value
        if (!value) pauseCall()
        runner?.cancel(); runner = null
        if (value) repository?.let { repo -> runner = viewModelScope.launch { repo.run() } }
    }
    fun disconnect() {
        try {
            endCall(); secure.clear(); runner?.cancel(); observer?.cancel(); repository = null
            mutable.value = ClientState()
        } catch (_: Exception) { mutable.update { it.copy(error = "无法清除凭据") } }
    }
    fun clearError() { mutable.update { it.copy(error = null) } }
    fun refresh() { repository?.requestRefresh() }
    /** No automatic retry of writes: an interrupted POST may already have been accepted. */
    fun perform(block: suspend CrewRepository.() -> Unit) {
        if (state.value.busy) return
        val repo = repository ?: return
        mutable.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try { repo.block() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutable.update { it.copy(error = (e.message ?: "操作失败") + "。若提交时断线，请先刷新任务列表，确认是否已受理。") } }
            finally { repo.requestRefresh(); mutable.update { it.copy(busy = false) } }
        }
    }
    suspend fun automations() = requireNotNull(repository).automations()
    suspend fun automationRuns() = requireNotNull(repository).automationRuns()
    suspend fun history(id: String) = requireNotNull(repository).history(id)
    suspend fun capabilities(id: String, cwd: String) = requireNotNull(repository).capabilities(id, cwd)
}
