import { useEffect, useMemo, useState } from 'react'
import { Brain, ChevronRight, Wrench } from 'lucide-react'
import { MessageMarkdown } from './MessageMarkdown'
import { useLang, useT, type TFn } from '../lib/i18n'
import { transcriptBlocks, type SessionLine } from '../lib/sessionTranscript'

function clock(at: number | undefined, lang: 'zh' | 'en') {
  if (!at) return ''
  const date = new Date(at)
  const sameDay = date.toDateString() === new Date().toDateString()
  const time = date.toLocaleTimeString(lang === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`
}

/** A row keeps its summary to one line, so a hundred-step turn still reads as a list. */
function preview(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat
}

/**
 * AX reports what a tool is doing in English (`read src/main.rs`, `running cargo test`).
 * The row leads with the action in the UI language and keeps the argument as the
 * muted tail, so a scan of the timeline reads as verbs, not as a command dump.
 */
const TOOL_RULES: [RegExp, string][] = [
  [/^searching\s+/i, '搜索代码'],
  [/^running\s+/i, '执行命令'],
  [/^editing\s+/i, '编辑文件'],
  [/^read\s+/i, '读取文件'],
  [/^list\s+/i, '列出目录'],
  [/^write\s+/i, '写入文件'],
  [/^search\s+\d+\s+quer(?:y|ies):\s*/i, '网络搜索'],
  [/^fetch\s+\d+\s+urls?:\s*/i, '访问网页'],
  [/^calling\s+/i, '调用工具'],
]

/** Splits a tool call row into the action it performs and the thing it acts on. */
function toolLabel(text: string, lang: 'zh' | 'en', t: TFn) {
  const detail = text.trim()
  if (!detail) return { verb: t('session.tool'), rest: '' }
  if (lang === 'en') return { verb: preview(detail), rest: '' }
  const rule = TOOL_RULES.find(([pattern]) => pattern.test(detail))
  if (!rule) return { verb: t('session.tool'), rest: preview(detail) }
  return { verb: rule[1], rest: preview(detail.replace(rule[0], '')) }
}

/** A folded row reports how long the turn ran, not how long its first step took. */
function duration(lines: SessionLine[], end: number | undefined, now: number | undefined, t: TFn) {
  const first = lines[0]?.at
  const last = now ?? end ?? lines.at(-1)?.at
  if (!first || !last || last <= first) return ''
  return t('session.processDuration', { seconds: Math.max(1, Math.round((last - first) / 1000)) })
}

/** Keeps the header clock moving while a turn is still running. */
function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return now
}

/** One step of a turn: an icon on the rail, one line of context, details on demand. */
function ActivityRow({ line }: { line: SessionLine }) {
  const t = useT()
  const lang = useLang(state => state.lang)
  const [open, setOpen] = useState(false)
  const time = clock(line.at, lang)
  const status = line.type === 'tool' && line.status ? t(`session.toolStatus.${line.status}`) : ''
  const content = line.type === 'tool' ? line.output ?? '' : line.text
  const expandable = !!content.trim()
  const { verb, rest } = line.type === 'tool' ? toolLabel(line.text, lang, t) : { verb: preview(line.text), rest: '' }
  const glyph = line.type === 'tool' ? <Wrench size={11}/> : line.type === 'thought' ? <Brain size={11}/> : <span className="session-activity-bead"/>
  const head = <>
    <span className="session-activity-glyph">{glyph}</span>
    <span className="session-activity-verb">{verb || t('session.tool')}</span>
    {rest && <span className="session-activity-target">{rest}</span>}
    {status && <small className={`session-activity-status is-${line.status}`}>{status}</small>}
    {time && <time className="session-activity-time">{time}</time>}
  </>
  return <li className={`session-activity-item is-${line.type}`}>
    {expandable
      ? <button type="button" className="session-activity-row" aria-expanded={open} title={open ? t('session.hide') : t('session.show')} onClick={() => setOpen(value => !value)}>{head}</button>
      : <div className="session-activity-row is-static">{head}</div>}
    {open && (line.type === 'tool'
      ? <pre className="session-activity-output">{content}</pre>
      : <div className="session-activity-detail"><MessageMarkdown text={line.text}/></div>)}
  </li>
}

/**
 * Everything a turn did before its answer, as an inline timeline: one compact row
 * per step along a hairline rail. No card, no block of background — hierarchy comes
 * from size, weight and indent, so the answer below stays the heaviest thing on screen.
 */
export function ProcessBlock({ lines, end }: { lines: SessionLine[]; end?: number }) {
  const t = useT()
  const [open, setOpen] = useState(true)
  const running = lines.some(line => line.type === 'tool' && (line.status === 'pending' || line.status === 'in_progress'))
  const now = useNow(running)
  const spans = duration(lines, end, running ? now : undefined, t)
  const label = (running
    ? [t('session.processThinking'), spans]
    : [t('session.processDone'), t('session.processSteps', { steps: lines.length }), spans])
    .filter(Boolean).join(' · ')
  return <div className={`session-activity ${running ? 'is-running' : 'is-done'}`}>
    <button type="button" className="session-activity-head" aria-label={t('session.process')} aria-expanded={open} title={open ? t('session.hide') : t('session.show')} onClick={() => setOpen(value => !value)}>
      {running && <span className="session-activity-pulse"/>}
      <span className="session-activity-label">{label}</span>
      <ChevronRight size={12} className={`session-activity-chevron ${open ? 'is-open' : ''}`}/>
    </button>
    {open && <ul className="session-activity-list">{lines.map(line => <ActivityRow key={line.key} line={line}/>)}</ul>}
  </div>
}

/**
 * One transcript row. The answer of a turn is always open — only the process that
 * produced it folds away, so the transcript reads as the result, not the log.
 */
export function TranscriptLine({ line }: { line: SessionLine }) {
  const t = useT()
  const lang = useLang(state => state.lang)
  const time = clock(line.at, lang)

  if (line.type === 'user') {
    return <div className="session-transcript-line is-user">
      <div className="session-transcript-user">
        <div className="session-transcript-bubble"><MessageMarkdown text={line.text}/></div>
        {time && <time className="session-transcript-time">{time}</time>}
      </div>
    </div>
  }

  return <div className={`session-transcript-line is-${line.type}`}>
    <div className="session-transcript-avatar">AX</div>
    <div className="session-transcript-body">
      <div className="session-transcript-author">{t('session.crew')}{time && <time className="session-transcript-time">{time}</time>}</div>
      <MessageMarkdown text={line.text}/>
    </div>
  </div>
}

export function TranscriptLines({ lines }: { lines: SessionLine[] }) {
  const blocks = useMemo(() => transcriptBlocks(lines), [lines])
  return <>{blocks.map(block => block.kind === 'process'
    ? <ProcessBlock key={block.key} lines={block.lines} end={block.end}/>
    : <TranscriptLine key={block.key} line={block.line}/>)}</>
}
