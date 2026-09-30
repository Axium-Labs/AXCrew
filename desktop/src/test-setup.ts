import { beforeEach } from 'vitest'
import { useLang } from './lib/i18n'
beforeEach(() => { useLang.setState({ lang: 'zh' }) })
