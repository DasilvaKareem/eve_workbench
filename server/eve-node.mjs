import { Readable } from 'node:stream';
import { handleEveRequest, MAX_BODY } from './eve-proxy.mjs';

/** Share the same Web Request handler between Vite and Vercel Node Functions. */
export async function serveEveRequest(req, res, env = process.env) {
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  req.on('aborted', () => controller.abort());
  try {
    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.body !== undefined) {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        if (Buffer.byteLength(body) > MAX_BODY) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Message too large.' }));
          return;
        }
      } else {
        const chunks = [];
        let length = 0;
        for await (const chunk of req) {
          length += chunk.length;
          if (length > MAX_BODY) {
            res.writeHead(413, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'Message too large.' }));
            return;
          }
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
    }
    const protocol = env.VERCEL || req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const request = new Request(`${protocol}://${req.headers.host || 'localhost'}${req.url}`, {
      method: req.method, headers: req.headers, body, signal: controller.signal,
    });
    const response = await handleEveRequest(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res);
    else res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'The workbench proxy could not handle this request.' }));
    } else res.destroy();
  }
}
