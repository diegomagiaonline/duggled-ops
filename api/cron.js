import webpush from 'web-push';
import crypto from 'node:crypto';

const key='duggled:ops:prospects:push-snapshot:v1';
const lockKey='duggled:ops:prospects:push-lock:v1';
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y)};
const redisUrl=()=>process.env.UPSTASH_REDIS_REST_URL||process.env.PSTASH_REDIS_REST_URL;
async function redis(...args){
  const url=redisUrl(),token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)throw Error('Redis no configurado');
  const resp=await fetch(url,{method:'POST',headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});
  if(!resp.ok)throw Error('Redis HTTP '+resp.status);
  const data=await resp.json();
  if(data.error)throw Error('Redis: '+data.error);
  return data.result;
}
async function script(mode=''){
  const url=new URL(process.env.APPS_SCRIPT_URL);
  if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!url.pathname.endsWith('/exec'))throw Error('Apps Script URL incorrecta');
  url.searchParams.set('key',process.env.APPS_SCRIPT_SECRET);
  if(mode)url.searchParams.set('mode',mode);
  const label=mode||'prospects';
  let lastError;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const resp=await fetch(url,{
        redirect:'follow',cache:'no-store',
        signal:AbortSignal.timeout(attempt===1?18000:22000)
      });
      if(!resp.ok)throw Error('Apps Script '+label+' HTTP '+resp.status);
      const data=await resp.json();
      if(data.error)throw Error('Apps Script '+label+': '+data.error);
      return data;
    }catch(error){
      lastError=error;
      console.warn('Apps Script '+label+' attempt '+attempt+':',error.message);
      if(attempt===1)await new Promise(resolve=>setTimeout(resolve,500));
    }
  }
  throw Error('Apps Script '+label+' agotó 2 intentos: '+lastError.message);
}
const gmailWatchTokenKey='duggled:ops:gmail:watch-token:v1';
const gmailSeenKey='duggled:ops:gmail:seen-ids:v1';
const gmailHealthKey='duggled:ops:gmail:health:v1';
function openGmailToken(value){
 try{
  const data=Buffer.from(value,'base64url'),key=crypto.createHash('sha256').update(process.env.GMAIL_SESSION_SECRET).digest();
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
  decipher.setAuthTag(data.subarray(12,28));
  const json=JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString());
  return json?.email==='infoduggled@gmail.com'?json.refresh_token:null;
 }catch{return null;}
}
function cleanEmail(value){const email=String(value||'').trim().toLowerCase();return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)?email:'';}
function emailAddresses(value){return [...new Set((String(value||'').toLowerCase().match(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g)||[]).map(cleanEmail).filter(Boolean))];}
function header(message,name){return message.payload?.headers?.find(h=>String(h.name).toLowerCase()===name.toLowerCase())?.value||'';}
function headerHasEmail(message,name,email){const exact=cleanEmail(email);return Boolean(exact)&&emailAddresses(header(message,name)).includes(exact);}
function isLegitimateReplyThread(messages,email){
 const inbound=messages.some(message=>headerHasEmail(message,'From',email));
 const outbound=messages.some(message=>headerHasEmail(message,'From','infoduggled@gmail.com')&&(headerHasEmail(message,'To',email)||headerHasEmail(message,'Cc',email)));
 return inbound&&outbound;
}
async function watchGmailReplies(prospects){
 const stored=await redis('GET',gmailWatchTokenKey);
 if(!stored)return {state:'not-enabled'};
 const refreshToken=openGmailToken(stored);
 if(!refreshToken)throw Error('Autorización Gmail de fondo inválida');
 const addresses=new Map();
 for(const p of prospects){const email=String(p.email||'').trim().toLowerCase();if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&p.id)addresses.set(email,{id:String(p.id),name:String(p.name||'Prospecto')})}
 if(!addresses.size)return {state:'no-emails'};
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:refreshToken,grant_type:'refresh_token'}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw Error('Gmail requiere reconexión: OAuth '+response.status);
 const oauth=await response.json();
 const query='in:anywhere {'+[...addresses.keys()].map(email=>'from:'+email).join(' ')+'} newer_than:7d';
 const listResponse=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+new URLSearchParams({q:query,maxResults:'100'}),{headers:{Authorization:'Bearer '+oauth.access_token},signal:AbortSignal.timeout(12000)});
 if(!listResponse.ok)throw Error('Gmail consulta '+listResponse.status);
 const listed=await listResponse.json();
 const ids=(listed.messages||[]).map(item=>String(item.id)).slice(0,100);
 const previous=await redis('GET',gmailSeenKey);
 if(!previous){await redis('SET',gmailSeenKey,JSON.stringify(ids),'EX',2592000);return {state:'baseline',messages:ids.length,sent:0}}
 let known=[];try{known=JSON.parse(previous)}catch{}
 const old=new Set(Array.isArray(known)?known:[]);
 const fresh=ids.filter(id=>!old.has(id));
 if(!fresh.length){await redis('SET',gmailSeenKey,JSON.stringify(ids),'EX',2592000);return {state:'checked',new:0,sent:0}}
 const messages=await Promise.all([...new Set(fresh)].slice(0,20).map(async id=>{
  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=Cc',{headers:{Authorization:'Bearer '+oauth.access_token},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Gmail mensaje '+response.status);
  return response.json();
 }));
 const candidates=messages.map(message=>({message,email:[...addresses.keys()].find(email=>headerHasEmail(message,'From',email))})).filter(item=>item.email);
 const threadIds=[...new Set(candidates.map(item=>String(item.message.threadId)).filter(Boolean))];
 const threadEntries=await Promise.all(threadIds.map(async id=>{
  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/threads/'+encodeURIComponent(id)+'?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc',{headers:{Authorization:'Bearer '+oauth.access_token},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Gmail conversación '+response.status);
  return [id,await response.json()];
 }));
 const threadMap=new Map(threadEntries),eventsByProspect=new Map();
 for(const {message,email} of candidates){
  const prospect=addresses.get(email),thread=threadMap.get(String(message.threadId));
  if(!prospect||!isLegitimateReplyThread(thread?.messages||[],email)||eventsByProspect.has(prospect.id))continue;
  eventsByProspect.set(prospect.id,{...prospect,from:email,snippet:String(message.snippet||'').slice(0,130)});
 }
 const events=[...eventsByProspect.values()];
 // Keep verified incoming replies available to the radar on every device.
 for(const item of events){
  await redis('HSET','duggled:ops:radar:verified-replies:v1',item.id,'1');
  await redis('HDEL','duggled:ops:radar:followups:v1',item.id);
 }
 let sent=0,failed=0;
 if(events.length){
  const data=await script('pushDevices');
  const devices=Array.isArray(data.devices)?data.devices:[];
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  for(const device of devices.slice(0,100)){
   if(!device.preferences?.status)continue;
   const item=events[0];
   const msg={title:'Duggled Ops · Nueva respuesta de Gmail',body:item.name+' respondió tu correo'+(events.length>1?' (+'+(events.length-1)+' respuestas)':''),url:'/?prospect='+encodeURIComponent(item.id)+'&view=conversation',tag:'duggled-gmail-'+Date.now()};
   try{await webpush.sendNotification(device.subscription,JSON.stringify(msg),{TTL:3600,urgency:'high'});sent++}
   catch(e){failed++;console.error('Gmail push failed:',e.statusCode||e.message)}
  }
 }
 if(failed)throw Error('No se entregaron '+failed+' avisos Gmail; se reintentará');
 await redis('SET',gmailSeenKey,JSON.stringify(ids),'EX',2592000);
 return {state:'checked',new:events.length,sent};
}
const makeSnapshot=(prospects)=>{
  const snapshot={};
  for(const p of prospects){
    const id=String(p.id||'').trim(),name=String(p.name||'').trim();
    if(!id||!name)continue;
    snapshot[id]={name,status:String(p.status||'Detectado'),score:Number(p.score||0)};
  }
  return snapshot;
};
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Método no permitido'});
  if(!process.env.CRON_SECRET||!equal(req.headers.authorization,'Bearer '+process.env.CRON_SECRET))return res.status(401).json({ok:false,error:'No autorizado'});
  const lockToken=crypto.randomUUID();
  try{
    const locked=await redis('SET',lockKey,lockToken,'NX','EX',60);
    if(locked!=='OK')return res.status(200).json({ok:true,skipped:'running'});
    const [sheet,stored]=await Promise.all([script(),redis('GET',key)]);
    if(!Array.isArray(sheet.prospects))throw Error('La planilla devolvió datos inválidos');
    const current=makeSnapshot(sheet.prospects);
    const previous=stored?JSON.parse(stored):null;
    const additions=[],changes=[];
    if(previous){
      for(const [id,p] of Object.entries(current)){
        if(!previous[id])additions.push({id,name:p.name,score:p.score});
        else if(previous[id].status!==p.status)changes.push({id,name:p.name,from:previous[id].status,to:p.status});
      }
    }
    let sent=0,failed=0,devicesCount=0;
    if(additions.length||changes.length){
      const data=await script('pushDevices');
      const devices=Array.isArray(data.devices)?data.devices:[];
      devicesCount=devices.length;
      webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
      for(const device of devices.slice(0,100)){
        const prefs=device.preferences||{};
        const relevantNew=additions.filter(p=>prefs.new||(prefs.priority&&p.score>=90));
        const relevantChanges=changes.filter(p=>prefs.status);
        if(!relevantNew.length&&!relevantChanges.length)continue;
        const item=relevantNew[0]||relevantChanges[0];
        const msg={title:relevantNew.length?'Duggled Ops · Nuevo prospecto':'Duggled Ops · Estado actualizado',
          body:String(item.name)+(relevantNew.length?' · Nuevo prospecto':' → '+String(item.to)),
          tag:'duggled-cron-'+Date.now(),url:'/?prospect='+encodeURIComponent(String(item.id))};
        try{await webpush.sendNotification(device.subscription,JSON.stringify(msg),{TTL:3600,urgency:'normal'});sent++}
        catch(err){failed++;console.error('Web Push cron send:',err.statusCode||err.message)}
      }
    }
    if(failed)throw Error('Web Push no se pudo entregar a '+failed+' dispositivos; conservando referencia para próximo intento');
    await redis('SET',key,JSON.stringify(current),'EX',2592000);
    let gmailWatch={state:'not-checked'};
    try{gmailWatch=await watchGmailReplies(sheet.prospects)}catch(e){console.error('Gmail background watch:',e.message);gmailWatch={state:'error',detail:e.message}}
    try{
      const previousHealth=await redis('GET',gmailHealthKey);
      let health={};try{health=previousHealth?JSON.parse(previousHealth):{}}catch{}
      const checkedAt=new Date().toISOString();
      const update={state:gmailWatch.state,checkedAt,notifiedAt:gmailWatch.sent?checkedAt:(health.notifiedAt||null),notified:gmailWatch.sent||0,detail:gmailWatch.state==='error'?gmailWatch.detail:undefined};
      if(gmailWatch.state!=='not-enabled')await redis('SET',gmailHealthKey,JSON.stringify(update),'EX',2592000);
    }catch(e){console.warn('Gmail watch health write:',e.message)}
    return res.status(200).json({ok:true,baseline:!previous,added:additions.length,changed:changes.length,devices:devicesCount,sent,failed,gmailWatch});
  }catch(error){
    console.error('Duggled push cron:',error.message);
    return res.status(503).json({ok:false,error:'Cron no disponible',detail:error.message});
  }finally{
    try{if(await redis('GET',lockKey)===lockToken)await redis('DEL',lockKey)}catch{}
  }
}

