// Site checks: images while you edit, images in the built site, and Lighthouse.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import * as A from './astro-source.mjs';

const RASTER = /\.(png|jpe?g|gif|webp|avif|tiff)$/i;
const SMART_IMAGE = 'src/components/media/SmartImage.astro';
const BIG_FILE = 1.5 * 1024 * 1024; // originals above this are worth shrinking
const BIG_SIDE = 3200;
const kb = (n) => Math.round(n / 1024);

// ---------------------------------------------------------------------------
// 1. While editing: problems visible in the source
// ---------------------------------------------------------------------------

/** sharp from the site's own install (Astro uses it), if present. */
function siteSharp(project) {
  try {
    return createRequire(path.join(project.root, 'package.json'))('sharp');
  } catch {
    return null;
  }
}

function sourceFiles(project) {
  return project.walk('src', (n) => /\.(astro|md|mdx)$/.test(n)).map((file) => ({ file, text: project.readOr(file, '') }));
}

export async function imageCheck(project) {
  const findings = [];
  const files = sourceFiles(project);
  const media = project.media().filter((m) => m.image);
  const pages = project.pages();
  const routeOf = (file) => pages.find((p) => p.file === file)?.route || null;
  const add = (f) => findings.push({ id: `${f.kind}:${f.file || ''}:${f.start ?? f.media ?? ''}`, ...f });

  const priorityIn = {}; // file -> number of load-first images written in it
  const places = {}; // file -> component files it places
  for (const { file, text } of files) {
    if (!file.endsWith('.astro')) continue;
    let doc;
    try {
      doc = A.parse(text);
    } catch {
      continue;
    }
    const imports = project.componentMap(file, doc);
    places[file] = [...new Set(doc.all.filter((n) => n.type === 'component').map((n) => imports[n.name.split('.')[0]]).filter(Boolean))];
    for (const n of doc.all) {
      const isImg = n.type === 'element' && n.name === 'img';
      const isSmart = n.type === 'component' && imports[n.name.split('.')[0]] === SMART_IMAGE;
      if (!isImg && !isSmart) continue;
      if (file === SMART_IMAGE) continue;
      const ref = { file, start: n.start, loc: n.loc, line: n.line, route: routeOf(file), type: isSmart ? 'component' : 'element', name: n.name };
      const alt = A.getAttr(n, 'alt');
      const src = A.getAttr(n, 'src');
      const hidden = A.getAttr(n, 'aria-hidden');
      if (!alt && !hidden) {
        add({ kind: 'alt', level: 'warn', title: 'Image has no description', detail: 'People using a screen reader hear nothing for this image. Write a short description, or mark it as decorative if it adds no information.', ...ref, fix: { type: 'decorative', label: 'Mark as decorative', args: { file, start: n.start } } });
      }
      if (isSmart && n.attrs.some((a) => a.name === 'priority' && !(a.kind === 'expr' && String(a.value).trim() === 'false'))) priorityIn[file] = (priorityIn[file] || 0) + 1;
      if (isImg && src?.kind === 'string' && src.value.startsWith('/src/assets/')) {
        add({ kind: 'plain', level: 'error', title: 'This photo will be missing from the published site', detail: 'It points at a file in src/assets through a plain image tag. That works while editing but not once the site is built. Switching it to an optimised image fixes it.', ...ref, fix: { type: 'smarten', label: 'Fix it', args: { file, start: n.start } } });
      }
    }
  }

  // More than one "load first" image on a page defeats the setting.
  for (const page of pages) {
    const seen = new Set();
    const visit = (f, depth) => {
      if (seen.has(f) || depth > 6) return;
      seen.add(f);
      for (const c of places[f] || []) visit(c, depth + 1);
    };
    visit(page.file, 0);
    const where = [...seen].filter((f) => priorityIn[f]);
    const total = where.reduce((n, f) => n + priorityIn[f], 0);
    if (total > 1) add({ kind: 'priority', level: 'warn', title: `${total} images are set to load first on ${page.route}`, detail: `Only the main image at the top of a page should load first; marking several makes them compete. They are in: ${where.map((f) => path.basename(f)).join(', ')}.`, file: page.file, route: page.route });
  }

  // Files: unoptimised photos in use, oversized originals, files nothing uses.
  const sharp = siteSharp(project);
  const all = files.map((f) => f.text).join('\n');
  for (const m of media) {
    const uses = files.filter((f) => f.text.includes(m.url));
    const isRaster = RASTER.test(m.name);
    if (!uses.length && !/favicon/i.test(m.name) && !all.includes(m.name)) {
      add({ kind: 'unused', level: 'info', title: `${m.name} isn’t used anywhere`, detail: `${kb(m.size)} KB in ${path.dirname(m.file)}. Remove it if you no longer need it.`, media: m.file, thumb: m.url, fix: { type: 'delete-media', label: 'Delete file', confirm: `Delete ${m.name} for good? This can’t be undone.`, args: { file: m.file } } });
      continue;
    }
    if (isRaster && !m.optimised && uses.length) {
      const inBody = uses.some((f) => /\.mdx?$/.test(f.file) && bodyOf(f.text).includes(m.url));
      add({
        kind: 'unoptimised',
        level: 'warn',
        title: `${m.name} is served at full size`,
        detail: `${kb(m.size)} KB, used in ${uses.length} place${uses.length === 1 ? '' : 's'}. It lives in public/, so every visitor downloads the whole file. Moving it to src/assets lets Astro resize it for each screen.` + (inBody ? ' It is used inside the text of a Markdown file, which has to be changed by hand.' : ''),
        media: m.file,
        thumb: m.url,
        fix: inBody ? null : { type: 'optimise', label: 'Optimise it', args: { file: m.file } },
      });
    }
    if (isRaster) {
      let side = 0;
      if (sharp) {
        try {
          const meta = await sharp(project.abs(m.file)).metadata();
          side = Math.max(meta.width || 0, meta.height || 0);
        } catch {}
      }
      if (m.size > BIG_FILE || side > BIG_SIDE) {
        add({ kind: 'oversized', level: 'info', title: `${m.name} is larger than it needs to be`, detail: `${(m.size / 1024 / 1024).toFixed(1)} MB${side ? `, ${side}px on its longest side` : ''}. Astro still resizes it for visitors, but a huge original slows every build and bloats the project. 2560px is plenty for a full-width photo.`, media: m.file, thumb: m.url, fix: sharp ? { type: 'shrink', label: 'Shrink to 2560px', confirm: `Replace ${m.name} with a 2560px version? The original is overwritten.`, args: { file: m.file } } : null });
      }
    }
  }
  const order = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return { findings, counts: { error: findings.filter((f) => f.level === 'error').length, warn: findings.filter((f) => f.level === 'warn').length, info: findings.filter((f) => f.level === 'info').length }, images: media.length };
}

