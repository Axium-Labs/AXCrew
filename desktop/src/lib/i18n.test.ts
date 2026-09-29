import { beforeEach, describe, expect, it } from 'vitest'
import { dictionaries, translate, useLang } from './i18n'

beforeEach(() => { useLang.setState({ lang: 'zh' }) })

describe('language switching', () => {
  it('reads from the active dictionary', () => {
    expect(translate('nav.sessions')).toBe('会话')
    useLang.setState({ lang: 'en' })
    expect(translate('nav.sessions')).toBe('Sessions')
  })

  it('toggles between the two languages', () => {
    useLang.getState().toggleLang()
    expect(useLang.getState().lang).toBe('en')
    useLang.getState().toggleLang()
    expect(useLang.getState().lang).toBe('zh')
  })
})

describe('lookup', () => {
  it('returns the key itself so a missing entry is visible rather than blank', () => {
    expect(translate('does.not.exist')).toBe('does.not.exist')
  })

  it('keeps both dictionaries in step', () => {
    const missingFromEnglish = Object.keys(dictionaries.zh).filter(key => !(key in dictionaries.en))
    const missingFromChinese = Object.keys(dictionaries.en).filter(key => !(key in dictionaries.zh))
    expect(missingFromEnglish).toEqual([])
    expect(missingFromChinese).toEqual([])
  })
})

describe('interpolation', () => {
  it('substitutes named placeholders', () => {
    const zhText = translate('session.roundProgress', { rounds: 3, seconds: 30 })
    expect(zhText).toContain('3')
    expect(zhText).toContain('30')
    useLang.setState({ lang: 'en' })
    expect(translate('session.roundProgress', { rounds: 3, seconds: 30 })).toBe('Round 3 · every 30s')
  })

  it('leaves a placeholder literal when no value is supplied', () => {
    expect(translate('session.roundProgress', { rounds: 3 })).toContain('{seconds}')
  })
})
