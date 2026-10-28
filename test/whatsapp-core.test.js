import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneKey,matchProspect,classify,normalizeMessages,messageHash,draftFor} from '../lib/whatsapp-core.js';

test('normaliza teléfonos argentinos y rechaza asociaciones ambiguas',()=>{
  assert.equal(phoneKey('+54 9 11 5555 1234'),'5491155551234');
  assert.equal(phoneKey('011 15 5555 1234'),'5491155551234');
  assert.equal(phoneKey('11 5555 1234'),'5491155551234');
  assert.equal(phoneKey('sin teléfono'),'');
  const list=[{id:'1',whatsapp:'011 15 5555 1234'}];
  assert.equal(matchProspect(list,'5491155551234').id,'1');
  assert.equal(matchProspect([...list,{id:'2',whatsapp:'5491155551234'}],'5491155551234'),null);
});

test('detecta intención, presupuesto, espera y no contactar',()=>{
  const now=Date.now();
  const sent={id:'a',direction:'out',timestamp:now-100000,text:'Te envié el presupuesto por USD 300'};
  const reply={id:'b',direction:'in',timestamp:now,text:'Me interesa, ¿podemos tener una llamada?'};
  assert.deepEqual(classify([sent,reply],now),{replyDetected:true,offerSent:true,awaitingReply:true,followupDue:false,opportunity:true,priority:'alta',reason:'Consulta con intención comercial'});
  assert.equal(classify([sent],now+49*3600000).followupDue,true);
  const stop={...reply,text:'No me interesa. No contactar.'};
  assert.equal(classify([sent,stop],now).priority,'no-contactar');
  assert.equal(draftFor({name:'Cliente'}, {messages:[stop],analysis:classify([stop],now)}),'');
  assert.equal(classify([sent,{...stop,timestamp:now-1},reply],now).priority,'alta');
});

test('valida mensajes, duplicados y cambios de contenido',()=>{
  const m={id:'abc-1',direction:'in',timestamp:Date.now()-1000,text:'Hola'};
  assert.deepEqual(normalizeMessages([m]),[m]);
  assert.throws(()=>normalizeMessages([m,m]),/inválido/);
  assert.throws(()=>normalizeMessages([{...m,text:''}]),/inválido/);
  assert.notEqual(messageHash([m]),messageHash([{...m,text:'Hola de nuevo'}]));
});
