import { expect, test } from '@playwright/test'

test('execution choices save independently and expose failures', async ({page}) => {
  await page.route('**/src/lib/api.ts*', route => route.fulfill({contentType:'application/javascript', body:`
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async()=>({});
    export const endpoints={health:async()=>({status:'ok'}),settings:async()=>({default_cwd:'C:/workspace'}),sessions:async()=>[],tasks:async()=>[],crews:async()=>[],devices:async()=>[],permissions:async()=>[],automations:async()=>[],events:async()=>[],localAx:async()=>({projects:[]})};
  `}));
  await page.route('**/src/lib/ax.ts*', async route => {
    const response = await route.fetch()
    let body = await response.text()
    body = body.replace(/export const axAvailable = isTauri\(\);?/, 'export const axAvailable = true;')
      .replace(/export const axLocalState = [^\n]+/, `const execution={agent_environment:'native',terminal_shell:'powershell',windows:true,active_path:'C:/AX/ax.exe',providers:[]}; export const axLocalState=async()=>({...execution});`)
      .replace(/export const axSelectExecution = [^\n]+/, `export const axSelectExecution=async(environment,terminalShell)=>{(window.__executionChanges??=[]).push({environment,terminalShell});if(environment==='wsl')throw new Error('WSL requires Linux AX');if(environment)execution.agent_environment=environment;if(terminalShell)execution.terminal_shell=terminalShell;};`)
    await route.fulfill({response, body})
  })
  await page.routeWebSocket('**/api/ws*',()=>{})
  await page.addInitScript(()=>localStorage.setItem('ax-crew-language', JSON.stringify({state:{lang:'zh'},version:0})))
  await page.setViewportSize({width:1440,height:1000})
  await page.goto('/#/settings/ax')
  const environment = page.getByRole('combobox', {name:'智能体环境'})
  const shell = page.getByRole('combobox', {name:'集成终端 Shell'})
  await expect(environment).toContainText('Windows 原生')
  await shell.click()
  await expect(page.getByRole('option')).toHaveCount(4)
  await page.screenshot({path:'test-results/execution-shell.png'})
  await page.getByRole('option', {name:'Command Prompt',exact:true}).click()
  await expect(shell).toContainText('Command Prompt')
  await expect(environment).toContainText('Windows 原生')
  await environment.click()
  await page.screenshot({path:'test-results/execution-environment.png'})
  await page.getByRole('option', {name:/适用于 Linux/}).click()
  // Failures are announced as alerts; successes use status.
  await expect(page.getByRole('alert')).toContainText('WSL requires Linux AX')
  await expect(environment).toContainText('Windows 原生')
})
