import { defineDynamic, defineMcpClientConnection } from 'eve/connections';
import { integrationCatalog, integrationConnector, integrationStatuses, integrationToken } from '../lib/integrations.ts';

export async function resolveIntegrationConnections(dependencies = { statuses: integrationStatuses, token: integrationToken }) {
  const statuses = await dependencies.statuses();
  const connected = integrationCatalog.filter(app => statuses.some(status => status.id === app.id && status.status === 'connected'));
  if (!connected.length) return null;
  const entries = await Promise.all(connected.map(async app => {
    try {
      const identity = await dependencies.token(app);
      return [app.id, defineMcpClientConnection({
    url: app.url, description: `${app.name}: ${app.description}`, protocolVersionDiscovery: false,
    instanceKey: `workbench:${integrationConnector(app)}:${identity.externalSubject || identity.tokenId || identity.connector?.id || 'workspace'}:${identity.tenantId || ''}:${identity.installationId || ''}`,
    auth: { credentialOwner: 'app', getToken: async () => {
      const value = await dependencies.token(app); return { token: value.token, expiresAt: value.expiresAt };
    } },
    // Ordinary reads run immediately; modifications surface Eve's real approval controls.
    approval: ({ toolAnnotations }) => toolAnnotations?.readOnlyHint === true ? 'not-applicable' : 'user-approval',
      })] as const;
    } catch { return null; }
  }));
  const available = entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  return available.length ? Object.fromEntries(available) : null;
}

export default defineDynamic({ events: { 'turn.started': () => resolveIntegrationConnections() } });
