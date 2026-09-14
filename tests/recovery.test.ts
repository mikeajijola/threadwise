import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { page } from '../ui/page';

// Exercise the shipped dashboard script across document lifetimes with shared session storage.
const script=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('const $='))!;
function browser(storage=new Map<string,string>(), capture=true) {
  const nodes=new Map<string,any>(), listeners=new Map<string,Function>();
  const node=(id:string)=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',hidden:false,disabled:false,dataset:{},style:{},addEventListener(){},setAttribute(){},replaceChildren(){},append(){},add(){}});return nodes.get(id);};
  let audio:any; const sent:any[]=[]; const calls:any[]=[];
  class Capture {
    run:any=null; callbacks:any;
    static tabSupport(){return {supported:true,reason:'supported'};}
    constructor(callbacks:any){this.callbacks=callbacks;audio=this;}
    snapshot(){}
    async startTab(both:boolean){this.run={both};this.callbacks.onState({phase:'listening',mode:'tab-and-microphone'});}
    async stop(){this.run=null;this.callbacks.onState({phase:'off',reason:'Stopped'});}
  }
  const context:any={document:{getElementById:node,createElement:()=>node(randomUUID()),title:''},
    location:{href:'https://example.test/?call=call-1'+(capture?'&capture=1':'')},history:{replaceState(){}},
    sessionStorage:{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)},
    BroadcastChannel:class{onmessage:any;postMessage(value:any){sent.push(value);}},
    CopilotAudioCapture:Capture,crypto:{randomUUID},URL,Option:class{},Date,Error,
    setInterval(){},setTimeout(){},addEventListener:(name:string,fn:Function)=>listeners.set(name,fn),
    fetch:async(path:string,options:any)=>{calls.push({path,options});return {ok:true,json:async()=>({documents:[],notes:[],calls:[],baseline:'',call:{title:'Test',createdAt:new Date().toISOString()},segments:[],briefs:[]})};},
    open:()=>({location:{href:'https://example.test/?call=call-1&capture=1',replace(){throw Error('Existing capture window must not navigate');}},focus(){}}),
  };context.window=context;runInNewContext(script,context);
  return {storage,nodes,node,audio,sent,calls,listeners,run:(code:string)=>runInNewContext(code,context),context};
}
test('reload restores pending segment IDs, private draft and analysis state for the same call', async()=>{
  const first=browser();await first.run("selectCall('call-1')");
  first.node('input').value='A private question not yet sent';
  first.run("add('Unsent captured speech','tab-audio',{utteranceId:'speech-1',provisional:true});analysing=true;activeBatch='previous-batch';startedAt=123;persist()");
  const id=first.run('pending[0].id');
  const next=browser(first.storage);await next.run("selectCall('call-1')");
  assert.equal(next.run('pending[0].id'),id);assert.equal(next.run('pending[0].provisional'),true);
  assert.equal(next.node('input').value,'A private question not yet sent');
  assert.equal(next.run('activeBatch'),'previous-batch');assert.equal(next.run('analysing'),true);
  const other=browser(first.storage);await other.run("selectCall('call-2')");
  assert.equal(other.run('pending.length'),0);assert.equal(other.node('input').value,'');
  const dashboard=browser(first.storage,false);await dashboard.run("selectCall('call-1')");
  assert.equal(dashboard.run('pending.length'),0,'dashboard does not replay capture window queue');
});
test('successful retry removes pending items only after acknowledgement and preserves IDs on failure', async()=>{
  const b=browser();await b.run("selectCall('call-1')");b.run("add('Queued speech','tab-audio')");
  const id=b.run('pending[0].id');b.context.fetch=async()=>{throw Error('offline');};await b.run('flush()');
  assert.equal(b.run('pending[0].id'),id);
  let delivered:any;b.context.fetch=async(path:string,options:any)=>{if(options?.method==='POST')delivered=JSON.parse(options.body);return {ok:true,json:async()=>({documents:[],notes:[],calls:[],baseline:'',call:{title:'Test',createdAt:new Date().toISOString()},segments:[],briefs:[]})};};
  await b.run('flush()');assert.equal(delivered.segments[0].id,id);assert.equal(b.run('pending.length'),0);
  assert.equal(JSON.parse(b.storage.get('copilot-recovery-capture-call-1')!).pending.length,0);
});
test('capture reload offers resume without requesting media; explicit Stop clears capture intent', async()=>{
  const first=browser();await first.run("selectCall('call-1');audio.startTab(true)");
  assert.equal(first.audio.run.both,true);
  const next=browser(first.storage);await next.run("selectCall('call-1')");
  assert.equal(next.audio.run,null);assert.equal(next.node('shareAudio').textContent,'Resume meeting audio');
  assert.match(next.node('micStatus').textContent,/select the meeting tab again/);
  await next.run('stopCapture()');const stopped=browser(next.storage);await stopped.run("selectCall('call-1')");
  assert.equal(stopped.run('captureWanted'),false);
});
test('dashboard refresh requests capture status and reopens the existing audio window without reloading it', async()=>{
  const b=browser(new Map(),false);await b.run("selectCall('call-1')");
  assert.ok(b.sent.some(m=>m.type==='query'));
  await b.run("audioChannel.onmessage({data:{type:'status',callId:'call-1',active:true,message:'Transcribing'}})");
  assert.equal(b.node('shareAudio').textContent,'Open audio window');assert.equal(b.node('stop').disabled,false);
  assert.equal(b.node('savedCalls').disabled,true);b.run('openAudioWindow()');assert.equal(b.audio.run,null);
  await b.run('stopCapture()');assert.ok(b.sent.some(m=>m.type==='stop'));
});

