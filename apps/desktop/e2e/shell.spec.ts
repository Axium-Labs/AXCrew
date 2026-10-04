import { expect, test } from '@playwright/test'

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>{if(!localStorage.getItem('ax-crew-language'))localStorage.setItem('ax-crew-language',JSON.stringify({state:{lang:'zh'},version:0}))})
  // Exercise the real UI and CSS with isolated API data, without changing the desktop database.
  await page.route(/\/src\/lib\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async()=>({});
    export const endpoints={health:async()=>({status:'ok'}),crews:async()=>[],devices:async()=>[],tasks:async()=>[],sessions:async()=>[],permissions:async()=>[],members:async()=>[],events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),history:async()=>({updates:[]}),automations:async()=>[],automationRuns:async()=>[],localAx:async()=>({available:true,home:'C:/Users/me/.ax',projects:[{id:'p1',root:'C:/workspace',sessions:[{id:'local-1',title:'本地上次会话',created_at:1,updated_at:2,messages:4,preview:'检查流水线',task_id:null}]}]}),localSession:async()=>({task_id:'local-1',ax_session_id:'local-1',updates:[]})};
  `}))
  await page.routeWebSocket('**/api/ws*',()=>{})
})

for(const width of [960,1440]){
  test(`collapse and restore panels at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900})
    await page.goto('/#/sessions')
    await expect(page.getByRole('textbox',{name:'发送消息'})).toBeVisible()
    await page.locator('.sidebar-collapse').click()
    await expect(page.locator('.sidebar')).toHaveClass(/is-compact/)
    await page.locator('.session-list-heading').getByRole('button',{name:'收起会话列表'}).click()
    await expect(page.locator('.session-list-panel')).toHaveClass(/is-closed/)
    await expect(page.locator('.session-list-panel')).toHaveCSS('width','64px')
    await expect(page.locator('.session-list-panel')).toHaveCSS('background-color','rgba(0, 0, 0, 0)')
    await expect(page.locator('.session-list-panel')).toHaveCSS('border-top-color','rgba(0, 0, 0, 0)')
    await expect(page.locator('.session-list-rail')).toBeVisible()
    await expect(page.locator('.session-list-rail .session-rail-button')).toHaveCount(1)
    await expect(page.locator('.session-rail-brand')).toHaveCount(0)
    await expect(page.locator('.session-list-heading')).toBeHidden()
    await page.getByRole('button',{name:'打开右侧面板',exact:true}).click()
    await expect(page.getByRole('complementary',{name:'会话侧栏'})).toBeVisible()
    const [rightBox,toggleBox]=await Promise.all([
      page.locator('.session-right-panel').boundingBox(),
      page.locator('.session-right-toggle').boundingBox(),
    ])
    expect((rightBox!.x+rightBox!.width)-(toggleBox!.x+toggleBox!.width)).toBeLessThan(16)
    await expect(page.locator('.session-right-toggle')).toHaveCSS('border-radius','12px')
    await expect.poll(async()=>{
      const chat=await page.locator('.session-chat-panel').boundingBox()
      const right=await page.locator('.session-right-panel').boundingBox()
      return right!.x-(chat!.x+chat!.width)
    }).toBeGreaterThanOrEqual(8)
    await page.screenshot({path:`test-results/right-open-${width}.png`})
    await page.getByRole('button',{name:'关闭右侧面板'}).click()
    await expect(page.locator('.session-right-panel')).toHaveCSS('width','48px')
    await expect(page.locator('.session-right-panel')).toHaveCSS('background-color','rgba(0, 0, 0, 0)')
    await expect(page.locator('.session-right-tabs')).toHaveCSS('border-bottom-width','0px')
    await page.screenshot({path:`test-results/panels-collapsed-${width}.png`})
    await page.getByRole('button',{name:'展开会话列表'}).click()
    await expect(page.locator('.session-list-panel')).not.toHaveClass(/is-closed/)
    await page.locator('.brand-mark').click()
    await expect(page.locator('.sidebar')).not.toHaveClass(/is-compact/)
    await page.getByRole('button',{name:'打开右侧面板',exact:true}).click()
    await page.keyboard.press('Escape')
  console.log('DBG url',page.url(),JSON.stringify(await page.locator('.sidebar-utilities .nav-item').evaluateAll(nodes=>nodes.map(n=>[n.textContent,n.className]))))
    await expect(page.locator('.session-right-panel')).toHaveClass(/is-closed/)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    await expect(page.locator('.sidebar')).toHaveCSS('width',width<1200?'200px':'240px')
    await expect(page.locator('.session-list-panel')).toHaveCSS('width',/\d+px/)
    const sidebar=await page.locator('.sidebar').boundingBox()
    const list=await page.locator('.session-list-panel').boundingBox()
    expect(list!.x-(sidebar!.x+sidebar!.width)).toBeGreaterThanOrEqual(8)
    await expect(page.locator('.sidebar')).toHaveCSS('border-top-left-radius','20px')
    await expect(page.locator('.session-list-panel')).toHaveCSS('border-top-left-radius','20px')
    const transition=await page.locator('.session-list-panel').evaluate(node=>getComputedStyle(node).transitionDuration)
    expect(parseFloat(transition)).toBeGreaterThan(0)
    expect(await page.getByRole('button',{name:'收起会话列表'}).count()).toBe(1)
    await page.screenshot({path:`test-results/session-${width}.png`})
  })
}

