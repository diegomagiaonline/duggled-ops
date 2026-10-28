import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import handler from '../api/whatsapp.js';

function response(){
  return {headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;return this},status(n){this.statusCode=n;return this},json(data){this.data=data;return this}};
}
test('worker auth, exact matching, idempotent ingest and draft approval',async()=>{
  const oldEnv={...process.env},oldFetch=globalThis.fetch;
  const data=new Map([['duggled:ops:prospects:last-good:v1',JSON.stringify({prospects:[{id:'6',name:'Cliente',whatsapp:'011 15 5555 1234'}]})]]);
  process.env.OPS_WHATSAPP_WORKER_SECRET='a'.repeat(40);
  process.env.UPSTASH_REDIS_REST_URL='https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN='test';
  globalThis.fetch=async (_url,options)=>{
    const [cmd,key,value]=JSON.parse(options.body);
    if(cmd==='GET')return {ok:true,json:async()=>({result:data.get(key)||null})};
    if(cmd==='SET'){data.set(key,value);return {ok:true,json:async()=>({result:'OK'})}}
    throw Error('Unexpected Redis command');
  };
  try{
    let res=response();
    await handler({method:'POST',query:{action:'ingest'},headers:{authorization:'Bearer wrong'},body:{}},res);
    assert.equal(res.statusCode,401);
    const req={method:'POST',query:{action:'ingest'},headers:{authorization:'Bearer '+process.env.OPS_WHATSAPP_WORKER_SECRET},body:{phone:'5491155551234',messages:[{id:'m1',direction:'in',timestamp:Date.now()-1000,text:'¿Cuánto sale?'}]}};
    res=response();await handler(req,res);
    assert.equal(res.statusCode,200);assert.equal(res.data.prospectId,'6');assert.equal(res.data.analysis.priority,'alta');
    res=response();await handler(req,res);assert.equal(res.data.changed,false);
    res=response();await handler({method:'POST',query:{id:'6',action:'draft'},headers:{origin:'https://ops.example.test',host:'ops.example.test'},body:{draft:'Hola, lo reviso.',approved:true}},res);
    assert.equal(res.statusCode,200);assert.equal(res.data.approved,true);
    res=response();await handler({method:'GET',query:{id:'6'},headers:{}},res);
    assert.equal(res.data.draft,'Hola, lo reviso.');
    assert.equal(res.data.approved,true);
  }finally{globalThis.fetch=oldFetch;process.env=oldEnv}
});
test('el QR requiere autenticación del worker y vence; nunca se devuelve a la petición POST',async()=>{
  const oldEnv={...process.env},oldFetch=globalThis.fetch;
  const values=new Map();let ttl;
  process.env.OPS_WHATSAPP_WORKER_SECRET='b'.repeat(40);
  process.env.UPSTASH_REDIS_REST_URL='https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN='test';
  globalThis.fetch=async (_url,options)=>{
    const [cmd,key,value,_ex,seconds]=JSON.parse(options.body);
    if(cmd==='SET'){values.set(key,value);ttl=seconds;return {ok:true,json:async()=>({result:'OK'})}}
    if(cmd==='GET')return {ok:true,json:async()=>({result:values.get(key)||null})};
    throw Error('Unexpected Redis command');
  };
  try{
    const qr='iVBORw0KGgo'+'A'.repeat(110);
    let res=response();await handler({method:'POST',query:{action:'session'},headers:{authorization:'Bearer wrong'},body:{status:'qr',qr}},res);
    assert.equal(res.statusCode,401);
    res=response();await handler({method:'POST',query:{action:'session'},headers:{authorization:'Bearer '+process.env.OPS_WHATSAPP_WORKER_SECRET},body:{status:'qr',qr}},res);
    assert.equal(res.statusCode,200);assert.deepEqual(res.data,{ok:true});assert.equal(ttl,180);
    res=response();await handler({method:'GET',query:{action:'session'},headers:{}},res);
    assert.equal(res.data.qr,qr);
    res=response();await handler({method:'POST',query:{action:'session'},headers:{authorization:'Bearer '+process.env.OPS_WHATSAPP_WORKER_SECRET},body:{status:'connected'}},res);
    assert.equal(res.statusCode,200);assert.equal(ttl,90);
    res=response();await handler({method:'GET',query:{action:'session'},headers:{}},res);
    assert.equal(res.data.qr,undefined);assert.equal(res.data.status,'connected');
  }finally{globalThis.fetch=oldFetch;process.env=oldEnv}
});

