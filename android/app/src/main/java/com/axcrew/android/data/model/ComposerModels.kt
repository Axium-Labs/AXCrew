package com.axcrew.android.data.model

import kotlinx.serialization.Serializable

@Serializable data class Attachment(val name: String, val mime: String, val data: String)
@Serializable data class Automation(
    val id: String = "", val name: String = "", val message: String = "",
    val schedule_kind: String = "interval", val interval_minutes: Int = 60,
    val daily_time: String = "09:00", val weekdays: String = "1,2,3,4,5",
    val utc_offset_minutes: Int = java.time.ZonedDateTime.now().offset.totalSeconds / 60,
    val member_id: String? = null, val model: String? = null, val approval: String = "ask",
    val silent: Boolean = false, val strict_schedule: Boolean = false,
    val hide_from_chat: Boolean = false, val lean_context: Boolean = false,
    val folder: String? = null, val enabled: Boolean = true,
    val created_at: Long = 0, val last_run_at: Long? = null, val next_run_at: Long? = null,
    val run_count: Int = 0, val last_status: String? = null,
)
@Serializable data class AutomationRun(val id: String, val automation_id: String, val task_id: String? = null, val status: String, val started_at: Long, val finished_at: Long? = null, val detail: String? = null, val name: String? = null)