test('the whole brand row toggles the sidebar and no separator rules are drawn',async({page})=>{
  await page.goto('/#/sessions')
  const brand=page.locator('.sidebar .brand')
  const clickRowEdge=async()=>{const box=(await brand.boundingBox())!;await page.mouse.click(box.x+4,box.y+box.height/2)}
  await clickRowEdge()
  await expect(page.locator('.sidebar')).toHaveClass(/is-compact/)
  await clickRowEdge()
  await expect(page.locator('.sidebar')).not.toHaveClass(/is-compact/)
  const edges=await page.evaluate(()=>{
    const top=(selector:string)=>parseFloat(getComputedStyle(document.querySelector(selector)!).borderTopWidth)
    const bottom=(selector:string)=>parseFloat(getComputedStyle(document.querySelector(selector)!).borderBottomWidth)
    return {titlebar:bottom('.shell-titlebar'),brand:bottom('.sidebar .brand'),utilities:top('.sidebar-utilities'),heading:bottom('.session-list-heading')}
  })
  expect(edges).toEqual({titlebar:0,brand:0,utilities:0,heading:0})
})

test('sidebar groups and terminal docking follow the shell layout',async({page})=>{
  await page.setViewportSize({width:1280,height:800})
  await page.goto('/#/sessions')
  await expect(page.locator('.sidebar-primary .nav-item')).toHaveText(['会话','计划','产物'])
  await expect(page.locator('.sidebar-utilities .nav-item')).toHaveText(['终端','连接手机','代理能力','设置'])
  await page.getByRole('button',{name:'终端',exact:true}).click()
  await expect(page.locator('.terminal-dock')).toHaveClass(/is-bottom.*is-open/)
  await expect(page.locator('.terminal-dock')).toHaveCSS('height','300px')
  await expect(page.locator('.terminal-dock')).toHaveCSS('border-top-width','0px')
  const grip=page.getByRole('separator',{name:'调整终端面板大小'})
  await expect(grip).toHaveCSS('height','6px')
  await expect(grip).toHaveCSS('background-color','rgba(0, 0, 0, 0)')
  await grip.hover()
  expect(await grip.evaluate(node=>getComputedStyle(node,'::before').content)).toBe('""')
  await expect(page.getByRole('tab',{name:'终端',exact:true})).toBeVisible()
  await page.screenshot({path:'test-results/terminal-bottom.png'})
  await page.getByRole('button',{name:'新建终端'}).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.getByRole('button',{name:'终端布局'}).click()
  await page.getByRole('menuitem',{name:'移到右侧'}).click()
  await expect(page.locator('.terminal-dock')).toHaveClass(/is-right.*is-open/)
  await expect(page.locator('.terminal-dock')).toHaveCSS('width','420px')
  await page.getByRole('button',{name:'隐藏终端'}).click()
  await expect(page.locator('.terminal-dock')).toHaveCSS('width','0px')
  await page.getByRole('button',{name:'终端',exact:true}).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await page.reload()
  await page.getByRole('button',{name:'终端',exact:true}).click()
  await expect(page.locator('.terminal-dock')).toHaveClass(/is-right.*is-open/)
})

test('light terminal has no black viewport gutter',async({page})=>{
  await page.addInitScript(()=>{
    const native=window as unknown as Record<string,unknown>
    native.isTauri=true
    let id=0
    native.__TAURI_INTERNALS__={
      metadata:{currentWindow:{label:'main'}},
      transformCallback:()=>++id,
      unregisterCallback:()=>{},
      invoke:async(command:string)=>command==='plugin:event|listen'?++id:command.includes('is_maximized')?false:null,
    }
    native.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}}
  })
  await page.goto('/#/settings')
  await page.getByRole('button',{name:'显示',exact:true}).click()
  await page.getByLabel('主题').click()
  await page.getByRole('menuitem',{name:'浅色'}).click()
  await expect(page.locator('.settings-page-top h1')).toHaveCSS('color','rgb(56, 54, 67)')
  await page.getByRole('button',{name:'终端',exact:true}).click()
  const screen=page.locator('.terminal-screen')
  await expect(screen.locator('.xterm-viewport')).toHaveCSS('background-color','rgb(255, 255, 255)')
  await expect(page.locator('.terminal-dock')).toHaveCSS('border-top-width','0px')
  await page.screenshot({path:'test-results/terminal-light.png'})
})

test('focus mode slides the titlebar away and reveals it at the top edge',async({page})=>{
  await page.setViewportSize({width:1280,height:760})
  await page.goto('/#/sessions')
  const bar=page.locator('.shell-titlebar')
  const workspace=page.locator('.workspace')
  await page.mouse.move(640,400)
  await page.getByRole('button',{name:'进入专注模式'}).click()
  await expect(bar).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, -42)')
  await expect(workspace).toHaveCSS('height','760px')
  await page.mouse.move(640,4)
  await expect(bar).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, 0)')
  await page.mouse.move(640,300)
  await expect(bar).toHaveCSS('transform','matrix(1, 0, 0, 1, 0, -42)')
  await page.mouse.move(640,4)
  await page.getByRole('button',{name:'退出专注模式'}).click()
  await expect(bar).toHaveCSS('transform','none')
  await expect(workspace).toHaveCSS('height','718px')
})

