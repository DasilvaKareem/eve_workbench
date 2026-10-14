import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { browserAvailable } from '../lib/workbench-auth';

export default defineTool({
  description: 'Check whether this Eve deployment supports the real sandbox browser before first using browser tools.',
  inputSchema: z.object({}),
  execute() {
    return { available: browserAvailable(), viewer: 'watch-only', message: browserAvailable()
      ? 'Browser tools are available. The user can watch in the Browser panel.'
      : 'The local just-bash sandbox cannot run Chromium. Use the deployed Vercel backend, or set EVE_BROWSER_SANDBOX=vercel locally with Vercel Sandbox credentials.' };
  },
});
