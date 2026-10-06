import { expect, test } from '@playwright/test'

const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
test.beforeEach(async({page})=>{
  await page.route('**/src/lib/api.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    const tasks=[],sessions=[];
    const updates=[{update:{sessionUpdate:'user_message_chunk',messageId:'u',content:{text:'修复校验错误'}}},{update:{sessionUpdate:'agent_message_chunk',messageId:'a',content:{text:'已修复字段校验。验证全部通过。'}}},{update:{sessionUpdate:'turn_changes',changedFiles:[{path:'src/schema.py',additions:3,deletions:1,diff:'@@ -42 +42 @@\\n-old\\n+new'}]}}];
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async(path,method,body)=>{if(path==='/api/projects')return [];
      (window.__requests??=[]).push({path,method,body});
      if(path==='/api/sessions'){
        const input={prompt:body.text,display_text:body.text,context:body.context??[]};
        if(body.context?.length)input.prompt+='\\n\\n[AX Crew conversation context]\\n'+JSON.stringify(body.context)+'\\n[End AX Crew conversation context]';
        const task={id:'created-'+(tasks.length+1),crew_id:'crew',parent_id:null,title:body.title,description:'',assigned_member:'member',assigned_device:'local',dependencies:[],priority:0,status:'ready',input,output:null,retry_count:0,created_at:Date.now()/1000,started_at:null,finished_at:null};tasks.push(task);return task;
      }
      return {};
    };
    export const endpoints={health:async()=>({status:'ok'}),crews:async()=>[{id:'crew',name:'本地'}],devices:async()=>[{id:'local',name:'本机',status:'online'}],tasks:async()=>tasks,sessions:async()=>sessions,permissions:async()=>[],members:async()=>[{id:'member',crew_id:'crew',name:'本地',device_id:'local',cwd:'C:/workspace',skills:[],mcp_servers:[],permission_profile:'ask'}],events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),automations:async()=>[],automationRuns:async()=>[],localAx:async()=>({available:true,projects:[{id:'project',root:'C:/workspace',sessions:[{id:'local-1',title:'校验修复',created_at:1,updated_at:2,messages:2,task_id:null}]}]}),localSession:async()=>({task_id:'local-1',ax_session_id:'local-1',updates}),history:async()=>({updates:[]})};
  `}))
  await page.routeWebSocket('**/api/ws*',()=>{})
  await page.addInitScript(()=>localStorage.setItem('ax-crew-language',JSON.stringify({state:{lang:'zh'},version:0})))
  await page.setViewportSize({width:1600,height:1000})
})

test('changed files open in the sidebar and selected text starts an independent side chat',async({page})=>{
  await page.goto('/#/sessions?local=local-1')
  await page.getByRole('button',{name:'查看变更'}).click()
  await expect(page.locator('.session-changes-panel .is-added code')).toHaveText('new')
  await expect(page.locator('.session-changes-panel .is-deleted .session-diff-number')).toHaveText('42')
  await page.locator('.session-changes-panel').getByRole('button',{name:'文件',exact:true}).click()
  await expect(page.getByText('此记录未保存差异；文件内容可在本地桌面端查看。')).toBeVisible()
  const answer=page.locator('.session-chat-panel .session-transcript-line.is-agent .session-markdown p')
  await answer.evaluate(node=>{const selection=window.getSelection(),range=document.createRange();range.selectNodeContents(node);selection?.removeAllRanges();selection?.addRange(range);node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))})
  await page.getByRole('button',{name:'在侧边聊天中提问'}).click()
  await expect(page.locator('.session-side-quotes')).toContainText('已修复字段校验。验证全部通过。')
  await page.getByRole('textbox',{name:'侧边聊天输入'}).fill('解释这个校验')
  await page.getByRole('button',{name:'发送侧边消息'}).click()
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__requests:{body:{text:string;context:{text:string}[]}}[]}).__requests?.[0]?.body.text)).toBe('解释这个校验')
  expect(await page.evaluate(()=>(window as unknown as {__requests:{body:{context:{text:string}[]}}[]}).__requests[0].body.context[0].text)).toContain('已修复字段校验')
  await expect(page).toHaveURL(/local=local-1/)
  await expect(page.locator('.session-side-chat .session-process-summary')).toContainText('思考中')
  await expect(page.locator('.session-side-chat .session-process-summary time')).toContainText('用时')
  await page.screenshot({path:'test-results/session-side-chat.png'})
  await page.getByRole('button',{name:'创建聊天分支'}).click()
  await expect(page.locator('.session-branch-banner')).toContainText('分支')
  await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('继续验证')
  await page.locator('.session-chat-panel .session-send-button').click()
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__requests:{body:{text:string}}[]}).__requests?.[1]?.body.text)).toBe('继续验证')
  expect(await page.evaluate(()=>(window as unknown as {__requests:{body:{context:{text:string}[]}}[]}).__requests[1].body.context.map(item=>item.text))).toEqual(['修复校验错误','已修复字段校验。验证全部通过。'])
  await expect(page).toHaveURL(/sessions\/created-2/)
  await expect(page.locator('.session-chat-panel .session-stop-button')).toBeVisible()
})

test('composer and submitted image thumbnails both reopen the image',async({page})=>{
  await page.goto('/#/sessions')
  await page.locator('.session-composer input[type=file]').setInputFiles({name:'example.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')})
  await page.getByRole('button',{name:'查看图片 example.png'}).click()
  await expect(page.getByRole('dialog',{name:'example.png'})).toBeVisible()
  await page.getByRole('button',{name:'关闭图片'}).click()
  await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('看图片')
  await page.locator('.session-chat-panel .session-send-button').click()
  await expect(page).toHaveURL(/sessions\/created-1/)
  await page.getByRole('button',{name:'查看图片 example.png'}).click()
  await expect(page.getByRole('dialog',{name:'example.png'})).toBeVisible()
  await page.getByRole('button',{name:'关闭图片'}).click()
  await expect(page.locator('.session-chat-panel .session-process-summary')).toContainText('思考中')
  await expect(page.locator('.session-chat-panel .session-process-summary time')).toContainText('用时')
  await page.screenshot({path:'test-results/session-sent-image.png'})
})

test('live change summary opens and follows successful edits while replying text stays hidden',async({page})=>{
  await page.route('**/src/lib/api.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    const task={id:'live-edit',crew_id:'crew',title:'修复代码',assigned_member:'member',assigned_device:'local',dependencies:[],status:'running',input:'修复代码',created_at:Date.now()/1000,started_at:Date.now()/1000};
    const session={task_id:'live-edit',ax_session_id:'s',member_id:'member',device_id:'local'};
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async(path)=>path==='/api/projects'?[]:{};
    export const endpoints={health:async()=>({status:'ok'}),crews:async()=>[],devices:async()=>[],tasks:async()=>[task],sessions:async()=>[session],permissions:async()=>[],members:async()=>[{id:'member',cwd:'C:/workspace',device_id:'local'}],events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),automations:async()=>[],automationRuns:async()=>[],localAx:async()=>({projects:[]}),history:async()=>({task_id:'live-edit',updates:[]})};
  `}))
  let socket: import('@playwright/test').WebSocketRoute
  await page.routeWebSocket('**/api/ws*',ws=>{socket=ws})
  await page.goto('/#/sessions/live-edit')
  const summary=page.getByRole('button',{name:'查看当前文件变更'})
  await expect(summary).toHaveCount(0)
  await expect(page.getByText('正在回复…',{exact:true})).toHaveCount(0)
  await expect(page.locator('.session-stop-button')).toBeVisible()
  const sendEdit=(id:string,path:string,additions:number)=>socket.send(JSON.stringify({event_id:id,kind:'agent.message',task_id:'live-edit',session_id:'s',timestamp:Date.now()/1000,payload:{sessionUpdate:'tool_call',toolCallId:id,title:'editing '+path,status:'completed',rawInput:{name:'patch',arguments:{path}},rawOutput:{raw_output:JSON.stringify({changed_files:[{path,additions,deletions:1,diff:'@@ -1 +1 @@\n-old\n+new'}]})}}}))
  await expect.poll(()=>!!socket!).toBe(true)
  sendEdit('edit-1','src/first.ts',3)
  await expect(summary).toContainText('1 个文件已更改')
  await expect(summary).toContainText('+3')
  await summary.click()
  await expect(page.locator('.session-changes-panel .is-added code')).toHaveText('new')
  sendEdit('edit-2','src/second.ts',5)
  await expect(summary).toContainText('2 个文件已更改')
  await expect(page.locator('.session-changes-panel-list button')).toHaveCount(2)
  await page.locator('.session-changes-panel-list button').filter({hasText:'src/second.ts'}).click()
  await expect(page.locator('.session-changes-panel-header strong')).toHaveText('src/second.ts')
  await page.screenshot({path:'test-results/live-change-summary.png'})
})
