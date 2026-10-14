import { serveEveRequest } from '../../server/eve-node.mjs';

export const config = { maxDuration: 300 };
export default function handler(req, res) {
  return serveEveRequest(req, res);
}
