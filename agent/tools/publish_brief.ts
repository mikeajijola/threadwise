import { defineTool } from 'eve/tools';
import { briefSchema, id } from '../../lib/schema';
import { saveBrief } from '../../lib/coaching';
export default defineTool({
  description: 'Publish one private live coaching card for you. Records the decision loop, evidence, next question and suggested response. Does not send anything to participants or change the backlog.',
  inputSchema: briefSchema,
  async execute(brief, ctx) {
    const callId = id.parse(ctx.session.auth.initiator?.attributes.callId);
    const recordId = `${ctx.session.id}-${ctx.session.turn.id}`;
    await saveBrief(callId, { id: recordId, callId, turnId: ctx.session.turn.id, batchId: id.optional().parse(ctx.session.auth.current?.attributes.batchId), createdAt: new Date().toISOString(), brief });
    return { saved: true };
  },
});
