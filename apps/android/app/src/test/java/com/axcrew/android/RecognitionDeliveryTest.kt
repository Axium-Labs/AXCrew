package com.axcrew.android

import com.axcrew.android.voice.RecognitionDelivery
import org.junit.Assert.*
import org.junit.Test

class RecognitionDeliveryTest {
    @Test fun callSubmitsOnServerFinalWithoutManualStop() {
        val results = mutableListOf<String>()
        val errors = mutableListOf<String>()
        val turn = RecognitionDelivery(true, { results.add(it) }, { errors.add(it) })
        turn.serverFinal("帮我查看任务")
        assertEquals(listOf("帮我查看任务"), results)
        turn.serverFinal("重复结束帧")
        turn.stop()
        turn.fail("晚到的断线通知")
        assertEquals(1, results.size)
        assertTrue(errors.isEmpty())
    }

    @Test fun pushToTalkWaitsForReleaseEvenIfServerEndsFirst() {
        val results = mutableListOf<String>()
        val turn = RecognitionDelivery(false, { results.add(it) }, { fail(it) })
        turn.serverFinal("识别结果")
        assertTrue(results.isEmpty())
        turn.stop()
        turn.stop()
        assertEquals(listOf("识别结果"), results)
    }

    @Test fun releaseBeforeFinalWaitsForFinalText() {
        val results = mutableListOf<String>()
        val turn = RecognitionDelivery(false, { results.add(it) }, { fail(it) })
        turn.stop()
        assertTrue(results.isEmpty())
        turn.serverFinal("最终文本")
        assertEquals(listOf("最终文本"), results)
    }

    @Test fun cancelSuppressesPendingAndLateResults() {
        for (automatic in listOf(true, false)) {
            val turn = RecognitionDelivery(automatic, { fail("cancelled result") }, { fail(it) })
            turn.cancel()
            turn.serverFinal("晚到结果")
            turn.stop()
            turn.fail("断线")
        }
        val pending = RecognitionDelivery(false, { fail("cancelled result") }, { fail(it) })
        pending.serverFinal("上滑取消前的结果")
        pending.cancel()
        pending.stop()
    }

    @Test fun emptySpeechAndConnectionFailureReportOnceWithoutSubmitting() {
        for (emptySpeech in listOf(true, false)) {
            val errors = mutableListOf<String>()
            val turn = RecognitionDelivery(true, { fail("unexpected submission") }, { errors.add(it) })
            if (emptySpeech) turn.serverFinal(" ") else turn.fail("连接中断")
            turn.serverFinal("晚到文本")
            turn.fail("重复错误")
            assertEquals(1, errors.size)
        }
    }
}