test('Ops actualiza el estado de WhatsApp aunque arranque sin conexión',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/waPairPolling=setInterval\(\(\)=>void refreshWaPair\(waPairExpanded\),10000\)/);
  assert.doesNotMatch(html,/if\(!waPairPolling\)waPairPolling=/);
});

test('monitor reads fresh Sheets contacts without waiting for a dashboard visit',async()=>{
  const oldEnv={...process.env},oldFetch=globalThis.fetch;
  const cacheKey='duggled:ops:prospects:last-good:v1';
  const cache=new Map([[cacheKey,JSON.stringify({prospects:[{id:'3',whatsapp:'5491144441111'}]})]]);
  process.env.OPS_WHATSAPP_WORKER_SECRET='c'.repeat(40);
  process.env.UPSTASH_REDIS_REST_URL='https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN='test';
  process.env.APPS_SCRIPT_URL='https://script.google.com/macros/s/example/exec';
  process.env.APPS_SCRIPT_SECRET='example-test-secret';
  let upstreamCalls=0;
  globalThis.fetch=async (url,options={})=>{
    if(String(url).startsWith('https://script.google.com/')){
      upstreamCalls++;
      assert.equal(new URL(String(url)).searchParams.get('key'),'example-test-secret');
      return {ok:true,json:async()=>({prospects:[
        {id:'3',whatsapp:'5491144441111'},
        {id:'59',whatsapp:'5491162262754'}
      ],updatedAt:'2026-10-20T23:00:00Z'})};
    }
    const [command,key,value]=JSON.parse(options.body);
    if(command==='GET')return {ok:true,json:async()=>({result:cache.get(key)||null})};
    if(command==='SET'){cache.set(key,value);return {ok:true,json:async()=>({result:'OK'})}}
    throw Error('Unexpected Redis command');
  };
  try{
    const res=response();
    await handler({method:'GET',query:{action:'contacts'},headers:{authorization:'Bearer '+process.env.OPS_WHATSAPP_WORKER_SECRET}},res);
    assert.equal(res.statusCode,200);
    assert.equal(upstreamCalls,1);
    assert.ok(res.data.phones.includes('5491162262754'));
    assert.equal(JSON.parse(cache.get(cacheKey)).prospects.length,2);
  }finally{globalThis.fetch=oldFetch;process.env=oldEnv}
});

test('monitor keeps the last-good contacts when Sheets is temporarily unavailable',async()=>{
  const oldEnv={...process.env},oldFetch=globalThis.fetch;
  process.env.OPS_WHATSAPP_WORKER_SECRET='d'.repeat(40);
  process.env.UPSTASH_REDIS_REST_URL='https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN='test';
  process.env.APPS_SCRIPT_URL='https://script.google.com/macros/s/example/exec';
  process.env.APPS_SCRIPT_SECRET='example-test-secret';
  globalThis.fetch=async (url,options={})=>{
    if(String(url).startsWith('https://script.google.com/'))return {ok:false,status:503};
    const [command,key]=JSON.parse(options.body);
    assert.equal(command,'GET');
    assert.equal(key,'duggled:ops:prospects:last-good:v1');
    return {ok:true,json:async()=>({result:JSON.stringify({prospects:[{id:'59',whatsapp:'5491162262754'}]})})};
  };
  try{
    const res=response();
    await handler({method:'GET',query:{action:'contacts'},headers:{authorization:'Bearer '+process.env.OPS_WHATSAPP_WORKER_SECRET}},res);
    assert.equal(res.statusCode,200);
    assert.deepEqual(res.data.phones,['5491162262754']);
  }finally{globalThis.fetch=oldFetch;process.env=oldEnv}
});
