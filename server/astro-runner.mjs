// Runs inside the *site's* folder so it uses the site's own copy of Astro.
// Usage: node astro-runner.mjs dev <port> | build
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const [, , command = 'dev', portArg] = process.argv;
const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));

let astro;
try {
  astro = await import(pathToFileURL(require.resolve('astro')).href);
} catch (e) {
  console.error(`Could not load Astro from ${root}. Run "npm install" in that folder first.\n${e.message}`);
  process.exit(1);
}

function bridge() {
  return {
    name: 'astronut-bridge',
    hooks: {
      'astro:config:setup'({ injectScript, injectRoute, updateConfig, command }) {
        if (command !== 'dev') return;
        injectScript('head-inline', fs.readFileSync(path.join(here, 'bridge.js'), 'utf8'));
        injectRoute({ pattern: '/__astronut/c/[id]', entrypoint: path.join(here, 'preview/component.astro'), prerender: true });
        updateConfig({ vite: { server: { fs: { allow: [here, root] } } } });
      },
      // Astro's own list of routes — the editor uses it for its page list.
      'astro:routes:resolved'({ routes }) {
        const list = routes.map((r) => ({ pattern: r.pattern, entrypoint: String(r.entrypoint || '').replace(/\\/g, '/'), type: r.type, origin: r.origin, params: r.params }));
        process.send?.({ type: 'routes', routes: list });
      },
    },
  };
}

try {
  if (command === 'build') {
    await astro.build({ root, logLevel: 'info' });
    console.log('__ASTRONUT_BUILD_DONE__');
    process.exit(0);
  } else {
    const server = await astro.dev({
      root,
      server: { port: Number(portArg) || 4601, host: '127.0.0.1' },
      devToolbar: { enabled: true },
      integrations: [bridge()],
    });
    console.log(`__ASTRONUT_READY__ ${server.address.port}`);
    const stop = async () => {
      await server.stop().catch(() => {});
      process.exit(0);
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    process.on('disconnect', stop);
  }
} catch (e) {
  console.error(e?.stack || String(e));
  process.exit(1);
}