const bodyOf = (md) => md.replace(/^---[\s\S]*?\n---/, '');

/** Apply one of the fixes offered by imageCheck. */
export async function fixImage(project, { type, args }) {
  switch (type) {
    case 'decorative':
      return project.op({ type: 'setAttr', file: args.file, target: { start: args.start }, name: 'alt', value: '' });
    case 'smarten': {
      const src = project.read(args.file);
      const out = project.smarten(args.file, src, (n) => n.start === args.start);
      await project.transaction('Optimise image', () => project.write(args.file, out));
      return { ok: true };
    }
    case 'delete-media':
      project.deleteMedia(args.file);
      return { ok: true };
    case 'shrink': {
      const sharp = siteSharp(project);
      if (!sharp) throw new Error('Image tools aren’t available in this project.');
      const abs = project.abs(args.file);
      const buf = await sharp(abs).rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true }).toBuffer();
      fs.writeFileSync(abs, buf);
      return { ok: true, size: buf.length };
    }
    case 'optimise': {
      // Move a photo from public/ to src/assets and point everything that used it at the new place.
      if (!args.file.startsWith('public/') || !RASTER.test(args.file)) throw new Error('Only photos in public/ can be optimised this way.');
      const oldUrl = '/' + args.file.replace(/^public\//, '');
      let to = `src/assets/${path.basename(args.file)}`;
      for (let k = 2; project.exists(to); k++) to = `src/assets/${path.basename(args.file, path.extname(args.file))}-${k}${path.extname(args.file)}`;
      const newUrl = '/' + to;
      fs.mkdirSync(path.dirname(project.abs(to)), { recursive: true });
      fs.copyFileSync(project.abs(args.file), project.abs(to));
      await project.transaction(`Optimise ${path.basename(args.file)}`, () => {
        for (const { file, text } of sourceFiles(project)) {
          if (!text.includes(oldUrl)) continue;
          let out = text.split(oldUrl).join(newUrl);
          // plain <img> tags that now point at src/assets need to become optimised images
          if (file.endsWith('.astro')) out = project.smarten(file, out, (n) => n.attrs.some((a) => a.name === 'src' && a.kind === 'string' && a.value === newUrl));
          project.write(file, out);
        }
        // widgets whose image field (or list) now holds the photo need an optimised image in their template
        for (const c of [...project.components().components]) {
          const src = project.read(c.file);
          let out = src;
          for (const f of project.fieldsOf(c.file)) {
            // only widgets that actually show this photo: as a default, or in one of their own placements
            const users =
              out.includes(newUrl) ||
              c.usedBy.some((f) => {
                try {
                  const doc = project.doc(f);
                  const imports = project.componentMap(f, doc);
                  return doc.all.some((n) => n.type === 'component' && imports[n.name.split('.')[0]] === c.file && doc.src.slice(n.start, n.openEnd).includes(newUrl));
                } catch {
                  return false;
                }
              });
            if (users && (f.type === 'image' || f.type === 'list')) out = project.smartenSource(c.file, out, f, f.type === 'list' ? [Object.fromEntries((f.itemFields || []).filter((k) => k.type === 'image').map((k) => [k.name, newUrl]))] : newUrl);
          }
          if (out !== src) project.write(c.file, out);
        }
      });
      fs.rmSync(project.abs(args.file), { force: true });
      return { ok: true, url: newUrl };
    }
  }
  throw new Error('Unknown fix.');
}

