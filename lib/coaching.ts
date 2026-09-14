import { read, write, keys } from './store';
import type { SavedBrief } from './schema';
export interface LiveHint { id: string; batchId?: string; createdAt: string; advice: string; automatic?: boolean }
export async function recentBriefs(callId: string): Promise<SavedBrief[]> {
  const index=await read<SavedBrief[]>(`calls/${callId}/recent-briefs.json`);
  if(index)return index;
  const older=(await Promise.all((await keys(`calls/${callId}/briefs/`)).map(k=>read<SavedBrief>(k)))).filter((b):b is SavedBrief=>!!b);
  return older.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-5);
}
export async function saveBrief(callId: string, brief: SavedBrief) {
  // Eve serializes this call's turns. Fixed-size pointers keep live reads independent of call length.
  const recent=(await recentBriefs(callId)).filter(b=>b.id!==brief.id).concat(brief).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(-5);
  await Promise.all([
    write(`calls/${callId}/briefs/${brief.id}.json`,brief),
    write(`calls/${callId}/latest-brief.json`,brief),
    write(`calls/${callId}/recent-briefs.json`,recent),
  ]);
}
