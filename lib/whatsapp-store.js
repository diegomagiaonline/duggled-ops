export async function redis(...args){
  const url=process.env.UPSTASH_REDIS_REST_URL||process.env.PSTASH_REDIS_REST_URL;
  const token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!url||!token)throw Error('Redis no configurado');
  const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(9000)});
  if(!r.ok)throw Error('Redis HTTP '+r.status);
  const data=await r.json();if(data.error)throw Error('Redis '+data.error);
  return data.result;
}
export const recordKey=id=>'duggled:ops:whatsapp:prospect:'+id+':v1';
