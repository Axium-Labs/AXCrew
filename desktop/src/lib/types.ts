export type TaskStatus = 'pending'|'ready'|'running'|'waiting_permission'|'waiting_user'|'completed'|'failed'|'cancelled'
export interface Device { id:string; name:string; hostname:string; platform:string; arch:string; ax_version:string; protocol_version:number; capabilities:Record<string,unknown>; status:string; last_seen:number; public_key:string|null }
export interface Crew { id:string; name:string; created_at:number }
export interface Member { id:string; crew_id:string; name:string; role:string; device_id:string; cwd:string; provider:string|null; model:string|null; skills:string[]; mcp_servers:string[]; permission_profile:'ask'|'allow'|'deny'; max_concurrency:number }
export interface Task { id:string; crew_id:string; parent_id:string|null; title:string; description:string; assigned_member:string; assigned_device:string; dependencies:string[]; priority:number; status:TaskStatus; input:unknown; output:{text?:string;error?:string}|null; retry_count:number; created_at:number; started_at:number|null; finished_at:number|null }
export interface Session { task_id:string; member_id:string; device_id:string; ax_session_id:string }
export interface CrewEvent { event_id:string; timestamp:number; kind:string; crew_id:string|null; member_id:string|null; device_id:string|null; task_id:string|null; session_id:string|null; payload:Record<string,unknown> }
export interface Permission { request_id:string; request:{sessionId:string;toolCall:{title:string;kind:string;rawInput:unknown};options:{optionId:string;name:string}[]} }
export interface Catalog { models:{providers:{id:string;models:{id:string;display_name:string}[]}[]}; skills:{skills:{name:string;description:string;missing_tools:string[]}[]}; mcp:{servers:{name:string;description:string;enabled:boolean;capabilities:string[]}[]}; capabilities:Record<string,unknown> }
export interface SessionHistory { task_id:string; ax_session_id:string; updates:{sessionId:string;update:Record<string,unknown>}[] }
export type ScheduleKind = 'interval'|'daily'|'weekly'
export interface Automation { id:string; name:string; message:string; schedule_kind:ScheduleKind; interval_minutes:number; daily_time:string; weekdays:string; utc_offset_minutes:number; member_id:string|null; model:string|null; approval:'default'|'auto'|'ask'; silent:boolean; strict_schedule:boolean; hide_from_chat:boolean; lean_context:boolean; folder:string|null; enabled:boolean; created_at:number; last_run_at:number|null; next_run_at:number|null; run_count:number; last_status:string|null }
export interface AutomationRun { id:string; automation_id:string; task_id:string|null; status:string; started_at:number; finished_at:number|null; detail:string|null; name:string|null }
export interface LocalAxSession { id:string; title:string; created_at:number; updated_at:number; messages:number; preview:string; task_id:string|null }
export interface LocalAxProject { id:string; root:string; sessions:LocalAxSession[]; error?:string }
export interface LocalAxOverview { available:boolean; home:string|null; projects:LocalAxProject[] }
