import { localDev, vercelOidc } from 'eve/channels/auth';
import { eveChannel } from 'eve/channels/eve';
import { workbenchService } from '../lib/workbench-auth';

export default eveChannel({
  auth: [workbenchService, vercelOidc(), localDev()],
});
