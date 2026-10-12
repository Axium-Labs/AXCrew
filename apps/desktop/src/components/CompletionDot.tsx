import { hasUnreadCompletion, useAttention } from '../store/attention'
import { useLang } from '../lib/i18n'

export function CompletionDot({ keys }: { keys?: string[] }) {
  const unread = useAttention(state => state.unread)
  const zh = useLang(state => state.lang) === 'zh'
  if (keys ? !hasUnreadCompletion(unread, keys) : !Object.keys(unread).length) return null
  const label = zh ? '有未读的任务结果' : 'Unread task result'
  return <span className="completion-dot" role="img" aria-label={label} title={label}/>
}
