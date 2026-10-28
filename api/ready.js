import crypto from 'node:crypto';
const KEY='duggled:ops:radar:ready-overrides:v1';
const REPLIES='duggled:ops:radar:verified-replies:v1';
const FOLLOWUPS='duggled:ops:radar:followups:v1';
function authorized(req){
 try{
  const raw=(req.headers.cookie||'').match(/(?:^|;\s*)duggled_gmail=([^;]*)/)?.[1];
  if(!raw||!process.env.GMAIL_SESSION_SECRET)return false;
  const buf=Buffer.from(decodeURIComponent(raw),'base64url');
  const key=crypto.createHash('sha256').update(process.env.GMAIL_SESSION_SECRET).digest();
  const d=crypto.createDecipheriv('aes-256-gcm',key,buf.subarray(0,12));
  d.setAuthTag(buf.subarray(12,28));
  const session=JSON.parse(Buffer.concat([d.update(buf.subarray(28)),d.final()]).toString('utf8'));
  return session.email==='infoduggled@gmail.com'&&Boolean(session.refresh_token);
 }catch{return false}
}
async function redis(...args){
 const url=process.env.UPSTASH_REDIS_REST_URL||process.env.PSTASH_REDIS_REST_URL;
 const token=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(!url||!token)throw Error('Redis unavailable');
 const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('Redis HTTP '+r.status);
 const data=await r.json();if(data.error)throw Error('Redis '+data.error);return data.result;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Método no permitido'});
 try{
  if(req.method==='GET'){
   const entries=await redis('HGETALL',KEY);
   let overrides={};
   if(Array.isArray(entries)){for(let i=0;i+1<entries.length;i+=2)overrides[entries[i]]=entries[i+1]}
   else if(entries&&typeof entries==='object')overrides=entries;
   const entriesReply=await redis('HGETALL',REPLIES);
   const replies={};
   if(Array.isArray(entriesReply)){for(let i=0;i+1<entriesReply.length;i+=2)replies[entriesReply[i]]=true}
   else if(entriesReply&&typeof entriesReply==='object')for(const id of Object.keys(entriesReply))replies[id]=true;
   const records=await redis('HGETALL',FOLLOWUPS);
   const followups={};
   if(Array.isArray(records)){for(let i=0;i+1<records.length;i+=2){try{followups[records[i]]=JSON.parse(records[i+1])}catch{}}}
   else if(records&&typeof records==='object'){for(const [id,v] of Object.entries(records)){try{followups[id]=JSON.parse(v)}catch{}}}
   return res.json({overrides,replies,followups});
  }
  // Mutations still require the authenticated Gmail session; reading returns only ID/state pairs.
  if(!authorized(req))return res.status(401).json({error:'Conectá Gmail en Ops para modificar tu lista Listos desde este dispositivo.'});
  const origin=req.headers.origin,host=req.headers.host;
  if(!origin||!host||new URL(origin).host!==host||new URL(origin).protocol!=='https:')return res.status(403).json({error:'Origen no autorizado'});
  if(!String(req.headers['content-type']||'').includes('application/json'))return res.status(415).json({error:'Se requiere JSON'});
  const id=String(req.body?.id||''),state=String(req.body?.state||'');
  if(!/^[0-9]{1,12}$/.test(id)||!['ready','review','reset','replied','sent','followup'].includes(state))return res.status(400).json({error:'Cambio de estado inválido'});
  if(state==='followup'){
   const stage=Number(req.body?.stage);
   if(![0,1,2,3].includes(stage))return res.status(400).json({error:'Etapa inválida'});
   const date=new Date().toISOString();
   await redis('HSET',FOLLOWUPS,id,JSON.stringify({stage,sentAt:date}));
   await redis('HSET',KEY,id,'sent');
  }
  else if(state==='replied'){
   await redis('HSET',REPLIES,id,'1');
   await redis('HDEL',FOLLOWUPS,id);
  }
  else if(state==='sent')await redis('HSET',KEY,id,'sent');
  else await redis(state==='reset'?'HDEL':'HSET',KEY,id,...(state==='reset'?[]:[state]));
  return res.json({ok:true,id,state});
 }catch(e){console.error('Radar ready state:',e.message);return res.status(502).json({error:'No se pudo sincronizar Listos. Volvé a intentar.'})}
}

