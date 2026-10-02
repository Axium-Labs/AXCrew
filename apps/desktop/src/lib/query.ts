import { useQuery, useQueryClient } from '@tanstack/react-query'
import { endpoints } from './api'

export function useDevices(){return useQuery({queryKey:['devices'],queryFn:endpoints.devices})}
export function useCrews(){return useQuery({queryKey:['crews'],queryFn:endpoints.crews})}
export function useTasks(){return useQuery({queryKey:['tasks'],queryFn:endpoints.tasks})}
export function useSessions(){return useQuery({queryKey:['sessions'],queryFn:endpoints.sessions})}
export function usePermissions(){return useQuery({queryKey:['permissions'],queryFn:endpoints.permissions})}
export function useAutomations(){return useQuery({queryKey:['automations'],queryFn:endpoints.automations})}
export function useAutomationRuns(){return useQuery({queryKey:['automationRuns'],queryFn:()=>endpoints.automationRuns(100)})}
export function useLocalAx(){return useQuery({queryKey:['localAx'],queryFn:endpoints.localAx,staleTime:15_000})}
export function useMembers(crewId:string){return useQuery({queryKey:['members',crewId],queryFn:()=>endpoints.members(crewId),enabled:!!crewId})}
export function useAllMembers(){const crews=useCrews();return useQuery({queryKey:['allMembers',crews.data?.map(c=>c.id)],queryFn:async()=>(await Promise.all((crews.data??[]).map(c=>endpoints.members(c.id)))).flat(),enabled:!!crews.data})}
export function useRefresh(){const client=useQueryClient();return ()=>client.invalidateQueries()}
