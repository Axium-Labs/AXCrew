package com.axcrew.android.data.model

import kotlinx.serialization.json.JsonObject

data class Line(val key: String, val role: String, val text: String, val status: String = "")
fun transcript(updates: List<JsonObject>): List<Line> {
    val lines = mutableListOf<Line>()
    updates.forEach { update ->
        val kind = update.str("sessionUpdate")
        when (kind) {
            "user_message_chunk", "agent_message_chunk", "agent_thought_chunk" -> {
                val role = when (kind) { "user_message_chunk" -> "你"; "agent_thought_chunk" -> "思考"; else -> "AX" }
                val key = update.str("messageId")
                val text = update["content"].obj().str("text")
                val last = lines.lastOrNull()
                if (last?.role == role && (key.isEmpty() || key == last.key)) lines[lines.lastIndex] = last.copy(text = last.text + text)
                else lines.add(Line(key.ifEmpty { "${lines.size}-$role" }, role, text))
            }
            "tool_call", "tool_call_update" -> {
                val key = update.str("toolCallId")
                val index = lines.indexOfLast { it.role == "工具" && it.key == key }
                if (index >= 0) lines[index] = lines[index].copy(status = update.str("status"))
                else lines.add(Line(key, "工具", update.str("title").ifEmpty { key }, update.str("status")))
            }
        }
    }
    return lines
}

/** History is an AX snapshot, not a replay cursor. Merge the current turn, never concatenate both. */
fun reconcile(history: History?, live: List<JsonObject>, task: Task, settled: Boolean): List<Line> {
    val saved = transcript(history?.updates.orEmpty().map { it.update })
    if (settled && saved.isNotEmpty()) return saved
    val lastUser = saved.indexOfLast { it.role == "你" }
    val current = lastUser >= 0 && saved[lastUser].text == task.prompt && history?.task_id == task.id
    val before = if (current) saved.take(lastUser) else saved
    val body = (if (current) saved.drop(lastUser + 1) else emptyList()).toMutableList()
    val offsets = mutableMapOf<String, Int>()
    transcript(live).filter { it.role != "你" }.forEach { incoming ->
        val occurrence = offsets.getOrDefault(incoming.role, 0)
        offsets[incoming.role] = occurrence + 1
        val index = if (incoming.role == "工具") body.indexOfFirst { it.role == "工具" && it.key == incoming.key }
        else body.withIndex().filter { it.value.role == incoming.role }.getOrNull(occurrence)?.index ?: -1
        if (index < 0) body.add(incoming)
        else {
            val prior = body[index]
            // Prefixes occur during normal replay. A suffix-only stream after reconnect
            // cannot safely be appended without a cursor; keep the snapshot until next refresh.
            val text = when { prior.text.startsWith(incoming.text) -> prior.text; incoming.text.startsWith(prior.text) -> incoming.text; else -> prior.text }
            body[index] = incoming.copy(text = text)
        }
    }
    return before + listOf(Line("prompt-${task.id}", "你", task.prompt)) + body
}
