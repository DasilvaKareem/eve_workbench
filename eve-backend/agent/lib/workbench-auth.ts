import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthFn } from 'eve/channels/auth';

export function workbenchAuthorized(request: Request): boolean {
  const expected = process.env.EVE_API_KEY;
  const value = request.headers.get('authorization');
  if (!expected || expected.length < 32 || !value?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(value.slice(7));
  const key = Buffer.from(expected);
  return provided.length === key.length && timingSafeEqual(provided, key);
}

export const workbenchService: AuthFn<Request> = async request => {
  if (!workbenchAuthorized(request)) return null;
  return { attributes: { workspace: 'personal' }, authenticator: 'workbench-service-key', principalId: 'eve-workbench-owner', principalType: 'service' };
};

export function browserViewerToken(sessionId: string): string {
  const key = process.env.EVE_API_KEY;
  if (!key || key.length < 32) throw new Error('Set EVE_API_KEY to at least 32 characters for browser viewing.');
  return createHmac('sha256', key).update(`eve-workbench.browser.v1:${sessionId}`).digest('base64url');
}

export const browserAvailable = () => Boolean(process.env.VERCEL || process.env.EVE_BROWSER_SANDBOX === 'vercel');
