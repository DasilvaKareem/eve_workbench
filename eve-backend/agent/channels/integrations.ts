import { defineChannel, GET, POST } from 'eve/channels';
import { handleIntegrations } from '../lib/integrations.ts';

export default defineChannel({ routes: [
  GET('/workbench/integrations', request => handleIntegrations(request)),
  POST('/workbench/integrations/:appId/:action', (request, { params }) => handleIntegrations(request, params.appId, params.action)),
] });
