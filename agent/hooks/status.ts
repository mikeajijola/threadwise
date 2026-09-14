import { defineHook } from 'eve/hooks';
import { read, write } from '../../lib/store';
export default defineHook({ events: {
  async '*'(event, ctx) {
    if (!ctx.session.auth.initiator?.attributes.callId) return;
    if (['turn.started','session.waiting','session.completed','turn.failed','input.requested','input.resolved','turn.cancelled'].includes(event.type)) {
      const key = `sessions/${ctx.session.id}/status.json`;
      if (event.type === 'session.waiting' && (await read<{requestId?: string}>(key))?.requestId) return;
      const request = event.type === 'input.requested' ? (event.data as any)?.requests?.find((r: any) => r.kind === 'session-limit') : null;
      const status = { automatic: ctx.session.auth.current?.attributes.automatic==='true', type: event.type, batchId: ctx.session.auth.current?.attributes.batchId, at: new Date().toISOString(), ...(request ? { requestId: request.requestId } : {}) };
      await Promise.all([write(key,status),write(`calls/${ctx.session.auth.initiator.attributes.callId}/live-status.json`,status)]);
    }
  },
} });
