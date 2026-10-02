import { describe, expect, it } from 'vitest'
import { stopFileAbsolute } from './goalLoop'

describe('goal loop stop file', () => {
  it('joins the stop file onto the workspace for both separator styles', () => {
    expect(stopFileAbsolute('C:\\work\\app', '.crew-stop')).toBe('C:\\work\\app\\.crew-stop')
    expect(stopFileAbsolute('C:\\work\\app\\', '.crew-stop')).toBe('C:\\work\\app\\.crew-stop')
    expect(stopFileAbsolute('/home/ax/app', '.crew-stop')).toBe('/home/ax/app/.crew-stop')
    expect(stopFileAbsolute('/home/ax/app/', '.crew-stop')).toBe('/home/ax/app/.crew-stop')
  })
})
