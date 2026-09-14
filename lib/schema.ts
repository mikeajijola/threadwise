import { z } from 'zod';
export const id = z.string().uuid();
export const segmentSchema = z.object({ id, text: z.string().trim().min(1).max(12000), source: z.enum(['microphone', 'tab-audio', 'transcript', 'operator']), capturedAt: z.string().datetime(), utteranceId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/).optional(), provisional: z.boolean().optional() }).strict();
export const briefSchema = z.object({
  headline: z.string().max(160),
  importance: z.enum(['high', 'lower', 'uncertain']),
  urgency: z.enum(['now', 'can-wait', 'uncertain']),
  rationale: z.string().max(3000).describe('For live coaching, one brief phrase about consequence and timing (around 8 words).'),
  evidence: z.string().max(3000).describe('For live coaching, around 15 words distinguishing reports, observations and unknown scope.'),
  changed: z.string().max(3000).describe('A short phrase on what changed, or No material change.'),
  nextQuestion: z.string().max(1500).describe('One short clarifying question the operator could ask (around 12 words in live coaching).'),
  suggestedResponse: z.string().max(3000).describe('Private advice to the operator, around 25 words during live coaching. Admit missing evidence and suggest one useful question. Describe issues plainly; no internal tags unless spoken. More detail is allowed for an explicitly requested summary. Never overstate agreement.'),
  capability: z.string().max(1000).describe('What needs to work; not a person or team name.'),
  owner: z.string().max(1000).describe('A proposed owner only when supported by the conversation.'),
  references: z.array(z.string().max(160)).max(8),
  followUps: z.array(z.string().max(350)).max(6),
}).strict();
export type Brief = z.infer<typeof briefSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export function latestTranscript(segments: Segment[]): Segment[] {
  const latest = new Map<string, Segment>();
  for (const segment of [...segments].sort((a,b) => a.capturedAt.localeCompare(b.capturedAt))) {
    const key = segment.utteranceId ? 'utterance:' + segment.utteranceId : 'segment:' + segment.id;
    const previous = latest.get(key);
    if (previous?.provisional === false && segment.provisional === true) continue;
    latest.set(key,segment);
  }
  return [...latest.values()].sort((a,b) => a.capturedAt.localeCompare(b.capturedAt));
}
export interface SavedBrief { id: string; callId: string; turnId: string; batchId?: string; createdAt: string; brief: Brief }
export interface Call { id: string; title: string; createdAt: string; memoryId?: string }
export interface Knowledge { version: string; syncedAt: string; documents: { id: string; name: string; text: string }[]; baseline: string }
export interface Note { id: string; createdAt: string; text: string }
export function sameOrigin(request: Request) { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }
