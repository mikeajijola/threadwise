import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireMemory, knowledgeRoot } from '../lib/knowledge';
import { write } from '../lib/store';
const [memoryId,...files]=process.argv.slice(2);
if(!memoryId||!files.length)throw Error('Usage: npm run knowledge:sync -- <memory-id> <text-or-markdown-file> [...]');
await requireMemory(memoryId);
for(const file of files){
  if(!/\.(txt|md)$/i.test(file))throw Error('Import text or Markdown files. Convert other formats to text first.');
  const text=await readFile(file,'utf8');
  if(!text.trim()||text.length>100000)throw Error('Each document must contain 1–100,000 characters');
  const id=randomUUID();await write(`${knowledgeRoot(memoryId)}/documents/${id}.json`,{id,name:basename(file),text});
  console.log(`Imported ${basename(file)} into ${memoryId}`);
}
