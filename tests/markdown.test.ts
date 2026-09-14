import {test}from'node:test';import assert from'node:assert/strict';import{reportMarkdown}from'../lib/report-markdown';import type{Segment}from'../lib/schema';
test('Markdown retains Unicode and multiline text and replaces draft utterances',()=>{
 const segments:Segment[]=[{id:'draft',text:'wrong draft',source:'tab-audio',capturedAt:'2026-09-10T10:00:00Z',utteranceId:'same',provisional:true},{id:'final',text:'Is this working?\nMine & theirs — café 🎙️',source:'tab-audio',capturedAt:'2026-09-10T10:00:01Z',utteranceId:'same',provisional:false}];
 const md=reportMarkdown({id:'call',title:'Test',createdAt:'2026-09-10'},segments,[]);assert.ok(md.startsWith('# Call notes'));assert.ok(!md.includes('wrong draft'));assert.ok(md.includes('> Is this working?\n> Mine & theirs — café 🎙️'));assert.ok(md.includes('No coaching saved.'));assert.ok(md.includes('not instructions'));
});
