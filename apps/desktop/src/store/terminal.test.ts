import { beforeEach, describe, expect, it } from 'vitest'
import { useTerminalDock } from './terminal'

const ids=()=>useTerminalDock.getState().tabs.map(tab=>tab.id)

function seed(...cwds:string[]){
  useTerminalDock.setState({open:true,tabs:[],activeId:null})
  for(const cwd of cwds)useTerminalDock.getState().addTab(cwd)
  return ids()
}

beforeEach(()=>{useTerminalDock.setState({open:false,tabs:[],activeId:null})})

describe('terminal tab order',()=>{
  it('moves the dragged tab in front of the tab it was dropped on',()=>{
    const [a,b,c]=seed('C:/a','C:/b','C:/c')
    useTerminalDock.getState().reorderTab(c!,a!)
    expect(ids()).toEqual([c,a,b])
  })

  it('moves a tab towards the end',()=>{
    const [a,b,c]=seed('C:/a','C:/b','C:/c')
    useTerminalDock.getState().reorderTab(a!,c!)
    expect(ids()).toEqual([b,c,a])
  })

  it('ignores unknown ids and a drop onto itself',()=>{
    const [a]=seed('C:/a','C:/b')
    const before=ids()
    useTerminalDock.getState().reorderTab('missing',a!)
    useTerminalDock.getState().reorderTab(a!,a!)
    expect(ids()).toEqual(before)
  })

  it('keeps each shell with its own directory and keeps the active tab active',()=>{
    const [a,b]=seed('C:/a','C:/b')
    useTerminalDock.getState().setActive(b!)
    useTerminalDock.getState().reorderTab(b!,a!)
    const state=useTerminalDock.getState()
    expect(state.activeId).toBe(b)
    expect(state.tabs.map(tab=>tab.cwd)).toEqual(['C:/b','C:/a'])
  })
})
