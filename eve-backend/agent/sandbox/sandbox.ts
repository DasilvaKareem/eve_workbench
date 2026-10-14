import { defineSandbox } from 'eve/sandbox';
import { JustBashSandbox } from 'eve/sandbox/just-bash';
import { VercelSandbox } from 'eve/sandbox/vercel';
import { installAgentBrowser } from '@agent-browser/eve/sandbox';
import { browserAvailable, browserViewerToken } from '../lib/workbench-auth';
import { browserRelaySource } from '../lib/browser-relay-source';

// Local planning/task tools need no native processes. Deployed builds use Vercel VMs.
export const environment = browserAvailable()
  ? VercelSandbox.environment({
    ports: [3001],
    tags: { workbench: 'browser-v1' },
    async prepare(sandbox) {
      // The install helper's old structural type still requires an id; installation
      // itself only uses run(). The fixed browser session below avoids that API drift.
      await installAgentBrowser({ id: 'template', run: options => sandbox.run(options) }, { installSpec: 'agent-browser@0.39.1' });
      await sandbox.writeTextFile({ path: '.eve/browser-relay.mjs', content: browserRelaySource });
      await sandbox.writeTextFile({ path: '.eve/browser-bin', content: '#!/bin/sh\nexport AGENT_BROWSER_STREAM_PORT=9223\nexport AGENT_BROWSER_STREAM_QUALITY=55\nexport AGENT_BROWSER_STREAM_MAX_WIDTH=1280\nexport AGENT_BROWSER_STREAM_MAX_HEIGHT=720\nexec agent-browser "$@"\n' });
      const result = await sandbox.run({ command: 'chmod 700 /workspace/.eve/browser-bin' });
      if (result.exitCode !== 0) throw new Error('Could not prepare the browser executable.');
    },
  })
  : JustBashSandbox.environment({ autoInstall: false });

export default defineSandbox(async ({ session }) => {
  const sandbox = await environment.open();
  if (browserAvailable()) {
    await sandbox.writeTextFile({ path: '.eve/browser-viewer-token', content: browserViewerToken(session.id) });
    const result = await sandbox.run({ command: 'chmod 600 /workspace/.eve/browser-viewer-token && (nohup node /workspace/.eve/browser-relay.mjs >/tmp/eve-browser-relay.log 2>&1 </dev/null &)' });
    if (result.exitCode !== 0) throw new Error('Could not start the browser viewer.');
  }
  return sandbox;
});
