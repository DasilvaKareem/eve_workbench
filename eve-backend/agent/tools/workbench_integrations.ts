import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { integrationStatuses } from '../lib/integrations.ts';

export default defineTool({
  description: 'List real app connection status, or open the Eve integrations panel so the user can add, authorize, or disconnect an app. Never collect passwords or API tokens in chat.',
  inputSchema: z.object({ operation: z.enum(['list', 'open']) }),
  async execute({ operation }) { return { apps: await integrationStatuses(), openIntegrations: operation === 'open' }; },
});
