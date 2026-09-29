import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { axAvailable } from './ax'

// The desktop window scales the whole UI so a big window shows a bigger interface and a small one
// stays usable. The baseline is the default window size from tauri.conf.json (1440x900).
//
// This uses the native webview zoom (a real page zoom) rather than CSS `zoom`: with CSS zoom the
// layout viewport stayed at the old size, so `vh`-sized elements (`.app{height:100vh}`) rendered at
// only `zoom` of the window and left dead space at the bottom, and every `vw`-based width drifted.
// The zoom is derived from the window's physical size, not from `window.innerWidth`, because the
// inner width already reflects the zoom and would feed back into itself.
const baseline = 1440, minimum = 0.85, maximum = 1.6

export function windowScale(width: number) { return Math.min(maximum, Math.max(minimum, width / baseline)) }

export function startWindowScale() {
  if (!axAvailable) return () => {}
  // Scaling is cosmetic: a missing or stubbed Tauri bridge must never take the UI down with it.
  try {
    return attach()
  } catch {
    return () => {}
  }
}

function attach() {
  // Clear the root zoom an earlier build applied; the native zoom below replaces it.
  document.documentElement.style.removeProperty('zoom')
  const displayScale = window.devicePixelRatio || 1
  const view = getCurrentWebview(), appWindow = getCurrentWindow()
  let applied = 1, timer: ReturnType<typeof setTimeout> | undefined, disposed = false
  const apply = async () => {
    if (disposed) return
    try {
      const size = await appWindow.innerSize()
      if (!size || typeof size.width !== 'number' || size.width <= 0) return
      const factor = windowScale(size.width / displayScale)
      if (Math.abs(factor - applied) > 0.005) { applied = factor; await view.setZoom(factor) }
    } catch { /* webview not ready yet, or zoom unsupported: keep the last factor */ }
  }
  const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void apply(), 120) }
  void apply()
  let unlisten: (() => void) | undefined
  void appWindow.onResized(schedule).then(off => { if (disposed) off(); else unlisten = off }).catch(() => {})
  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    unlisten?.()
    void view.setZoom(1).catch(() => {})
  }
}
