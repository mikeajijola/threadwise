import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { documents, currentContext, memoryForCall } from '../../lib/knowledge';
import { id as callIdSchema } from '../../lib/schema';
export default defineTool({
  description: 'Read a source document in this call’s attached memory. Use document IDs from supplied context or search_memory. context returns current memory. Optional query locates a passage.',
  inputSchema: z.object({ id: z.string().max(100), query: z.string().max(200).optional() }),
  async execute({ id, query },ctx) {
    const space=await memoryForCall(callIdSchema.parse(ctx.session.auth.initiator?.attributes.callId));
    if(id==='context')return {context:await currentContext(space)};
    const doc=(await documents(space)).find(d=>d.id===id);
    if(!doc)return {error:'Document not found in attached memory'};
    const found=query?doc.text.toLowerCase().indexOf(query.toLowerCase()):0;
    const start=Math.max(0,found-1500);
    return {name:doc.name,queryFound:found>=0,text:doc.text.slice(start,start+24000),truncated:doc.text.length>start+24000};
  },
});