test('menus, keyboard shortcuts and saved panel choices work after reload',async({page})=>{
  await page.goto('/#/sessions')
  await page.getByRole('button',{name:'运行命令',exact:true}).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button',{name:'会话菜单'}).click()
  await page.getByRole('menuitem',{name:'会话详情'}).click()
  await expect(page.locator('.session-right-details')).toBeVisible()
  await page.keyboard.press('Control+Shift+B')
  await page.keyboard.press('Control+b')
  await page.reload()
  await expect(page.locator('.sidebar')).toHaveClass(/is-compact/)
  await expect(page.locator('.session-list-panel')).toHaveClass(/is-closed/)
  await expect(page.locator('.session-right-details')).toBeVisible()
  await page.getByRole('button',{name:'关闭右侧面板'}).click()
  await page.getByRole('button',{name:'添加上下文'}).click()
  await page.getByRole('menuitem',{name:'引用工作区文件'}).click()
  await expect(page.locator('.session-files-view')).toBeVisible()
  await page.getByRole('link',{name:'设置',exact:true}).click()
  await page.getByRole('button',{name:'显示',exact:true}).click()
  await page.getByLabel('主题').click()
  await page.getByRole('menuitem',{name:'浅色'}).click()
  await page.getByRole('link',{name:'会话',exact:true}).click()
  expect(await page.locator('.shell-titlebar').evaluate(node=>getComputedStyle(node).backgroundColor)).toBe(await page.locator('.session-chat-panel').evaluate(node=>getComputedStyle(node).backgroundColor))
})

test('composer shows one quiet focus border in both themes',async({page},testInfo)=>{
  await page.setViewportSize({width:1440,height:760})
  await page.goto('/#/sessions')
  const editor=page.locator('.session-composer')
  const input=page.getByRole('textbox',{name:'发送消息'})
  const notice=page.locator('.session-composer-wrap .session-inline-error').first()
  await expect(notice).toBeVisible()
  const [noticeBox,composerBox]=await Promise.all([notice.boundingBox(),editor.boundingBox()])
  expect(Math.abs(noticeBox!.x-composerBox!.x)).toBeLessThan(1)
  const idleShadow=await editor.evaluate(node=>getComputedStyle(node).boxShadow)
  await input.fill('正在输入')
  await expect(input).toHaveCSS('outline-style','none')
  await expect(input).toHaveCSS('resize','none')
  await expect(editor).toHaveCSS('box-shadow',idleShadow)
  await expect(editor).toHaveCSS('border-top-width','1px')
  await page.screenshot({path:`test-results/composer-focus-${testInfo.project.name}.png`})
  await page.getByRole('link',{name:'设置',exact:true}).click()
  await page.getByRole('button',{name:'显示',exact:true}).click()
  await page.getByLabel('主题').click()
  await page.getByRole('menuitem',{name:'浅色'}).click()
  await page.getByRole('link',{name:'会话',exact:true}).click()
  await input.fill('继续输入')
  await expect(input).toHaveCSS('outline-style','none')
  await expect(editor).toHaveCSS('border-top-width','1px')
})

test('the session panel mirrors the reference list and reads local AX in place',async({page})=>{
  await page.setViewportSize({width:1440,height:900})
  await page.goto('/#/sessions')
  await expect(page.locator('.session-new-chat')).toHaveText('新聊天')
  await expect(page.locator('.session-section-head')).toHaveText(['项目','最近','远程项目'])
  await expect(page.locator('.session-new-button')).toHaveCount(0)
  await expect(page.locator('.session-older-button')).toHaveCount(0)
  // 项目 lists directories; expanding one reveals the sessions that ran inside it.
  const project=page.locator('.session-project-pick').first()
  await expect(project).toHaveText('workspace')
  await expect(project).toHaveAttribute('title','C:/workspace')
  await expect(page.locator('.session-project-session')).toHaveCount(0)
  await project.click()
  const session=page.locator('.session-project-session').first()
  await expect(session).toContainText('本地上次会话')
  await session.click()
  await expect(page).toHaveURL(/#\/sessions\?local=local-1/)
  await expect(page.locator('.session-local-bar')).toBeVisible()
  await expect(page.getByRole('textbox',{name:'发送消息'})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'在 Crew 中继续'})).toBeVisible()
  await expect(page.locator('.session-transcript-meta')).toContainText('本地 AX')
  await page.screenshot({path:'test-results/local-ax-session.png'})
  // Sections collapse from their headers, and a project starts a session in its own directory.
  await expect(page.getByRole('button',{name:'在 workspace 中新建会话'})).toBeVisible()
  await page.getByRole('button',{name:'项目',exact:true}).click()
  await expect(page.locator('.session-project-session')).toHaveCount(0)
  await page.getByRole('button',{name:'项目',exact:true}).click()
  await expect(page.locator('.session-project-session')).toHaveCount(1)
  await page.getByRole('button',{name:'远程项目',exact:true}).click()
  await expect(page.locator('.session-section.is-remote .session-local-note')).toContainText('还没有配对的远程 AX 设备')
  await page.getByRole('button',{name:'新聊天',exact:true}).click()
  await expect(page).toHaveURL(/#\/sessions$/)
  await expect(page.getByRole('textbox',{name:'发送消息'})).toBeVisible()
})

