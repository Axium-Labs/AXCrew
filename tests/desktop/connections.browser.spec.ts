import { expect,test } from '../../apps/desktop/node_modules/@playwright/test'

test.beforeEach(async({page})=>{
  await page.route('**/src/lib/api.ts*',route=>route.fulfill({contentType:'application/javascript',body:`
    const projects=[{id:'p',name:'Remote project',device_id:'ssh:host',cwd:'/srv/project',member_id:'remote'}],tasks=[],sessions=[];
    const devices=[{id:'local',name:'本机',status:'online'},{id:'ssh:host',name:'Build host',status:'online'},{id:'offline',name:'Offline host',status:'offline'}];
    const members=[{id:'local-member',crew_id:'crew',name:'本地',device_id:'local',cwd:'C:/workspace',skills:[],mcp_servers:[],permission_profile:'ask'},{id:'remote',crew_id:'crew',name:'AX',device_id:'ssh:host',cwd:'/srv/project',skills:[],mcp_servers:[],permission_profile:'ask'}];
    export const getConnection=async()=>({endpoint:'http://127.0.0.1:1424',token:'test'});
    export const api=async(path,method,body)=>{
      (window.__requests??=[]).push({path,method,body});
      if(path==='/api/projects')return method==='POST'?(projects.push({...body,id:'new',member_id:'remote'}),projects.at(-1)):projects;
      if(path==='/api/connections/ssh')return method==='POST'?{...body,id:'ssh:new'}:[{id:'ssh:host',name:'Build host',host:'user@build',port:null,identity_file:null}];
      if(path==='/api/connections/ssh/discover')return [{name:'build-alias',host:'build-alias',port:null,identity_file:null}];
      if(path.includes('/workspace'))return {cwd:'/srv/project',parent:'/srv',directories:[{name:'src',path:'/srv/project/src'}]};
      if(path==='/api/environments/remote/model'){const selected={...members[1],id:'remote-model',provider:body.provider,model:body.model};members.push(selected);return selected;}
      if(path==='/api/sessions'){
        const member=members.find(m=>m.id===body.member_id);if(!member)throw new Error('remote environment required');
        const task={id:'created',crew_id:'crew',title:body.title,assigned_member:member.id,assigned_device:member.device_id,dependencies:[],status:'completed',input:body.text,output:{text:'Done'},created_at:1,finished_at:2};tasks.push(task);sessions.push({task_id:'created',member_id:member.id,device_id:member.device_id,ax_session_id:'remote-session'});return task;
      }
      return {};
    };
    export const endpoints={capabilities:async()=>({models:{providers:[{id:'deepseek',models:[{id:'deepseek-chat',display_name:'Deepseek Chat'}]}]},skills:{skills:[]},mcp:{servers:[]},capabilities:{}}),health:async()=>({status:'ok'}),crews:async()=>[{id:'crew',name:'本地'}],devices:async()=>devices,tasks:async()=>tasks,sessions:async()=>sessions,permissions:async()=>[],members:async()=>members,events:async()=>[],settings:async()=>({default_cwd:'C:/workspace'}),automations:async()=>[],automationRuns:async()=>[],localAx:async()=>({available:true,projects:[]}),history:async()=>({updates:[]}),authorizations:async()=>({pending:[],authorized:[]})};
  `}))
  await page.routeWebSocket('**/api/ws*',()=>{})
  await page.addInitScript(()=>{localStorage.setItem('ax-crew-language',JSON.stringify({state:{lang:'zh'},version:0}));localStorage.setItem('ax-crew-ui',JSON.stringify({state:{theme:'dark'},version:0}))})
})

for(const width of [960,1440])for(const theme of ['dark','light'])test(`connection, SSH and project surfaces at ${width} ${theme}`,async({page})=>{
  await page.setViewportSize({width,height:950});await page.goto('/#/connect');await page.evaluate(t=>document.documentElement.dataset.theme=t,theme)
  await expect(page.getByRole('heading',{name:'连接',exact:true})).toBeVisible();await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});await page.screenshot({path:`test-results/connections-browser/connection-${width}-${theme}.png`})
  await page.getByRole('tab',{name:'SSH',exact:true}).click();await page.getByRole('button',{name:'添加 SSH 连接',exact:true}).click();await expect(page.getByText('build-alias',{exact:true})).toBeVisible();await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});await page.screenshot({path:`test-results/connections-browser/ssh-list-${width}-${theme}.png`})
  await page.getByRole('button',{name:'手动添加'}).click();await page.getByLabel('主机名').fill('user@build');await page.getByRole('button',{name:'身份文件',exact:true}).click();await page.getByLabel('身份文件路径').fill('C:/keys/id_ed25519');await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});await page.screenshot({path:`test-results/connections-browser/ssh-manual-${width}-${theme}.png`})
  await page.getByRole('button',{name:'关闭',exact:true}).click();await page.goto('/#/sessions');await page.getByRole('button',{name:'添加项目',exact:true}).click();await expect(page.getByRole('dialog',{name:'创建项目'})).toBeVisible();await page.getByLabel('项目名称').fill('Demo');await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});await page.screenshot({path:`test-results/connections-browser/project-${width}-${theme}.png`})
  await page.getByRole('button',{name:'在此电脑上添加文件夹'}).click();await expect(page.getByRole('menuitem',{name:/Offline host/})).toHaveAttribute('data-disabled','');await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});await page.screenshot({path:`test-results/connections-browser/project-hosts-${width}-${theme}.png`});await page.keyboard.press('Escape');await page.getByRole('button',{name:'取消',exact:true}).click()
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth',width)
})

test('cloud requires an environment and sends to its member, fixing the location for follow-ups',async({page})=>{
  await page.setViewportSize({width:1440,height:950});await page.goto('/#/sessions');await page.getByRole('button',{name:'工作位置',exact:true}).click();await page.getByRole('menuitemradio',{name:'云端',exact:true}).click()
  await expect(page.getByRole('button',{name:'选择环境',exact:true})).toBeVisible();await page.getByRole('textbox',{name:'发送消息',exact:true}).fill('Run tests remotely');await expect(page.locator('.session-chat-panel .session-send-button')).toBeDisabled()
  await page.getByRole('button',{name:'选择环境',exact:true}).click();await page.getByRole('menuitem',{name:/Remote project/}).click();await page.getByRole('button',{name:'选择 AX 模型',exact:true}).click();await page.locator('.session-model-choice').click();await page.getByRole('menuitem',{name:'Deepseek Chat'}).click();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'选择 AX 模型',exact:true})).toContainText('Deepseek Chat');await expect(page.locator('.session-model-popover')).toHaveCount(0);await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})))});await page.screenshot({path:'test-results/connections-browser/cloud-environment.png'})
  await page.locator('.session-chat-panel .session-send-button').click();await expect(page).toHaveURL(/sessions\/created/);await expect(page.locator('.session-composer-tabs')).toHaveCount(0)
  const request=await page.evaluate(()=>((window as unknown as {__requests:{path:string;body:Record<string,unknown>}[]}).__requests).find(r=>r.path==='/api/sessions'))
  expect(request?.body.member_id).toBe('remote-model');expect(request?.body).not.toHaveProperty('cwd')
})
