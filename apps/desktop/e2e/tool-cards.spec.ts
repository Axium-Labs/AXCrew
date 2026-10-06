import { expect, test } from '@playwright/test'

test('tool cards fold, scroll and preserve failure in light and dark themes',async({page})=>{
  await page.route('**/src/lib/api.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    const updates=[
      {update:{sessionUpdate:'user_message_chunk',messageId:'u1',content:{text:'修复工具体验'}}},
      {update:{sessionUpdate:'agent_thought_chunk',content:{text:'先检查实现，并行读取两个文件。'}}},
      {update:{sessionUpdate:'tool_call',toolCallId:'s1',kind:'shell',title:"running rg -n 'ToolResult' crates",status:'pending',_ax:{createdAt:1790790000}}},
      {update:{sessionUpdate:'tool_call_update',toolCallId:'s1',status:'completed',_ax:{createdAt:1790790071},rawOutput:{status:'success',raw_output:Array.from({length:120},(_,i)=>'src/core.rs:'+i+': ToolResult').join('\\n')}}},
      {update:{sessionUpdate:'tool_call',toolCallId:'p1',kind:'patch',title:'editing src/core.rs',status:'pending'}},
      {update:{sessionUpdate:'tool_call_update',toolCallId:'p1',status:'failed',rawOutput:{status:'error',raw_output:'patch conflict at src/core.rs:42'}}},
      {update:{sessionUpdate:'agent_message_chunk',content:{text:'已定位冲突，接下来修复对应行。'}}},
      {update:{sessionUpdate:'turn_changes',changedFiles:[{path:'src/core.rs',additions:13,deletions:4},{path:'src/ui.tsx',additions:6,deletions:2}]}}
    ];
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async(path)=>path==='/api/projects'?[]:{};
    export const endpoints={health:async()=>({status:'ok'}),crews:async()=>[],devices:async()=>[],tasks:async()=>[],sessions:async()=>[],permissions:async()=>[],members:async()=>[],events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),automations:async()=>[],automationRuns:async()=>[],localAx:async()=>({available:true,projects:[{id:'p1',root:'C:/workspace',sessions:[{id:'local-1',title:'工具体验',created_at:1,updated_at:2,messages:4,task_id:null}]}]}),localSession:async()=>({task_id:'local-1',ax_session_id:'local-1',updates})};
  `}))
  await page.routeWebSocket('**/api/ws*',()=>{})
  await page.addInitScript(()=>localStorage.setItem('ax-crew-language',JSON.stringify({state:{lang:'zh'},version:0})))
  await page.setViewportSize({width:1440,height:1000})
  await page.goto('/#/sessions?local=local-1')
  await expect(page.locator('.session-process-summary')).toHaveAttribute('aria-expanded','false')
  await expect(page.getByText('已定位冲突，接下来修复对应行。')).toBeVisible()
  await expect(page.getByText('先检查实现，并行读取两个文件。')).toBeHidden()
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'))
  await page.screenshot({path:'test-results/transcript-collapsed-light.png'})
  await page.locator('.session-process-summary').click()
  await page.locator('.session-tool-group-summary').click()
  await expect(page.locator('.session-tool-row')).toHaveCount(2)
  await expect(page.getByText('先检查实现，并行读取两个文件。')).toBeVisible()
  await expect(page.locator('.session-tool-card')).toHaveCount(0)
  const shell=page.locator('.session-tool-row').first()
  await shell.click()
  await expect(shell).toHaveAttribute('aria-expanded','true')
  await expect(page.locator('.session-tool-card header').getByText('运行命令',{exact:true})).toBeVisible()
  await expect(page.getByText('✓ 成功',{exact:true})).toBeVisible()
  const output=page.locator('.session-tool-output').first()
  expect(await output.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true)
  expect((await output.boundingBox())!.height).toBeLessThanOrEqual(261)
  await page.locator('.session-tool-row').nth(1).click()
  await expect(page.getByText('✕ 失败',{exact:true})).toBeVisible()
  await expect(page.getByText('已编辑 2 个文件',{exact:false})).toBeVisible()
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'))
  await page.screenshot({path:'test-results/tool-cards-light.png'})
  await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'))
  await page.screenshot({path:'test-results/tool-cards-dark.png'})
  await shell.click()
  await expect(shell).toHaveAttribute('aria-expanded','false')
  await page.locator('.session-tool-group-summary').click()
  await page.locator('.session-tool-group-summary').click()
  await expect(shell).toHaveAttribute('aria-expanded','false')
  await expect(page.locator('.session-process-content .session-message-actions')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'创建聊天分支'})).toHaveCount(1)
  await page.getByRole('button',{name:'创建聊天分支'}).click()
  await expect(page.locator('.session-branch-banner')).toBeVisible()
  await page.goBack()
  await expect(page.locator('.session-process-summary')).toHaveAttribute('aria-expanded','false')
  await page.locator('.session-process-summary').click()
  await page.locator('.session-tool-group-summary').click()
  await page.locator('.session-tool-row').first().click()
  await expect(page.locator('.session-tool-output').first()).toContainText('src/core.rs:119: ToolResult')
})
