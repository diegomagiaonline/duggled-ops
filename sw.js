/* Duggled Ops PWA: network-first; never caches prospect or Gmail data. */
self.addEventListener('install',event=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
  let msg={title:'Duggled Ops',body:'Hay novedades en tu panel comercial',url:'/'};
  try{if(event.data)msg={...msg,...event.data.json()}}catch{}
  const url=typeof msg.url==='string'&&msg.url.startsWith('/')&&!msg.url.startsWith('//')?msg.url:'/';
  event.waitUntil(self.registration.showNotification(String(msg.title).slice(0,100),{
    body:String(msg.body||'').slice(0,240),icon:'/icon-192.svg',badge:'/icon-192.svg',tag:msg.tag||'duggled-ops',renotify:true,data:{url}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/',self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    const existing=clients.find(client=>client.url.startsWith(self.location.origin));
    if(existing){return existing.focus().then(()=>existing.navigate(target))}
    return self.clients.openWindow(target);
  }));
});
