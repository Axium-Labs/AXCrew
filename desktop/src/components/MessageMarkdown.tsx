import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MessageMarkdown({text}:{text:string}){
  return <div className="session-markdown"><Markdown remarkPlugins={[remarkGfm]} components={{a:({href,children})=><a href={href} target="_blank" rel="noopener noreferrer">{children}</a>}}>{text}</Markdown></div>
}
