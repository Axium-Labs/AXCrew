import { invoke, isTauri } from '@tauri-apps/api/core'
import { useQuery } from '@tanstack/react-query'

export type EvolutionStatus = {
  enabled: boolean
  pending: number
  last_analysis: number
  consecutive_failures: number
  backoff_seconds: number
  pending_reviews: number
}

export type EvolutionSkill = {
  name: string
  state: 'candidate' | 'trial' | 'active' | 'archived' | 'deleted'
  use_count: number
  success_count: number
  digest?: string
}

export type EvolutionReview = {
  name: string
  digest: string
  content: string
  evidence: { id: string; task: string }[]
}

export type EvolutionData = {
  status: EvolutionStatus
  skills: EvolutionSkill[]
  reviews: EvolutionReview[]
}

export type EvolutionUnavailableReason = 'desktopRequired' | 'workspaceRequired' | 'axMissing' | 'axOutdated' | 'invalidData' | 'readFailed' | 'staleReview'
export type LocalEvolution = ({ available: true } & EvolutionData) | { available: false; reason: EvolutionUnavailableReason; detail?: string }

class InvalidEvolutionData extends Error {}
class StaleEvolutionReview extends Error {}
class EvolutionCommandError extends Error {
  nativeFailure: boolean
  constructor(reason: unknown) {
    super(diagnostic(reason))
    try {
      const raw = reason instanceof Error ? reason.message : String(reason)
      const value: unknown = JSON.parse(raw)
      this.nativeFailure = !isObject(value) || typeof value.error !== 'string'
    } catch { this.nativeFailure = true }
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const states = new Set(['candidate', 'trial', 'active', 'archived', 'deleted'])

function diagnostic(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason)
  try {
    const value: unknown = JSON.parse(raw)
    if (isObject(value) && typeof value.error === 'string') return value.error
  } catch { /* Older AX versions return plain-text command errors. */ }
  return raw
}

// Every command stays in the local desktop process. Serialize invocations for
// reads and mutations because different paths can resolve to the same project.
let commandTail = Promise.resolve()

function command(workspace: string, args: string[]): Promise<unknown> {
  const running = commandTail.then(async () => {
    let output: string
    try {
      output = await invoke<string>('ax_tui_command', { cwd: workspace, args: ['evolution', ...args] })
    } catch (reason) {
      throw new EvolutionCommandError(reason)
    }
    let value: unknown
    try { value = JSON.parse(output) } catch { throw new InvalidEvolutionData('Invalid evolution JSON') }
    if (isObject(value) && typeof value.error === 'string') throw new EvolutionCommandError(JSON.stringify(value))
    return value
  })
  commandTail = running.then(() => {}, () => {})
  return running
}

function readStatus(value: unknown): EvolutionStatus {
  if (!isObject(value) || typeof value.enabled !== 'boolean'
    || !isCount(value.pending) || !isCount(value.last_analysis)
    || !isCount(value.consecutive_failures) || !isCount(value.backoff_secs)
    || !isCount(value.pending_reviews)) throw new InvalidEvolutionData('Invalid evolution status')
  return {
    enabled: value.enabled,
    pending: value.pending,
    last_analysis: value.last_analysis,
    consecutive_failures: value.consecutive_failures,
    backoff_seconds: value.backoff_secs,
    pending_reviews: value.pending_reviews,
  }
}

function readSkills(value: unknown): EvolutionSkill[] {
  if (!Array.isArray(value)) throw new InvalidEvolutionData('Invalid evolved skills')
  const names = new Set<string>()
  return value.map((item: unknown) => {
    if (!isObject(item) || typeof item.name !== 'string' || !/^[a-z0-9-]{1,64}$/.test(item.name)
      || typeof item.state !== 'string' || !states.has(item.state)
      || !isCount(item.use_count) || !isCount(item.success_count)
      || (item.digest !== null && !isDigest(item.digest)) || names.has(item.name)) {
      throw new InvalidEvolutionData('Invalid evolved skill metadata')
    }
    names.add(item.name)
    return {
      name: item.name,
      state: item.state as EvolutionSkill['state'],
      use_count: item.use_count,
      success_count: item.success_count,
      ...(typeof item.digest === 'string' ? { digest: item.digest } : {}),
    }
  })
}

async function readReview(workspace: string, skill: EvolutionSkill): Promise<EvolutionReview> {
  const value = await command(workspace, ['show', skill.name])
  if (!isObject(value) || value.name !== skill.name || value.state !== 'candidate'
    || typeof value.skill_md !== 'string' || !Array.isArray(value.evidence) || !skill.digest) {
    throw new InvalidEvolutionData('Invalid evolved skill preview')
  }
  const evidence = value.evidence.map((item: unknown) => {
    if (!isObject(item) || typeof item.id !== 'string' || typeof item.task !== 'string') {
      throw new InvalidEvolutionData('Invalid evolved skill evidence')
    }
    return { id: item.id, task: item.task }
  })
  // `show` returns the exact SKILL.md but no digest. Match its UTF-8 SHA-256
  // against the queued review digest before allowing either review action.
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value.skill_md))
  const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== skill.digest) throw new StaleEvolutionReview()
  return { name: skill.name, digest, content: value.skill_md, evidence }
}

export async function readLocalEvolution(workspace?: string): Promise<LocalEvolution> {
  if (!isTauri()) return { available: false, reason: 'desktopRequired' }
  if (!workspace) return { available: false, reason: 'workspaceRequired' }
  try {
    const status = readStatus(await command(workspace, ['status']))
    const skills = readSkills(await command(workspace, ['skills']))
    const reviews: EvolutionReview[] = []
    // Do not parallelize `show`: each CLI read acquires the same writer lock.
    for (const skill of skills) {
      if (skill.state === 'candidate' && skill.digest) reviews.push(await readReview(workspace, skill))
    }
    return { available: true, status, skills, reviews }
  } catch (reason) {
    if (reason instanceof StaleEvolutionReview) return { available: false, reason: 'staleReview' }
    const detail = diagnostic(reason)
    if (reason instanceof InvalidEvolutionData) return { available: false, reason: 'invalidData', detail }
    if (/unrecognized subcommand|unknown (sub)?command|unexpected argument|method not found/i.test(detail)) {
      return { available: false, reason: 'axOutdated', detail }
    }
    if (/choose an existing workspace directory|workspace (directory )?(is )?(unavailable|invalid)/i.test(detail)) {
      return { available: false, reason: 'workspaceRequired', detail }
    }
    if (reason instanceof EvolutionCommandError && reason.nativeFailure
      && /cannot locate the ax executable|ax(\.exe)? .*not found|ax .*not installed|os error (2|3)\b|no such file or directory|cannot find the (file|path)|找不到指定的(文件|路径)/i.test(detail)) {
      return { available: false, reason: 'axMissing', detail }
    }
    return { available: false, reason: 'readFailed', detail }
  }
}

export function useLocalEvolution(workspace?: string) {
  return useQuery({
    queryKey: ['ax-evolution', workspace],
    queryFn: () => readLocalEvolution(workspace),
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: false,
  })
}

export async function axEvolutionReview(workspace: string, name: string, digest: string, accept: boolean): Promise<void> {
  if (!isDigest(digest)) throw new InvalidEvolutionData('Invalid learned skill review digest')
  await command(workspace, ['review', name, '--digest', digest, accept ? '--accept' : '--reject'])
}

export async function axEvolutionArchive(workspace: string, name: string): Promise<void> {
  await command(workspace, ['archive', name])
}
