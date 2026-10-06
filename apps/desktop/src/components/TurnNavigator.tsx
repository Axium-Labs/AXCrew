import { useEffect, useState } from 'react'
import { transcriptTurns, type SessionLine } from '../lib/sessionTranscript'
import { useLang } from '../lib/i18n'

export function TurnNavigator({lines, container, onJump}: {lines: SessionLine[]; container: HTMLDivElement | null; onJump: () => void}) {
  const lang = useLang(s => s.lang), zh = lang === 'zh'
  const turns = transcriptTurns(lines).filter(turn => turn[0].type === 'user')
  const keys = turns.map(turn => turn[0].key).join('\n')
  const [active, setActive] = useState(''), [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    setPreview(null)
    if (!container) return
    const update = () => {
      const top = container.getBoundingClientRect().top + 40
      const elements = [...container.querySelectorAll<HTMLElement>('[data-turn-key]')]
      const current = elements.findLast(element => element.getBoundingClientRect().top <= top) ?? elements[0]
      setActive(current?.dataset.turnKey ?? '')
    }
    update(); container.addEventListener('scroll', update, {passive: true}); window.addEventListener('resize', update)
    return () => { container.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [container, keys])
  if (!turns.length) return null
  const turn = turns.find(turn => turn[0].key === preview)
  const answer = turn?.findLast(line => line.type === 'agent' && line.text.trim())
  return <nav className="session-turn-nav" aria-label={zh ? '会话轮次' : 'Conversation turns'} onMouseLeave={() => setPreview(null)} onKeyDown={event => {if(event.key === 'Escape') setPreview(null)}}>
    <div className="session-turn-marks">{turns.map((turn, index) => <button type="button" key={turn[0].key} aria-label={zh ? `跳转到第 ${index + 1} 轮：${turn[0].text.slice(0, 60)}` : `Jump to turn ${index + 1}: ${turn[0].text.slice(0, 60)}`} aria-current={active === turn[0].key ? 'step' : undefined} aria-describedby={preview === turn[0].key ? 'session-turn-preview' : undefined} onMouseEnter={() => setPreview(turn[0].key)} onFocus={() => setPreview(turn[0].key)} onBlur={() => setPreview(null)} onClick={() => {
      const element = [...(container?.querySelectorAll<HTMLElement>('[data-turn-key]') ?? [])].find(element => element.dataset.turnKey === turn[0].key)
      if (element && container) { onJump(); container.scrollTo({top: container.scrollTop + element.getBoundingClientRect().top - container.getBoundingClientRect().top - 12, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'}) }
    }}><span/></button>)}</div>
    {turn && <div className="session-turn-preview" role="tooltip" id="session-turn-preview"><strong>{turn[0].text || (zh ? '图片请求' : 'Image request')}</strong><p>{answer?.text || (zh ? '本轮尚未完成' : 'This turn has not completed')}</p></div>}
  </nav>
}
