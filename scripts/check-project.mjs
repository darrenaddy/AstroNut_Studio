#!/usr/bin/env node
// Tries AstroNut Studio on an Astro project and reports what works there.
//
//   npm run check -- /path/to/astro-project            a report in the terminal
//   npm run check -- /path/to/astro-project --json     the same as JSON
//   npm run check -- /path/to/astro-project --no-build skip the (slow) build
//
// It starts the editor's own server against the project and makes the same requests the editor
// makes when you click, type, move and delete. Nothing is looked up by name: it asks the editor what
// it found and picks the first page, element, placement and entry of each kind, so a project's own
// naming and folder layout don't matter. Every edit is undone and the project's files are compared
// with a snapshot taken at the start, so the project is left exactly as it was.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith('--')) || '');
const asJson = args.includes('--json');
const withBuild = !args.includes('--no-build');
if (!args.find((a) => !a.startsWith('--')) || !fs.existsSync(path.join(root, 'package.json'))) {
  console.error('Usage: npm run check -- /path/to/astro-project [--json] [--no-build]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const add = (area, name, status, detail = '') => results.push({ area, name, status, detail });

async function freePort(start) {
  for (let p = start; p < start + 300; p++) {
    const ok = await new Promise((res) => {
      const s = net.createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('No free port found');
}

// ---- a snapshot of the project's own files, to prove nothing is left changed ----
function snapshot() {
  const out = new Map();
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.astro', '.git', '.vercel', '.netlify', '.wrangler'].includes(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.set(path.relative(root, abs), crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex'));
    }
  };
  walk(root);
  return out;
}
function changedSince(before) {
  const after = snapshot();
  const out = [];
  for (const [f, h] of after) if (before.get(f) !== h) out.push(before.has(f) ? f : `${f} (new)`);
  for (const f of before.keys()) if (!after.has(f)) out.push(`${f} (deleted)`);
  return out;
}

const before = snapshot();
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'astronut-check-'));
const port = await freePort(4700);
const sitePort = await freePort(port + 50);
const server = spawn(process.execPath, [path.join(here, '..', 'server', 'index.mjs'), root], {
  env: { ...process.env, PORT: String(port), ASTRONUT_SITE_PORT: String(sitePort), ASTRONUT_HOME: settingsDir, ASTRONUT_MOCK_AI: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
server.stdout.on('data', (d) => (serverOut += d));
server.stderr.on('data', (d) => (serverOut += d));

const api = async (method, url, body) => {
  const r = await fetch(`http://127.0.0.1:${port}/api${url}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {}
  if (!r.ok) throw new Error(data?.error || `${r.status} ${text.slice(0, 120)}`);
  return data;
};

let dev = null;
/** Fetch a page of the running site: { status, html, error }. */
async function page(route) {
  try {
    const r = await fetch(dev + route, { redirect: 'follow' });
    const html = await r.text();
    const broken = r.status >= 400 || /<vite-error-overlay|<title>\s*Error|An error occurred\.?<\/h/i.test(html);
    const why = broken ? (/<title>([^<]*)<\/title>/i.exec(html)?.[1] || '').trim() || `HTTP ${r.status}` : '';
    return { status: r.status, html, error: broken ? why : null };
  } catch (e) {
    return { status: 0, html: '', error: e.message };
  }
}
/** Keep fetching a page until `test(html)` holds, for the few seconds hot reload can take. */
async function until(route, test, ms = 8000) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    last = await page(route);
    if (!last.error && test(last.html)) return { ok: true, ...last };
    await sleep(350);
  }
  return { ok: false, ...(last || {}) };
}

/** The marked elements in a page: [{ tag, file, loc }], one per distinct source position. */
function marked(html) {
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)\b([^<>]*data-astro-source-file="[^"]*"[^<>]*)>/g)) {
    const file = /data-astro-source-file="([^"]*)"/.exec(m[2])?.[1];
    const loc = /data-astro-source-loc="([^"]*)"/.exec(m[2])?.[1];
    if (!file || !loc || file.includes('/node_modules/')) continue; // Astro's own components aren't the project's to edit
    const rel = file.startsWith(root) ? file.slice(root.length + 1).split(path.sep).join('/') : null;
    if (!rel || seen.has(rel + '@' + loc)) continue;
    seen.add(rel + '@' + loc);
    out.push({ tag: m[1].toLowerCase(), file: rel, loc });
  }
  return out;
}

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const lineDelta = (a, b) => {
  const A = a.split('\n');
  const B = b.split('\n');
  const inA = new Map();
  for (const l of A) inA.set(l, (inA.get(l) || 0) + 1);
  let same = 0;
  for (const l of B) if (inA.get(l)) (inA.set(l, inA.get(l) - 1), same++);
  return `${B.length - same} added, ${A.length - same} removed`;
};

/**
 * Make one edit the way the editor does, check the site still renders (and `expect`, if given),
 * then undo it and confirm the file is byte-for-byte what it was.
 */
async function edit(name, route, file, op, expect) {
  const was = read(file);
  try {
    await api('POST', '/op', op);
  } catch (e) {
    return add('Editing', name, 'fail', `refused: ${e.message}`);
  }
  const now = read(file);
  const shown = await until(route, expect || (() => true));
  let undone = false;
  try {
    await api('POST', '/undo');
    undone = read(file) === was;
  } catch {}
  await until(route, () => true, 4000);
  if (now === was) return add('Editing', name, 'fail', 'the request succeeded but the file did not change');
  if (shown.error) return add('Editing', name, 'fail', `the page broke after the edit: ${shown.error}`);
  if (!shown.ok) return add('Editing', name, 'fail', 'the change was written but did not show up in the page');
  if (!undone) return add('Editing', name, 'fail', 'undo did not restore the file exactly');
  add('Editing', name, 'pass', `${file} · ${lineDelta(was, now)} · undone cleanly`);
}

async function run() {
  // ---- start-up ----------------------------------------------------------------
  let state = null;
  for (let i = 0; i < 240; i++) {
    if (server.exitCode != null) break;
    try {
      state = await api('GET', '/state');
      if (state.dev.status === 'running' || state.dev.status === 'error') break;
    } catch {}
    await sleep(500);
  }
  if (!state || state.dev.status !== 'running') {
    add('Start-up', 'The site’s preview starts', 'fail', (serverOut.trim().split('\n').slice(-3).join(' | ') || 'the dev server did not come up').slice(0, 300));
    return;
  }
  dev = state.dev.url.replace('localhost', '127.0.0.1');
  let astro = '?';
  try {
    astro = JSON.parse(fs.readFileSync(fs.realpathSync(path.join(root, 'node_modules/astro/package.json')), 'utf8')).version;
  } catch {}
  const p = state.project;
  add('Start-up', 'The site’s preview starts', 'pass', `Astro ${astro} · ${p.packageManager} · ${p.tailwind ? 'Tailwind' : 'no Tailwind'}`);
  if (p.devScript) add('Start-up', 'Start command is plain “astro dev”', 'info', `it is: ${p.devScript}`);

  // ---- pages ---------------------------------------------------------------------
  const statics = state.pages.filter((x) => !x.dynamic && !/\.(md|mdx)$/.test(x.file) && !/\/(404|500)$/.test(x.route));
  // A site whose pages all come from an integration (Starlight builds them from the docs collection) has none of its own.
  const generated = !state.pages.length && state.collections.some((c) => c.entries.length);
  add('Pages', 'Pages are listed', state.pages.length ? 'pass' : generated ? 'info' : 'fail', state.pages.length ? `${state.pages.length} found, ${state.pages.filter((x) => x.dynamic).length} of them dynamic` : generated ? 'none in src/pages: this site’s pages are generated from its content, which is edited in the Content tab' : 'none found');
  let home = null;
  const broken = [];
  for (const pg of statics.slice(0, 8)) {
    const r = await page(pg.route);
    if (r.error) broken.push(`${pg.route}: ${r.error}`);
    else if (!home || pg.route === '/') home = { ...pg, html: r.html };
  }
  const tried = Math.min(8, statics.length);
  add('Pages', 'Pages render in the preview', !tried ? 'skip' : broken.length ? 'fail' : 'pass', broken.length ? broken.slice(0, 3).join(' | ') : `${tried} tried`);
  if (!home) {
    add('Selecting', 'Click to select', 'skip', state.pages.length ? 'no page rendered, so nothing could be tried' : 'the project has no pages of its own to open');
    return contentAndChecks(state);
  }

  // ---- selecting -----------------------------------------------------------------
  const els = marked(home.html);
  // Elements drawn by a UI framework (React, Vue, Svelte …) or injected by a script have no position: the editor selects the nearest element around them that does.
  const body = home.html.slice(home.html.search(/<body[\s>]/i));
  const tags = [...body.matchAll(/<([a-zA-Z][\w-]*)\b[^<>]*>/g)].filter((m) => !/^(script|style|astro-island|astro-slot|astro-dev-toolbar|template|link|meta|vite-error-overlay)$/i.test(m[1]));
  const withMark = tags.filter((m) => m[0].includes('data-astro-source-file="')).length;
  add('Selecting', 'Elements carry their source position', els.length ? 'pass' : 'fail', els.length ? `${withMark} of ${tags.length} elements on ${home.route} (${els.length} distinct places in the source)` : `none on ${home.route}: clicking in the preview would select nothing`);
  const infos = [];
  const misses = [];
  for (const el of els.slice(0, 250)) {
    try {
      const info = await api('POST', '/node', { file: el.file, ref: { loc: el.loc, tag: el.tag } });
      if (String(info.name).toLowerCase() === el.tag && info.loc === el.loc) infos.push({ ...el, info });
      else if (String(info.name).toLowerCase() === el.tag) misses.push(`<${el.tag}> at ${el.file}:${el.loc} was given position ${info.loc}`);
      else misses.push(`<${el.tag}> at ${el.file}:${el.loc} resolved to <${info.name}>`);
    } catch (e) {
      misses.push(`<${el.tag}> at ${el.file}:${el.loc}: ${e.message}`);
    }
  }
  const total = Math.min(250, els.length);
  const wrong = misses.length;
  if (total) add('Selecting', 'A click finds the right place in the source', wrong ? (wrong > total / 10 ? 'fail' : 'info') : 'pass', `${total - wrong} of ${total} elements resolved to the same tag and position${wrong ? `; not: ${misses.slice(0, 4).join(' · ')}${wrong > 4 ? ` and ${wrong - 4} more` : ''}` : ''}`);
  const files = new Set(infos.map((x) => x.file));
  if (total) add('Selecting', 'Selection reaches into components', files.size > 1 ? 'pass' : 'info', `elements come from ${files.size} file${files.size === 1 ? '' : 's'}`);

  // ---- editing -------------------------------------------------------------------
  const ref = (x) => ({ file: x.file, target: { start: x.info.start, loc: x.info.loc, name: x.info.name } });
  const plain = (x) => x.info.type === 'element' && !x.info.inExpr && !['html', 'head', 'body', 'main', 'title', 'meta', 'link'].includes(x.tag);
  const editableText = infos.filter((x) => x.info.textEditable).length;
  const editableClass = infos.filter((x) => x.info.classEditable).length;
  if (infos.length) add('Editing', 'How much of the page is directly editable', 'info', `text on ${editableText} of ${infos.length} elements, classes on ${editableClass}`);

  const styled = infos.find((x) => x.info.classEditable && x.info.type === 'element' && x.tag !== 'html');
  if (!p.tailwind) add('Editing', 'Restyle an element', 'skip', 'no Tailwind: the Design panel is switched off');
  else if (!styled) add('Editing', 'Restyle an element', 'skip', 'no element with plainly written classes');
  else await edit('Restyle an element', home.route, styled.file, { type: 'setAttr', name: 'class', value: `${styled.info.classes || ''} astronut-check`.trim(), ...ref(styled) }, (h) => h.includes('astronut-check'));

  const texty = infos.find((x) => x.info.textEditable && plain(x));
  if (!texty) add('Editing', 'Edit text on the page', 'skip', 'no element whose text is written in the file');
  else await edit('Edit text on the page', home.route, texty.file, { type: 'setText', text: 'AstroNut check text', ...ref(texty) }, (h) => h.includes('AstroNut check text'));

  const block = infos.find((x) => plain(x) && x.info.textEditable && (x.info.canMoveDown || x.info.canMoveUp)) || infos.find((x) => plain(x) && x.info.textEditable);
  if (!block) add('Editing', 'Duplicate, move and delete', 'skip', 'no simple element outside loops and conditions');
  else {
    await edit(`Duplicate <${block.tag}>`, home.route, block.file, { type: 'duplicate', ...ref(block) });
    if (block.info.canMoveDown || block.info.canMoveUp) await edit(`Move <${block.tag}>`, home.route, block.file, { type: 'move', dir: block.info.canMoveDown ? 'down' : 'up', ...ref(block) });
    else add('Editing', 'Move an element', 'skip', 'the element found has no sibling to move past');
    await edit(`Delete <${block.tag}>`, home.route, block.file, { type: 'delete', ...ref(block) });
  }

  // ---- components ------------------------------------------------------------------
  add('Components', 'Components and layouts are listed', state.components.length + state.layouts.length ? 'pass' : 'info', `${state.components.length} components, ${state.layouts.length} layouts`);
  const outline = await api('GET', `/outline?file=${encodeURIComponent(home.file)}`).catch(() => ({ nodes: [] }));
  const placements = [];
  const visit = (n) => {
    if (n.type === 'component' && n.componentFile) placements.push(n);
    (n.children || []).forEach(visit);
  };
  (outline.nodes || []).forEach(visit);
  let fielded = 0;
  let target = null;
  for (const n of placements.slice(0, 40)) {
    const info = await api('POST', '/node', { file: home.file, ref: { start: n.start, loc: n.loc } }).catch(() => null);
    const usable = (info?.fields || []).filter((f) => f.type !== 'code');
    if (usable.length) fielded++;
    const f = usable.find((x) => (x.type === 'text' || x.type === 'longtext') && typeof info.values?.[x.name]?.value === 'string' && info.values[x.name].value);
    if (f && !target) target = { n, info, f };
  }
  if (placements.length) add('Components', 'Placements offer fields', fielded ? 'pass' : 'info', `${fielded} of ${Math.min(40, placements.length)} placements on ${home.route} have at least one field`);
  if (target) await edit(`Change a field (${target.info.name} · ${target.f.name})`, home.route, home.file, { type: 'setField', name: target.f.name, value: 'AstroNut check field', file: home.file, target: { start: target.n.start, loc: target.n.loc, name: target.info.name } });
  else add('Editing', 'Change a field on a placement', 'skip', placements.length ? 'no placement has a text field' : `no components placed on ${home.route}`);

  const previews = [];
  for (const c of state.components.filter((c) => c.source === 'block' || c.source === 'widget').slice(0, 4)) {
    const r = await page('/__astronut/c/' + c.previewId);
    // A component that is handed its data by a page (a list of posts, say) often can't stand on its own; that is a limit, not a fault.
    const needsData = r.error ? ((await api('GET', `/fields?file=${encodeURIComponent(c.file)}`).catch(() => null))?.fields || []).some((f) => f.type === 'code') : false;
    previews.push({ name: c.name, error: r.error, needsData });
  }
  const limited = previews.filter((x) => x.error && x.needsData);
  if (limited.length) add('Components', 'Components that need data from a page', 'info', `${limited.map((x) => x.name).join(', ')} can’t be previewed alone`);
  const bad = previews.filter((x) => x.error && !x.needsData);
  if (previews.length > limited.length) add('Components', 'A component previews on its own', bad.length ? 'fail' : 'pass', bad.length ? bad.map((x) => `${x.name}: ${x.error}`).join(' | ').slice(0, 300) : `${previews.length - limited.length} tried`);

  await contentAndChecks(state);
}

async function contentAndChecks(state) {
  // ---- content ----------------------------------------------------------------------
  const cols = state.collections;
  add('Content', 'Collections are listed', cols.length ? 'pass' : 'info', cols.map((c) => `${c.name} (${c.entries.length})`).join(', ') || 'none found');
  let saved = 0;
  let rewritten = [];
  let groups = 0;
  for (const c of cols) {
    groups += c.fields.filter((f) => f.type === 'group').length;
    const first = c.entries[0];
    if (!first) continue;
    const was = read(first.file);
    try {
      const e = await api('GET', `/content/entry?file=${encodeURIComponent(first.file)}`);
      await api('PUT', '/content/entry', { file: first.file, data: e.data, body: e.body });
      if (read(first.file) === was) saved++;
      else {
        rewritten.push(first.file);
        await api('POST', '/undo');
      }
    } catch (e) {
      rewritten.push(`${first.file}: ${e.message}`);
    }
  }
  if (cols.some((c) => c.entries.length)) add('Content', 'Opening and saving an entry leaves it untouched', rewritten.length ? 'fail' : 'pass', rewritten.length ? rewritten.slice(0, 3).join(' | ') : `${saved} entries, one per collection`);
  if (groups) add('Content', 'Fields that hold groups', 'info', `${groups} shown read-only, edited in the file`);

  // ---- checks -----------------------------------------------------------------------
  try {
    const img = await api('GET', '/checks/images');
    add('Checks', 'Image check runs', 'pass', `${img.images} images · ${img.counts.error} errors, ${img.counts.warn} warnings`);
  } catch (e) {
    add('Checks', 'Image check runs', 'fail', e.message);
  }
  if (withBuild) {
    try {
      const b = await api('POST', '/build');
      if (b.ok) add('Checks', 'The site builds', 'pass', `${b.seconds.toFixed(1)}s`);
      else {
        // Is it the editor, or does the project not build by itself either? Run its own build to find out.
        const own = await new Promise((res) => {
          const child = spawn(process.execPath, [path.join(root, 'node_modules/astro/astro.js'), 'build'], { cwd: root, env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' }, stdio: 'ignore' });
          child.on('exit', (code) => res(code === 0));
          child.on('error', () => res(false));
        });
        add('Checks', 'The site builds', own ? 'fail' : 'info', own ? 'the project builds by itself, but not from the editor — see the Build log in the editor' : 'the project’s own “astro build” fails too, so this is not the editor’s doing');
      }
    } catch (e) {
      add('Checks', 'The site builds', 'fail', e.message);
    }
  }
}

let crashed = null;
try {
  await run();
} catch (e) {
  crashed = e;
  add('Check', 'The check itself ran to the end', 'fail', e.stack?.split('\n').slice(0, 2).join(' ') || String(e));
}
server.kill('SIGTERM');
await Promise.race([new Promise((r) => server.once('exit', r)), sleep(6000)]);
if (server.exitCode == null) server.kill('SIGKILL');
fs.rmSync(settingsDir, { recursive: true, force: true });

const left = changedSince(before);
add('Safety', 'The project’s files are as they were', left.length ? 'fail' : 'pass', left.length ? left.slice(0, 6).join(', ') : `${before.size} files compared`);

const count = (s) => results.filter((r) => r.status === s).length;
if (asJson) console.log(JSON.stringify({ project: root, results, summary: { pass: count('pass'), fail: count('fail'), skip: count('skip'), info: count('info') } }, null, 2));
else {
  const mark = { pass: '✓', fail: '✗', skip: '–', info: 'i' };
  console.log(`\nAstroNut Studio check — ${root}\n`);
  for (const area of [...new Set(results.map((r) => r.area))]) {
    console.log(area);
    for (const r of results.filter((x) => x.area === area)) console.log(`  ${mark[r.status]} ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
  }
  console.log(`\n${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped, ${count('info')} notes\n`);
}
process.exit(count('fail') ? 1 : 0);
