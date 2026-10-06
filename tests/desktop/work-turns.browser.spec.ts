import { expect, test } from '../../apps/desktop/node_modules/@playwright/test'

test('related web calls form one phase, completion folds manual expansion, branch return preserves outputs',async({page})=>{
  await page.route('**/src/lib/api.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    const task={id:'work',crew_id:'crew',title:'核对中文资料',assigned_member:'member',assigned_device:'local',dependencies:[],status:'running',input:'核对中文资料',created_at:Date.now()/1000,started_at:Date.now()/1000};
    const binding={task_id:'work',ax_session_id:'s',member_id:'member',device_id:'local'};
    const updates=[];
    window.__finishWork=()=>{task.status='completed';task.finished_at=Date.now()/1000;};
    window.__saveUpdate=update=>updates.push({sessionId:'s',update});
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async(path)=>path==='/api/projects'?[]:{};
    export const endpoints={health:async()=>({status:'ok'}),crews:async()=>[{id:'crew'}],devices:async()=>[{id:'local',name:'本机',status:'online'}],tasks:async()=>[task],sessions:async()=>[binding],permissions:async()=>[],members:async()=>[{id:'member',cwd:'C:/workspace',device_id:'local'}],events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),automations:async()=>[],automationRuns:async()=>[],localAx:async()=>({projects:[]}),history:async()=>({task_id:'work',ax_session_id:'s',updates:task.status==='completed'?updates:[]})};
  `}))
  let socket:import('@playwright/test').WebSocketRoute
  await page.routeWebSocket('**/api/ws*',ws=>{socket=ws})
  await page.addInitScript(()=>localStorage.setItem('ax-crew-language',JSON.stringify({state:{lang:'zh'},version:0})))
  await page.setViewportSize({width:1440,height:1000})
  await page.goto('/#/sessions/work')
  await expect.poll(()=>!!socket!).toBe(true)
  let sequence=0
  const send=async(update:Record<string,unknown>)=>{
    await page.evaluate(update=>(window as unknown as {__saveUpdate:(update:unknown)=>void}).__saveUpdate(update),update)
    socket.send(JSON.stringify({event_id:'e'+(++sequence),kind:'agent.message',task_id:'work',session_id:'s',timestamp:Date.now()/1000,payload:update}))
  }
  await send({sessionUpdate:'user_message_chunk',messageId:'u',content:{text:'核对中文资料'}})
  await send({sessionUpdate:'agent_thought_chunk',content:{text:'先核对可靠来源'}})
  await send({sessionUpdate:'agent_message_chunk',messageId:'intro',content:{text:'我会集中读取相关网页，再汇总结果。'}})
  for(let i=1;i<=3;i++){
    await send({sessionUpdate:'tool_call',toolCallId:'w'+i,title:'fetch 2 urls: https://zh.wikisource.org/wiki/%E9%B2%81',kind:'web',rawInput:{name:'web',arguments:{operation:'fetch',urls:['https://zh.wikisource.org/wiki/%E9%B2%81','https://example.org']}}})
    await send({sessionUpdate:'tool_call_update',toolCallId:'w'+i,status:'completed',rawOutput:{status:'success',raw_output:'网页资料 '+i}})
    if(i<3)await send({sessionUpdate:'agent_message_chunk',messageId:'progress'+i,content:{text:'接着核对来源 '+i}})
  }
  await expect(page.locator('.session-tool-group-summary')).toHaveCount(1)
  await expect(page.locator('.session-process-content .session-message-actions')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'创建聊天分支'})).toHaveCount(0)
  const summary=page.locator('.session-process-summary')
  expect(await summary.locator('span').evaluate(node=>getComputedStyle(node).animationName)).toBe('none')
  await page.getByRole('button',{name:'浏览了网页'}).click()
  await expect(page.locator('.session-tool-title').first()).toHaveText('已读取 2 个网页 · zh.wikisource.org')
  await page.locator('.session-tool-row').first().click()
  await expect(page.locator('.session-tool-output')).toHaveText('网页资料 1')
  // Explicitly closing/reopening during work must not pin it open after completion.
  await summary.click();await summary.click()
  await page.screenshot({path:'test-results/work-turn-running.png'})
  await send({sessionUpdate:'agent_message_chunk',messageId:'final',content:{text:'资料已核对完成。这里是统一汇总的结果。'}})
  await page.evaluate(()=>(window as unknown as {__finishWork:()=>void}).__finishWork())
  socket.send(JSON.stringify({event_id:'done',kind:'task.completed',task_id:'work',timestamp:Date.now()/1000,payload:{}}))
  await expect(summary).toHaveAttribute('aria-expanded','false')
  await expect(page.getByText('资料已核对完成。这里是统一汇总的结果。')).toBeVisible()
  await expect(page.getByRole('button',{name:'创建聊天分支'})).toHaveCount(1)
  await page.screenshot({path:'test-results/work-turn-completed.png'})
  await page.getByRole('button',{name:'创建聊天分支'}).click()
  await expect(page.locator('.session-branch-banner')).toBeVisible()
  await page.goBack()
  await expect(summary).toHaveAttribute('aria-expanded','false')
  await summary.click()
  const group=page.getByRole('button',{name:'浏览了网页'})
  if(await group.getAttribute('aria-expanded')!=='true')await group.click()
  const row=page.locator('.session-tool-row').first()
  if(await row.getAttribute('aria-expanded')!=='true')await row.click()
  await expect(page.locator('.session-tool-output').first()).toHaveText('网页资料 1')
  await expect(page.locator('.session-tool-row')).toHaveCount(3)
})