test('switching calls keeps each private draft scoped to its original call', async()=>{
  const b=browser();await b.run("selectCall('call-1')");
  b.node('input').value='Only for the first call';b.run('persist()');
  await b.run("selectCall('call-2')");assert.equal(b.node('input').value,'');
  await b.run("selectCall('call-1')");assert.equal(b.node('input').value,'Only for the first call');
});

test('new speech schedules a prompt upload without waiting for a periodic batch timer', async()=>{
  const b=browser();await b.run("selectCall('call-1')");
  const timers:{fn:Function,ms:number}[]=[];b.context.setTimeout=(fn:Function,ms:number)=>{timers.push({fn,ms});return timers.length;};
  b.run("add('First speech','tab-audio');add('Next speech','tab-audio')");
  assert.equal(timers.length,1,'new speech does not postpone the first upload');
  assert.equal(timers[0].ms,250);timers[0].fn();
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(b.calls.some(c=>c.options?.method==='POST'));
});
test('quick advice is visible before the full card and disappears when its card arrives', async()=>{
  const b=browser();await b.run("selectCall('call-1')");
  const hint={id:'hint-1',batchId:'batch-1',createdAt:new Date().toISOString(),advice:'ask which user journey they tested.'};
  b.context.fetch=async()=>({ok:true,json:async()=>({documents:[],notes:[],calls:[],baseline:'',call:{title:'Test',createdAt:new Date().toISOString()},hint,status:{type:'turn.started',batchId:'batch-1',at:hint.createdAt},latestBrief:null})});
  await b.run('refresh()');assert.equal(b.node('liveHint').hidden,false);assert.equal(b.node('hintText').textContent,hint.advice);
  const brief={headline:'Check scope',importance:'uncertain',urgency:'uncertain',suggestedResponse:'ask about both sessions.',nextQuestion:'Which session?',rationale:'Unknown',changed:'No material change',evidence:'Report only',capability:'Unknown',owner:'Unknown',followUps:[],references:[]};
  b.context.fetch=async()=>({ok:true,json:async()=>({documents:[],notes:[],calls:[],baseline:'',call:{title:'Test',createdAt:new Date().toISOString()},hint,status:{type:'session.waiting',batchId:'batch-1'},latestBrief:{id:'brief-1',batchId:'batch-1',createdAt:hint.createdAt,brief}})});
  await b.run('refresh()');assert.equal(b.node('liveHint').hidden,true);assert.equal(b.run('analysing'),false);
  b.context.fetch=async()=>({ok:true,json:async()=>({documents:[],notes:[],calls:[],baseline:'',call:{title:'Test',createdAt:hint.createdAt},segments:[],briefs:[]})});
  await b.run('refresh()');assert.equal(b.node('liveHint').hidden,true,'a slower history read must not replace the newly published card with older history');assert.equal(b.run('lastData.briefs.at(-1).id'),'brief-1');
});

