import { getCurrentWebview } from '@tauri-apps/api/webview'
import { axAvailable } from './ax'

// Windows/WebView already handles monitor DPI. Layout responds to CSS pixels;
// multiplying page zoom by window width enlarges text and can use stale DPI.
export function windowScale(_width: number) { return 1 }
export function startWindowScale() {
  document.documentElement.style.removeProperty('zoom')
  if (axAvailable) {
    try { void getCurrentWebview().setZoom(1).catch(() => {}) } catch { /* Bridge unavailable. */ }
  }
  return () => {}
}
