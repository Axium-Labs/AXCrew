import { expect, test } from '@playwright/test'

test('subagent switch saves, reloads persisted state and retains it after an error', async ({page}) => {
  await page.route('**/src/lib/api.ts*', route => route.fulfill({contentType:'application/javascript', body:`
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1421',token:'test'});
    export const api=async()=>({});
    export const endpoints={health:async()=>({status:'ok'}),settings:async()=>({default_cwd:'C:/workspace'}),sessions:async()=>[],tasks:async()=>[],crews:async()=>[],devices:async()=>[],permissions:async()=>[],automations:async()=>[],events:async()=>[],localAx:async()=>({projects:[]})};
  `}));
  await page.route('**/src/lib/ax.ts*', async route => {
    const response = await route.fetch()
    const body = (await response.text())
      .replace(/export const axAvailable = isTauri\(\);?/, 'export const axAvailable = true;')
      .replace(/export const axLocalState = [^\n]+/, `export const axLocalState=async()=>({agent_environment:'native',terminal_shell:'powershell',windows:true,active_path:'C:/AX/ax.exe',providers:[],subagent_enabled:localStorage.getItem('test-subagent')==='true'});`)
      .replace(/export const axSelectSubagent = [^\n]+/, `export const axSelectSubagent=async(enabled)=>{if(window.__failSubagentSave)throw new Error('AX settings unavailable');localStorage.setItem('test-subagent',String(enabled));};`)
    await route.fulfill({response, body})
  })
  await page.routeWebSocket('**/api/ws*',()=>{})
  await page.addInitScript(()=>localStorage.setItem('ax-crew-language', JSON.stringify({state:{lang:'zh'},version:0})))
  await page.goto('/#/settings/ax')
  const toggle = page.getByRole('switch', {name:'子智能体（Subagent）'})
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('status')).toContainText('下一轮对话生效')
  await page.reload()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toBeEnabled()
  await page.evaluate('window.__failSubagentSave = true')
  await toggle.click()
  await expect(page.getByRole('status')).toContainText('AX settings unavailable')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await page.screenshot({path:'test-results/subagent-settings.png'})
})
