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
    export const axStoreApiKey=async()=>state(),axRefreshModels=async()=>state(),axRemoveCredential=async()=>state(),axSelectSubagent=async()=>{},axSelectExecution=async()=>{},axSubagentSettings=async()=>({max_depth:1,max_concurrent:8});
    export const axManageCapability=async()=>'',axScanCapabilitySources=async()=>[],axExport=async()=>'',axImport=async()=>'',axImportCapability=async()=>'',axCatalog=async()=>({skills:[],mcp_servers:[],tools:[],warnings:[]}),axCheckUpdate=async()=>({action:'none'}),axApplyUpdate=axCheckUpdate;
  `}))
  await page.routeWebSocket('**/api/ws*', () => {})
})

test('model popup uses catalogue steps, Fast, model switching and follow-up effort', async ({page}) => {
  await page.setViewportSize({width:1440,height:900}); await page.goto('/#/sessions/first')
  const trigger=page.getByRole('button',{name:'选择 AX 模型'})
  await expect(trigger).toContainText('推理模型');await trigger.click()
  await expect(page.locator('.session-transcript-meta')).toHaveCount(0)
  await expect(page.locator('.session-transcript')).not.toContainText('AX Session ·')
  const slider=page.getByRole('slider',{name:'思考强度'})
  await expect(slider).toHaveAttribute('max','2');await expect(slider).toHaveAttribute('aria-valuetext','最低')
  await slider.focus();await page.keyboard.press('End');await expect(slider).toHaveAttribute('aria-valuetext','极高')
  const fast=page.getByRole('button',{name:'更快',exact:true});await fast.click();await expect(fast).toHaveAttribute('aria-pressed','true')
  await page.screenshot({path:'test-results/composer-effort.png'})
  await page.getByRole('button',{name:'选择模型：推理模型',exact:true}).click()
  await expect(page.getByText('重置默认',{exact:true})).toHaveCount(0)
  await page.getByRole('menuitem',{name:'另一个模型'}).click()
  await expect(slider).toHaveAttribute('max','1');await expect(slider).toHaveAttribute('aria-valuetext','低')
  await page.getByRole('button',{name:'选择模型：另一个模型',exact:true}).click();await page.getByRole('menuitem',{name:'普通模型'}).click()
  await expect(page.getByRole('slider')).toHaveCount(0);await expect(page.getByText('此模型未提供可设置的思考强度')).toBeVisible()
  await page.getByRole('button',{name:'选择模型：普通模型',exact:true}).click();await page.getByRole('menuitem',{name:'推理模型'}).click()
  await expect(slider).toHaveAttribute('aria-valuetext','极高');await page.keyboard.press('Escape')
  await page.getByRole('textbox',{name:'发送消息'}).fill('继续核对');await page.getByRole('button',{name:'发送消息',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__requests:{body:{reasoning_effort:string}}[]}).__requests[0]?.body.reasoning_effort)).toBe('ultra')
})

test('compact model card supports pointer steps, keyboard menu navigation and dismissal', async ({page}) => {
  await page.setViewportSize({width:960,height:700});await page.goto('/#/sessions/first')
  const trigger=page.getByRole('button',{name:'选择 AX 模型'})
  await trigger.click()
  const panel=page.locator('.session-model-popover'),slider=page.getByRole('slider',{name:'思考强度'})
  expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(100)
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(260)
  const choice=page.locator('.session-model-choice')
  await page.mouse.move(0,0)
  await expect(choice).toHaveCSS('background-color','rgba(0, 0, 0, 0)')
  await choice.hover()
  expect(await choice.evaluate(node=>getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await page.mouse.move(0,0)
  await expect(choice).toHaveCSS('background-color','rgba(0, 0, 0, 0)')
  const box=(await slider.boundingBox())!
  await slider.click({position:{x:box.width-16,y:box.height/2}})
  await expect(slider).toHaveAttribute('aria-valuetext','极高')
  await expect(page.getByRole('button',{name:'恢复默认思考强度'})).toHaveCount(0)
  await slider.focus();await page.keyboard.press('Home')
  await expect(slider).toHaveAttribute('aria-valuetext','最低')
  await page.mouse.move(box.x+16,box.y+box.height/2);await page.mouse.down()
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:8});await page.mouse.up()
  await expect(slider).toHaveAttribute('aria-valuetext','高')
  await slider.focus();await page.keyboard.press('ArrowRight');await expect(slider).toHaveAttribute('aria-valuetext','极高')
  await page.locator('.session-model-choice').click()
  const menu=page.getByRole('menu',{name:'选择模型'})
  await expect(menu).toBeVisible()
  expect(await choice.evaluate(node=>getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await expect(page.getByRole('menuitem',{name:'推理模型'})).toHaveClass(/is-selected/)
  await page.screenshot({path:'test-results/model-menu-dark.png'})
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0);await expect(panel).toBeVisible();await expect(page.locator('.session-model-choice')).toBeFocused()
  await page.locator('.session-model-choice').focus();await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem',{name:'推理模型'})).toBeFocused()
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0);await expect(trigger).toContainText('另一个模型')
  await page.locator('.session-chat-scroll').click({position:{x:20,y:20}});await expect(panel).toHaveCount(0)
  for(const theme of ['dark','light']){
    await page.evaluate(value=>document.documentElement.dataset.theme=value,theme)
    await trigger.click()
    await page.getByRole('slider').focus();await page.keyboard.press('End')
    await panel.screenshot({path:`test-results/model-card-${theme}.png`})
    await page.locator('.session-model-choice').click()
    await page.locator('.session-model-menu-panel').screenshot({path:`test-results/model-list-${theme}.png`})
    await page.keyboard.press('Escape');await page.keyboard.press('Escape')
  }
})

test('Fast leaves an accelerating wake behind the thumb; endpoints are clean and effort glides', async ({page}) => {
  await page.goto('/#/sessions/first')
  await page.getByRole('button',{name:'选择 AX 模型'}).click()
  const slider=page.getByRole('slider',{name:'思考强度'}),thumb=page.locator('.session-effort-thumb'),flow=page.locator('.session-effort-flow')
  await slider.focus();await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuetext','高')
  await slider.evaluate(node=>(node as HTMLInputElement).blur())
  const fast=page.getByRole('button',{name:'更快',exact:true})
  await expect(flow).toHaveCSS('opacity','0')
  await fast.click()
  await expect(flow).toHaveCSS('opacity','0.6')
  const particle=flow.locator('i').first()
  await expect(flow.locator('i')).toHaveCount(7)
  await expect(particle).toHaveCSS('animation-name','session-fast-wake')
  await expect(particle).toHaveCSS('animation-duration','0.9s')
  await expect(particle).toHaveCSS('width','3px')
  expect(await flow.evaluate(node=>getComputedStyle(node,'::before').backgroundImage)).toBe('none')
  const start=await particle.evaluate(node=>getComputedStyle(node).left)
  await expect.poll(()=>particle.evaluate(node=>getComputedStyle(node).left)).not.toBe(start)
  const speed=await particle.evaluate(node=>{
    const animation=node.getAnimations()[0];animation.pause()
    const position=(time:number)=>{animation.currentTime=time;return parseFloat(getComputedStyle(node).left)}
    const duration=Number(animation.effect!.getTiming().duration)
    const earlyStart=position(duration*.1),earlyEnd=position(duration*.2),lateStart=position(duration*.7),lateEnd=position(duration*.8)
    animation.play();return {early:earlyStart-earlyEnd,late:lateStart-lateEnd}
  })
  expect(speed.early).toBeGreaterThan(0)
  expect(speed.late).toBeGreaterThan(speed.early)
  const wakeBox=(await flow.boundingBox())!,thumbAtFast=(await thumb.boundingBox())!
  expect(wakeBox.x+wakeBox.width).toBeCloseTo(thumbAtFast.x+thumbAtFast.width/2,0)
  await expect(flow).toHaveCSS('overflow','hidden')
  await expect(slider).toHaveAttribute('aria-valuetext','高')
  await page.locator('.session-model-popover').screenshot({path:'test-results/model-fast-particles.png'})
  await fast.click();await expect(flow).toHaveCSS('opacity','0')

  await slider.focus();await page.keyboard.press('Home')
  const box=(await slider.boundingBox())!,y=box.y+box.height/2
  const center=async()=>thumb.evaluate(node=>{const r=node.getBoundingClientRect();return r.left+r.width/2})
  await expect.poll(center).toBeCloseTo(box.x+14,0)
  const rail=page.locator('.session-effort-rail'),fill=page.locator('.session-effort-fill')
  await expect(rail).toHaveCSS('overflow','hidden')
  await expect(rail).toHaveCSS('border-radius','999px')
  const thumbBox=(await thumb.boundingBox())!
  const railBox=(await rail.boundingBox())!
  expect(thumbBox.x).toBeGreaterThanOrEqual(box.x-.1)
  expect(thumbBox.height).toBeGreaterThan(railBox.height)
  expect(thumbBox.y).toBeLessThan(railBox.y)
  expect(thumbBox.y+thumbBox.height).toBeGreaterThan(railBox.y+railBox.height)
  await slider.evaluate(node=>(node as HTMLInputElement).blur());await page.locator('.session-model-popover').screenshot({path:'test-results/model-minimum-clean.png'})
  await page.mouse.move(box.x+14,y);await page.mouse.down()
  const dragX=box.x+14+(box.width-28)*.32
  await page.mouse.move(dragX,y,{steps:8})
  expect(await thumb.evaluate(node=>parseFloat(getComputedStyle(node).transitionDuration))).toBeCloseTo(.08)
  await expect.poll(center).toBeCloseTo(dragX,0)
  await expect(slider).toHaveAttribute('aria-valuetext','高')
  const nearStop=box.x+14+(box.width-28)*.47
  await page.mouse.move(nearStop,y)
  await expect.poll(center).toBeGreaterThan(nearStop+2)
  await expect.poll(async()=>Math.abs(await center()-(box.x+box.width/2))).toBeLessThan(3)
  await page.mouse.up()
  await expect.poll(center).toBeCloseTo(box.x+box.width/2,0)
  expect(await thumb.evaluate(node=>parseFloat(getComputedStyle(node).transitionDuration))).toBeCloseTo(.2)
  const filled=(await fill.boundingBox())!
  expect(filled.x+filled.width).toBeCloseTo(await center(),0)
  await slider.evaluate(node=>(node as HTMLInputElement).blur())
  await page.locator('.session-model-popover').screenshot({path:'test-results/model-rounded-detent.png'})
  await slider.focus();await page.keyboard.press('End')
  expect(await thumb.evaluate(node=>node.getAnimations().some(animation=>animation.playState==='running'))).toBe(true)
  await expect.poll(center).toBeCloseTo(box.x+box.width-14,0)
  // Capture releases outside the track and still selects a valid endpoint.
  await page.mouse.move(box.x+box.width-14,y);await page.mouse.down();await page.mouse.move(box.x-40,y);await page.mouse.up()
  await expect(slider).toHaveAttribute('aria-valuetext','最低')
  await expect.poll(center).toBeCloseTo(box.x+14,0)
  await page.emulateMedia({reducedMotion:'reduce'})
  await fast.click()
  await expect(flow).toHaveCSS('opacity','0')
  await expect(particle).toHaveCSS('animation-name','none')
  expect(await thumb.evaluate(node=>parseFloat(getComputedStyle(node).transitionDuration))).toBeLessThan(.001)
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

test('workspace setup disappears during first send, stays hidden after work and returns on a new chat', async ({page},testInfo) => {
  // Keep the normal page/API flow, but use an isolated successful session lifecycle.
  await page.route('**/src/lib/workspace.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const resolveSendWorkspace=async cwd=>cwd;`}))
  await page.route('**/src/lib/api.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    const tasks=[],sessions=[];let attempts=0;
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1422',token:'test'});
    export const api=async(path,method,body)=>{
      if(path==='/api/projects')return [];
      if(path==='/api/sessions'){
        await new Promise(resolve=>setTimeout(resolve,250));
        if(++attempts===1)throw Error('first send failed');
        const task={id:'created',crew_id:'crew',title:body.title,assigned_member:'member',assigned_device:'local',dependencies:[],status:'running',input:body.text,created_at:Date.now()/1000,started_at:Date.now()/1000};tasks.push(task);
        sessions.push({task_id:'created',ax_session_id:'created',member_id:'member',device_id:'local'});return task;
      }
      if(path.endsWith('/cancel')){tasks[0].status='cancelled';tasks[0].finished_at=2;return {};}
      return {};
    };
    export const endpoints={health:async()=>({status:'ok'}),crews:async()=>[{id:'crew'}],devices:async()=>[{id:'local',name:'本机',status:'online'}],tasks:async()=>tasks,sessions:async()=>sessions,permissions:async()=>[],members:async()=>[{id:'member',cwd:'C:/workspace',device_id:'local'}],events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),automations:async()=>[],automationRuns:async()=>[],localAx:async()=>({projects:[]}),history:async()=>({task_id:'created',updates:[{update:{sessionUpdate:'user_message_chunk',messageId:'user',content:{text:tasks[0]?.input}}},{update:{sessionUpdate:'agent_message_chunk',messageId:'answer',content:{text:'正在处理你的请求'}}}]})};
  `}))
  await page.setViewportSize({width:1440,height:900});await page.goto('/#/sessions')
  const strip=page.locator('.session-composer-tabs'),input=page.getByRole('textbox',{name:'发送消息'}),send=page.locator('.session-chat-panel .session-send-button')
  await expect(strip).toBeVisible()
  const bottomGap=async()=>page.locator('.session-composer').evaluate(node=>node.closest('.session-chat-panel')!.getBoundingClientRect().bottom-node.getBoundingClientRect().bottom)
  expect(await bottomGap()).toBeGreaterThanOrEqual(20)
  await page.screenshot({path:testInfo.outputPath('composer-before-work.png')})
  await input.fill('开始工作');await send.click();await expect(strip).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('first send failed');await expect(strip).toBeVisible();await expect(input).toHaveValue('开始工作')
  await send.click();await expect(page).toHaveURL(/sessions\/created/);await expect(strip).toHaveCount(0)
  await page.locator('.session-process-summary').click()
  await expect(page.locator('.session-process')).toContainText('正在处理你的请求')
  await page.screenshot({path:testInfo.outputPath('composer-working.png')})
  await page.getByRole('button',{name:'停止',exact:true}).click();await expect(page.getByRole('button',{name:'发送消息',exact:true})).toBeVisible();await expect(strip).toHaveCount(0)
  await page.reload();await expect(strip).toHaveCount(0)
  await page.getByRole('button',{name:'新聊天',exact:true}).click();await expect(strip).toBeVisible()
})

test('AX settings omit the subagent toggle while retaining execution settings', async ({page}) => {
  await page.goto('/#/settings/ax')
  await expect(page.locator('.settings-workspace')).toBeVisible()
  await expect(page.locator('.execution-settings')).toBeVisible()
  await expect(page.getByRole('switch',{name:/Subagent|子智能体/i})).toHaveCount(0)
  await expect(page.locator('.settings-main')).not.toContainText('允许智能体按需委派独立任务')
})

test('small windows retain readable sizes and keep composer and popup inside viewport', async ({page}) => {
  await page.setViewportSize({width:1440,height:900});await page.goto('/#/sessions/first')
  const text=page.locator('.session-transcript-body').last(), font=await text.evaluate(node=>getComputedStyle(node).fontSize)
  for(const size of [{width:960,height:620},{width:760,height:620},{width:560,height:620},{width:640,height:480}]){
    await page.setViewportSize(size)
    await expect(text).toHaveCSS('font-size',font)
    await expect.poll(()=>page.locator('.session-composer').evaluate(node=>{const r=node.getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight&&r.width>200})).toBe(true)
    await expect.poll(()=>page.locator('.session-composer').evaluate(node=>node.closest('.session-chat-panel')!.getBoundingClientRect().bottom-node.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(20)
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
