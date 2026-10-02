package com.axcrew.android

import com.axcrew.android.data.model.*
import com.axcrew.android.voice.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class VoiceTest {
    @Test fun canceledCaptureCannotSubmitLateResultsIntoANewTurn() {
        val epochs = AudioEpoch()
        val beforePause = epochs.current
        epochs.invalidate() // Hangup/background/focus loss cancels capture.
        val nextCapture = epochs.current
        assertFalse(epochs.finish(beforePause))
        assertTrue(epochs.isCurrent(nextCapture))
        assertTrue(epochs.finish(nextCapture))
        assertFalse(epochs.finish(nextCapture)) // Some services deliver final twice.
    }
    @Test fun oldPlaybackCallbackCannotStopNewMicrophoneCapture() {
        val epochs = AudioEpoch()
        val playback = epochs.current
        epochs.invalidate() // user interrupted playback and resumed capture
        assertFalse(epochs.isCurrent(playback))
        assertTrue(epochs.finish(epochs.current))
    }
    @Test fun speechSkipsCodeLinksAndBoundsLongResponses() {
        val spoken = voiceReply("# 完成\n```sh\nrm dangerous-file\n```\n详情 https://example.com/private")
        assertFalse(spoken.contains("rm dangerous-file"))
        assertFalse(spoken.contains("https://"))
        assertTrue(spoken.contains("完成"))
        assertTrue(voiceReply("字".repeat(5000)).length < 1700)
        assertTrue(voiceReply("").isNotBlank())
    }
    @Test fun voiceSummaryKeepsShortRepliesAndBlankFallback() {
        assertEquals("简短回复。", voiceSummary("简短回复。", "fallback"))
        assertEquals("任务已完成，详细结果请查看会话。", voiceSummary("###", "任务已完成，详细结果请查看会话。"))
    }
    @Test fun voiceSummaryExtractsKeyConclusionsInsteadOfFullContent() {
        val verbose = (1..8).joinToString("。") { "第${it}轮检查了相关环节的细节情况并做了相应准备" }
        val long = verbose + "。**文件列表：**\n| 类型 | 名称 |\n| 目录 | .ax |\n\n目录下没有普通文件，只有一个隐藏目录 .ax。\n.ax 内部仅有一个 50 字节的 project.json。\n\n第一次用的 ls -la 报错，是因为该环境的 shell 是 PowerShell，需要改用 Get-ChildItem -Force。"
        val s = voiceSummary(long, "fallback")
        assertTrue(s.contains("没有普通文件"))
        assertTrue(s.contains("project.json"))
        assertFalse(s.contains("Get-ChildItem -Force"))
        assertTrue(s.endsWith("完整结果请查看会话。"))
        assertTrue(s.length < 260)
        // 无关键句的极长内容回退为“首句 + 尾句”，仍然受限。
        val rambling = "内容".repeat(200) + "最后一句总结。"
        val fallback = voiceSummary(rambling, "fallback")
        assertTrue(fallback.contains("最后一句总结"))
        assertTrue(fallback.length < 260)
    }
    @Test fun progressAnnouncementsPickNewStepsThenApprovalsAndDedupe() {
        val started = CrewEvent("e1", kind = "tool.started", task_id = "t", payload = buildJsonObject {
            put("toolCallId", "c1"); put("title", "running echo hi"); put("rawInput", buildJsonObject { put("name", "shell") })
        })
        assertEquals("正在执行：运行命令。", nextProgress("t", listOf(started), emptyList(), emptySet())!!.first)
        assertEquals("t:e1", nextProgress("t", listOf(started), emptyList(), emptySet())!!.second)
        assertNull(nextProgress("t", listOf(started), emptyList(), setOf("t:e1")))
        val approval = Permission("p1", PermissionRequest("s", ToolCall(title = "shell"), listOf(PermissionOption("allow_once", "Allow once"))))
        assertEquals("需要你审批一个操作：运行命令。", nextProgress("t", listOf(started), listOf(approval), setOf("t:e1"))!!.first)
        assertNull(nextProgress("t", listOf(started), listOf(approval), setOf("t:e1", "p:p1")))
        val custom = CrewEvent("e2", kind = "tool.started", task_id = "t", payload = buildJsonObject {
            put("toolCallId", "c2"); put("rawInput", buildJsonObject { put("name", "custom_tool") })
        })
        assertEquals("正在执行：custom_tool。", nextProgress("t", listOf(custom), emptyList(), emptySet())!!.first)
        assertNull(nextProgress(null, listOf(started), emptyList(), emptySet()))
        assertNull(nextProgress("t", listOf(CrewEvent("e3", kind = "tool.completed", task_id = "t")), emptyList(), emptySet()))
    }
}