test('remote AX projects stay separate from the local ones',async({page})=>{
  await page.route(/\/src\/lib\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async()=>({});
    const task={id:'t-remote',crew_id:'crew',parent_id:null,title:'远程会话',description:'',assigned_member:'member',assigned_device:'phone',dependencies:[],priority:0,status:'completed',input:'hi',output:null,retry_count:0,created_at:5,started_at:5,finished_at:6};
    export const endpoints={health:async()=>({status:'ok'}),crews:async()=>[{id:'crew',name:'团队',created_at:1}],devices:async()=>[{id:'phone',name:'Pixel 8',hostname:'pixel',platform:'android',arch:'arm64',ax_version:'0.1.0',protocol_version:1,capabilities:{},status:'online',last_seen:9,public_key:null}],tasks:async()=>[task],sessions:async()=>[{task_id:'t-remote',member_id:'member',device_id:'phone',ax_session_id:'ax-remote-1'}],permissions:async()=>[],members:async(id)=>id==='crew'?[{id:'member',crew_id:'crew',name:'测试成员',role:'远程',device_id:'phone',cwd:'/srv/work',permission_profile:'ask',skills:[],mcp_servers:[],max_concurrency:1}]:[],events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),history:async()=>({updates:[]}),automations:async()=>[],automationRuns:async()=>[],localAx:async()=>({available:true,home:'C:/Users/me/.ax',projects:[{id:'p1',root:'C:/workspace',sessions:[{id:'local-1',title:'本地上次会话',created_at:1,updated_at:2,messages:4,preview:'检查流水线',task_id:null}]}]}),localSession:async()=>({task_id:'local-1',ax_session_id:'local-1',updates:[]})};
  `}))
  await page.setViewportSize({width:1440,height:900})
  await page.goto('/#/sessions')
  await expect(page.locator('.session-project-pick').first()).toHaveText('workspace')
  await page.getByRole('button',{name:'远程项目',exact:true}).click()
  const remote=page.locator('.session-section.is-remote')
  await expect(remote.locator('.session-remote-device')).toContainText('Pixel 8')
  await expect(remote.locator('.session-remote-device')).toContainText('在线')
  const remoteRow=remote.locator('.session-local-row').first()
  await expect(remoteRow).toContainText('远程 AX')
  await expect(remoteRow).toContainText('远程会话')
  await remoteRow.click()
  await expect(page).toHaveURL(/\/sessions\/t-remote$/)
  await page.screenshot({path:'test-results/session-remote-projects.png'})
})

test('controls stay rounded and every state change eases',async({page})=>{
  await page.setViewportSize({width:1440,height:900})
  await page.goto('/#/schedule')
  const radius=async(selector:string)=>page.locator(selector).first().evaluate(node=>parseFloat(getComputedStyle(node).borderTopLeftRadius))
  const duration=async(selector:string)=>page.locator(selector).first().evaluate(node=>parseFloat(getComputedStyle(node).transitionDuration))
  await expect(page.getByRole('button',{name:'添加任务'})).toHaveCount(0)
  expect(await radius('.schedule-empty button')).toBeGreaterThanOrEqual(9)
  expect(await duration('.schedule-empty button')).toBeGreaterThan(0)
  expect(await radius('.schedule-template')).toBeGreaterThanOrEqual(14)
  expect(await duration('.schedule-template')).toBeGreaterThan(0)
  expect(await radius('.schedule-views')).toBeGreaterThanOrEqual(10)
  expect(await duration('.schedule-views button')).toBeGreaterThan(0)
  // The card lifts on hover rather than snapping.
  const card=page.locator('.schedule-template').first()
  await expect.poll(async()=>card.evaluate(node=>getComputedStyle(node).transform)).toBe('none')
  await card.hover()
  await expect.poll(async()=>card.evaluate(node=>getComputedStyle(node).transform)).not.toBe('none')
  await page.locator('.schedule-empty button').first().click()
  const dialog=page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect(await radius('.ax-dialog')).toBeGreaterThanOrEqual(14)
  const animation=await page.locator('.ax-dialog').evaluate(node=>getComputedStyle(node).animationName)
  expect(animation).toContain('ax-dialog-in')
  await expect(page.locator('.ax-overlay')).toHaveCount(1)
  expect(await radius('.ax-field')).toBeGreaterThanOrEqual(9)
  expect(await duration('.ax-field')).toBeGreaterThan(0)
  // Tailwind v4 positions this dialog with `translate`; the entry animation must not fight it.
  const box=await dialog.boundingBox()
  expect(Math.abs(box!.x+box!.width/2-720)).toBeLessThan(4)
  expect(Math.abs(box!.y+box!.height/2-450)).toBeLessThan(6)
  await expect.poll(async()=>page.locator('.ax-dialog').evaluate(node=>getComputedStyle(node).opacity)).toBe('1')
  expect(await page.locator('.ax-field').first().evaluate(node=>getComputedStyle(node).borderTopLeftRadius)).toBe('11px')
  await page.screenshot({path:'test-results/schedule-motion.png'})
  // Magnified corner crop so the rounded shell is reviewable in isolation.
  await page.screenshot({path:'test-results/schedule-corner.png',clip:{x:box!.x-16,y:box!.y-16,width:150,height:120}})
})

test('the list search highlights the whole rounded field, not the bare input',async({page})=>{
  await page.goto('/#/sessions')
  const field=page.locator('.session-list-search')
  const input=page.getByRole('textbox',{name:'搜索会话'})
  const idle=await field.evaluate(node=>getComputedStyle(node).borderTopColor)
  await input.click()
  await expect(input).toHaveCSS('outline-style','none')
  expect(await field.evaluate(node=>getComputedStyle(node).borderTopColor)).not.toBe(idle)
  await input.fill('会话')
  await expect(input).toHaveCSS('outline-style','none')
  await page.screenshot({path:'test-results/session-search-focus.png'})
})

test('schedule page mirrors the reference plans, calendar and dialog',async({page})=>{
  await page.setViewportSize({width:1440,height:900})
  await page.goto('/#/schedule')
  await expect(page.locator('.schedule-views [role=tab]')).toHaveText(['列表','日历','执行记录'])
  await expect(page.getByRole('heading',{name:'尚无定时任务'})).toBeVisible()
  await expect(page.getByRole('button',{name:'创建你的第一个任务'})).toBeVisible()
  await expect(page.locator('.schedule-template')).toHaveCount(4)
  await expect(page.locator('.schedule-template')).toHaveText([/每晚构建监控/,/错误摘要/,/站会简报/,/部署验证/])
  await page.screenshot({path:'test-results/schedule-empty.png'})
  await page.locator('.schedule-template').first().click()
  const dialog=page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('新建定时任务')).toBeVisible()
  for(const label of ['名称','消息','计划','代理','模型','审批','聊天文件夹'])await expect(dialog.getByText(label,{exact:true})).toBeVisible()
  for(const hint of ['此任务的简短标签','此任务触发时发送给代理的提示词或任务','此任务的运行频率','由哪个代理处理此任务','执行期间工具调用的审批方式','精简上下文'])await expect(dialog.getByText(hint,{exact:false}).first()).toBeVisible()
  for(const label of ['静默模式','严格计划','在聊天中隐藏','精简上下文'])await expect(dialog.getByRole('switch',{name:label})).toBeVisible()
  await expect(dialog.getByText('频道 ID')).toHaveCount(0)
  await expect(dialog.getByPlaceholder('例如：每晚构建监控')).toHaveValue('每晚构建监控')
  await expect(dialog.locator('input[type=time]')).toHaveValue('02:00')
  await page.screenshot({path:'test-results/schedule-dialog.png'})
  await dialog.getByRole('button',{name:'取消'}).click()
  await page.getByRole('tab',{name:'日历'}).click()
  await expect(page.locator('.schedule-calendar-day')).toHaveCount(7)
  await expect(page.locator('.schedule-calendar-zone')).toContainText('UTC')
  await page.screenshot({path:'test-results/schedule-calendar.png'})
  await page.getByRole('tab',{name:'执行记录'}).click()
  await expect(page.getByText(/还没有执行记录/)).toBeVisible()
})

test('schedule list shows the automations table, calendar dots and run history',async({page})=>{
  await page.route(/\/src\/lib\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async()=>({});
    const automation={id:'a1',name:'错误摘要',message:'把新的生产错误聚类，并给出每一类的可疑原因。',schedule_kind:'interval',interval_minutes:360,daily_time:'09:00',weekdays:'',utc_offset_minutes:480,member_id:null,model:null,approval:'default',silent:false,strict_schedule:false,hide_from_chat:false,lean_context:false,folder:null,enabled:true,created_at:1,last_run_at:null,next_run_at:0,run_count:0,last_status:null};
    export const endpoints={health:async()=>({status:'ok'}),crews:async()=>[],devices:async()=>[],tasks:async()=>[],sessions:async()=>[],permissions:async()=>[],members:async()=>[],events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),history:async()=>({updates:[]}),automations:async()=>[automation],automationRuns:async()=>[{id:'r1',automation_id:'a1',task_id:null,status:'completed',started_at:1,finished_at:61,detail:null,name:'错误摘要'}],localAx:async()=>({available:true,home:'C:/Users/me/.ax',projects:[]}),localSession:async()=>({task_id:'',ax_session_id:'x',updates:[]})};
  `}))
  await page.setViewportSize({width:1440,height:900})
  await page.goto('/#/schedule')
  await expect(page.locator('.schedule-table-head span')).toHaveText(['名称','类型','计划','消息','状态','上次运行','下次运行','操作'])
  const row=page.locator('.schedule-row').first()
  await expect(row).toContainText('错误摘要')
  await expect(row).toContainText('每 6 小时')
  await expect(row).toContainText('就绪')
  await expect(row.getByRole('button',{name:'运行'})).toBeVisible()
  await row.getByRole('button',{name:/显示消息/}).click()
  await expect(row).toContainText('把新的生产错误聚类')
  await expect(row.getByRole('button',{name:'错误摘要 的更多操作'})).toBeVisible()
  await page.screenshot({path:'test-results/schedule-list.png'})
  await page.getByRole('tab',{name:'日历'}).click()
  await expect(page.locator('.schedule-calendar-dot')).toHaveCount(28)
  await page.getByRole('tab',{name:'执行记录'}).click()
  await expect(page.locator('.schedule-run')).toHaveCount(1)
  await expect(page.locator('.schedule-run')).toContainText('用时 1 分钟')
})