// ---------------------------------------------------------------------------
// 2. After building: what the generated site actually contains
// ---------------------------------------------------------------------------

function htmlPages(dist) {
  const out = [];
  const visit = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) visit(p);
      else if (ent.name.endsWith('.html')) out.push(p);
    }
  };
  if (fs.existsSync(dist)) visit(dist);
  return out.map((file) => {
    const rel = path.relative(dist, file).split(path.sep).join('/');
    const route = '/' + rel.replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '');
    return { file, route: route === '/' ? '/' : route.replace(/\/$/, '') };
  });
}

const attr = (tag, name) => new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined) ?? null;

export function builtImageCheck(project) {
  const dist = path.join(project.root, 'dist');
  const pages = htmlPages(dist);
  if (!pages.length) return { built: false };
  const originals = project.media().filter((m) => m.optimised);
  const size = (url) => {
    if (!url || /^(https?:|data:|\/\/)/.test(url)) return null;
    const p = path.join(dist, decodeURIComponent(url.split('?')[0].split('#')[0]));
    try {
      return fs.statSync(p).size;
    } catch {
      return -1;
    }
  };
  const findings = [];
  const rows = [];
  let saved = 0;
  let originalTotal = 0;
  for (const page of pages) {
    const html = fs.readFileSync(page.file, 'utf8');
    let phone = 0;
    let desktop = 0;
    let count = 0;
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const src = attr(tag, 'src');
      if (!src || /^(https?:|data:|\/\/)/.test(src)) continue;
      count++;
      const base = size(src);
      if (base === -1) {
        findings.push({ id: `broken:${page.route}:${src}`, level: 'error', title: `Missing image on ${page.route}`, detail: `The page asks for ${src}, but that file isn’t in the built site. A photo in src/assets used through a plain image tag is the usual cause — run the image check under “While editing” to fix it.`, route: page.route });
        continue;
      }
      const srcset = attr(tag, 'srcset');
      const cands = (srcset || '').split(',').map((c) => c.trim().split(/\s+/)).filter((c) => c[0] && /w$/.test(c[1] || '')).map(([u, w]) => ({ w: parseInt(w, 10), bytes: size(u) })).filter((c) => c.bytes > 0).sort((a, b) => a.w - b.w);
      const pick = (target) => (cands.find((c) => c.w >= target) || cands.at(-1))?.bytes ?? base;
      // a phone is ~390px wide at 2x; a laptop ~1440px wide at 1x–2x
      phone += pick(780);
      desktop += pick(1600);
      if (RASTER.test(src) && !cands.length && !/\.(webp|avif)$/i.test(src) && base > 120 * 1024) {
        findings.push({ id: `unoptimised:${page.route}:${src}`, level: 'warn', title: `Large unoptimised image on ${page.route}`, detail: `${src} is ${kb(base)} KB and is sent at one size to every screen. Use “Optimise it” under “While editing”.`, route: page.route });
      }
      // what it would have cost unoptimised
      const stem = path.basename(src).split('.')[0];
      const orig = cands.length ? originals.find((o) => path.basename(o.name, path.extname(o.name)) === stem) : null;
      if (orig) {
        originalTotal += orig.size;
        saved += Math.max(0, orig.size - pick(780));
      }
    }
    rows.push({ route: page.route, images: count, phoneKB: kb(phone), desktopKB: kb(desktop) });
  }
  rows.sort((a, b) => b.phoneKB - a.phoneKB);
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  walk(dist);
  return { built: true, builtAt: fs.statSync(dist).mtimeMs, pages: rows, findings, totals: { pages: rows.length, siteKB: kb(total), originalKB: kb(originalTotal), savedKB: kb(saved) } };
}

