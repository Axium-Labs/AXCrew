import { expect, test } from '../../apps/desktop/node_modules/@playwright/test'

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('ax-crew-language', JSON.stringify({state:{lang:'zh'}, version:0})))
  await page.route('**/src/lib/api.ts*', route => route.fulfill({contentType:'application/javascript', body:`
    const tasks=['first','second'].map((id,index)=>({id,crew_id:'crew',title:id==='first'?'中文任务一':'中文任务二',assigned_member:'member',assigned_device:'local',dependencies:[],status:'completed',input:'开始',created_at:10+index,finished_at:100}));
    const bindings=tasks.map(task=>({task_id:task.id,ax_session_id:task.id,member_id:'member',device_id:'local'}));
    const history=id=>({task_id:id,ax_session_id:id,updates:Array.from({length:5},(_,i)=>[
      {sessionId:id,update:{sessionUpdate:'user_message_chunk',messageId:'u'+i,content:{text:'第 '+(i+1)+' 轮请求：核对中文资料'}}},
      {sessionId:id,update:{sessionUpdate:'agent_message_chunk',messageId:'a'+i,content:{text:'第 '+(i+1)+' 轮结果：已完成核对。\\n\\n'+('这里是保留的完整中文答复内容。\\n\\n').repeat(14)}}}
    ]).flat()});
    window.__requests=[];
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async(path,method,body)=>{if(method==='POST'&&path.includes('/sessions')){window.__requests.push({path,body});throw Error('测试保留草稿')}return []};
    export const endpoints={health:async()=>({status:'ok'}),crews:async()=>[{id:'crew'}],devices:async()=>[{id:'local',name:'本机',status:'online'}],tasks:async()=>tasks,sessions:async()=>bindings,permissions:async()=>[],members:async()=>[{id:'member',cwd:'C:/workspace',device_id:'local'}],events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),automations:async()=>[],automationRuns:async()=>[],localAx:async()=>({projects:[]}),history:async id=>history(id)};
  `}))
  await page.route('**/src/lib/ax.ts*', route => route.fulfill({contentType:'application/javascript', body:`
    export const axAvailable=true,workspaceFileExists=async()=>false,axTuiCommand=()=>'';
    const models=[{provider:'vendor',id:'reasoner',display_name:'推理模型',reasoning_efforts:['minimal','high','ultra'],default_reasoning_effort:'high'},{provider:'vendor',id:'other',display_name:'另一个模型',reasoning_efforts:['low','max'],default_reasoning_effort:'low'},{provider:'vendor',id:'plain',display_name:'普通模型',reasoning_efforts:[]}];
    let selected=models[0],mode='standard';const state=()=>({active_path:'ax.exe',providers:[{id:'vendor',configured:true,models}],selected_model:{...selected,reasoning_effort:'minimal'},inference_mode:mode});
    export const axLocalState=async()=>state(),axSelectModel=async(provider,id)=>{selected=models.find(m=>m.id===id);return state()},axSelectInferenceMode=async value=>{mode=value;return value};
    export const axStoreApiKey=async()=>state(),axRefreshModels=async()=>state(),axRemoveCredential=async()=>state(),axSelectSubagent=async()=>{},axSelectExecution=async()=>{};
    export const axManageCapability=async()=>'',axScanCapabilitySources=async()=>[],axExport=async()=>'',axImport=async()=>'',axImportCapability=async()=>'',axCatalog=async()=>({skills:[],mcp_servers:[],tools:[],warnings:[]}),axCheckUpdate=async()=>({action:'none'}),axApplyUpdate=axCheckUpdate;
  `}))
  await page.routeWebSocket('**/api/ws*', () => {})
})

