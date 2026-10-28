import crypto from 'node:crypto';

const MAX_AGE = 30 * 24 * 60 * 60;
const sender = 'infoduggled@gmail.com';
const scopes = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email';
function config() { return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_SESSION_SECRET && process.env.GMAIL_SESSION_SECRET.length >= 32); }
function appUrl(req) { const h = req.headers.host || ''; if (!/^[a-z0-9.-]+(:[0-9]{2,5})?$/i.test(h)) throw Error('Invalid host'); return 'https://' + h; }
function cookie(req, key) { const m=(req.headers.cookie||'').match(new RegExp('(?:^|;\\s*)'+key+'=([^;]*)'));return m?decodeURIComponent(m[1]):''; }
function seal(data){const key=crypto.createHash('sha256').update(process.env.GMAIL_SESSION_SECRET).digest();const iv=crypto.randomBytes(12);const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url');}
function unseal(raw){try{const b=Buffer.from(raw,'base64url');const key=crypto.createHash('sha256').update(process.env.GMAIL_SESSION_SECRET).digest();const d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString())}catch{return null}}
function setCookie(res, key, value, age) { res.setHeader('Set-Cookie',key+'='+encodeURIComponent(value)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+age); }
function fail(res, status, message){return res.status(status).json({error:message});}
async function googleToken(params){const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)});if(!r.ok)throw Error('Google OAuth token rejected');return r.json();}
async function auth(req){const session=unseal(cookie(req,'duggled_gmail'));if(!session?.refresh_token||session.email!==sender)return null;const token=await googleToken({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,refresh_token:session.refresh_token,grant_type:'refresh_token'});return token.access_token;}
async function gmail(token,path,opts={}){const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{...opts,headers:{Authorization:'Bearer '+token,...opts.headers}});if(!r.ok)throw Error('Gmail returned '+r.status);return r.json();}
const gmailPushKey='duggled:ops:gmail:watch-token:v1';
const gmailSeenKey='duggled:ops:gmail:seen-ids:v1';
const gmailHealthKey='duggled:ops:gmail:health:v1';
async function redis(...args){
 const url=process.env.UPSTASH_REDIS_REST_URL||process.env.PSTASH_REDIS_REST_URL;
 if(!url||!process.env.UPSTASH_REDIS_REST_TOKEN)throw Error('Redis no configurado');
 const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+process.env.UPSTASH_REDIS_REST_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Redis HTTP '+r.status);
 const j=await r.json();if(j.error)throw Error('Redis '+j.error);return j.result;
}
function cleanEmail(x){const value=String(x||'').trim().toLowerCase();return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)?value:'';}
function encodedMime(to,subject,plain,html,thread){const boundary='duggled-'+crypto.randomBytes(9).toString('hex');const headers=['From: Duggled <'+sender+'>','To: '+to,'Subject: =?UTF-8?B?'+Buffer.from(subject).toString('base64')+'?=','MIME-Version: 1.0','Content-Type: multipart/alternative; boundary="'+boundary+'"'];if(thread?.messageId){headers.push('In-Reply-To: '+thread.messageId);headers.push('References: '+(thread.references?thread.references+' ':'')+thread.messageId)}const mime=headers.join('\r\n')+'\r\n\r\n--'+boundary+'\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from(plain).toString('base64')+'\r\n--'+boundary+'\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from(html).toString('base64')+'\r\n--'+boundary+'--';return Buffer.from(mime).toString('base64url');}
function encodedPlainMime(to,subject,plain,thread){
 const headers=['From: Duggled <'+sender+'>','To: '+to,
 'Subject: =?UTF-8?B?'+Buffer.from(subject).toString('base64')+'?=',
 'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64'];
 if(thread?.messageId){headers.push('In-Reply-To: '+thread.messageId);headers.push('References: '+(thread.references?thread.references+' ':'')+thread.messageId)}
 return Buffer.from(headers.join('\r\n')+'\r\n\r\n'+Buffer.from(plain).toString('base64')).toString('base64url');
}
function decodeBody(data){
 try{return Buffer.from(String(data||'').replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')}catch{return ''}
}
function plainFromHtml(html){
 return String(html||'').replace(/<head[\s\S]*?<\/head>/gi,'').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi,'')
  .replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/p>|<\/div>|<\/li>|<\/tr>/gi,'\n')
  .replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/gi,' ').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
  .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&amp;/gi,'&');
}
function gmailBody(payload){
 let plain='',html='';
 function walk(part){
  if(!part)return;
  const type=String(part.mimeType||'').toLowerCase();
  if(type==='text/plain'&&!plain&&part.body?.data)plain=decodeBody(part.body.data);
  if(type==='text/html'&&!html&&part.body?.data)html=decodeBody(part.body.data);
  for(const child of part.parts||[])walk(child);
 }
 walk(payload);
 let message=(plain||plainFromHtml(html)).replace(/\r\n?/g,'\n').trim();
 // Gmail/Outlook may include quoted headers inside the body. Cut at the
 // beginning of the old message, keeping only the new reply's actual text.
 const separators=[
  /^\s*El\s+(?:lun|mar|mi[eé]|jue|vie|s[aá]b|dom|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|\d{1,2}[\/.-])[^\n]{0,250}(?:escribi[oó]:|wrote:)/im,
  // Gmail en español: «El vie, oct 16, 2026 a la(s) 14:35 ...» incluso sin «escribió» en la misma línea.
  /^\s*El\s+(?:lun|mar|mi[eé]|jue|vie|s[aá]b|dom)\s*,\s*[^\n]{0,300}$/im,
  /^\s*El\s+[^\n]{0,220}\ba la\(s\)\s+[^\n]*$/im,
  /^\s*On\s+[^\n]{5,250}\bwrote:\s*$/im,
  /^\s*(?:De|From):\s*[^\n]+\n\s*(?:(?:Fecha|Date|Enviado|Sent|Para|To|Asunto|Subject):)/im,
  /^\s*(?:Enviado desde|Sent from)\s+(?:mi |my )?(?:iPhone|iPad|Android)/im,
  /^\s*-{2,}\s*(?:Original Message|Mensaje original)\s*-{2,}/im,
  /^\s*_{8,}\s*$/m,
  /^\s*--\s*$/m
 ];
 let cut=message.length;
 for(const pattern of separators){const found=pattern.exec(message);if(found&&found.index<cut)cut=found.index;}
 message=message.slice(0,cut);
 // Avoid displaying individual leftover quoted headers and Gmail quotation lines.
 message=message.replace(/^\s*(?:De|From|Para|To|Fecha|Date|Enviado|Sent|Asunto|Subject):[^\n]*$/gim,'')
  .replace(/^\s*>.*$/gm,'').replace(/\n{3,}/g,'\n\n').trim();
 return message.slice(0,12000);
}
function header(message,name){return message.payload?.headers?.find(h=>h.name.toLowerCase()===name.toLowerCase())?.value||'';}
function emailAddresses(value){return [...new Set((String(value||'').toLowerCase().match(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/g)||[]).map(cleanEmail).filter(Boolean))];}
function headerHasEmail(message,name,email){const exact=cleanEmail(email);return Boolean(exact)&&emailAddresses(header(message,name)).includes(exact);}
function isReply(message,email){return headerHasEmail(message,'From',email);}
function isLegitimateReplyThread(messages,email){
 const exact=cleanEmail(email);if(!exact)return false;
 const inbound=messages.some(message=>headerHasEmail(message,'From',exact));
 const outbound=messages.some(message=>headerHasEmail(message,'From',sender)&&(headerHasEmail(message,'To',exact)||headerHasEmail(message,'Cc',exact)));
 return inbound&&outbound;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
 const action=String(req.query.action||'status');
 if(!config())return fail(res,503,'Gmail no está configurado para Duggled Ops. Se requieren las credenciales OAuth en Vercel.');
 const callback=appUrl(req)+'/api/gmail?action=callback';
 try{
 if(action==='connect'){
  if(req.method!=='GET')return fail(res,405,'Method not allowed');
  const state=crypto.randomBytes(24).toString('base64url');setCookie(res,'duggled_oauth_state',seal({state,at:Date.now()}),600);
  const params=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:callback,response_type:'code',scope:scopes,access_type:'offline',prompt:'consent select_account',state});
  return res.redirect(302,'https://accounts.google.com/o/oauth2/v2/auth?'+params);
 }
 if(action==='callback'){
  const stateCookie=unseal(cookie(req,'duggled_oauth_state'));setCookie(res,'duggled_oauth_state','',0);
  if(!stateCookie||stateCookie.state!==req.query.state||Date.now()-stateCookie.at>600000||!req.query.code)return res.redirect(302,'/?gmail=denied');
  const tokens=await googleToken({client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:callback,grant_type:'authorization_code',code:String(req.query.code)});
  const r=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:'Bearer '+tokens.access_token}});
  if(!r.ok)throw Error('Cannot verify account');
  const user=await r.json();
  if(user.email?.toLowerCase()!==sender||!user.email_verified||!tokens.refresh_token)return res.redirect(302,'/?gmail=wrong_account');
  setCookie(res,'duggled_gmail',seal({email:sender,refresh_token:tokens.refresh_token}),MAX_AGE);
  return res.redirect(302,'/?gmail=connected');
 }
 if(action==='disconnect'){if(req.method!=='POST')return fail(res,405,'Method not allowed');setCookie(res,'duggled_gmail','',0);return res.json({connected:false});}
 const token=await auth(req);
 if(action==='status')return res.json({connected:Boolean(token),account:token?sender:null});
 if(!token)return fail(res,401,'Conectá primero el Gmail autorizado');
 if(action==='push-status' && req.method==='GET'){
   if(!token)return res.json({enabled:false,connected:false});
   const [stored,healthRaw]=await Promise.all([redis('GET',gmailPushKey),redis('GET',gmailHealthKey)]);
   let health=null;try{health=healthRaw?JSON.parse(healthRaw):null}catch{}
   return res.json({enabled:Boolean(stored),connected:true,lastCheck:health?.checkedAt||null,lastResult:health?.state||'pending',lastNotification:health?.notifiedAt||null});
 }
 if(action==='push-enable' && req.method==='POST'){
   const origin=String(req.headers.origin||'');
   if(origin!==appUrl(req)||req.headers['x-requested-with']!=='Duggled-Ops')return fail(res,403,'Solicitud no autorizada');
   const session=unseal(cookie(req,'duggled_gmail'));
   if(!session?.refresh_token||session.email!==sender)return fail(res,401,'Conectá Gmail nuevamente');
   // Establish the baseline at activation, so a reply arriving before the next cron run isn't silently consumed.
   const initial=await gmail(token,'messages?'+new URLSearchParams({q:'in:anywhere newer_than:7d',maxResults:'100'}));
   const ids=(initial.messages||[]).map(m=>String(m.id));
   await redis('SET',gmailSeenKey,JSON.stringify(ids),'EX',2592000);
   await redis('SET',gmailPushKey,seal({email:sender,refresh_token:session.refresh_token}));
   await redis('SET',gmailHealthKey,JSON.stringify({state:'awaiting-first-check',checkedAt:null}),'EX',2592000);
   return res.json({enabled:true,baseline:ids.length});
 }
 if(action==='push-disable' && req.method==='POST'){
   const origin=String(req.headers.origin||'');
   if(origin!==appUrl(req)||req.headers['x-requested-with']!=='Duggled-Ops')return fail(res,403,'Solicitud no autorizada');
   await redis('DEL',gmailPushKey);
   return res.json({enabled:false});
 }
 if(action==='alerts' && req.method==='GET'){
  const emails=String(req.query.emails||'').split(',').map(cleanEmail).filter(Boolean).slice(0,60);
  if(!emails.length)return res.json({messages:[],checkedAt:new Date().toISOString()});
  const q='in:anywhere {'+emails.map(e=>'from:'+e).join(' ')+'} newer_than:30d';
  const listed=await gmail(token,'messages?'+new URLSearchParams({q,maxResults:'80'}));
  const uniqueIds=[...new Set((listed.messages||[]).map(m=>String(m.id)))].slice(0,80);
  const messages=await Promise.all(uniqueIds.map(id=>gmail(token,'messages/'+encodeURIComponent(id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date')));
  const candidates=messages.map(message=>({message,email:emails.find(email=>headerHasEmail(message,'From',email))})).filter(item=>item.email);
  const threadIds=[...new Set(candidates.map(item=>String(item.message.threadId)).filter(Boolean))];
  const threadEntries=await Promise.all(threadIds.map(async id=>[id,await gmail(token,'threads/'+encodeURIComponent(id)+'?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc')]));
  const threadMap=new Map(threadEntries);
  const filtered=candidates.filter(({message,email})=>isLegitimateReplyThread(threadMap.get(String(message.threadId))?.messages||[],email)).map(({message:m})=>({id:m.id,threadId:m.threadId,from:header(m,'From'),subject:header(m,'Subject'),snippet:m.snippet||'',internalDate:Number(m.internalDate||0)}));
  return res.json({messages:filtered,checkedAt:new Date().toISOString()});
 }
 if(action==='thread' && req.method==='GET'){
  const email=cleanEmail(req.query.email);if(!email)return fail(res,400,'No hay correo válido para este prospecto');
  const q='in:anywhere {from:'+email+' to:'+email+'}';
  const listed=await gmail(token,'messages?'+new URLSearchParams({q,maxResults:'35'}));
  const uniqueIds=[...new Set((listed.messages||[]).map(m=>String(m.id)))].slice(0,25);
  const raw=await Promise.all(uniqueIds.map(id=>gmail(token,'messages/'+encodeURIComponent(id)+'?format=full')));
  const legitimateThreads=new Set([...new Set(raw.map(m=>String(m.threadId)).filter(Boolean))].filter(id=>isLegitimateReplyThread(raw.filter(m=>String(m.threadId)===id),email)));
  const messages=raw.map(m=>({id:m.id,threadId:m.threadId,from:header(m,'From'),to:header(m,'To'),subject:header(m,'Subject'),date:header(m,'Date'),body:gmailBody(m.payload),snippet:m.snippet||'',isReply:isReply(m,email),messageId:header(m,'Message-ID'),references:header(m,'References'),internalDate:Number(m.internalDate||0)})).sort((a,b)=>a.internalDate-b.internalDate);
  const threads=[...new Set(messages.map(m=>m.threadId))].map(id=>{const ms=messages.filter(m=>m.threadId===id);return {id,subject:ms[0]?.subject||'',lastDate:ms.at(-1)?.internalDate||0,replied:legitimateThreads.has(String(id)),messages:ms}}).sort((a,b)=>b.lastDate-a.lastDate);
  return res.json({email,threads,checkedAt:new Date().toISOString()});
 }
 if(action==='send' && req.method==='POST'){
  const to=cleanEmail(req.body?.to),subject=String(req.body?.subject||'').trim(),html=String(req.body?.html||''),plain=String(req.body?.plain||'').trim(),threadId=String(req.body?.threadId||''),format=req.body?.format==='plain'?'plain':'html';
  if(!to||!subject||subject.length>180||(format==='html'&&(!html||html.length>100000))||!plain||plain.length>15000)return fail(res,400,'Faltan datos o exceden el tamaño permitido');
  let thread=null;
  if(threadId){
   if(!/^[a-zA-Z0-9]+$/.test(threadId))return fail(res,400,'Conversación inválida');
   const t=await gmail(token,'threads/'+threadId+'?format=metadata');
   const last=t.messages?.at(-1);if(!last||!t.messages.some(m=>header(m,'To').includes(to)||header(m,'From').includes(to)))return fail(res,403,'Este hilo no corresponde al prospecto');
   thread={messageId:header(last,'Message-ID'),references:header(last,'References')};
  }
  const message={raw:format==='plain'?encodedPlainMime(to,subject,plain,thread):encodedMime(to,subject,plain,html,thread)};if(threadId)message.threadId=threadId;
  const sent=await gmail(token,'messages/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message)});
  // Temporary diagnostics: inspect the message Gmail actually saved in Sent.
  // This cannot determine whether the recipient's Gmail UI displays an avatar.
  let diagnostic={status:'unavailable',format,warnings:[]};
  try{
   const actual=await gmail(token,'messages/'+encodeURIComponent(sent.id)+'?format=metadata&metadataHeaders=From&metadataHeaders=Sender&metadataHeaders=Reply-To&metadataHeaders=Content-Type');
   const from=header(actual,'From'),senderHeader=header(actual,'Sender'),replyTo=header(actual,'Reply-To');
   const fromEmail=(from.match(/<([^<>]+)>/)?.[1]||from).trim().toLowerCase();
   const fromName=from.replace(/<[^<>]+>/g,'').replace(/^"|"$/g,'').trim();
   const warnings=[];
   if(fromEmail!==sender)warnings.push('Gmail guardó un remitente diferente al autorizado.');
   if(fromName!=='Duggled')warnings.push('El nombre mostrado por Gmail difiere de Duggled.');
   if(senderHeader&&!senderHeader.toLowerCase().includes(sender))warnings.push('El encabezado Sender difiere de la cuenta autorizada.');
   if(replyTo&&!replyTo.toLowerCase().includes(sender))warnings.push('Reply-To contiene otra dirección.');
   const mimeType=actual.payload?.mimeType||null;
   if(format==='plain'&&mimeType!=='text/plain')warnings.push('Gmail guardó un tipo MIME diferente de text/plain.');
   diagnostic={status:warnings.length?'warning':'ok',format,from,fromName,fromEmail,senderHeader:senderHeader||null,replyTo:replyTo||null,mimeType,warnings};
  }catch(error){console.warn('Sent mail diagnostic unavailable:',error.message)}
  return res.json({sent:true,id:sent.id,threadId:sent.threadId,diagnostic});
 }
 return fail(res,405,'Action not supported');
 }catch(e){console.error('Duggled Gmail error:',e.message);return fail(res,502,'No se pudo completar la operación con Gmail. '+(e.message?.startsWith('Gmail returned')?e.message:''));}
}

