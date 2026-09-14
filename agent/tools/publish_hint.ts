import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { id } from '../../lib/schema';
import { read, write } from '../../lib/store';
import type { LiveHint } from '../../lib/coaching';
export default defineTool({
  description: 'Immediately show the operator a short private suggestion before the fuller coaching card. Call this first using the supplied current context; express uncertainty instead of waiting for document research. This is preliminary advice, not a verified decision.',
  inputSchema:z.object({advice:z.string().trim().min(1).max(600).describe('One or two short sentences addressed to the operator, ideally under 25 words. Describe the issue plainly; avoid internal tags unless spoken. Acknowledge missing evidence and suggest one useful clarification.')}),
  async execute({advice},ctx){
    const callId=id.parse(ctx.session.auth.initiator?.attributes.callId);
    const hint={id:`${ctx.session.id}-${ctx.session.turn.id}`,batchId:id.optional().parse(ctx.session.auth.current?.attributes.batchId),createdAt:new Date().toISOString(),automatic:ctx.session.auth.current?.attributes.automatic==='true',advice};
    await Promise.all([write(`calls/${callId}/latest-hint.json`,hint),write(`calls/${callId}/hints/${hint.id}.json`,hint)]);
    const recentKey=`calls/${callId}/recent-hints.json`;
    const recent=await read<LiveHint[]>(recentKey)||[];
    await write(recentKey,[...recent.filter(h=>h.id!==hint.id),hint].slice(-5));
    return {visible:true};
  },
});
