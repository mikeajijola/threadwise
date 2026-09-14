import { read, write, keys } from './store';
import { id, latestTranscript, type Call, type Knowledge, type Note, type Segment } from './schema';

export const GENERAL_MEMORY = 'general';
export function memoryId(value: string) {
  if (value === GENERAL_MEMORY) return value;
  return id.parse(value);
}
export interface MemorySpace { id: string; name: string; createdAt: string }
export async function memorySpaces(): Promise<MemorySpace[]> {
  const saved = (await Promise.all((await keys('memories/')).filter(k => k.endsWith('/space.json')).map(k => read<MemorySpace>(k)))).filter((s): s is MemorySpace => !!s);
  const spaces: MemorySpace[] = [{ id: GENERAL_MEMORY, name: 'General', createdAt: '' }, ...saved];
  return spaces;
}
export async function requireMemory(value: string) {
  memoryId(value);
  if (value === GENERAL_MEMORY) return { id: value, name: 'General', createdAt: '' };
  const space = (await memorySpaces()).find(s => s.id === value);
  if (!space) throw Error('Memory space not found');
  return space;
}
export async function memoryForCall(callId: string) {
  const call = await read<Call>(`calls/${id.parse(callId)}/call.json`);
  if (!call) throw Error('Call not found');
  return memoryId(call.memoryId || GENERAL_MEMORY);
}
export function knowledgeRoot(space = GENERAL_MEMORY) {
  return `memories/${memoryId(space)}`;
}
export async function knowledge(space = GENERAL_MEMORY): Promise<Knowledge> {
  return await read<Knowledge>(`${knowledgeRoot(space)}/current.json`) || { version: 'empty', syncedAt: '', baseline: '', documents: [] };
}
export async function notes(space = GENERAL_MEMORY) {
  return (await Promise.all((await keys(`${knowledgeRoot(space)}/notes/`)).map(k => read<Note>(k)))).filter((n): n is Note => !!n).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
}
export async function documents(space = GENERAL_MEMORY) {
  const legacy = (await knowledge(space)).documents;
  const added = (await Promise.all((await keys(`${knowledgeRoot(space)}/documents/`)).map(k => read<{id:string;name:string;text:string}>(k)))).filter((d): d is {id:string;name:string;text:string} => !!d);
  return [...legacy,...added];
}
export async function callMemories(space = GENERAL_MEMORY) {
  memoryId(space);
  const entries = await Promise.all((await keys(`memories/${space}/calls/`)).map(k => read<{callId:string;title:string;savedAt:string;text:string}>(k)));
  return entries.filter((m): m is NonNullable<typeof m> => !!m).sort((a,b)=>a.savedAt.localeCompare(b.savedAt));
}
export async function rememberCall(callId: string) {
  const space=await memoryForCall(callId);
  const call=(await read<Call>(`calls/${callId}/call.json`))!;
  const segments=latestTranscript((await Promise.all((await keys(`calls/${callId}/segments/`)).map(k=>read<Segment>(k)))).filter((s):s is Segment=>!!s));
  const text=segments.map(s=>`${s.capturedAt} [${s.source}${s.provisional?' draft':''}] ${s.text}`).join('\n');
  if(!text)throw Error('This call has no saved transcript yet');
  // Save evidence, not model suggestions. Each call has an idempotent memory entry.
  const record={callId,title:call.title,savedAt:new Date().toISOString(),text};
  await write(`memories/${space}/calls/${callId}.json`,record);
  return record;
}
export async function currentContext(space = GENERAL_MEMORY) {
  const [data, updates, docs, calls] = await Promise.all([knowledge(space), notes(space), documents(space),callMemories(space)]);
  return JSON.stringify({ memoryId:space, version:data.version, baseline:data.baseline.slice(0,16000), sources:docs.slice(-100).map(({id,name})=>({id,name})), documentExcerpts:docs.slice(-8).map(d=>({id:d.id,name:d.name,text:d.text.slice(0,2000)})), operatorUpdates:updates.slice(-20).map(n=>({...n,text:n.text.slice(0,2000)})), previousCalls:calls.slice(-5).map(c=>({...c,text:c.text.slice(-6000)})) });
}
