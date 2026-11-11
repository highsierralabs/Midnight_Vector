// Serves a build folder under /some/nested/path/, so an absolute URL in a build fails rather than happening to work.
// node:http on an ephemeral port, so it cannot collide with a sibling.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';

export const NESTED_PREFIX = '/some/nested/path/';

const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
};

export interface DistServer {
  /** The nested root, with a trailing slash. */
  readonly url: string;
  close(): Promise<void>;
}

export function serveDist(folder: string): Promise<DistServer> {
  const root = resolve(folder);
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (!path.startsWith(NESTED_PREFIX)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = join(root, normalize(path.slice(NESTED_PREFIX.length) || 'index.html'));
    if (!(file === root || file.startsWith(root + sep)) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((done) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      done({
        url: `http://127.0.0.1:${port}${NESTED_PREFIX}`,
        close: () => new Promise((closed) => {
          server.closeAllConnections();
          server.close(() => { closed(); });
        }),
      });
    });
  });
}
