import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveBrief,recentBriefs} from '../lib/coaching';
import {read,keys,write} from '../lib/store';
import type {SavedBrief} from '../lib/schema';
import {reportMarkdown} from '../lib/report-markdown';
test('live pointers retain five recent turns, retry safely, and preserve the complete report history',async()=>{
 process.env.DATA_DIRECTORY=await mkdtemp(join(tmpdir(),'coaching-speed-'));
 try{
  const brief={headline:'Scope',importance:'uncertain',urgency:'uncertain',rationale:'Unknown',evidence:'Reported',changed:'No material change',nextQuestion:'Which journey?',suggestedResponse:'ask what they tested.',capability:'Unknown',owner:'Unknown',references:[],followUps:[]} as const;
  const make=(n:number)=>({id:'brief-'+n,callId:'call',turnId:String(n),createdAt:new Date(n*1000).toISOString(),brief:{...brief,references:[],followUps:[]}} as SavedBrief);
  await write('calls/call/briefs/brief-0.json',make(0));
  assert.equal((await recentBriefs('call')).length,1,'old calls migrate from their saved cards');
  for(let i=1;i<=7;i++)await saveBrief('call',make(i));
  await saveBrief('call',make(7));
  assert.deepEqual((await recentBriefs('call')).map(b=>b.id),['brief-3','brief-4','brief-5','brief-6','brief-7']);
  assert.equal((await keys('calls/call/briefs/')).length,8);
  assert.equal((await read<SavedBrief>('calls/call/latest-brief.json'))?.id,'brief-7');
 }finally{await rm(process.env.DATA_DIRECTORY,{recursive:true,force:true});delete process.env.DATA_DIRECTORY;}
});
test('download includes preliminary live advice as distinct from full analysis',()=>{
 const md=reportMarkdown({id:'call',title:'Test',createdAt:'today'},[],[],[{id:'hint',createdAt:'today',advice:'I do not have that detail yet.'}]);
 assert.match(md,/Live suggestions \(preliminary\)/);assert.match(md,/I do not have that detail yet/);assert.match(md,/later coaching may refine or correct/);
});
