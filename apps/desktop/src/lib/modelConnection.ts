export type ModelConnection = {
  status: 'connecting'|'retrying'|'connected'|'failed'
  attempt: number
  maxAttempts: number
  error?: string
}

/** Connection status is supplied by AX; never infer retries from error prose. */
export function modelConnection(value: unknown): ModelConnection|undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  if (!['connecting', 'retrying', 'connected', 'failed'].includes(String(item.status))) return undefined
  if (typeof item.attempt !== 'number' || !Number.isSafeInteger(item.attempt) || item.attempt < 1) return undefined
  if (typeof item.maxAttempts !== 'number' || !Number.isSafeInteger(item.maxAttempts) || item.maxAttempts < item.attempt) return undefined
  return {status: item.status as ModelConnection['status'], attempt: item.attempt, maxAttempts: item.maxAttempts,
    ...(typeof item.error === 'string' ? {error: item.error} : {})}
}

export function modelConnectionText(connection: ModelConnection, lang: 'zh'|'en'): string {
  const count = `${connection.attempt}/${connection.maxAttempts}`
  if (connection.status === 'failed') return lang === 'zh' ? `模型连接失败（已尝试 ${count} 次）` : `Model connection failed (${count} attempts)`
  if (connection.status === 'connected') return lang === 'zh' ? '模型已连接' : 'Model connected'
  if (connection.status === 'retrying') return lang === 'zh' ? `正在重新连接模型（${count}）…` : `Reconnecting to model (${count})…`
  return lang === 'zh' ? `正在连接模型（${count}）…` : `Connecting to model (${count})…`
}
