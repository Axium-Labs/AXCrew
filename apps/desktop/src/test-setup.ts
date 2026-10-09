import { beforeEach } from 'vitest'
import { useLang } from './lib/i18n'
beforeEach(() => { useLang.setState({ lang: 'zh' }) })

// jsdom has no layout observer; real resizing is covered by Playwright.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.setPointerCapture ??= () => {}
Element.prototype.releasePointerCapture ??= () => {}
