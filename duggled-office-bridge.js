/* Duggled Office bridge v2. Read-only, opt-in, exact-origin window messaging. */
(function(){
 'use strict';
 const OFFICE_ORIGIN='https://duggled-agent-office-game.duggledmedia.chatgpt.site';
 globalThis.DuggledOfficeBridge={start(getSummary,source){
  const params=new URLSearchParams(location.search);if(params.get('officeBridge')!=='1')return;
  const channel=params.get('officeChannel');if(!/^[a-f0-9]{32}$/.test(channel||'')||!['ops','hunter'].includes(source))return;
  const office=window.opener;if(!office)return;
  let active=false,closed=false,timer;
  const banner=document.createElement('div');banner.setAttribute('role','region');banner.setAttribute('aria-label','Conexión a Duggled Office');
  Object.assign(banner.style,{position:'fixed',left:'16px',right:'16px',bottom:'16px',zIndex:'2147483000',padding:'15px 18px',background:'#112333',color:'#d9edf5',border:'1px solid #81c5c7',borderRadius:'12px',boxShadow:'0 8px 30px #0008',font:'13px/1.6 system-ui',display:'flex',gap:'14px',alignItems:'center',flexWrap:'wrap'});
  const info=document.createElement('span');info.textContent='Duggled Office solicita los registros de '+(source==='ops'?'prospectos y prioridades':'ofertas y seguimiento local')+'. Incluye fichas, estados y notas de seguimiento. No comparte credenciales, mensajes de correo ni CV.';info.style.flex='1 1 300px';
  const allow=document.createElement('button');allow.type='button';allow.textContent='Compartir con mi oficina';const stop=document.createElement('button');stop.type='button';stop.textContent='Ahora no';
  for(const b of[allow,stop])Object.assign(b.style,{border:'1px solid #80d7d0',borderRadius:'7px',padding:'9px 12px',background:'#1d4a55',color:'#d9edf5',font:'12px system-ui',cursor:'pointer'});
  banner.append(info,allow,stop);document.body.append(banner);
  function post(type,data={}){if(office.closed)return;office.postMessage({type,channel,source,...data},OFFICE_ORIGIN)}
  function send(){if(!active||office.closed||closed)return;try{const data=getSummary();if(JSON.stringify(data).length>8000000)throw Error('Resumen demasiado grande');post('duggled:summary',{data:{...data,generatedAt:new Date().toISOString()}})}catch{post('duggled:source-error',{message:'No se pudo leer el resumen de esta fuente.'})}}
  function disconnect(){active=false;clearInterval(timer);post('duggled:source-disconnected');allow.disabled=false;allow.textContent='Compartir con mi oficina';stop.textContent='Cerrar aviso';info.textContent='Resumen desconectado. No se transmiten cambios a la oficina.'}
  allow.addEventListener('click',()=>{if(closed)return;active=true;allow.disabled=true;allow.textContent='Compartiendo resumen';stop.textContent='Dejar de compartir';info.textContent='Resumen conectado con tu oficina. Mantené esta ventana abierta para sincronizar los cambios.';clearInterval(timer);timer=setInterval(send,5000);send()});
  stop.addEventListener('click',()=>{if(active)disconnect();else{closed=true;banner.remove();post('duggled:source-disconnected')}});
  window.addEventListener('message',event=>{if(event.origin!==OFFICE_ORIGIN||event.source!==office)return;const m=event.data;if(!m||m.channel!==channel||m.source!==source)return;if(m.type==='duggled:request-summary')send();if(m.type==='duggled:disconnect')disconnect()});
  window.addEventListener('pagehide',()=>{clearInterval(timer);post('duggled:source-disconnected')});
  post('duggled:bridge-ready');
 }};
})();
