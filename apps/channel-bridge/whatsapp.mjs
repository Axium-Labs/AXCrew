// Private stdio bridge. Credentials go only to the parent's protected store.
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
// Third-party diagnostics must never share the protocol stream or expose credentials.
console.log = console.info = console.warn = console.error = () => {}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
const pending = new Map()
let sequence = 0, socket, sdk, data, active = false
const silent = { level: 'silent', trace(){},debug(){},info(){},warn(){},error(){},fatal(){},child(){return this} }
function persist() {
  const id = `auth-${++sequence}`
  const value = JSON.parse(JSON.stringify(data, sdk.BufferJSON.replacer))
  return new Promise((resolve,reject) => {
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('credential persistence timed out'))},15000)
    pending.set(id,()=>{clearTimeout(timer);resolve()});emit({type:'auth',id,value})
  })
}
async function start(request) {
  sdk = await import(pathToFileURL(path.join(process.argv[1], 'node_modules/@whiskeysockets/baileys/lib/index.js')).href)
  data = request.params.auth ? JSON.parse(JSON.stringify(request.params.auth),sdk.BufferJSON.reviver) : null
  if (!data?.creds) data = { creds:sdk.initAuthCreds(), keys:{} }
  const keys = {
    get:async(type,ids)=>Object.fromEntries(ids.map(id=>{
      let value=data.keys[`${type}:${id}`]
      if(type==='app-state-sync-key'&&value)value=sdk.proto.Message.AppStateSyncKeyData.fromObject(value)
      return [id,value]
    })),
    set:async(updates)=>{for(const [type,values] of Object.entries(updates)){for(const [id,value] of Object.entries(values)){if(value)data.keys[`${type}:${id}`]=value;else delete data.keys[`${type}:${id}`]}}await persist()}
  }
  await persist()
  socket=sdk.default({auth:{creds:data.creds,keys},logger:silent,markOnlineOnConnect:false,syncFullHistory:false,shouldSyncHistoryMessage:()=>false,browser:['AXCrew','Chrome','1.0'],getMessage:async()=>undefined})
  socket.ev.on('creds.update',async update=>{try{Object.assign(data.creds,update);await persist()}catch{process.exit(1)}})
  socket.ev.on('connection.update',update=>{
    if(update.qr)emit({type:'qr',value:update.qr})
    if(update.connection==='open'){active=true;emit({type:'connected',account:socket.user?.id||''})}
    if(update.connection==='close'){active=false;const code=update.lastDisconnect?.error?.output?.statusCode;emit({type:'closed',logged_out:code===sdk.DisconnectReason.loggedOut});setTimeout(()=>process.exit(0),50)}
  })
  socket.ev.on('messages.upsert',({type,messages})=>{
    if(type!=='notify')return
    for(const m of messages){
      const chat=m.key.remoteJid||''
      if(m.key.fromMe||!m.key.id||!/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(chat))continue
      if(Number(m.messageTimestamp)<Date.now()/1000-300)continue
      const text=m.message?.conversation||m.message?.extendedTextMessage?.text
      if(typeof text==='string')emit({type:'message',message:{id:m.key.id,chat,sender:chat,text}})
    }
  })
}
input.on('line',line=>{
  if(line.length>8*1024*1024){process.exit(1);return}
  let request;try{request=JSON.parse(line)}catch{return}
  if(request.method==='auth.saved'){pending.get(request.id)?.();pending.delete(request.id);return}
  void (async()=>{
    if(request.method==='initialize'){await start(request);emit({id:request.id,result:{ok:true}})}
    else if(request.method==='send'){
      const {chat,text}=request.params
      if(!active||!/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(chat)||typeof text!=='string')throw new Error('invalid send')
      await socket.sendMessage(chat,{text});emit({id:request.id,result:{ok:true}})
    }else if(request.method==='logout'){await socket?.logout();emit({id:request.id,result:{ok:true}})}
  })().catch(()=>{emit({id:request.id,error:{message:'WhatsApp operation failed'}});if(request.method==='initialize')process.exit(1)})
})
input.on('close',()=>process.exit(0))
process.on('uncaughtException',()=>process.exit(1))
process.on('unhandledRejection',()=>process.exit(1))
