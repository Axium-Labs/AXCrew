import { expect, it, vi } from 'vitest'
const native=vi.hoisted(()=>({zoom:vi.fn().mockResolvedValue(undefined)}))
vi.mock('../../apps/desktop/src/lib/ax',()=>({axAvailable:true}))
vi.mock('../../apps/desktop/node_modules/@tauri-apps/api/webview.js',()=>({getCurrentWebview:()=>({setZoom:native.zoom})}))
import { startWindowScale } from '../../apps/desktop/src/lib/scale'

it('resets native zoom once and leaves window resizing and monitor DPI to the system',()=>{
  const oldDpi=window.devicePixelRatio
  Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:1.5})
  document.documentElement.style.setProperty('zoom','1.6')
  const stop=startWindowScale()
  expect(native.zoom).toHaveBeenCalledExactlyOnceWith(1)
  expect(document.documentElement.style.getPropertyValue('zoom')).toBe('')
  Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:1})
  window.dispatchEvent(new Event('resize'))
  expect(native.zoom).toHaveBeenCalledOnce()
  stop()
  Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:oldDpi})
})