// ---------------------------------------------------------------------------
// 3. Lighthouse, run against the built site
// ---------------------------------------------------------------------------

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff' };

/** Serve dist/ the way an ordinary static host does: compressed text, long caching for hashed files. */
function serveDist(dist) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let p = path.join(dist, decodeURIComponent((req.url || '/').split('?')[0]));
      if (!p.startsWith(dist)) p = dist;
      try {
        if (fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      } catch {}
      if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
      if (!fs.existsSync(p)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      const ext = path.extname(p).toLowerCase();
      const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': /[\\/]_astro[\\/]/.test(p) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate' };
      const body = fs.readFileSync(p);
      if (/text|javascript|json|xml|svg/.test(headers['Content-Type']) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
        headers['Content-Encoding'] = 'gzip';
        return zlib.gzip(body, (_e, zipped) => {
          res.writeHead(200, headers);
          res.end(zipped);
        });
      }
      res.writeHead(200, headers);
      res.end(body);
    });
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => server.listen(port, '127.0.0.1', () => resolve({ port, close: () => server.close() })));
    });
  });
}

const CATEGORIES = [
  ['performance', 'Performance'],
  ['accessibility', 'Accessibility'],
  ['best-practices', 'Best practices'],
  ['seo', 'SEO'],
];
const plain = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').trim();