test('speech is saved during an active analysis and only the latest speech drives the next automatic suggestion',async()=>{
 const b=browser();await b.run("selectCall('call-1');analysing=true;activeBatch='older'");
 for(let i=0;i<16;i++)b.run("add('Spoken point "+i+"','tab-audio')");
 await b.run('flush()');
 assert.equal(b.run('pending.length'),0);assert.equal(b.run('suggestions.length'),16);
 const writes=b.calls.filter(c=>c.options?.method==='POST').map(c=>JSON.parse(c.options.body));
 assert.equal(writes.length,1);assert.equal(writes[0].mode,'save');
 b.run('analysing=false');await b.run('flush()');
 const request=JSON.parse(b.calls.filter(c=>c.options?.method==='POST').at(-1).options.body);
 assert.equal(request.mode,'suggest');assert.equal(request.segments.length,12);
 assert.equal(request.segments.at(-1).text,'Spoken point 15');assert.equal(b.run('suggestions.length'),0);
});
test('automatic hint completes a voice turn without waiting for a full analysis card',async()=>{
 const b=browser();await b.run("selectCall('call-1')");b.run("add('We have half the engineers now','tab-audio');flush()");
 const batchId=b.run('activeBatch');const at=new Date().toISOString();
 b.context.fetch=async()=>({ok:true,json:async()=>({documents:[],notes:[],calls:[],baseline:'',call:{title:'Test',createdAt:at},hint:{id:'h',batchId,automatic:true,createdAt:at,advice:'ask which fixed commitments the reduced capacity still covers.'},status:{type:'session.waiting',batchId,automatic:true},latestBrief:null})});
 await b.run('refresh()');assert.equal(b.run('analysing'),false);assert.equal(b.node('liveHint').hidden,false);
 assert.ok(!b.node('error').textContent.includes('without a coaching card'));
});
test('saved speech awaiting a suggestion survives refresh, and unchanged final wording does not retrigger it',async()=>{
 const b=browser();await b.run("selectCall('call-1');analysing=true;add('What should we protect first','tab-audio',{utteranceId:'one',provisional:true});saveSpeech()");
 const restored=browser(b.storage);await restored.run("selectCall('call-1')");assert.equal(restored.run('suggestions.length'),1);
 restored.run('analysing=false');await restored.run('flush()');
 restored.run("analysing=false;add('What should we protect first','tab-audio',{utteranceId:'one',provisional:false})");await restored.run('flush()');
 const requests=restored.calls.filter(c=>c.options?.method==='POST').map(c=>JSON.parse(c.options.body));
 assert.equal(requests.filter(r=>r.mode==='suggest').length,1,'finalizing unchanged words only saves the transcript');
 assert.equal(requests.filter(r=>r.mode==='save').length,1);
});
test('typed private questions retain the detailed analysis path',async()=>{
 const b=browser();await b.run("selectCall('call-1')");await b.run("add('Review the evidence in detail','operator');flush()");
 const request=JSON.parse(b.calls.find(c=>c.options?.method==='POST').options.body);
 assert.equal(request.mode,'analyse');assert.equal(b.run('activeAutomatic'),false);
});

test('partial delivery retry follows the server batch ID instead of waiting for an already delivered segment',async()=>{
 const b=browser();await b.run("selectCall('call-1')");b.run("add('Question to retry','operator')");
 b.context.fetch=async(path:string,options:any)=>({ok:true,json:async()=>options?.method==='POST'?{accepted:true,batchId:'fresh-batch'}:{call:{title:'Test',createdAt:new Date().toISOString()},segments:[],briefs:[]}});
 await b.run('flush()');assert.equal(b.run('activeBatch'),'fresh-batch');
});
