import { serveEveRequest } from './eve-node.mjs';

export function eveProxy(env) {
  return {
    name: 'eve-workbench-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/api/eve/')) void serveEveRequest(req, res, env);
        else next();
      });
    },
  };
}
