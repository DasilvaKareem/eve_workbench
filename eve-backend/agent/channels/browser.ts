import { defineChannel, GET } from 'eve/channels';
import { browserFrame } from '../lib/browser-viewer';

export default defineChannel({
  routes: [GET('/workbench/browser/:sessionId/frame', (request, { params }) => browserFrame(request, params.sessionId))],
});
