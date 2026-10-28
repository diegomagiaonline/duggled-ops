const CACHE_KEY='duggled:ops:prospects:last-good:v1';
const CACHE_TTL=7*24*60*60;
const redisUrl=()=>process.env.UPSTASH_REDIS_REST_URL||process.env.PSTASH_REDIS_REST_URL;
async function redis(...args){
  const endpoint=redisUrl(),token=process.env.UPSTASH_REDIS_REST_TOKEN;
  if(!endpoint||!token)return null;
  const r=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw Error('Redis HTTP '+r.status);
  const data=await r.json();
  if(data.error)throw Error('Redis '+data.error);
  return data.result;
}
async function fromAppsScript(endpoint,secret){
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||url.hostname!=='script.google.com'||!url.pathname.endsWith('/exec'))throw Error('Invalid Apps Script URL');
  url.searchParams.set('key',secret);
  let lastError;
  for(const delay of [18000,22000]){
    try{
      const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(delay),cache:'no-store'});
      if(!r.ok)throw Error('Apps Script HTTP '+r.status);
      const data=await r.json();
      if(data.error||!Array.isArray(data.prospects)||!data.prospects.length)throw Error('Invalid Apps Script response');
      return {prospects:data.prospects,updatedAt:data.updatedAt||new Date().toISOString(),source:'google-sheets'};
    }catch(e){
      lastError=e;
      console.warn('Prospects upstream retry:',e.message);
    }
  }
  throw lastError||Error('Apps Script did not respond');
}
export default async function handler(request,response){
  response.setHeader('Cache-Control','private, no-store, max-age=0');
  response.setHeader('Access-Control-Allow-Methods','GET');
  if(request.method!=='GET')return response.status(405).json({error:'Method not allowed'});
  try{
    if(!process.env.APPS_SCRIPT_URL||!process.env.APPS_SCRIPT_SECRET)throw Error('Apps Script integration is not configured');
    const data=await fromAppsScript(process.env.APPS_SCRIPT_URL,process.env.APPS_SCRIPT_SECRET);
    try{await redis('SET',CACHE_KEY,JSON.stringify(data),'EX',CACHE_TTL)}catch(e){console.warn('Prospects cache write:',e.message)}
    return response.status(200).json(data);
  }catch(error){
    console.error('Prospects integration error:',error.message);
    try{
      const cached=await redis('GET',CACHE_KEY);
      if(cached){
        const data=JSON.parse(cached);
        if(Array.isArray(data.prospects)&&data.prospects.length){
          response.setHeader('X-Ops-Data-State','cached');
          return response.status(200).json({...data,source:'google-sheets-cache',stale:true});
        }
      }
    }catch(e){console.error('Prospects cache read:',e.message)}
    return response.status(503).json({error:'Prospects temporarily unavailable'});
  }
}
