import type { AxModel } from './ax'

// Capability values belong to the provider catalogue, including future values.
export function modelEfforts(model?: Pick<AxModel, 'reasoning_efforts'> | null) {
  return [...new Set(model?.reasoning_efforts?.filter(value => !!value) ?? [])]
}
export function selectedEffort(model: AxModel | undefined | null, preferred: string) {
  const values = modelEfforts(model)
  return values.includes(preferred) ? preferred : values.includes(model?.reasoning_effort ?? '') ? model!.reasoning_effort! : values.includes(model?.default_reasoning_effort ?? '') ? model!.default_reasoning_effort! : values[0] ?? ''
}
export function effortLabel(value: string, lang: 'zh' | 'en') {
  const labels: Record<string, string> = { none: '无', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高', ultra: '极高' }
  return lang === 'zh' ? labels[value] ?? value : value
}
