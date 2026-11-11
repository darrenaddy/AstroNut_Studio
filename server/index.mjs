#!/usr/bin/env node
// Astrophile Studio — a visual editor for Astro sites.
//   npm start                 edit the bundled starter site in ./site
//   npm start -- ../my-site   edit any other Astro project
import express from 'express';
import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project, httpError, FORM_PRESETS } from './project.mjs';
import { DevServer } from './dev.mjs';
import { Fonts } from './fonts.mjs';
import { imageCheck, fixImage, builtImageCheck, Lighthouse } from './checks.mjs';
import { Assistant, chatgpt, invalidateModels, listModels, publicSettings, saveProviders, saveSettings, setModel } from './ai.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const editorRoot = path.join(here, '..', 'editor');
const projectRoot = path.resolve(process.argv[2] || process.env.ASTROPHILE_PROJECT || path.join(here, '..', 'site'));
const PORT = Number(process.env.PORT) || 4600;

if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
  console.error(`\n  No Astro project found at ${projectRoot}\n  Usage: npm start -- /path/to/astro-project\n`);
  process.exit(1);
}

const project = new Project(projectRoot);
const clients = new Set();
const broadcast = (ev) => {
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(data);
};
const dev = new DevServer(projectRoot, broadcast);
project.routes = () => dev.routes;
const assistant = new Assistant(project);
const fonts = new Fonts(project, process.env.ASTROPHILE_HOME || path.join(here, '..', '.astrophile'));
// Astro reads its config once at start-up, so a config change needs the dev server restarted.
const restartIfConfig = (step) => {
  if (step?.changes?.some((c) => /^astro\.config\./.test(c.file))) dev.restart().catch(() => {});
};
project.on((ev) => broadcast({ ...ev, history: project.historyState() }));

// Tell the UI when files change on disk (from the editor, the AI, or your own code editor).
let fsTimer = null;
chokidar
  .watch([path.join(projectRoot, 'src'), path.join(projectRoot, 'public')], { ignoreInitial: true, ignored: /(^|[/\\])(\.DS_Store|node_modules)/ })
  .on('all', (event, file) => {
    clearTimeout(fsTimer);
    fsTimer = setTimeout(() => broadcast({ type: 'fs', file: project.rel(file), event }), 60);
  });

const app = express();
app.use(express.json({ limit: '20mb' }));

const wrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    if (!e.status) console.error('[astrophile]', e);
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.message || String(e) });
  }
};

const api = express.Router();

api.get('/state', wrap(async () => ({ ...project.state(), dev: dev.info(), ai: await publicSettings() })));

