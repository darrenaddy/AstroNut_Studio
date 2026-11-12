// Runs inside the *site's* folder so it uses the site's own copy of Astro.
// Usage: node astro-runner.mjs dev <port> | build
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

import { stampSource } from './astro-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [, , command = 'dev', portArg] = process.argv;
const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));

let astro;
try {
  astro = await import(pathToFileURL(require.resolve('astro')).href);
} catch (e) {
  const pm = fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm';
  console.error(`Could not load Astro from ${root}. Run "${pm} install" in that folder first.\n${e.message}`);
  process.exit(1);
}

// Adds the editor's own source markers to each .astro file as Vite loads it (see stampSource).
function stampPlugin() {
  return {
    name: 'astronut-stamp',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.astro') || id.includes('\0') || id.includes('/node_modules/')) return null;
      try {
        return stampSource(fs.readFileSync(id, 'utf8'), id);
      } catch {
        return null; // unreadable or unparseable: let Astro handle the file as it is
      }
    },
  };
}

// The site-wide stylesheets a component needs when it is previewed on its own. Only the top-level ones:
// a file that another stylesheet @imports is a part of that one, and often can't be loaded by itself.
function stylesPlugin() {
  const id = 'virtual:astronut-styles';
  return {
    name: 'astronut-styles',
    resolveId: (x) => (x === id ? '\0' + id : null),
    load(x) {
      if (x !== '\0' + id) return null;
      const files = [];
      for (const dir of ['src/styles', 'src/assets/styles', 'src/css']) {
        const abs = path.join(root, dir);
        if (!fs.existsSync(abs)) continue;
        for (const name of fs.readdirSync(abs)) if (name.endsWith('.css')) files.push({ name, url: `/${dir}/${name}`, text: fs.readFileSync(path.join(abs, name), 'utf8') });
      }
      const imported = (f) => files.some((o) => o !== f && new RegExp(`@import\\s+(?:url\\()?['"][^'"]*${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(o.text));
      return files.filter((f) => !imported(f)).map((f) => `import ${JSON.stringify(f.url)};`).join('\n') || 'export {};';
    },
  };
}

let base = '/';

function bridge(stamp) {
  return {
    name: 'astronut-bridge',
    hooks: {
      'astro:config:setup'({ injectScript, injectRoute, updateConfig, command }) {
        if (command !== 'dev') return;
        injectScript('head-inline', fs.readFileSync(path.join(here, 'bridge.js'), 'utf8'));
        injectRoute({ pattern: '/__astronut/c/[id]', entrypoint: path.join(here, 'preview/component.astro'), prerender: true });
        injectRoute({ pattern: '/__astronut/probe', entrypoint: path.join(here, 'preview/probe.astro'), prerender: true });
        updateConfig({ vite: { server: { fs: { allow: [here, root] } }, plugins: [stylesPlugin(), ...(stamp ? [stampPlugin()] : [])] } });
      },
      'astro:config:done'({ config }) {
        base = config.base || '/';
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
    const start = (stamp) =>
      astro.dev({
        root,
        server: { port: Number(portArg) || 4601, host: '127.0.0.1' },
        devToolbar: { enabled: true },
        integrations: [bridge(stamp)],
      });
    let server = await start(false);
    // Clicking in the preview depends on Astro marking each element with its source position.
    // Some versions don't; when the probe page comes back unmarked, start again with our own marks.
    const marked = await fetch(`http://127.0.0.1:${server.address.port}${base.replace(/\/?$/, '/')}__astronut/probe`)
      .then((r) => (r.ok ? r.text() : null))
      .then((html) => html == null || /data-astro-source-file="/.test(html))
      .catch(() => true);
    if (!marked) {
      console.log('This version of Astro does not mark elements with their source position, so AstroNut Studio is adding its own marks.');
      await server.stop().catch(() => {});
      server = await start(true);
    }
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