test('utility navigation highlights only the entry you are actually on',async({page})=>{
  await page.goto('/#/sessions')
  const entry=(label:string)=>page.locator('.sidebar-utilities .nav-item').filter({hasText:label})
  await expect(entry('连接手机')).not.toHaveClass(/active/)
  await page.getByRole('link',{name:'连接手机',exact:true}).click()
  await expect(page).toHaveURL(/\/connect$/)
  await expect(entry('连接手机')).toHaveClass(/active/)
  await expect(entry('代理能力')).not.toHaveClass(/active/)
  await page.keyboard.press('Escape')
  await page.getByRole('link',{name:'代理能力',exact:true}).click()
  await expect(entry('代理能力')).toHaveClass(/active/)
  await expect(entry('连接手机')).not.toHaveClass(/active/)
  await page.getByRole('link',{name:'计划',exact:true}).click()
  await expect(entry('代理能力')).not.toHaveClass(/active/)
  await expect(entry('连接手机')).not.toHaveClass(/active/)
  await page.screenshot({path:'test-results/sidebar-active.png'})
})

test('artifacts page groups output into a gallery and a table',async({page})=>{
  await page.route(/\/src\/lib\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async()=>({});
    const base={crew_id:'crew',parent_id:null,description:'',assigned_member:'member',assigned_device:'local',dependencies:[],priority:0,status:'completed',input:'x',retry_count:0,started_at:10};
    const tasks=[{...base,id:'a-code',title:'重构脚本',output:{text:'\\u0060\\u0060\\u0060python\\nprint(1)\\n\\u0060\\u0060\\u0060'},created_at:10,finished_at:11},{...base,id:'a-doc',title:'周报',output:{text:'# 本周进展\\n- 完成 A'},created_at:11,finished_at:12}];
    export const endpoints={health:async()=>({status:'ok'}),crews:async()=>[{id:'crew',name:'本地 AX',created_at:1}],devices:async()=>[],tasks:async()=>tasks,sessions:async()=>[],permissions:async()=>[],members:async()=>[],events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),history:async()=>({updates:[]}),automations:async()=>[],automationRuns:async()=>[],localAx:async()=>({available:true,home:'C:/Users/me/.ax',projects:[]}),localSession:async()=>({task_id:'',ax_session_id:'x',updates:[]})};
  `}))
  await page.setViewportSize({width:1440,height:900})
  await page.goto('/#/artifacts')
  await expect(page.locator('.artifacts-head h1')).toHaveText('产物')
  await expect(page.locator('.artifacts-toolbar h2')).toHaveText('你的产物')
  await expect(page.locator('.artifacts-views button')).toHaveText(['画廊','表格'])
  // The two chip groups from the reference are deliberately absent.
  await expect(page.getByText('产物部署')).toHaveCount(0)
  await expect(page.getByText('已加星')).toHaveCount(0)
  await expect(page.locator('.artifact-card')).toHaveCount(2)
  await expect(page.locator('.artifact-card').first()).toContainText('周报')
  await expect(page.locator('.artifact-card').first()).toContainText('本地 AX')
  await expect(page.locator('.artifact-card').nth(1)).toContainText('代码')
  await page.screenshot({path:'test-results/artifacts-gallery.png'})
  await page.getByLabel('筛选产物').fill('脚本')
  await expect(page.locator('.artifact-card')).toHaveCount(1)
  await page.getByLabel('筛选产物').fill('')
  await page.getByRole('tab',{name:'表格'}).click()
  await expect(page.locator('.artifacts-row')).toHaveCount(3)
  await expect(page.locator('.artifacts-row').first()).toHaveText(/名称.*类型.*标签.*更新时间.*操作/)
  await page.screenshot({path:'test-results/artifacts-table.png'})
  // Folders group the library without touching the underlying tasks.
  await page.getByRole('button',{name:'新建文件夹'}).click()
  const dialog=page.getByRole('dialog')
  await dialog.locator('input').fill('周报')
  await dialog.getByRole('button',{name:'创建'}).click()
  await page.getByRole('button',{name:'周报 的更多操作'}).click()
  await page.getByRole('menuitem',{name:'归档到「周报」'}).click()
  await expect(page.locator('.artifacts-folder')).toContainText('周报')
  await page.getByRole('tab',{name:'画廊'}).click()
  await expect(page.locator('.artifact-card')).toHaveCount(2)
})

test('artifacts shows the empty library hint',async({page})=>{
  await page.goto('/#/artifacts')
  await expect(page.locator('.artifacts-empty')).toContainText('暂无产物')
  await expect(page.locator('.artifacts-empty')).toContainText('完成一次会话或任务后')
})

test('settings keeps the reference two-column layout and functional categories',async({page})=>{
  await page.setViewportSize({width:1440,height:900})
  await page.goto('/#/settings')
  await expect(page.locator('.settings-sidebar')).toBeVisible()
  await expect(page.locator('.settings-main')).toBeVisible()
  await expect(page.getByRole('button',{name:'本地 AX'})).toBeVisible()
  await expect(page.getByRole('button',{name:'模型与登录'})).toBeVisible()
  await expect(page.getByRole('complementary',{name:'设置分类'}).getByRole('button',{name:'导入 / 导出'})).toBeVisible()
  await page.screenshot({path:'test-results/settings-overview.png'})
  await page.getByRole('button',{name:'显示',exact:true}).click()
  await page.getByLabel('主题').click()
  await page.getByRole('menuitem',{name:'浅色'}).click()
  await expect(page.locator('.settings-workspace')).toHaveCSS('background-color','rgb(255, 255, 255)')
  await page.screenshot({path:'test-results/settings-light.png'})
})

test('goal loop dialog mirrors the goal and PR-monitor fields',async({page})=>{
  await page.setViewportSize({width:1280,height:800})
  await page.goto('/#/sessions')
  await page.getByRole('button',{name:'设定目标'}).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('此目标循环会在每个周期调用代理')).toBeVisible()
  await expect(page.getByLabel('目标描述')).toHaveValue(/north_star\.md/)
  await expect(page.getByLabel('推动间隔秒数')).toHaveValue('60')
  await expect(page.getByLabel('最大轮次（0 = ∞）')).toHaveValue('0')
  await page.getByRole('button',{name:'改为监控拉取请求'}).click()
  await expect(page.getByLabel('拉取请求 URL')).toHaveAttribute('placeholder',/github\.com/)
  await expect(page.getByLabel('探测间隔（秒）')).toHaveValue('300')
  await expect(page.getByLabel('最大运行时间（秒）')).toHaveValue('14400')
  await expect(page.getByLabel('最大代理轮次')).toHaveValue('8')
  await expect(page.getByLabel('最大令牌数')).toHaveValue('250000')
  await expect(page.getByLabel('最大提供商错误数')).toHaveValue('3')
  await page.getByRole('button',{name:'返回目标循环'}).first().click()
  await expect(page.getByLabel('目标描述')).toBeVisible()
})


test('settings separates connections and system and switches both languages',async({page})=>{
  await page.goto('/#/settings/connections')
  await expect(page.locator('.settings-page-top h1')).toHaveText('连接')
  await expect(page.getByText('公共网关 URL')).toBeVisible()
  await expect(page.getByText('桌面行为')).toHaveCount(0)
  await page.getByRole('button',{name:'系统',exact:true}).click()
  await expect(page).toHaveURL(/settings\/system/)
  await expect(page.getByText('桌面行为')).toBeVisible()
  await expect(page.getByText('公共网关 URL')).toHaveCount(0)
  await page.getByRole('button',{name:'显示',exact:true}).click()
  await page.getByLabel('语言').click()
  await page.getByRole('menuitem',{name:'English',exact:true}).click()
  await page.getByRole('button',{name:'System',exact:true}).click()
  await expect(page.locator('.settings-page-top h1')).toHaveText('System')
  await expect(page.getByText('Desktop behavior')).toBeVisible()
  await page.screenshot({path:'test-results/settings-system-en.png'})
})

test('conversation inference button toggles Fast and pickers highlight only on interaction',async({page})=>{
  await page.route(/\/src\/lib\/ax\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
    export const axAvailable=true; export const workspaceFileExists=async()=>false;
    let mode='standard';
    const state=()=>({active_path:'ax.exe',providers:[{id:'deepseek',name:'DeepSeek',auth_kind:'api_key',configured:true,supported:true,models:[{provider:'deepseek',id:'deepseek-chat',display_name:'DeepSeek Chat'}]}],selected_model:{provider:'deepseek',id:'deepseek-chat'},inference_mode:mode});
    export const axLocalState=async()=>state();
    export const axSelectInferenceMode=async(value)=>{mode=value;window.__inferenceMode=value;return mode};
    export const axSelectModel=async()=>state();
    export const axStoreApiKey=async()=>state(),axRefreshModels=async()=>state(),axRemoveCredential=async()=>state();
    export const axSelectSubagent=async()=>{},axSelectExecution=async()=>state();
    export function axTuiCommand(){return 'ax tui'}
    export const axScanCapabilitySources=async()=>[]; export const axExport=async()=>'',axImport=async()=>'',axImportCapability=async()=>'',axManageCapability=async()=>'ok',axCatalog=async()=>({skills:[],mcp_servers:[],tools:[],warnings:[]});
    export const axCheckUpdate=async()=>({action:'none'}),axApplyUpdate=axCheckUpdate;
  `}))
  await page.goto('/#/sessions')
  const fast=page.getByRole('button',{name:'更快',exact:true})
  await expect(fast).toHaveAttribute('aria-pressed','false')
  await fast.hover()
  await expect(page.getByRole('tooltip')).toHaveText('更快用量更多')
  await fast.click()
  await expect(fast).toHaveAttribute('aria-pressed','true')
  await expect.poll(()=>page.evaluate(()=>(window as any).__inferenceMode)).toBe('fast')
  await fast.click()
  await expect(fast).toHaveAttribute('aria-pressed','false')
  await expect.poll(()=>page.evaluate(()=>(window as any).__inferenceMode)).toBe('standard')
  for(const selector of ['.session-footer-thinking','.session-footer-auto']){
    const picker=page.locator(selector)
    await page.getByRole('textbox',{name:'发送消息'}).click()
    await page.mouse.move(0,0)
    await expect(picker).toHaveCSS('background-color','rgba(0, 0, 0, 0)')
    await picker.hover()
    expect(await picker.evaluate(node=>getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    await picker.click()
    await page.mouse.move(0,0)
    await expect(picker).toHaveAttribute('data-state','open')
    expect(await picker.evaluate(node=>getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    await page.keyboard.press('Escape')
  }
  await fast.hover()
  await page.screenshot({path:'test-results/session-fast-tooltip.png'})
})

test('terminal tabs reorder by pointer and scroll without replacing their IDs',async({page})=>{
  await page.setViewportSize({width:960,height:900})
  await page.goto('/#/sessions')
  await page.evaluate(async()=>{
    const {useTerminalDock}=await import('/src/store/terminal.ts')
    const state=useTerminalDock.getState()
    for(let i=0;i<8;i++)state.addTab('C:/workspace')
    state.setPosition('right')
  })
  await expect.poll(()=>page.locator('.terminal-dock').evaluate(node=>node.clientWidth)).toBeGreaterThan(300)
  const tabs=page.locator('.terminal-tab')
  await expect(tabs).toHaveCount(8)
  await expect(page.getByRole('tab',{name:'终端',exact:true})).toHaveCount(8)
  await expect(page.locator('.session-list-panel')).toHaveClass(/is-closed/)
  await expect.poll(()=>page.locator('.session-chat-panel').evaluate(node=>node.clientWidth)).toBeGreaterThan(250)
  const before=await tabs.evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.terminalId))
  const first=await tabs.nth(0).boundingBox(),second=await tabs.nth(1).boundingBox()
  await page.mouse.move(first!.x+first!.width/3,first!.y+first!.height/2)
  await page.mouse.down()
  await page.mouse.move(second!.x+second!.width/2,second!.y+second!.height/2,{steps:8})
  await page.mouse.up()
  await expect.poll(()=>tabs.nth(1).getAttribute('data-terminal-id')).toBe(before[0])
  const after=await tabs.evaluateAll(nodes=>nodes.map(node=>(node as HTMLElement).dataset.terminalId))
  expect([...after].sort()).toEqual([...before].sort())
  const strip=page.locator('.terminal-tabs')
  await expect.poll(()=>strip.evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(true)
  const pageScroll=await page.evaluate(()=>window.scrollY)
  await strip.hover();await page.mouse.wheel(0,160)
  await expect.poll(()=>strip.evaluate(node=>node.scrollLeft)).toBeGreaterThan(0)
  expect(await page.evaluate(()=>window.scrollY)).toBe(pageScroll)
  await page.screenshot({path:'test-results/terminal-reordered.png'})
})

for (const width of [960,1440]) {
  test(`usage settings remains responsive with navigation collapsed at ${width}`,async({page})=>{
    await page.route(/\/src\/lib\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
      export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
      export const endpoints={health:async()=>({status:'ok'}),settings:async()=>({default_cwd:'C:/workspace'}),tasks:async()=>[],sessions:async()=>[],devices:async()=>[],permissions:async()=>[],crews:async()=>[],members:async()=>[],localAx:async()=>({projects:[]})};
      export const api=async(path)=>{const days=path.includes('days=30')?30:7;return {start:20000,today:20000+days-1,totals:{input:1200,output:400,cached:300,messages:8,tools:3,skills:1,unreported:2},daily:[{day:20003,model:'gpt-6.1-sol',client:'AX Crew',counts:{input:1200,output:400,cached:300,messages:8,tools:3,skills:1,unreported:2}}],ranking:[{id:'one',title:'Test conversation',model:'gpt-6.1-sol',client:'AX Crew',counts:{input:1200,output:400,cached:300,messages:8,tools:3,skills:1,unreported:2}}],warnings:[]}};
    `}))
    await page.setViewportSize({width,height:900});await page.goto('/#/settings/usage')
    await expect(page.getByText('Test conversation')).toBeVisible()
    await page.locator('.sidebar-collapse').click()
    await expect(page.locator('.sidebar')).toHaveClass(/is-compact/)
    expect(await page.locator('.settings-main').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
    await expect(page.locator('.usage-chart')).toHaveCount(4)
    await page.getByRole('button',{name:'30 天',exact:true}).click()
    await expect(page.getByRole('button',{name:'30 天',exact:true})).toHaveClass('is-active')
    await page.getByText('Test conversation').click()
    await expect(page.getByText('AX Crew · gpt-6.1-sol')).toBeVisible()
    await page.screenshot({path:`test-results/usage-settings-${width}.png`})
  })
}

test('adaptive composer grows, caps and shrinks with draft text',async({page})=>{
  await page.setViewportSize({width:1280,height:900})
  await page.goto('/#/sessions')
  const input=page.getByRole('textbox',{name:'发送消息',exact:true})
  const initial=(await input.boundingBox())!.height
  await input.fill('这是较长的输入，需要自动换行并增加输入框高度。'.repeat(35))
  await expect.poll(async()=>(await input.boundingBox())!.height).toBeGreaterThan(initial+50)
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(280)
  await page.screenshot({path:'test-results/adaptive-composer.png'})
  await input.fill('短消息')
  await expect.poll(async()=>(await input.boundingBox())!.height).toBe(initial)
})

for(const width of [960,1600]){
  test(`adaptive settings and discovered imports at ${width}px`,async({page})=>{
    await page.setViewportSize({width,height:900})
    await page.route(/\/src\/lib\/ax\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
      export const axAvailable=true;
      const state=()=>({providers:['WorkBuddy China','DeepSeek','OpenAI','OpenAI Codex'].map((name,index)=>({id:String(index),name,configured:true,supported:true,source:'AX',models:[],auth_kind:'api_key',model_source:'cache'})),home:'C:/Users/me/.ax',selected_model:null});
      export const axLocalState=async()=>state(),axStoreApiKey=async()=>state(),axRefreshModels=async()=>state(),axRemoveCredential=async()=>state(),axSelectModel=async()=>state(),axSelectInferenceMode=async()=> 'standard';
      export const axCatalog=async()=>({skills:[],mcp_servers:[],tools:[],warnings:[],cwd:'C:/workspace'});
      export const axSelectSubagent=async()=>{},axSelectExecution=async()=>state();
      export function axTuiCommand(){return 'ax tui'}
      export const axScanCapabilitySources=async()=>[{id:'codex',name:'Codex',items:[{name:'review',kind:'skill',path:'C:/Users/me/.codex/skills/review'},{name:'MCP · User',kind:'mcp',path:'C:/Users/me/.codex/config.toml'}]}];
      export const axExport=async()=>'',axImport=async()=>'',axImportCapability=async()=>'',axManageCapability=async()=>'ok',workspaceFileExists=async()=>false;
      export const axCheckUpdate=async()=>({action:'none'}),axApplyUpdate=axCheckUpdate;
    `}))
    await page.goto('/#/settings/models')
    const rows=page.locator('.settings-provider-list>div')
    await expect(rows).toHaveCount(4)
    const columns=await rows.evaluateAll(nodes=>nodes.map(node=>[...node.querySelectorAll('button')].map(button=>button.getBoundingClientRect().x)))
    for(const row of columns)expect(row).toEqual(columns[0])
    expect(await page.locator('.settings-main').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
    await page.screenshot({path:`test-results/adaptive-providers-${width}.png`})
    await page.goto('/#/settings/capabilities')
    await expect(page.getByText('Skill · review')).toBeVisible()
    await page.getByText('Skill · review').click()
    await expect(page.getByRole('button',{name:'导入所选（1）'})).toBeEnabled()
    expect(await page.locator('.settings-main').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
    await page.screenshot({path:`test-results/discovered-imports-${width}.png`})
  })
}
