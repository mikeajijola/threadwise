import { defineAgent } from 'eve';
export default defineAgent({
  model: 'anthropic/claude-sonnet-5',
  reasoning: 'none',
  defaultTools: false,
  compaction: { thresholdPercent: 0.7 },
  limits: { maxInputTokensPerSession: 4_000_000, maxOutputTokensPerSession: 100_000, sessionTimeoutMs: 14_400_000 },
});
