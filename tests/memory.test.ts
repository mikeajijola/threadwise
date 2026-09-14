import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { read, write } from '../lib/store';
import { knowledge, currentContext, memoryForCall, memorySpaces, requireMemory, rememberCall, callMemories } from '../lib/knowledge';

test('empty memory works and remembered calls stay scoped across sessions', async()=>{
  process.env.DATA_DIRECTORY=await mkdtemp(join(tmpdir(),'copilot-memory-'));
  try {
    assert.equal((await knowledge()).baseline,'');
    assert.deepEqual((await memorySpaces()).map(m=>m.id),['general']);
    const other=randomUUID();await write(`memories/${other}/space.json`,{id:other,name:'Project B',createdAt:'today'});
    const a=randomUUID(),b=randomUUID();
    await write(`calls/${a}/call.json`,{id:a,title:'Planning call',createdAt:'today',memoryId:'general'});
    await write(`calls/${b}/call.json`,{id:b,title:'Follow-up',createdAt:'today',memoryId:'general'});
    const seg=randomUUID();await write(`calls/${a}/segments/${seg}.json`,{id:seg,text:'Target Friday, pending approval.',source:'transcript',capturedAt:'2026-09-14T12:00:00Z'});
    await write(`calls/${a}/briefs/speculative.json`,{brief:{suggestedResponse:'Invented agreement'}});
    assert.equal((await callMemories('general')).length,0,'calls are not silently promoted to shared memory');
    await rememberCall(a);await rememberCall(a);
    assert.equal((await callMemories('general')).length,1,'retry replaces one call snapshot');
    const context=await currentContext(await memoryForCall(b));
    assert.match(context,/Target Friday, pending approval/);
    assert.doesNotMatch(context,/Invented agreement/);
    assert.doesNotMatch(await currentContext(other),/Target Friday/);
    await assert.rejects(requireMemory('../knowledge'));
    await assert.rejects(requireMemory(randomUUID()),/not found/);
    await assert.rejects(rememberCall(b),/no saved transcript/);
  } finally { await rm(process.env.DATA_DIRECTORY,{recursive:true,force:true});delete process.env.DATA_DIRECTORY; }
});
