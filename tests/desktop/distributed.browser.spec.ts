import { expect, test } from '../../apps/desktop/node_modules/@playwright/test'

const caps={roles:['code'],skills:['rust'],mcp:[],tools:['shell'],models:['model'],permissions:['ask'],environments:['windows']}
const cluster={revision:8,server_time:100,hosts:{h:{id:'h',name:'Build server',resources:{cpu:8,ram_mb:16384,gpu:1},last_seen:100,enabled:true,inventory_at:100,inventory:{hostname:'build-machine',os:'windows',arch:'x86_64',cpu_name:'Test CPU',cpu:8,ram_mb:16384,gpu:1,gpu_names:['Test GPU'],errors:[]}}},instances:{a:{id:'a',host_id:'h',name:'AX-code',projects:['project-ax'],max_executions:2,can_delegate:true,enabled:true,last_seen:100,incarnation:'epoch',capabilities:caps},b:{id:'b',host_id:'h',name:'AX-test',projects:['project-ax'],max_executions:4,can_delegate:false,enabled:true,last_seen:100,incarnation:'epoch',capabilities:{...caps,roles:['test']}}},tasks:{t:{id:'t',creator:'admin',spec:{title:'Remote test failure',input:'run test suite',project_id:'project-ax',parent_id:null,dependencies:[],artifacts:[],requirements:{capabilities:{roles:['test']},resources:{cpu:2,ram_mb:1024,gpu:0}}},status:'failed',owner:'b',generation:2,failure:'assertion failed: race condition',result:null,artifacts:[],attempts:[{generation:2,instance_id:'b',started_at:80,ended_at:90,error:'network interrupted'}]}},artifacts:{},events:[{sequence:8,timestamp:90,kind:'task.observation',task_id:'t',instance_id:'b',detail:'TEST_FAILED: race condition'}],workflows:{w:{id:'w',title:'Durable project workflow',project_id:'project-ax',root_task_id:'t',status:'blocked',revision:3,state:{stage:'awaiting_fix',test_task_id:'t'},updated_at:90}}}

for(const width of [960,1440])for(const theme of ['dark','light']){
  test(`empty distributed sections have card spacing at ${width}px in ${theme}`,async({page})=>{
    await page.setViewportSize({width,height:900})
    await page.addInitScript(({theme})=>{
      localStorage.setItem('ax-crew-language',JSON.stringify({state:{lang:'zh'},version:0}))
      localStorage.setItem('ax-crew-ui',JSON.stringify({state:{theme,sidebar:true},version:0}))
    },{theme})
    await page.route(/\/src\/lib\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
      export const getConnection=async()=>({endpoint:'http://127.0.0.1:1423',token:'test'});
      export const api=async()=>({hosts:{},instances:{},tasks:{},artifacts:{},workflows:{},events:[]});
      export const endpoints={health:async()=>({status:'ok'}),settings:async()=>({}),crews:async()=>[],devices:async()=>[],tasks:async()=>[],sessions:async()=>[],permissions:async()=>[],events:async()=>[],automations:async()=>[]};
    `}))
    await page.routeWebSocket('**/api/ws*',()=>{})
    await page.goto('/#/distributed')
    await expect(page.locator('.cluster-intro')).toBeVisible()
    for(const tab of ['协作任务','产物','观测与事件','工作流']){
      await page.getByRole('tab',{name:tab,exact:true}).click()
      await expect(page.locator('.distributed-page .empty')).toBeVisible()
      expect(await page.locator('.distributed-page').evaluate(node=>node.querySelector('.empty')!.getBoundingClientRect().top-node.querySelector('.cluster-intro')!.getBoundingClientRect().bottom)).toBeGreaterThanOrEqual(24)
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    }
    await page.screenshot({path:`test-results/distributed-empty-${width}-${theme}.png`})
  })
  test(`durable cluster management at ${width}px in ${theme}`,async({page})=>{
    await page.setViewportSize({width,height:900})
    await page.addInitScript(({theme})=>{
      localStorage.setItem('ax-crew-language',JSON.stringify({state:{lang:'zh'},version:0}))
      localStorage.setItem('ax-crew-ui',JSON.stringify({state:{theme,sidebar:true},version:0}))
    },{theme})
    await page.route(/\/src\/lib\/api\.ts(?:\?.*)?$/,route=>route.fulfill({contentType:'application/javascript',body:`
      const cluster=${JSON.stringify(cluster)};
      export const getConnection=async()=>({endpoint:'http://127.0.0.1:1423',token:'test'});
      export const api=async(path,method,body)=>{if(path==='/api/distributed')return cluster;if(path.endsWith('/retry')){cluster.tasks.t.status='pending';return {accepted:true}}return {}};
      export const endpoints={health:async()=>({status:'ok'}),settings:async()=>({default_cwd:'C:/workspace'}),crews:async()=>[],devices:async()=>[],tasks:async()=>[],sessions:async()=>[],permissions:async()=>[],events:async()=>[],automations:async()=>[]};
    `}))
    await page.routeWebSocket('**/api/ws*',()=>{})
    await page.goto('/#/distributed')
    await expect(page.getByRole('link',{name:'分布式协作',exact:true})).toHaveAttribute('aria-current','page')
    await expect(page.getByText('Build server')).toBeVisible()
    await expect(page.getByText('8 · Test CPU')).toBeVisible()
    await expect(page.getByText('1 · Test GPU')).toBeVisible()
    await expect(page.getByText('AX-code',{exact:true})).toBeVisible()
    await expect(page.getByText('AX-test',{exact:true})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    await page.screenshot({path:`test-results/distributed-hosts-${width}-${theme}.png`})
    await page.getByRole('tab',{name:'AX 实例',exact:true}).click()
    await page.getByRole('button',{name:'配置能力',exact:true}).first().click()
    await expect(page.getByLabel('模型 ID',{exact:true})).toBeVisible()
    await page.getByLabel('Skill 名称',{exact:true}).fill('rust, testing')
    await page.getByRole('button',{name:'保存并生成本地配置',exact:true}).click()
    await expect(page.getByRole('button',{name:'下载配置字段',exact:true})).toBeVisible()
    await page.screenshot({path:`test-results/distributed-configure-${width}-${theme}.png`})
    await page.keyboard.press('Escape')
    await page.getByRole('tab',{name:'工作流',exact:true}).click()
    await expect(page.getByText('Durable project workflow')).toBeVisible()
    await expect(page.getByText(/awaiting_fix/)).toBeVisible()
    await page.getByRole('button',{name:'查看根任务 / 取消 / 恢复'}).click()
    const dialog=page.getByRole('dialog')
    await expect(dialog.getByText('assertion failed: race condition')).toBeVisible()
    await expect(dialog.getByText('TEST_FAILED: race condition')).toBeVisible()
    await page.screenshot({path:`test-results/distributed-recovery-${width}-${theme}.png`})
    await dialog.getByRole('button',{name:'重试',exact:true}).click()
    await expect(dialog.getByRole('button',{name:'取消任务及子任务'})).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button',{name:'添加 AX 实例',exact:true}).click()
    await expect(page.getByLabel('Host ID',{exact:true})).toBeVisible()
    await expect(page.getByLabel('此机器上的项目路径')).toBeVisible()
    for(const label of ['CPU 核数','GPU 数量','Skill 名称','MCP 名称','Tool 名称','模型 ID'])await expect(page.getByLabel(label,{exact:true})).toHaveCount(0)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    await page.screenshot({path:`test-results/distributed-enroll-${width}-${theme}.png`})
  })
}
