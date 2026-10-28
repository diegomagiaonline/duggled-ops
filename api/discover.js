import crypto from 'node:crypto';

// Duggled Ops discovery: evidence-based screening, no fabricated emails/scores.
// Setup: BRAVE_SEARCH_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON (share Sheet with service account).
const sheetId=process.env.GOOGLE_SHEET_ID||'1rMOf9CPZS4KdTobETIQpE_sH1JmPqUZrIOB5e2ot6wU';
const redisBase=()=>process.env.UPSTASH_REDIS_REST_URL||process.env.PSTASH_REDIS_REST_URL;
const headings=['ID','Fecha detectado','Negocio','Rubro','Ciudad','Web','Instagram','Email','WhatsApp','Señal 1','Señal 2','Evidencia / URL','Puntaje','Servicio recomendado','Ángulo inicial','Mensaje inicial','Estado'];
const queries=[
  'site:mitiendanube.com "consultar stock" "whatsapp" "email" argentina',
  'site:mitiendanube.com "enviar comprobante" "whatsapp" contacto',
  'site:mitiendanube.com "pedidos personalizados" "seña" "contacto"',
  'site:mitiendanube.com "coordinar el envío" "whatsapp" "mail"',
  '"tienda online" "no se puede pagar" "WhatsApp" argentina'
];
const indicators=[
  {name:'Compra derivada a mensajería',rx:/compra.{0,110}(whatsapp|mensaje)|pedido.{0,90}(whatsapp|mensaje)|termin(ar|amos).{0,90}whatsapp/i},
  {name:'Stock sujeto a confirmación',rx:/consult(a|ar|anos|en).{0,90}(stock|disponibilidad)|stock.{0,100}(consult|confirm)/i},
  {name:'Comprobantes enviados manualmente',rx:/envi(ar|anos|ar el).{0,90}comprobante|comprobante.{0,100}whatsapp/i},
  {name:'Pedido personalizado por consulta',rx:/personalizad[oa]s?.{0,110}(mensaje|whatsapp|consult|pedido)|encargo.{0,100}(consulta|whatsapp|seña)/i},
  {name:'Pago o seña fuera del checkout',rx:/seña.{0,90}(transferencia|whatsapp|pago|pedido)|pago.{0,90}(transferencia|whatsapp|manual)/i},
  {name:'Envíos coordinados por WhatsApp',rx:/env[ií]o.{0,100}(whatsapp|coordina|consult)|whatsapp.{0,90}env[ií]o/i},
  {name:'Venta mayorista con validación manual',rx:/mayorista.{0,120}(consult|pedido|whatsapp|m[ií]nimo)|compra m[ií]nima.{0,80}(whatsapp|consulta)/i},
  {name:'Pedido con anticipación obligatoria',rx:/anticipaci[oó]n.{0,90}(pedido|encargo)|plazo.{0,90}(producci[oó]n|personalizaci[oó]n)/i}
];
function safeSite(raw) {
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:'&&url.protocol!=='http:')return null;
    const host=url.hostname.toLowerCase();
    if(!host.includes('.')||host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||
      /^(?:127|10|0|169\.254|192\.168)\./.test(host)||host.startsWith('172.16.')||host.endsWith('.google.com'))return null;
    return url;
  }catch{return null}
}
function rootUrl(raw){const u=safeSite(raw);if(!u)return '';return u.origin+'/'}
async function request(url,opts={},ms=6500){return fetch(url,{redirect:'follow',...opts,signal:AbortSignal.timeout(ms)})}
function textContent(html){return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|quot|#39);/g,' ').replace(/\s+/g,' ').slice(0,95000)}
function businessName(html,url){
 const match=html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i)||
   html.match(/<title[^>]*>([^<]+)/i);
 const name=String(match?.[1]||url.hostname.replace(/^www\./,'').split('.')[0]).split(/\s+[|–—-]\s+/)[0].replace(/&amp;/g,'&').trim().slice(0,95);
 return name.length>=3?name:url.hostname;
}
function emailsIn(html){const found=new Set();const clean=html.replace(/&#64;|&commat;/gi,'@').replace(/\s*\[at\]\s*/gi,'@');for(const m of clean.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)){
 const email=m[0].toLowerCase().replace(/[.,;:]+$/,'');
 if(!/\.(png|jpg|jpeg|svg|webp|css|js)$/i.test(email)&&!/(example\.com|test\.com|sentry|wixpress|shopify\.com|tiendanube\.com)/.test(email)&&email.length<120)found.add(email);
 }return [...found]}
