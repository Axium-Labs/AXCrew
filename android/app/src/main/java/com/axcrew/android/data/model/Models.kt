package com.axcrew.android.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

val wireJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }
fun JsonElement?.text(): String = (this as? JsonPrimitive)?.contentOrNull.orEmpty()
fun JsonElement?.obj(): JsonObject = this as? JsonObject ?: JsonObject(emptyMap())
fun JsonObject.str(key: String) = get(key).text()

@Serializable data class Connection(val endpoint: String, val token: String)
@Serializable data class PairingRedeem(val status: String = "", val device_id: String? = null, val awaiting_confirmation: Boolean = false)
@Serializable data class PairingClaim(val status: String = "", val credential: String? = null)
@Serializable data class Device(val id: String, val name: String, val hostname: String = "", val platform: String = "", val arch: String = "", val ax_version: String = "", val protocol_version: Int = 1, val status: String, val last_seen: Long = 0, val capabilities: JsonElement = JsonNull)
@Serializable data class Crew(val id: String, val name: String, val created_at: Long = 0)
@Serializable data class Member(val id: String, val crew_id: String, val name: String, val role: String = "", val device_id: String, val cwd: String, val provider: String? = null, val model: String? = null, val skills: List<String> = emptyList(), val mcp_servers: List<String> = emptyList(), val permission_profile: String = "ask", val max_concurrency: Int = 1)
@Serializable data class Task(val id: String, val crew_id: String, val title: String, val description: String = "", val assigned_member: String, val assigned_device: String, val status: String, val input: JsonElement = JsonNull, val output: JsonObject? = null, val dependencies: List<String> = emptyList(), val parent_id: String? = null, val priority: Int = 0, val retry_count: Int = 0, val created_at: Long = 0, val started_at: Long? = null, val finished_at: Long? = null) {
    val active get() = status in setOf("pending", "ready", "running", "waiting_permission", "waiting_user")
    val prompt get() = if (input is JsonPrimitive) input.contentOrNull.orEmpty() else input.obj().str("prompt")
}
@Serializable data class Session(val task_id: String, val member_id: String, val device_id: String, val ax_session_id: String)
@Serializable data class CrewEvent(val event_id: String, val timestamp: Long = 0, val kind: String, val task_id: String? = null, val device_id: String? = null, val member_id: String? = null, val session_id: String? = null, val crew_id: String? = null, val payload: JsonObject = JsonObject(emptyMap()))
@Serializable data class Permission(val request_id: String, val request: PermissionRequest)
@Serializable data class PermissionRequest(val sessionId: String = "", val toolCall: ToolCall, val options: List<PermissionOption> = emptyList())
@Serializable data class ToolCall(val title: String = "Tool", val kind: String = "", val rawInput: JsonElement = JsonNull)
@Serializable data class PermissionOption(val optionId: String, val name: String)
@Serializable data class History(val task_id: String = "", val ax_session_id: String = "", val updates: List<HistoryUpdate> = emptyList())
@Serializable data class HistoryUpdate(val update: JsonObject)
@Serializable data class Settings(val version: String = "", val default_cwd: String = "", val protocol_version: Int = 1, val session_files: Boolean = false)
/** 讯飞实时语音听写配置（桌面端设置 → 网关下发）。 */
@Serializable data class XfyConfig(val configured: Boolean = false, val appid: String? = null, val api_key: String? = null, val api_secret: String? = null)
@Serializable data class NewCrew(val name: String)
@Serializable data class NewMember(val name: String, val role: String, val device_id: String, val cwd: String, val provider: String? = null, val model: String? = null, val skills: List<String> = emptyList(), val mcp_servers: List<String> = emptyList(), val permission_profile: String = "ask", val max_concurrency: Int = 1)
@Serializable data class NewTask(val crew_id: String, val title: String, val assigned_member: String, val input: JsonElement, val dependencies: List<String> = emptyList(), val priority: Int = 0)

data class Snapshot(val devices: List<Device> = emptyList(), val crews: List<Crew> = emptyList(), val members: List<Member> = emptyList(), val tasks: List<Task> = emptyList(), val sessions: List<Session> = emptyList(), val permissions: List<Permission> = emptyList(), val settings: Settings = Settings())
data class Conversation(val root: Task, val latest: Task)
fun conversations(snapshot: Snapshot): List<Conversation> {
    val bindings = snapshot.sessions.associateBy { it.task_id }
    return snapshot.tasks.filter { it.input.obj()["hidden"] != JsonPrimitive(true) }.groupBy {
        bindings[it.id]?.let { b -> "${b.device_id}:${b.ax_session_id}" } ?: "task:${it.id}"
    }.values.map { turns ->
        fun depth(t: Task): Int {
            val seen = mutableSetOf<String>(); var current = t
            while (current.parent_id != null && seen.add(current.id)) current = turns.find { it.id == current.parent_id } ?: break
            return seen.size
        }
        val ordered = turns.sortedWith(compareBy<Task> { depth(it) }.thenBy { it.created_at }.thenBy { it.id })
        Conversation(ordered.first(), ordered.lastOrNull { it.active } ?: ordered.last())
    }.sortedByDescending { it.latest.created_at }
}
