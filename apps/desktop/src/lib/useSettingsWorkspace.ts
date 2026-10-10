import { useQuery } from '@tanstack/react-query'
import { axAvailable } from './ax'
import { call } from './errors'

/** Settings must not run AX in a stale persisted folder or another project. */
export function useSettingsWorkspace(candidate?: string, enabled = true) {
  const validation = useQuery({
    queryKey: ['settings-workspace', candidate],
    queryFn: () => call<string>('validate_workspace', { path: candidate }),
    enabled: enabled && axAvailable && !!candidate,
    retry: false,
    staleTime: 0,
  })
  return {
    workspace: axAvailable && enabled ? (validation.error ? undefined : validation.data) : candidate,
    error: validation.error,
    checking: enabled && axAvailable && !!candidate && validation.isPending,
  }
}
