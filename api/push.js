import webpush from 'web-push';
import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';

const fail=(res,status,error)=>res.status(status).json({ok:false,error});
const eq=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y)};
const parsable=(s)=>{try{return JSON.parse(s)}catch{return null}};
const origin='https://duggled-ops.vercel.app';

async function callScript(mode, options={}) {
  const url=new URL(process.env.APPS_SCRIPT_URL);
  if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!url.pathname.endsWith('/exec'))throw Error('Apps Script URL incorrecta');
  url.searchParams.set('key',process.env.APPS_SCRIPT_SECRET);
  if(mode)url.searchParams.set('mode',mode);
  const r=await fetch(url,{redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(15000),...options});
  if(!r.ok)throw Error('Apps Script HTTP '+r.status);
  const json=await r.json();
  if(json.error)throw Error('Apps Script: '+json.error);
  return json;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const action=String(req.query.action||'');
  if(req.method==='GET'&&action==='config'){
    if(!process.env.VAPID_PUBLIC_KEY)return fail(res,503,'Web Push no configurado');
    return res.status(200).json({publicKey:process.env.VAPID_PUBLIC_KEY});
  }
  if(req.method!=='POST')return fail(res,405,'Método no permitido');
  if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_SUBJECT||!process.env.APPS_SCRIPT_URL||!process.env.APPS_SCRIPT_SECRET)return fail(res,503,'Faltan variables de Web Push');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  if(action==='register'){
    const subscription=req.body?.subscription;
    if(!subscription||typeof subscription.endpoint!=='string'||!subscription.endpoint.startsWith('https://')||!subscription.keys?.p256dh||!subscription.keys?.auth)return fail(res,400,'Suscripción inválida');
    if(JSON.stringify(subscription).length>3500)return fail(res,413,'Suscripción demasiado grande');
    const prefs=req.body?.preferences||{};
    const categories={new:!!prefs.new,status:!!prefs.status,priority:!!prefs.priority};
    const result=await callScript('',{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({mode:'push-register',key:process.env.APPS_SCRIPT_SECRET,subscription,preferences:categories,operation:req.body?.operation==='remove'?'remove':'save'})});
    return res.status(200).json({ok:true,devices:result.count});
  }
  if(action==='test-delayed'){
    const subscription=req.body?.subscription;
    if(!subscription||typeof subscription.endpoint!=='string'||!subscription.endpoint.startsWith('https://')||!subscription.keys?.p256dh||!subscription.keys?.auth)
      return fail(res,400,'Suscripción de prueba inválida');
    const data=await callScript('pushDevices');
    const devices=Array.isArray(data.devices)?data.devices:[];
    const registered=devices.find(device=>device.subscription?.endpoint===subscription.endpoint&&
      device.subscription?.keys?.p256dh===subscription.keys.p256dh&&
      device.subscription?.keys?.auth===subscription.keys.auth);
    if(!registered)return fail(res,404,'Este dispositivo no figura entre los registrados');
    // The server continues independently after responding; closing the PWA will not cancel the send.
    waitUntil((async()=>{
      await new Promise(resolve=>setTimeout(resolve,20000));
      try{
        await webpush.sendNotification(registered.subscription,JSON.stringify({
          title:'Duggled Ops · Prueba con app cerrada',
          body:'¡Llegó! Esta notificación salió de Vercel 20 segundos después de cerrar la aplicación.',
          url:'/',tag:'ops-background-'+Date.now()
        }),{TTL:300,urgency:'high'});
        console.info('Delayed Web Push accepted');
      }catch(error){console.error('Delayed Web Push rejected',error.statusCode||error.message)}
    })());
    return res.status(202).json({ok:true,scheduled:true,delaySeconds:20});
  }
  if(action==='test'){
    const subscription=req.body?.subscription;
    if(!subscription||typeof subscription.endpoint!=='string'||!subscription.endpoint.startsWith('https://')||!subscription.keys?.p256dh||!subscription.keys?.auth)return fail(res,400,'Suscripción de prueba inválida');
    const data=await callScript('pushDevices');
    const devices=Array.isArray(data.devices)?data.devices:[];
    const registered=devices.find(device=>device.subscription?.endpoint===subscription.endpoint&&
      device.subscription?.keys?.p256dh===subscription.keys.p256dh&&
      device.subscription?.keys?.auth===subscription.keys.auth);
    if(!registered)return fail(res,404,'Este dispositivo todavía no figura entre los registrados');
    try{
      const result=await webpush.sendNotification(registered.subscription,JSON.stringify({
        title:'Duggled Ops · Prueba remota',
        body:'Esta notificación fue enviada desde Vercel, no desde la página.',
        url:'/',tag:'ops-remote-'+Date.now()
      }),{TTL:300,urgency:'high'});
      return res.status(200).json({ok:true,accepted:true,statusCode:result.statusCode});
    }catch(error){
      console.error('Web Push self-test error',error.statusCode||error.message);
      return fail(res,502,'El servicio Push rechazó el envío: '+(error.statusCode||'sin código'));
    }
  }
  if(action==='dispatch'){
    if(!process.env.OPS_PUSH_DISPATCH_SECRET||process.env.OPS_PUSH_DISPATCH_SECRET.length<32)return fail(res,503,'Falta clave de envío');
    if(!eq(req.headers.authorization,'Bearer '+process.env.OPS_PUSH_DISPATCH_SECRET))return fail(res,401,'No autorizado');
    const events=req.body||{};
    const additions=Array.isArray(events.additions)?events.additions.slice(0,50):[];
    const changes=Array.isArray(events.changes)?events.changes.slice(0,50):[];
    if(!additions.length&&!changes.length)return res.status(200).json({ok:true,sent:0});
    const data=await callScript('pushDevices');
    const devices=Array.isArray(data.devices)?data.devices:[];
    let sent=0,failed=0;
    for(const device of devices.slice(0,100)){
      const p=device.preferences||{};
      const relevantNew=additions.filter(x=>p.new || (p.priority&&Number(x.score)>=90));
      const relevantStatus=changes.filter(x=>p.status);
      if(!relevantNew.length&&!relevantStatus.length)continue;
      const first=relevantNew[0]||relevantStatus[0];
      const msg={title:relevantNew.length?'Duggled Ops · Nuevo prospecto':'Duggled Ops · Cambio de estado',body:String(first.name||'Prospecto')+(relevantNew.length?' · Nuevo prospecto':' → '+String(first.to||'')),url:'/',tag:'ops-'+Date.now()};
      try{await webpush.sendNotification(device.subscription,JSON.stringify(msg),{TTL:3600,urgency:'normal'});sent++}catch(e){failed++;console.error('Web Push delivery error',e.statusCode||e.message)}
    }
    return res.status(200).json({ok:true,sent,failed});
  }
  return fail(res,404,'Acción desconocida');
}