api.get('/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(`data: ${JSON.stringify({ type: 'hello', dev: dev.info(), logs: dev.logs.slice(-300) })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

// ---- source structure + visual edits ---------------------------------------
api.get('/outline', wrap((req) => project.outline(String(req.query.file))));
api.post('/node', wrap((req) => project.nodeInfo(req.body.file, req.body.ref)));
api.post('/op', wrap((req) => project.op(req.body)));
api.post('/placement', wrap((req) => project.placementFor(req.body)));
api.post('/image-placement', wrap((req) => project.imagePlacement(req.body)));
api.get('/fields', wrap((req) => ({ fields: project.fieldsOf(String(req.query.file)) })));
api.post('/undo', wrap(() => {
  const step = project.undo();
  restartIfConfig(step);
  return { step: step?.label ?? null, history: project.historyState() };
}));
api.post('/redo', wrap(() => {
  const step = project.redo();
  restartIfConfig(step);
  return { step: step?.label ?? null, history: project.historyState() };
}));

// ---- raw files ---------------------------------------------------------------
api.get('/file', wrap((req) => ({ path: req.query.path, content: project.read(String(req.query.path)) })));
api.put('/file', wrap((req) => project.transaction(`Edit ${path.basename(req.body.path)}`, () => project.write(req.body.path, req.body.content))));
api.delete('/file', wrap((req) => {
  const file = String(req.query.path);
  if (!/^src\//.test(file)) throw httpError(400, 'Only files in src/ can be deleted here.');
  return project.transaction(`Delete ${path.basename(file)}`, () => project.remove(file));
}));
api.post('/file/rename', wrap((req) => project.renameFile(req.body.from, req.body.to)));
api.post('/file/duplicate', wrap((req) => ({ file: project.duplicateFile(req.body.file) })));

// ---- pages + components ---------------------------------------------------
api.post('/pages', wrap((req) => project.createPage(req.body)));
api.post('/components', wrap((req) => project.createComponent(req.body)));
api.post('/forms', wrap((req) => project.createForm(req.body)));
api.get('/forms/presets', wrap(() => Object.entries(FORM_PRESETS).map(([value, p]) => ({ value, label: p.label }))));

// ---- media -------------------------------------------------------------------
api.post('/media', express.raw({ type: () => true, limit: '60mb' }), wrap((req) => project.saveMedia(decodeURIComponent(String(req.query.name || 'upload')), req.body, req.query.keep === '1')));
api.delete('/media', wrap((req) => project.deleteMedia(String(req.query.file))));

// ---- fonts (declared in astro.config, downloaded and self-hosted by Astro) -----------
api.get('/fonts', wrap(() => fonts.state()));
api.get('/fonts/search', wrap((req) => fonts.search({ q: String(req.query.q || ''), category: String(req.query.category || '') })));
api.put('/fonts', wrap(async (req) => {
  const out = await fonts.setRole(req.body.role, req.body.font);
  await dev.restart();
  return { ...out, ...fonts.state() };
}));

// ---- checks: images while editing, images after building, Lighthouse ---------------
const lighthouse = new Lighthouse(project, process.env.ASTROPHILE_HOME || path.join(here, '..', '.astrophile'), broadcast);
api.get('/checks/images', wrap(() => imageCheck(project)));
api.post('/checks/fix', wrap((req) => fixImage(project, req.body)));
api.get('/checks/built', wrap(() => builtImageCheck(project)));
api.post('/checks/build', wrap(async () => {
  const build = await dev.build();
  return { build, ...(build.ok ? builtImageCheck(project) : { built: false }) };
}));
api.get('/checks/lighthouse', wrap(() => ({ last: lighthouse.last(), pages: lighthouse.pages(), running: lighthouse.running })));
api.post('/checks/lighthouse', wrap((req) => lighthouse.run({ routes: req.body.routes, device: req.body.device })));
api.post('/checks/lighthouse/stop', wrap(() => lighthouse.stop()));

// ---- theme tokens ----------------------------------------------------------
api.put('/theme', wrap((req) => project.transaction('Change theme', () => project.setTheme(req.body.scope, req.body.vars))));

// ---- content collections ----------------------------------------------------
api.get('/content/entry', wrap((req) => project.entry(String(req.query.file))));
api.put('/content/entry', wrap((req) => project.saveEntry(req.body.file, req.body.data, req.body.body)));
api.post('/content/entry', wrap((req) => project.createEntry(req.body.collection, req.body.title)));
api.post('/content/collection', wrap((req) => project.createCollection(req.body.name)));

// ---- dev server / build ----------------------------------------------------
api.post('/dev/restart', wrap(async () => {
  await dev.restart();
  return dev.info();
}));
api.post('/build', wrap(() => dev.build()));

// ---- assistant ---------------------------------------------------------------
api.get('/settings', wrap(() => publicSettings()));
api.put('/settings', wrap((req) => {
  const patch = {};
  for (const k of ['apiKey', 'effort']) if (k in req.body) patch[k] = typeof req.body[k] === 'string' ? req.body[k].trim() : null;
  saveSettings(patch);
  if (req.body.providers) saveProviders(req.body.providers);
  if (req.body.model) setModel(typeof req.body.model === 'string' ? { provider: 'anthropic', id: req.body.model } : req.body.model);
  return publicSettings();
}));
api.get('/ai/models', wrap((req) => listModels(req.query.refresh === '1')));
// "Sign in with ChatGPT": use a ChatGPT plan instead of an API key.
api.get('/ai/chatgpt', wrap(() => chatgpt.status()));
api.post('/ai/chatgpt/signin', wrap(() => chatgpt.startSignIn()));
api.post('/ai/chatgpt/signout', wrap(async () => {
  const out = await chatgpt.signOut();
  invalidateModels();
  return out;
}));
api.post('/ai/chat', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  res.on('close', () => {
    if (!res.writableEnded) assistant.abort();
  });
  try {
    await assistant.chat({ prompt: String(req.body.prompt || ''), context: req.body.context }, send);
  } catch (e) {
    send({ type: 'error', message: e.message });
  }
  res.end();
});
api.post('/ai/stop', wrap(() => assistant.abort()));
api.post('/ai/reset', wrap(() => assistant.reset()));

api.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', api);

// ---- the editor UI (served through Vite so there is no build step) -----------
const { createServer } = await import('vite');
const vite = await createServer({
  root: editorRoot,
  configFile: path.join(editorRoot, 'vite.config.mjs'),
  server: { middlewareMode: true, hmr: { port: PORT + 500 } },
  appType: 'spa',
  logLevel: 'warn',
});
app.use(vite.middlewares);

const server = app.listen(PORT, '127.0.0.1', async () => {
  console.log(`\n  ✦ Astrophile Studio is running\n\n    Editor   http://localhost:${PORT}\n    Project  ${projectRoot}\n`);
  await dev.start();
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `\n  Port ${PORT} is already in use. Try: PORT=4700 npm start\n` : e);
  process.exit(1);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await dev.stop().catch(() => {});
  await vite.close().catch(() => {});
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