test('model popup uses catalogue steps, Fast, model switching and follow-up effort', async ({page}) => {
  await page.setViewportSize({width:1440,height:900}); await page.goto('/#/sessions/first')
  const trigger=page.getByRole('button',{name:'选择 AX 模型'})
  await expect(trigger).toContainText('推理模型');await trigger.click()
  const slider=page.getByRole('slider',{name:'思考强度'})
  await expect(slider).toHaveAttribute('max','2');await expect(slider).toHaveAttribute('aria-valuetext','最低')
  await slider.focus();await page.keyboard.press('End');await expect(slider).toHaveAttribute('aria-valuetext','极高')
  const fast=page.getByRole('button',{name:'更快',exact:true});await fast.click();await expect(fast).toHaveAttribute('aria-pressed','true')
  await page.screenshot({path:'test-results/composer-effort.png'})
  await page.getByRole('button',{name:'推理模型',exact:true}).click()
  await expect(page.getByText('重置默认',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'另一个模型 vendor'}).click()
  await expect(slider).toHaveAttribute('max','1');await expect(slider).toHaveAttribute('aria-valuetext','低')
  await page.getByRole('button',{name:'另一个模型',exact:true}).click();await page.getByRole('button',{name:'普通模型 vendor'}).click()
  await expect(page.getByRole('slider')).toHaveCount(0);await expect(page.getByText('此模型未提供可设置的思考强度')).toBeVisible()
  await page.getByRole('button',{name:'普通模型',exact:true}).click();await page.getByRole('button',{name:'推理模型 vendor'}).click()
  await expect(slider).toHaveAttribute('aria-valuetext','极高');await page.keyboard.press('Escape')
  await page.getByRole('textbox',{name:'发送消息'}).fill('继续核对');await page.getByRole('button',{name:'发送消息',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__requests:{body:{reasoning_effort:string}}[]}).__requests[0]?.body.reasoning_effort)).toBe('ultra')
})

test('new and existing drafts survive chat switching and reload; rail previews and jumps', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});await page.goto('/#/sessions')
  const input=page.getByRole('textbox',{name:'发送消息'})
  await input.fill('新聊天还没发出的中文草稿')
  await page.locator('.session-recent-row').filter({hasText:'中文任务一'}).click();await input.fill('任务一的草稿')
  await page.locator('.session-recent-row').filter({hasText:'中文任务二'}).click();await input.fill('任务二的草稿')
  await page.locator('.session-recent-row').filter({hasText:'中文任务一'}).click();await expect(input).toHaveValue('任务一的草稿')
  await page.getByRole('button',{name:'新聊天',exact:true}).click();await expect(input).toHaveValue('新聊天还没发出的中文草稿')
  await page.reload();await expect(input).toHaveValue('新聊天还没发出的中文草稿')
  await page.locator('.session-recent-row').filter({hasText:'中文任务一'}).click()
  const rail=page.getByRole('navigation',{name:'会话轮次'});await expect(rail.getByRole('button')).toHaveCount(5)
  const first=rail.getByRole('button').first();await first.hover()
  await expect(page.getByRole('tooltip')).toContainText('第 1 轮请求');await expect(page.getByRole('tooltip')).toContainText('第 1 轮结果')
  await page.screenshot({path:'test-results/turn-preview.png'})
  await first.click();await expect.poll(()=>page.locator('.session-chat-scroll').evaluate(node=>node.scrollTop)).toBeLessThan(80)
  const last=rail.getByRole('button').last();await last.click();await expect(last).toHaveAttribute('aria-current','step')
})

test('small windows retain readable sizes and keep composer and popup inside viewport', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});await page.goto('/#/sessions/first')
  const text=page.locator('.session-transcript-body').last(), font=await text.evaluate(node=>getComputedStyle(node).fontSize)
  for(const size of [{width:960,height:620},{width:760,height:620},{width:560,height:620},{width:640,height:480}]){
    await page.setViewportSize(size)
    await expect(text).toHaveCSS('font-size',font)
    await expect.poll(()=>page.locator('.session-composer').evaluate(node=>{const r=node.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight&&r.width>200})).toBe(true)
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.getByRole('button',{name:'选择 AX 模型'}).click()
    await expect.poll(()=>page.locator('.session-model-popover').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})).toBe(true)
    await page.screenshot({path:'test-results/composer-'+size.width+'.png'});await page.keyboard.press('Escape')
  }
  await page.getByRole('button',{name:'展开主导航',exact:true}).click()
  await expect(page.getByRole('button',{name:'收起主导航',exact:true})).toHaveAttribute('aria-expanded','true')
  await page.getByRole('button',{name:'收起主导航',exact:true}).click()
  await page.getByRole('link',{name:'设置',exact:true}).click()
  await expect(page.locator('.settings-workspace')).toBeVisible()
  await expect.poll(()=>page.locator('.settings-main').evaluate(node=>{const r=node.getBoundingClientRect();return r.width>200&&r.right<=innerWidth})).toBe(true)
})
