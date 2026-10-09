import { File, Folder } from 'lucide-react'

/** Display-only formatting; keep the original path for native calls. */
export function readableSettingsPath(path:string) {
  if(path.toLowerCase().startsWith('\\\\?\\unc\\'))return `\\\\${path.slice(8)}`
  return path.startsWith('\\\\?\\')?path.slice(4):path
}

export function SettingsLocation({path,kind='directory'}:{path:string;kind?:'directory'|'file'}) {
  const Icon=kind==='file'?File:Folder
  return <span className="settings-location" title={readableSettingsPath(path)}>
    <Icon size={15} aria-hidden="true"/><span className="settings-location-name">{readableSettingsPath(path)}</span>
  </span>
}
