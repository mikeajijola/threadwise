import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Script } from 'node:vm';
import { operatorAuth } from '../lib/auth';
import { sameOrigin, segmentSchema } from '../lib/schema';
import { read, write, keys } from '../lib/store';
import { currentContext } from '../lib/knowledge';
import { reportPdf } from '../lib/report';
import { page } from '../ui/page';

test('operator auth fails closed without configuration and rejects the wrong password', async () => {
  delete process.env.COPILOT_PASSWORD;
  assert.equal(await operatorAuth(new Request('https://example.test')),null);
  process.env.COPILOT_PASSWORD='test-only-secret';
  assert.equal(await operatorAuth(new Request('https://example.test',{ headers:{ authorization:'Bearer wrong' } })),null);
  assert.ok(await operatorAuth(new Request('https://example.test',{ headers:{ authorization:'Bearer test-only-secret' } })));
});
test('cross-origin browser writes and invalid transcript inputs are rejected', () => {
  assert.equal(sameOrigin(new Request('https://example.test',{ headers:{origin:'https://attacker.test'} })),false);
  assert.equal(sameOrigin(new Request('https://example.test',{ headers:{origin:'https://example.test'} })),true);
  assert.equal(segmentSchema.safeParse({id:randomUUID(),text:' ',source:'transcript',capturedAt:new Date().toISOString()}).success,false);
  assert.equal(segmentSchema.safeParse({id:'../private',text:'hello',source:'transcript',capturedAt:new Date().toISOString()}).success,false);
});
test('knowledge refresh observes saved corrections without a restart; storage rejects traversal', async () => {
  process.env.DATA_DIRECTORY=await mkdtemp(join(tmpdir(),'copilot-test-'));
  try {
    await write('memories/general/current.json',{version:'v1',syncedAt:'2026-09-10',baseline:'Task awaiting review',documents:[]});
    assert.match(await currentContext('general'),/Task awaiting review/);
    await write('memories/general/notes/note.json',{id:'note',createdAt:'2026-09-10',text:'Engineering reports a deployment; verification pending.'});
    assert.match(await currentContext('general'),/verification pending/);
    const context=JSON.parse(await currentContext('general'));assert.equal(context.baseline,'Task awaiting review');
    assert.equal((await keys('memories/general/notes/')).length,1);
    await assert.rejects(read('../secret'));
  } finally { await rm(process.env.DATA_DIRECTORY,{recursive:true,force:true}); delete process.env.DATA_DIRECTORY; }
});
test('report produces a genuine PDF containing transcript pages', async () => {
  const call={id:randomUUID(),title:'Verification call',createdAt:new Date().toISOString()};
  const pdf=await reportPdf(call,[{id:randomUUID(),text:'The draft still needs review.',source:'transcript',capturedAt:new Date().toISOString()}],[]);
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-'); assert.ok(pdf.length>1000);
});
test('browser script parses and the public shell does not embed account documents or secrets', () => {
  const scripts=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)]; assert.ok(scripts.length >= 3); for(const [,script] of scripts)new Script(script);
  assert.ok(!page.includes('test-only-secret')); assert.ok(!page.includes('Alice')); assert.ok(page.includes('textContent'));
});
