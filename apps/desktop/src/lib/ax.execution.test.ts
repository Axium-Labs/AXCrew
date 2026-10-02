import { describe, expect, it } from 'vitest'
import { axTuiCommand } from './ax'

describe('AX terminal launch quoting', () => {
  it('quotes executable paths for the selected shell', () => {
    const path = "C:\\Program Files\\O'Brien\\ax.exe"
    expect(axTuiCommand(path)).toBe("& 'C:\\Program Files\\O''Brien\\ax.exe' tui")
    expect(axTuiCommand(path, 'cmd')).toBe(`"${path}" tui`)
    expect(axTuiCommand(path, 'git_bash')).toBe("'C:/Program Files/O'\\''Brien/ax.exe' tui")
    expect(axTuiCommand(path, 'wsl')).toBe('"$(wslpath \'C:\\Program Files\\O\'\\\'\'Brien\\ax.exe\')" tui')
  })
})
