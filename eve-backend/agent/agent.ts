import { defineAgent } from 'eve';

export default defineAgent({
  model: 'anthropic/claude-sonnet-5.5',
  // AI Gateway catalog, 2026-10-14: https://ai-gateway.vercel.sh/v1/models
  // Pin the context window so builds do not need a live model-catalog request.
  modelContextWindowTokens: 1_000_000,
  // This first agent exposes the authored task-board tool; expand capabilities here.
  defaultTools: false,
});