async function getPage(url){
  try{const resp=await request(url,{headers:{'Accept':'text/html','User-Agent':'Mozilla/5.0 (compatible; DuggledOpsResearch/1.0)'}},5500);
    if(!resp.ok||!String(resp.headers.get('content-type')||'').includes('text/html'))return '';
    const html=await resp.text();return html.slice(0,300000);
  }catch{return ''}
}
async function searchWeb(q){
 const u=new URL('https://api.search.brave.com/res/v1/web/search');
 u.searchParams.set('q',q);u.searchParams.set('count','15');u.searchParams.set('country','AR');u.searchParams.set('search_lang','es');
 const resp=await request(u,{headers:{'Accept':'application/json','X-Subscription-Token':process.env.BRAVE_SEARCH_API_KEY}},10000);
 if(!resp.ok)throw Error('Buscador HTTP '+resp.status);
 const json=await resp.json();return json.web?.results||[];
}
async function sheetToken(){
 let service;try{service=JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON||'{}')}catch{throw Error('Credencial de Google Sheets inválida')}
 if(!service.client_email||!service.private_key)throw Error('Faltan credenciales de Google Sheets');
 const now=Math.floor(Date.now()/1000),base64=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url');
 const input=base64({alg:'RS256',typ:'JWT'})+'.'+base64({iss:service.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const jwt=input+'.'+crypto.sign('RSA-SHA256',Buffer.from(input),service.private_key).toString('base64url');
 const resp=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})},8000);
 const token=await resp.json();if(!resp.ok||!token.access_token)throw Error('No se pudo autorizar Sheets');return token.access_token;
}
async function sheets(token,method,range,values){
 const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(sheetId)+'/values/'+encodeURIComponent(range)+(method==='PUT'?'?valueInputOption=RAW':'?valueRenderOption=FORMATTED_VALUE');
 const resp=await request(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='PUT'?{body:JSON.stringify({range,majorDimension:'ROWS',values})}:{})},12000);
 const data=await resp.json();if(!resp.ok)throw Error('Google Sheets HTTP '+resp.status+': '+String(data.error?.message||'').slice(0,100));return data;
}
async function redis(...args){
 const url=redisBase(),token=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(!url||!token)throw Error('Redis no configurado');
 const r=await request(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args)},7000);
 const d=await r.json();if(!r.ok||d.error)throw Error('Redis no disponible');return d.result;
}
const norm=x=>String(x||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,'');
function candidateRow(c,id){
 const signal=c.signals.map(x=>x.name);
 const angle='Ordenar el circuito de '+signal[0].toLowerCase()+' y '+signal[1].toLowerCase()+' con un flujo comercial medible.';
 return [id,new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}),c.name,'Ecommerce / PyME','Argentina · confirmar ubicación',c.site,'',c.email,'',signal[0],signal[1],c.evidence,c.score,'Automatización / ecommerce',angle,'Hola, estuve revisando la tienda de '+c.name+' y observé oportunidades para ordenar consultas y pedidos. ¿Les puedo compartir una idea concreta para simplificar ese proceso?','Listo para contactar'];
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method==='GET')return res.status(200).json({ok:true,configured:!!(process.env.BRAVE_SEARCH_API_KEY&&process.env.GOOGLE_SERVICE_ACCOUNT_JSON),requirements:['BRAVE_SEARCH_API_KEY','GOOGLE_SERVICE_ACCOUNT_JSON']});
 if(req.method!=='POST')return res.status(405).json({ok:false,error:'Método no permitido'});
 const expected=String(process.env.CRON_SECRET||'');
 const provided=String(req.headers.authorization||'');
 const expectedHeader='Bearer '+expected;
 if(!expected||Buffer.byteLength(provided)!==Buffer.byteLength(expectedHeader)||!crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expectedHeader)))return res.status(401).json({ok:false,error:'No autorizado'});
 if(!process.env.BRAVE_SEARCH_API_KEY||!process.env.GOOGLE_SERVICE_ACCOUNT_JSON)return res.status(503).json({ok:false,code:'needs_setup',error:'Falta configurar el buscador web y/o el acceso de escritura a Google Sheets. No se realizó ninguna búsqueda.'});
 const lockId=crypto.randomUUID(),lock='duggled:ops:discover:lock';
 try{
   if(await redis('SET',lock,lockId,'NX','EX',120)!=='OK')return res.status(409).json({ok:false,error:'Ya hay una búsqueda de prospectos en curso'});
   const token=await sheetToken();
   const existing=await sheets(token,'GET',"'Prospectos'!A6:Q2000");
   const already=(existing.values||[]).filter(x=>String(x[2]||'').trim());
   const ids=new Set((existing.values||[]).map(x=>String(x[0]||'').trim()).filter(Boolean)),names=new Set(already.map(x=>norm(x[2]))),domains=new Set(already.map(x=>norm(x[5]))),existingEmails=new Set(already.map(x=>norm(x[7])));
   let next=Math.max(0,...[...ids].map(Number).filter(Number.isFinite))+1;
   const batches=await Promise.allSettled(queries.map(q=>searchWeb(q)));
   const seen=new Set(),hits=[];
   for(const result of batches){if(result.status!=='fulfilled')continue;for(const hit of result.value){const u=safeSite(hit.url);if(!u)continue;const root=u.origin;if(seen.has(root)||domains.has(norm(root)))continue;seen.add(root);hits.push({url:u.href,root,snippet:hit.description||''})}}
   if(!batches.some(x=>x.status==='fulfilled'))throw Error('El buscador no respondió. Probá nuevamente más tarde.');
   const checked=[],limit=10;
   for(let i=0;i<hits.length&&checked.length<limit&&i<32;i+=4){
     const results=await Promise.all(hits.slice(i,i+4).map(async hit=>{
       const html=await getPage(hit.root);if(!html)return null;
       const text=textContent(html);
       const emails=emailsIn(html);
       // Follow a public contact page when the homepage does not reveal an email.
       if(!emails.length){for(const suffix of ['/contacto','/pages/contacto','/contact']){const other=await getPage(hit.root.replace(/\/$/,'')+suffix);if(other){emails.push(...emailsIn(other));if(emails.length)break}}}
       if(!emails.length)return null;
       const page=await getPage(hit.url);
       const evidence=textContent(page||html);
       const signals=indicators.filter(x=>x.rx.test(text+' '+evidence));
       if(signals.length<2)return null;
       const name=businessName(html,new URL(hit.root)),email=emails[0],domain=norm(hit.root);
       if(names.has(norm(name))||domains.has(domain)||existingEmails.has(norm(email)))return null;
       const score=Math.min(98,85+(signals.length-2)*3+Math.min(4,emails.length));
       return {name,email,site:hit.root,signals,score,evidence:hit.url};
     }));
     for(const item of results){if(!item)continue;if(checked.some(x=>norm(x.email)===norm(item.email)||norm(x.site)===norm(item.site)))continue;checked.push(item);if(checked.length>=limit)break}
   }
   if(!checked.length)return res.status(200).json({ok:true,added:0,requested:10,message:'No se encontraron candidatos nuevos que cumplan email público y dos señales verificables. No se agregaron registros.'});
   const rows=checked.map(c=>candidateRow(c,String(next++)));
   // Never fill gaps or overwrite reserved/partial records; append after the last occupied row.
   const firstRow=(existing.values||[]).length+6;
   const lastRow=firstRow+rows.length-1;
   const updated=await sheets(token,'PUT',"'Prospectos'!A"+firstRow+':Q'+lastRow,rows);
   const verified=await sheets(token,'GET',"'Prospectos'!A"+firstRow+':Q'+lastRow);
   const confirmed=(verified.values||[]).length===rows.length&&rows.every((row,i)=>row.every((value,j)=>String(verified.values[i]?.[j]??'')===String(value??'')));
   if(!confirmed)throw Error('La lectura posterior no coincide con las filas escritas; revisar '+firstRow+':'+lastRow);
   return res.status(200).json({ok:true,verified:true,added:rows.length,requested:10,prospects:checked.map((c,i)=>({id:rows[i][0],name:c.name,score:c.score,email:c.email})),updatedRange:updated.updatedRange||null});
 }catch(e){console.error('Duggled discovery:',e.message);return res.status(503).json({ok:false,error:'Búsqueda no disponible: '+e.message})}
 finally{try{if(await redis('GET',lock)===lockId)await redis('DEL',lock)}catch{}}
}