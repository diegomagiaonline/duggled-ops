import crypto from 'node:crypto';

export function phoneKey(value) {
  let digits=String(value||'').replace(/\D/g,'');
  if(digits.startsWith('00'))digits=digits.slice(2);
  // Argentina: WhatsApp uses 549, while listings often show 0/15/54 9.
  if(digits.startsWith('0'))digits=digits.slice(1);
  if(digits.startsWith('54')){
    let local=digits.slice(2);
    if(local.startsWith('9'))local=local.slice(1);
    if(local.startsWith('0'))local=local.slice(1);
    if(local.length===11&&local.slice(2,4)==='15')local=local.slice(0,2)+local.slice(4);
    digits='549'+local;
  }else if(digits.length===10||digits.length===12&&digits.slice(2,4)==='15'){
    if(digits.length===12)digits=digits.slice(0,2)+digits.slice(4);
    digits='549'+digits;
  }
  return /^\d{10,15}$/.test(digits)?digits:'';
}

export function matchProspect(prospects,phone) {
  const key=phoneKey(phone);
  if(!key)return null;
  const matches=prospects.filter(p=>phoneKey(p.whatsapp)===key);
  return matches.length===1?matches[0]:null;
}

export function classify(messages,now=Date.now()) {
  const ordered=messages.slice().sort((a,b)=>a.timestamp-b.timestamp);
  const last=ordered.at(-1);
  const incoming=ordered.filter(m=>m.direction==='in');
  const outgoing=ordered.filter(m=>m.direction==='out');
  const text=String(incoming.at(-1)?.text||'').toLowerCase();
  const offer=outgoing.some(m=>/\b(presupuesto|cotizaci[oó]n|propuesta|\$\s*\d|usd\s*\d|u\$s\s*\d)\b/i.test(m.text));
  const interest=/\b(precio|cu[aá]nto|presupuesto|cotizaci[oó]n|reuni[oó]n|llamada|me interesa|quiero|contratar|podemos avanzar|envi[aá]me)\b/i.test(text);
  const declined=/\b(no me interesa|no contactar|no escrib[ai]s m[aá]s|no quiero|dame de baja)\b/i.test(text);
  const awaiting=last?.direction==='in'&&!declined;
  const due=last?.direction==='out'&&!declined&&now-last.timestamp>=48*3600000;
  const priority=declined?'no-contactar':interest&&awaiting?'alta':awaiting||due?'media':'baja';
  return {replyDetected:incoming.length>0,offerSent:offer,awaitingReply:awaiting,followupDue:Boolean(due),opportunity:interest&&!declined,priority,reason:declined?'Pidió no continuar':interest?'Consulta con intención comercial':awaiting?'Respondió y espera respuesta':due?'Seguimiento pendiente por más de 48 horas':'Sin acción urgente'};
}

export function normalizeMessages(input) {
  if(!Array.isArray(input)||input.length>80)throw Error('Mensajes inválidos');
  const seen=new Set();
  return input.map(m=>{
    const id=String(m?.id||'');
    const direction=m?.direction;
    const timestamp=Number(m?.timestamp);
    const text=String(m?.text||'').trim();
    if(!/^[\w:.-]{1,160}$/.test(id)||seen.has(id)||!['in','out'].includes(direction)||!Number.isSafeInteger(timestamp)||timestamp<946684800000||timestamp>Date.now()+300000||!text||text.length>4000)throw Error('Mensaje inválido');
    seen.add(id);
    return {id,direction,timestamp,text};
  }).sort((a,b)=>a.timestamp-b.timestamp);
}

export function messageHash(messages) {
  return crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex');
}

export function draftFor(prospect,state) {
  const name=String(prospect.name||'').trim();
  const first=String(state.messages.filter(m=>m.direction==='in').at(-1)?.text||'').trim();
  if(!first)return '';
  if(state.analysis.priority==='no-contactar')return '';
  if(state.analysis.opportunity)return `Hola, gracias por responder. Vi tu consulta sobre ${String(prospect.recommendedService||'la propuesta').toLowerCase()}. Para prepararte algo concreto, ¿me contás qué objetivo tenés y qué parte te gustaría resolver primero? Así te comparto una opción ajustada a ${name}.`;
  return `Hola, gracias por responder. Leí tu mensaje y quería retomar lo que hablamos sobre ${String(prospect.recommendedService||'tu proyecto').toLowerCase()}. ¿Qué necesitarías resolver primero para que tenga sentido avanzar?`;
}
