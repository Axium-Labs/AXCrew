import { describe, expect, it } from 'vitest'
import { startWindowScale, windowScale } from './scale'

describe('window scale', () => {
  it('keeps native DPI handling at every window size', () => {
    expect(windowScale(1080)).toBe(1)
    expect(windowScale(1440)).toBe(1)
    expect(windowScale(1800)).toBe(1)
    expect(windowScale(2600)).toBe(1)
  })

  it('never falls back to CSS zoom on the document', () => {
    // CSS zoom on the root kept the layout viewport at its old size: a 100vh app rendered at only
    // `zoom` of the window height and left dead space at the bottom. The zoom must go through the
    // native webview zoom instead.
    document.documentElement.style.setProperty('zoom', '0.85')
    const stop = startWindowScale()
    expect(document.documentElement.style.getPropertyValue('zoom')).toBe('')
    stop()
  })
})
