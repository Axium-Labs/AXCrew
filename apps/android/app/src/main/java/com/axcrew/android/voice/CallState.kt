package com.axcrew.android.voice

import com.axcrew.android.data.model.*

data class CallSession(
    val taskId: String?, val member: Member?, val device: String, val cwd: String,
    val provider: String?, val model: String?, val reasoningEffort: String? = null, val paused: Boolean = true,
    val sending: Boolean = false, val heard: String = "", val error: String? = null,
    val spokenTaskId: String? = taskId, val key: String = java.util.UUID.randomUUID().toString(),
)

/** Only AX's user-facing final response is spoken, never thought/tool/event payloads. */
fun voiceReply(text: String): String {
    val plain = text.replace(Regex("```[\\s\\S]*?```"), " 代码请查看会话。 ")
        .replace(Regex("https?://\\S+"), "链接请查看会话")
        .replace(Regex("[#*_`>|]"), " ")
        .replace(Regex("\\s+"), " ").trim()
    return if (plain.length > 1600) plain.take(1600) + "。内容较长，完整结果请查看会话。" else plain.ifBlank { "任务已完成，详细结果请查看会话。" }
}

/**
 * 通话播报用的精简摘要：语音只念关键结论（做了什么、结果如何、有什么需要注意），
 * 完整工作内容仍留在会话和通话文字面板里。过短的结果直接全念。
 */
fun voiceSummary(text: String, fallback: String): String {
    val plain = voiceReply(text)
    if (plain.isBlank()) return fallback
    if (plain.length <= 240) return plain
    val sentences = plain.split(Regex("(?<=[。！？])|(?<=\\n)")).map { it.trim() }.filter { it.isNotEmpty() }
    val keywords = Regex("完成|成功|失败|错误|结果|结论|说明|只有|没有|仅有|共有|总计|共|生成|创建|删除|修改|新增|用时|耗时|无法|不能|建议|下一步|综上|总结")
    val keep = LinkedHashSet<String>()
    sentences.forEach { s -> if (s.length <= 60 && keywords.containsMatchIn(s)) keep.add(s) }
    return if (keep.isNotEmpty()) {
        val joined = keep.take(4).joinToString("。")
        (if (joined.length > 240) joined.take(240).trimEnd('。') else joined) + "。完整结果请查看会话。"
    } else {
        val head = sentences.firstOrNull()?.take(120).orEmpty()
        val tail = sentences.lastOrNull()?.takeLast(120).orEmpty()
        "$head。…$tail。完整结果请查看会话。"
    }
}

private val toolDisplay = mapOf(
    "shell" to "运行命令", "search" to "搜索内容", "filesystem" to "操作文件", "patch" to "编辑文件",
    "web" to "访问网页", "read_file" to "读取文件", "write_file" to "写入文件", "edit_file" to "编辑文件",
    "list_files" to "列出文件", "python" to "运行脚本", "view_image" to "查看图片", "browser" to "浏览网页",
    "git" to "执行 Git 操作", "ask" to "向你提问", "mcp" to "调用外部服务",
)
/** 工具名转成适合播报的中文；未知工具回退原名，避免念出冗长的参数。 */
fun toolDisplayName(name: String): String {
    val n = name.trim()
    if (n.isEmpty()) return "工具"
    return toolDisplay[n] ?: n
}

/**
 * 本通话任务值得播报的下一步进展：(播报文本, 去重键)，没有则返回 null。
 * 审批提醒优先于工具进度；[announced] 用于避免同一事件重复播报。
 */
fun nextProgress(taskId: String?, events: List<CrewEvent>, approvals: List<Permission>, announced: Set<String>): Pair<String, String>? {
    approvals.firstOrNull { "p:${it.request_id}" !in announced }?.let { p ->
        return "需要你审批一个操作：${toolDisplayName(p.request.toolCall.title)}。" to "p:${p.request_id}"
    }
    if (taskId == null) return null
    val started = events.firstOrNull {
        it.task_id == taskId && it.kind == "tool.started" && "t:${it.event_id}" !in announced && it.payload.str("toolCallId").isNotBlank()
    } ?: return null
    val name = started.payload["rawInput"]?.obj()?.str("name").orEmpty().ifBlank { started.payload.str("title") }
    return "正在执行：${toolDisplayName(name)}。" to "t:${started.event_id}"
}

fun canSendVoice(paused: Boolean, sending: Boolean, connected: Boolean, busy: Boolean, activeTask: Boolean, approvals: Boolean) =
    !paused && !sending && connected && !busy && !activeTask && !approvals

/** Invalidates callbacks from cancelled recognizers and consumes each final result once. */
class AudioEpoch {
    var current: Int = 0; private set
    fun invalidate() { current++ }
    fun isCurrent(ticket: Int) = ticket == current
    fun finish(ticket: Int): Boolean {
        if (!isCurrent(ticket)) return false
        invalidate(); return true
    }
}
