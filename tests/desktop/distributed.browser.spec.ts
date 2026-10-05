import { expect, test } from '../../apps/desktop/node_modules/@playwright/test'

const caps={roles:['code'],skills:['rust'],mcp:[],tools:['shell'],models:['model'],permissions:['ask'],environments:['windows']}
const cluster={revision:8,server_time:100,hosts:{h:{id:'h',name:'Build server',resources:{cpu:8,ram_mb:16384,gpu:1},last_seen:100,enabled:true}},instances:{a:{id:'a',host_id:'h',name:'AX-code',projects:['project-ax'],max_executions:2,can_delegate:true,enabled:true,last_seen:100,incarnation:'epoch',capabilities:caps},b:{id:'b',host_id:'h',name:'AX-test',projects:['project-ax'],max_executions:4,can_delegate:false,enabled:true,last_seen:100,incarnation:'epoch',capabilities:{...caps,roles:['test']}}},tasks:{t:{id:'t',creator:'admin',spec:{title:'Remote test failure',input:'run test suite',project_id:'project-ax',parent_id:null,dependencies:[],artifacts:[],requirements:{capabilities:{roles:['test']},resources:{cpu:2,ram_mb:1024,gpu:0}}},status:'failed',owner:'b',generation:2,failure:'assertion failed: race condition',result:null,artifacts:[],attempts:[{generation:2,instance_id:'b',started_at:80,ended_at:90,error:'network interrupted'}]}},artifacts:{},events:[{sequence:8,timestamp:90,kind:'task.observation',task_id:'t',instance_id:'b',detail:'TEST_FAILED: race condition'}],workflows:{w:{id:'w',title:'Durable project workflow',project_id:'project-ax',root_task_id:'t',status:'blocked',revision:3,state:{stage:'awaiting_fix',test_task_id:'t'},updated_at:90}}}

for(const width of [960,1440])for(const theme of ['dark','light']){
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
    await expect(page.getByText('AX-code',{exact:true})).toBeVisible()
    await expect(page.getByText('AX-test',{exact:true})).toBeVisible()
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    await page.screenshot({path:`test-results/distributed-hosts-${width}-${theme}.png`})
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
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
    await page.screenshot({path:`test-results/distributed-enroll-${width}-${theme}.png`})
  })
}
