import { getTokenResponse, revokeToken } from '@vercel/connect';
import { connect } from '@vercel/connect/eve';
import { workbenchAuthorized } from './workbench-auth.ts';

// Runtime URLs from the official Eve connection registry, not model-authored URLs.
export const integrationCatalog = [
  { id: 'notion', name: 'Notion', description: 'Search and work with pages and databases.', url: 'https://mcp.notion.com/mcp' },
  { id: 'linear', name: 'Linear', description: 'Work with issues, projects, and cycles.', url: 'https://mcp.linear.app/mcp' },
  { id: 'miro', name: 'Miro', description: 'Read and create content on your boards.', url: 'https://mcp.miro.com/' },
  { id: 'sentry', name: 'Sentry', description: 'Investigate errors and project issues.', url: 'https://mcp.sentry.dev/mcp' },
] as const;
export type Integration = typeof integrationCatalog[number];
// This app currently authenticates one private, shared workspace. This is not a per-person login.
export const integrationSubject = { type: 'user' as const, id: 'eve-workbench-owner' };
export const integrationConnector = (app: Integration) => `${new URL(app.url).hostname}/eve-workbench`;
export const integrationToken = (app: Integration) => getTokenResponse(integrationConnector(app), { subject: integrationSubject }, { forceRefresh: true });

const disconnected = (error: unknown) => {
  const value = error as { name?: string; code?: string; status?: number; message?: string };
  return ['NoValidTokenError', 'UserAuthorizationRequiredError', 'ConnectorInstallationRequiredError'].includes(value?.name || '')
    || value?.code === 'no_token' || value?.code === 'user_authorization_required' || value?.status === 404
    || (value?.status === 403 && /not linked to this project/i.test(value.message || ''));
};

export async function integrationStatuses(token = integrationToken) {
  return Promise.all(integrationCatalog.map(async app => {
    let status: 'connected' | 'not_connected' | 'unavailable' = 'not_connected';
    try { await token(app); status = 'connected'; }
    catch (error) { if (!disconnected(error)) status = 'unavailable'; }
    return { id: app.id, name: app.name, description: app.description, status };
  }));
}

export function safeAuthorizationUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (url.hostname === 'vercel.com' || url.hostname.endsWith('.vercel.com')) ? url.href : null;
  } catch { return null; }
}

function callbackUrl() {
  const url = new URL(process.env.WORKBENCH_FRONTEND_URL || 'https://eve-workbench.vercel.app');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) throw new Error('Invalid frontend URL.');
  url.pathname = '/'; url.search = '?integrations=connected'; url.hash = ''; return url.href;
}

const start = async (app: Integration) => {
  // This runs only after the user presses Connect. Status reads never provision a connector.
  const auth = connect({ connector: integrationConnector(app), autoProvision: true, displayName: app.name,
    createSubject: () => integrationSubject });
  return auth.startAuthorization({ principal: integrationSubject, connection: { url: app.url }, callbackUrl: callbackUrl() });
};
const revoke = (app: Integration) => revokeToken(integrationConnector(app), { subject: integrationSubject });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Authenticated UI control plane. Only public status and a consent link leave the server. */
export async function handleIntegrations(request: Request, appId?: string, action?: string,
  dependencies = { statuses: integrationStatuses, start, revoke }) {
  if (!workbenchAuthorized(request)) return json({ error: 'Unauthorized.' }, 401);
  if (request.method === 'GET' && !appId) return json({ apps: await dependencies.statuses(), scope: 'workspace' });
  const app = integrationCatalog.find(item => item.id === appId);
  if (request.method !== 'POST' || !app || !['connect', 'disconnect'].includes(action || '')) return json({ error: 'Unknown integration.' }, 404);
  try {
    if (action === 'disconnect') { await dependencies.revoke(app); return json({ ok: true }); }
    const { challenge } = await dependencies.start(app);
    const url = safeAuthorizationUrl(challenge.url);
    if (!url) return json({ error: 'The sign-in service returned an invalid link.' }, 502);
    return json({ authorization: { appId: app.id, name: app.name, url,
      ...(challenge.userCode ? { userCode: challenge.userCode } : {}),
      ...(challenge.expiresAt ? { expiresAt: challenge.expiresAt } : {}),
    } });
  } catch {
    // SDK errors can include vendor payloads. Never forward them or token material to the UI.
    return json({ error: action === 'disconnect' ? 'Could not disconnect this app. Try again.'
      : 'Could not start sign-in. Check that Vercel Connect is available for this deployment, then try again.' }, 502);
  }
}
