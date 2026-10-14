import { timingSafeEqual } from 'node:crypto';
import { localDev, vercelOidc, type AuthFn } from 'eve/channels/auth';
import { eveChannel } from 'eve/channels/eve';

// The browser never receives this credential. Only the frontend's proxy uses it.
const workbenchService: AuthFn<Request> = async (request) => {
  const expected = process.env.EVE_API_KEY;
  const value = request.headers.get('authorization');
  if (!expected || expected.length < 32 || !value?.startsWith('Bearer ')) return null;
  const provided = Buffer.from(value.slice(7));
  const key = Buffer.from(expected);
  if (provided.length !== key.length || !timingSafeEqual(provided, key)) return null;
  return { attributes: { workspace: 'personal' }, authenticator: 'workbench-service-key', principalId: 'eve-workbench-owner', principalType: 'service' };
};

export default eveChannel({
  auth: [workbenchService, vercelOidc(), localDev()],
});
