import { defineSandbox } from 'eve/sandbox';
import { JustBashSandbox } from 'eve/sandbox/just-bash';
import { VercelSandbox } from 'eve/sandbox/vercel';

// Local planning/task tools need no native processes. Deployed builds use Vercel VMs.
export const environment = process.env.VERCEL
  ? VercelSandbox.environment()
  : JustBashSandbox.environment({ autoInstall: false });

export default defineSandbox(() => environment.open());