/** Boil a Lighthouse result down to scores and the findings that cost points. */
function summarise(lhr) {
  const scores = {};
  const findings = [];
  for (const [id, label] of CATEGORIES) {
    const cat = lhr.categories[id];
    if (!cat) continue;
    scores[id] = cat.score == null ? null : Math.round(cat.score * 100);
    for (const ref of cat.auditRefs) {
      const a = lhr.audits[ref.id];
      if (!a || a.score == null || a.score >= 0.9) continue;
      if (['informative', 'manual', 'notApplicable'].includes(a.scoreDisplayMode)) continue;
      if (id === 'performance' && !ref.weight && !(a.details?.overallSavingsMs > 50 || a.details?.overallSavingsBytes > 20000 || a.scoreDisplayMode === 'metricSavings')) continue;
      const items = (a.details?.items || [])
        .map((it) => it.node || it.element || (it.subItems?.items || []).map((s) => s.node).find(Boolean) || null)
        .filter((n) => n && n.selector)
        .slice(0, 6)
        .map((n) => ({ selector: n.selector, label: plain(n.nodeLabel || n.snippet || n.selector).slice(0, 90) }));
      findings.push({ id: a.id, category: id, categoryLabel: label, title: plain(a.title), detail: plain(a.description).replace(/\s*Learn (more|how)[^.]*\.?$/i, ''), value: a.displayValue || '', weight: ref.weight || 0, score: a.score, items });
    }
  }
  findings.sort((x, y) => y.weight * (1 - y.score) - x.weight * (1 - x.score));
  const m = (id) => lhr.audits[id]?.displayValue || null;
  return { scores, findings, metrics: { fcp: m('first-contentful-paint'), lcp: m('largest-contentful-paint'), tbt: m('total-blocking-time'), cls: m('cumulative-layout-shift') } };
}

export class Lighthouse {
  constructor(project, cacheDir, emit) {
    this.project = project;
    this.file = path.join(cacheDir, 'lighthouse.json');
    this.emit = emit;
    this.running = false;
    this.cancel = false;
  }
  last() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }
  pages() {
    return htmlPages(path.join(this.project.root, 'dist')).map((p) => p.route).filter((r) => !/^\/(404|500)$/.test(r)).sort((a, b) => a.length - b.length || a.localeCompare(b));
  }
  stop() {
    this.cancel = true;
  }

  /** Run against the built site. `routes` defaults to every page; `device` is 'mobile' or 'desktop'. */
  async run({ routes, device = 'mobile' } = {}) {
    if (this.running) throw new Error('A check is already running.');
    const dist = path.join(this.project.root, 'dist');
    const all = this.pages();
    if (!all.length) throw new Error('Build the site first — Lighthouse measures the finished pages.');
    const list = (routes?.length ? routes.filter((r) => all.includes(r)) : all).slice(0, 25);
    if (!list.length) throw new Error('That page isn’t in the built site. Build again and retry.');
    this.running = true;
    this.cancel = false;
    const previous = this.last();
    const started = Date.now();
    const out = { device, at: started, pages: [] };
    let server, chrome;
    try {
      const [{ default: lighthouse }, launcher] = await Promise.all([import('lighthouse'), import('chrome-launcher')]);
      const desktopConfig = device === 'desktop' ? (await import('lighthouse/core/config/desktop-config.js')).default : undefined;
      server = await serveDist(dist);
      try {
        chrome = await launcher.launch({ chromeFlags: ['--headless=new', '--no-first-run', '--disable-extensions'] });
      } catch {
        throw new Error('Lighthouse needs Google Chrome (or another Chromium browser) installed on this computer.');
      }
      for (const [i, route] of list.entries()) {
        if (this.cancel) break;
        this.emit({ type: 'check', kind: 'lighthouse', state: 'running', route, done: i, total: list.length });
        const url = `http://127.0.0.1:${server.port}${route === '/' ? '/' : route + '/'}`;
        try {
          const result = await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: CATEGORIES.map((c) => c[0]) }, desktopConfig);
          const page = { route, ...summarise(result.lhr) };
          const before = previous?.device === device ? previous.pages.find((p) => p.route === route) : null;
          if (before) page.previous = before.scores;
          out.pages.push(page);
        } catch (e) {
          out.pages.push({ route, error: String(e.message || e).slice(0, 200), scores: {}, findings: [] });
        }
      }
      out.seconds = Math.round((Date.now() - started) / 1000);
      out.stopped = this.cancel;
      // keep results for pages not re-run, so a single-page check doesn't wipe the rest
      if (previous?.device === device) for (const p of previous.pages) if (!out.pages.some((x) => x.route === p.route)) out.pages.push({ ...p, stale: true });
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(out));
      return out;
    } finally {
      this.running = false;
      try {
        await chrome?.kill();
      } catch {}
      server?.close();
      this.emit({ type: 'check', kind: 'lighthouse', state: 'idle' });
    }
  }
}
