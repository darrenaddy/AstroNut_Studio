// Everything that reads or writes the Astro project on disk.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import * as A from './astro-source.mjs';
import * as W from './widgets.mjs';
import { fileURLToPath } from 'node:url';

const TEMPLATES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
const F = (label, type = 'text', placeholder = '', required = true, half = false, options = []) => ({ label, type, placeholder, required, half, options });
/** Starting points for the form builder. */
export const FORM_PRESETS = {
  contact: { label: 'Contact', values: { eyebrow: 'Get in touch', title: 'Send us a message', text: 'Tell us a little about what you need and we will get back to you within one working day.', submitLabel: 'Send message', subject: 'New message from the website', fields: [F('Name', 'text', 'Ada Lovelace', true, true), F('Email', 'email', 'ada@example.com', true, true), F('Message', 'long text', 'How can we help?')] } },
  newsletter: { label: 'Newsletter sign-up', values: { eyebrow: 'Newsletter', title: 'One thoughtful email a month', text: 'No tracking, no tricks. Unsubscribe in one click.', submitLabel: 'Subscribe', subject: 'New newsletter subscriber', successMessage: 'You are on the list. Thank you!', layout: 'plain', fields: [F('Email', 'email', 'you@example.com')] } },
  signup: { label: 'Sign-up', values: { eyebrow: 'Join us', title: 'Create your account', text: 'It takes less than a minute.', submitLabel: 'Sign up', subject: 'New sign-up', fields: [F('First name', 'text', '', true, true), F('Last name', 'text', '', true, true), F('Email', 'email', 'you@example.com'), F('Company', 'text', '', false), F('I agree to the terms', 'checkbox')] } },
  feedback: { label: 'Feedback', values: { eyebrow: 'Feedback', title: 'How did we do?', text: 'Two minutes of your time helps us get better.', submitLabel: 'Send feedback', subject: 'New feedback', fields: [F('How would you rate your experience?', 'choice', '', true, false, ['Excellent', 'Good', 'Fair', 'Poor']), F('What could we do better?', 'long text', '', false), F('Email (if you would like a reply)', 'email', 'you@example.com', false)] } },
  quote: { label: 'Quote request', values: { eyebrow: 'Request a quote', title: 'Tell us about your project', text: 'Share a few details and we will reply with a quote within two working days.', submitLabel: 'Request quote', subject: 'New quote request', fields: [F('Name', 'text', '', true, true), F('Email', 'email', 'you@example.com', true, true), F('Phone', 'phone', '', false, true), F('Budget', 'dropdown', 'Choose a range', false, true, ['Under $1,000', '$1,000 – $5,000', '$5,000 – $20,000', 'Over $20,000']), F('When do you need it?', 'date', '', false, true), F('Project details', 'long text', 'What are you looking to build?')] } },
  blank: { label: 'Blank (one field)', values: { title: 'A new form', text: 'Describe what this form is for.', fields: [F('Email', 'email', 'you@example.com')] } },
};

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico']);
const RASTER_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.tiff']);
const SMART_IMAGE = 'src/components/media/SmartImage.astro';
const MEDIA_EXT = new Set([...IMAGE_EXT, '.mp4', '.webm', '.mp3', '.pdf', '.woff2']);

const toPosix = (p) => p.split(path.sep).join('/');
const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export class Project {
  constructor(root) {
    this.root = path.resolve(root);
    this.undoStack = [];
    this.redoStack = [];
    this.group = null;
    this.listeners = new Set();
  }

  // ---- paths -------------------------------------------------------------
  abs(rel) {
    const p = path.resolve(this.root, rel);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) throw httpError(400, `Path escapes the project: ${rel}`);
    if (/(^|\/)(node_modules|\.git)(\/|$)/.test(toPosix(path.relative(this.root, p)))) throw httpError(400, `Path is off limits: ${rel}`);
    return p;
  }
  rel(abs) {
    return toPosix(path.relative(this.root, abs));
  }
  exists(rel) {
    return fs.existsSync(this.abs(rel));
  }
  read(rel) {
    return fs.readFileSync(this.abs(rel), 'utf8');
  }
  readOr(rel, fallback = null) {
    try {
      return this.read(rel);
    } catch {
      return fallback;
    }
  }

  // ---- history-aware writes ---------------------------------------------
  /** Group several writes into one undo step. */
  async transaction(label, fn) {
    if (this.group) return fn();
    this.group = { label, changes: new Map() };
    try {
      return await fn();
    } finally {
      const g = this.group;
      this.group = null;
      const changes = [...g.changes.entries()].map(([file, c]) => ({ file, ...c })).filter((c) => c.before !== c.after);
      if (changes.length) {
        this.undoStack.push({ label: g.label, changes, time: Date.now() });
        if (this.undoStack.length > 200) this.undoStack.shift();
        this.redoStack = [];
        this.emit({ type: 'history' });
      }
    }
  }

  write(rel, content) {
    const abs = this.abs(rel);
    const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (before === content) return;
    const record = (g) => {
      const prev = g.changes.get(rel);
      g.changes.set(rel, { before: prev ? prev.before : before, after: content });
    };
    if (this.group) record(this.group);
    else {
      const g = { label: `Edit ${path.basename(rel)}`, changes: new Map() };
      record(g);
      this.undoStack.push({ label: g.label, changes: [{ file: rel, before, after: content }], time: Date.now() });
      this.redoStack = [];
      this.emit({ type: 'history' });
    }
    if (content === null) {
      fs.rmSync(abs, { force: true });
    } else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  remove(rel) {
    this.write(rel, null);
  }

  applyRaw(file, content) {
    const abs = this.abs(file);
    if (content === null) fs.rmSync(abs, { force: true });
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  undo() {
    const step = this.undoStack.pop();
    if (!step) return null;
    for (const c of [...step.changes].reverse()) this.applyRaw(c.file, c.before);
    this.redoStack.push(step);
    this.emit({ type: 'history' });
    return step;
  }
  redo() {
    const step = this.redoStack.pop();
    if (!step) return null;
    for (const c of step.changes) this.applyRaw(c.file, c.after);
    this.undoStack.push(step);
    this.emit({ type: 'history' });
    return step;
  }
  historyState() {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
    };
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(ev) {
    for (const fn of this.listeners) fn(ev);
  }

  // ---- scanning ----------------------------------------------------------
  walk(relDir, filter) {
    const out = [];
    const base = path.join(this.root, relDir);
    if (!fs.existsSync(base)) return out;
    const visit = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (ent.name.startsWith('.') || ent.name === 'node_modules') continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) visit(p);
        else if (!filter || filter(ent.name)) out.push(this.rel(p));
      }
    };
    visit(base);
    return out;
  }

  pages() {
    return this.walk('src/pages', (n) => /\.(astro|md|mdx)$/.test(n)).map((file) => {
      let r = file.replace(/^src\/pages\//, '').replace(/\.(astro|md|mdx)$/, '');
      r = r.replace(/(^|\/)index$/, '');
      let route = '/' + r.replace(/\/$/, '');
      // Astro's dev server reports the real route for each file (base path, i18n,
      // trailing slashes…). Use it when we have it; the file name is the fallback.
      const known = (this.routes?.() || []).find((x) => x.entrypoint === file && x.type === 'page');
      if (known?.pattern) route = known.pattern === '/' ? '/' : known.pattern.replace(/\/$/, '');
      const dynamic = /\[/.test(route);
      let title = null;
      const src = this.readOr(file, '');
      const m = /<title>([^<{]+)<\/title>/.exec(src) || /\btitle=["']([^"']+)["']/.exec(src) || /^title:\s*["']?(.+?)["']?\s*$/m.exec(src);
      if (m) title = m[1].trim();
      return { file, route, dynamic, title, name: route === '/' ? 'Home' : titleCase(route.split('/').filter(Boolean).pop().replace(/[\[\]\.]/g, '')) };
    });
  }

  /** Which files place which components, and which pages end up showing them. */
  usage() {
    const files = this.walk('src', (n) => n.endsWith('.astro'));
    const places = {}; // file -> { componentFile: count }
    for (const file of files) {
      try {
        const doc = this.doc(file);
        const imports = this.componentMap(file, doc);
        const counts = {};
        for (const node of doc.all) {
          if (node.type !== 'component') continue;
          const target = imports[node.name.split('.')[0]];
          if (target) counts[target] = (counts[target] || 0) + 1;
        }
        places[file] = counts;
      } catch {
        places[file] = {};
      }
    }
    const pages = this.pages();
    const usedOn = {}; // componentFile -> [{ file, route, count, direct }]
    for (const page of pages) {
      const seen = new Map(); // componentFile -> { count, direct }
      const visit = (file, depth) => {
        for (const [target, count] of Object.entries(places[file] || {})) {
          const had = seen.get(target);
          if (had) {
            if (depth === 0) {
              had.direct = true;
              had.count += count;
            }
            continue;
          }
          seen.set(target, { count: depth === 0 ? count : 0, direct: depth === 0 });
          if (depth < 8) visit(target, depth + 1);
        }
      };
      visit(page.file, 0);
      for (const [target, u] of seen) (usedOn[target] ||= []).push({ file: page.file, route: page.route, count: u.count, direct: u.direct });
    }
    const usedBy = {}; // componentFile -> files that place it directly
    for (const [file, counts] of Object.entries(places)) for (const target of Object.keys(counts)) (usedBy[target] ||= []).push(file);
    return { usedOn, usedBy };
  }

  components() {
    const { usedOn, usedBy } = this.usage();
    // Every .astro file that isn't a page is a component or a layout, wherever the project keeps it.
    const all = this.walk('src', (n) => n.endsWith('.astro')).filter((f) => !f.startsWith('src/pages/'));
    const map = (kind) =>
      all.filter((file) => (isLayoutPath(file) || /<html[\s>]/i.test(this.readOr(file, '')) ? 'layout' : 'component') === kind).map((file) => {
        const parts = file.replace(/^src\/(components\/|layouts\/)?/, '').split('/');
        const src = this.readOr(file, '');
        let fields = [];
        try {
          fields = W.parseFields(src).fields;
        } catch {}
        const editable = fields.filter((f) => f.type !== 'code');
        const data = /getCollection|getEntry|getEntries/.test(src);
        // Works out what to show from the page it is on: its address, or the page's own headings.
        const pageAware = /Astro\.url|Astro\.params|Astro\.currentLocale|from ['"]astro-breadcrumbs['"]|\bheadings\b/.test(src);
        // Where the content comes from decides how it is edited.
        const source = kind === 'layout' ? 'layout' : data ? 'data' : pageAware ? 'page' : editable.length ? 'widget' : fields.length ? 'code' : 'block';
        return {
          file,
          kind,
          source,
          name: path.basename(file, '.astro'),
          folder: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
          dynamic: source !== 'block' && source !== 'layout',
          fields: editable.map((f) => ({ name: f.name, label: f.label, type: f.type, count: f.type === 'list' ? f.default.length : undefined })),
          hasSlot: /<slot[\s/>]/.test(src),
          usedOn: usedOn[file] || [],
          usedBy: usedBy[file] || [],
          previewId: file.replace(/^src\//, '').replace(/\.astro$/, '').split('/').join('~'),
        };
      });
    return { components: map('component'), layouts: map('layout') };
  }
  media() {
    const item = (file, url, optimised) => {
      const st = fs.statSync(this.abs(file));
      return { file, url, name: path.basename(file), size: st.size, image: IMAGE_EXT.has(path.extname(file).toLowerCase()), optimised, mtime: st.mtimeMs };
    };
    // Photos in src/assets are resized by Astro at build time; files in public/ are served as they are.
    const assets = this.walk('src/assets', (n) => RASTER_EXT.has(path.extname(n).toLowerCase()) || /\.svg$/i.test(n)).map((file) => item(file, '/' + file, RASTER_EXT.has(path.extname(file).toLowerCase())));
    const pub = this.walk('public', (n) => MEDIA_EXT.has(path.extname(n).toLowerCase())).map((file) => item(file, '/' + file.replace(/^public\//, ''), false));
    return [...assets.sort((a, b) => b.mtime - a.mtime), ...pub];
  }

  // ---- theme tokens ------------------------------------------------------
  themeFile() {
    const files = this.walk('src', (n) => n.endsWith('.css'));
    return files.find((f) => /@theme/.test(this.readOr(f, ''))) || files.find((f) => /global\.css$/.test(f)) || files[0] || null;
  }

  static cssBlocks(src) {
    // Finds flat `selector { --a: b; }` blocks we know how to edit.
    const blocks = [];
    const re = /(^|\n)[ \t]*(@theme(?:[ \t]+inline)?|:root|\.dark|html\.dark|:root\.dark)[ \t]*\{/g;
    let m;
    while ((m = re.exec(src))) {
      const open = m.index + m[0].length;
      const close = src.indexOf('}', open);
      if (close < 0) break;
      const body = src.slice(open, close);
      const vars = [];
      const vre = /(--[\w-]+)\s*:\s*([^;]+);/g;
      let v;
      while ((v = vre.exec(body))) vars.push({ name: v[1], value: v[2].trim(), start: open + v.index, end: open + v.index + v[0].length });
      const sel = m[2].replace(/\s+/g, ' ');
      const kind = sel === '@theme' ? 'theme' : sel === '@theme inline' ? 'inline' : sel === ':root' ? 'light' : 'dark';
      blocks.push({ kind, open, close, vars });
    }
    return blocks;
  }

  theme() {
    const file = this.themeFile();
    if (!file) return { file: null, theme: {}, light: {}, dark: {} };
    const blocks = Project.cssBlocks(this.read(file));
    const out = { file, theme: {}, light: {}, dark: {} };
    for (const b of blocks) if (b.kind !== 'inline') for (const v of b.vars) out[b.kind][v.name] = v.value;
    return out;
  }

  setTheme(scope, vars) {
    const file = this.themeFile();
    if (!file) throw httpError(400, 'No stylesheet with theme tokens found.');
    let src = this.read(file);
    for (const [name, value] of Object.entries(vars)) {
      if (!/^--[\w-]+$/.test(name)) continue;
      const blocks = Project.cssBlocks(src).filter((b) => b.kind === scope);
      let block = blocks.find((b) => b.vars.some((v) => v.name === name)) || blocks[0];
      if (!block) {
        const sel = scope === 'theme' ? '@theme' : scope === 'light' ? ':root' : '.dark';
        src = src.replace(/\s*$/, '') + `\n\n${sel} {\n}\n`;
        block = Project.cssBlocks(src).filter((b) => b.kind === scope)[0];
      }
      const existing = block.vars.find((v) => v.name === name);
      if (value === null) {
        if (existing) src = src.slice(0, existing.start).replace(/[ \t]*$/, '') + src.slice(existing.end).replace(/^\r?\n/, '\n');
      } else if (existing) src = src.slice(0, existing.start) + `${name}: ${value};` + src.slice(existing.end);
      else {
        const before = src.slice(0, block.close).replace(/[ \t]*$/, '');
        src = before + (before.endsWith('\n') ? '' : '\n') + `  ${name}: ${value};\n` + src.slice(block.close);
      }
    }
    this.write(file, src);
  }

  // ---- imports / outline -------------------------------------------------
  resolveImport(fromFile, source) {
    let target = null;
    if (source.startsWith('.')) target = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), source)));
    else {
      const aliases = [
        ['@/', 'src/'],
        ['~/', 'src/'],
        ['@components/', 'src/components/'],
        ['@layouts/', 'src/layouts/'],
      ];
      try {
        const ts = JSON.parse(this.readOr('tsconfig.json', '{}').replace(/^\s*\/\/.*$/gm, ''));
        const base = ts.compilerOptions?.baseUrl || '.';
        for (const [k, v] of Object.entries(ts.compilerOptions?.paths || {})) {
          if (k.endsWith('/*') && v[0]?.endsWith('/*')) aliases.unshift([k.slice(0, -1), toPosix(path.posix.normalize(path.posix.join(base, v[0].slice(0, -1)))) + '/']);
        }
      } catch {}
      const hit = aliases.find(([k]) => source.startsWith(k));
      if (hit) target = hit[1].replace(/^\.\//, '') + source.slice(hit[0].length);
    }
    if (!target) return null;
    try {
      return this.exists(target) ? target : null;
    } catch {
      return null;
    }
  }

  doc(file) {
    return A.parse(this.read(file));
  }

  componentMap(file, doc) {
    const map = {};
    for (const imp of A.getImports(doc)) {
      const r = this.resolveImport(file, imp.source);
      if (r) map[imp.name] = r;
    }
    return map;
  }

  outline(file) {
    const doc = this.doc(file);
    const imports = this.componentMap(file, doc);
    const ser = (node) => {
      const cls = A.getAttr(node, 'class');
      const id = A.getAttr(node, 'id');
      const textOnly = A.isTextOnly(doc, node);
      return {
        start: node.start,
        loc: node.loc,
        type: node.type,
        name: node.name || 'Fragment',
        id: id && id.kind === 'string' ? id.value : null,
        cls: cls && cls.kind === 'string' ? cls.value : null,
        text: textOnly ? A.textOf(doc, node).slice(0, 60) : null,
        inExpr: node.inExpr,
        componentFile: node.type === 'component' ? imports[node.name.split('.')[0]] || null : null,
        children: node.children.filter((c) => !(c.type === 'element' && ['script', 'style'].includes(c.name) && node.type !== 'root')).map(ser),
      };
    };
    return { file, nodes: doc.root.children.map(ser) };
  }

  locate(doc, ref) {
    let node = null;
    if (ref?.start != null) node = doc.findByStart(ref.start);
    if (!node && ref?.loc) node = doc.findByLoc(ref.loc, ref.name || ref.tag);
    if (!node) throw httpError(409, 'That element could not be found in the source — it may have changed. Try selecting it again.');
    if (ref.name && node.name !== ref.name && ref.start != null && ref.loc) {
      const alt = doc.findByLoc(ref.loc, ref.name);
      if (alt && alt.name === ref.name) node = alt;
    }
    return node;
  }

  nodeInfo(file, ref) {
    const doc = this.doc(file);
    const node = this.locate(doc, ref);
    const imports = this.componentMap(file, doc);
    const cls = A.getAttr(node, 'class');
    const sibs = node.parent.children;
    const idx = sibs.indexOf(node);
    const ancestors = [];
    for (let p = node.parent; p && p.type !== 'root'; p = p.parent) ancestors.unshift({ start: p.start, loc: p.loc, name: p.name || 'Fragment', type: p.type });
    return {
      file,
      start: node.start,
      loc: node.loc,
      type: node.type,
      name: node.name || 'Fragment',
      attrs: node.attrs.map((a) => ({ name: a.name, kind: a.kind, value: a.kind === 'bool' ? true : a.value ?? null, raw: a.raw })),
      classes: cls && cls.kind === 'string' ? cls.value : '',
      classEditable: (!cls || cls.kind === 'string') && !A.getAttr(node, 'class:list') && node.type === 'element',
      textEditable: A.isTextOnly(doc, node),
      text: A.isTextOnly(doc, node) ? A.textOf(doc, node) : null,
      source: doc.src.slice(node.start, node.end),
      inExpr: node.inExpr,
      exprRoot: !!node.exprRoot,
      isVoid: !!node.isVoid,
      canMoveUp: idx > 0 && !node.exprRoot && !sibs[idx - 1].exprRoot,
      canMoveDown: idx < sibs.length - 1 && !node.exprRoot && !sibs[idx + 1].exprRoot,
      childCount: node.children.length,
      componentFile: node.type === 'component' ? imports[node.name.split('.')[0]] || null : null,
      ancestors,
      line: node.line,
      ...this.widgetInfo(file, doc, node, imports),
    };
  }

  /** Field details for a selected node: a placement's values, or the field an element shows. */
  widgetInfo(file, doc, node, imports) {
    try {
      if (node.type === 'component') {
        const target = imports[node.name.split('.')[0]];
        if (!target) return {};
        const compSrc = this.read(target);
        const fields = W.placementFields(node, W.parseFields(compSrc).fields, compSrc);
        return { fields, values: W.readValues(node, fields) };
      }
      if (node.type !== 'element') return {};
      const own = W.parseFields(doc.src);
      const kinds = !file.startsWith('src/pages/') ? W.fieldKindsFor(doc, node) : [];
      const taken = new Set(own.fields.map((f) => f.name));
      return {
        field: W.fieldOfNode(doc, node, own.fields),
        listItem: W.listItemOfNode(doc, node, own.fields),
        fieldKinds: kinds,
        fieldNames: Object.fromEntries(kinds.map((k) => [k, W.suggestName(node, k, taken)])),
        repeatCount: kinds.includes('list') ? node.children.length : 0,
      };
    } catch {
      return {};
    }
  }

  /** When a field (or list) is given a photo from src/assets, make the widget show it through SmartImage. */
  smartenSource(file, src, field, value) {
    const uses = (v) => typeof v === 'string' && v.startsWith('/src/assets/');
    if (field.type === 'list') {
      const keys = field.itemFields.filter((k) => k.type === 'image' && (value || []).some((it) => uses(it[k.name]))).map((k) => k.name);
      if (!keys.length || !field.param) return src;
      return this.smarten(file, src, (n) => n.attrs.some((a) => a.name === 'src' && a.kind === 'expr' && keys.some((k) => String(a.value).trim() === `${field.param}.${k}`)));
    }
    if (field.type !== 'image' || !uses(value)) return src;
    return this.smarten(file, src, (n) => n.attrs.some((a) => a.name === 'src' && ((a.kind === 'expr' && String(a.value).trim() === field.name) || (a.kind === 'shorthand' && a.name === field.name))));
  }
  smartenFor(compFile, field, value, extra) {
    if (!compFile) return;
    const before = this.read(compFile);
    const after = this.smartenSource(compFile, before, field, value);
    if (after !== before) extra.push({ file: compFile, content: after });
  }

  /** The fields of a component file with their defaults (for editing a widget's defaults). */
  fieldsOf(file) {
    return W.parseFields(this.read(file)).fields;
  }

  /**
   * Find which placement on a page a rendered copy belongs to.
   * `index` is its position among the rendered copies; `text`/`field` let us
   * double-check by content when the same widget is also placed elsewhere.
   */
  placementFor({ page, component, index = 0, field, text }) {
    const doc = this.doc(page);
    const imports = this.componentMap(page, doc);
    const list = doc.all.filter((x) => x.type === 'component' && imports[x.name.split('.')[0]] === component);
    if (!list.length) throw httpError(404, 'This widget isn’t placed directly on this page (it comes from a layout or another component), so open that file to change it.');
    let node = list[index] || null;
    if (field && text != null) {
      const fields = W.parseFields(this.read(component)).fields;
      const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
      const matches = list.filter((n) => norm(W.readValues(n, fields)[field]?.value) === norm(text));
      if (!(node && matches.includes(node))) node = matches.length === 1 ? matches[0] : node || (list.length === 1 ? list[0] : null);
    }
    if (!node) throw httpError(409, 'Couldn’t tell which copy of this widget you mean. Select it in the Layers list instead.');
    return { file: page, start: node.start, loc: node.loc, name: node.name, type: 'component' };
  }

  /** Make sure the project has the SmartImage component (it is what lets Astro optimise a photo given just its path). */
  ensureSmartImage() {
    if (!this.exists(SMART_IMAGE)) this.write(SMART_IMAGE, fs.readFileSync(path.join(TEMPLATES, 'SmartImage.astro'), 'utf8'));
    return SMART_IMAGE;
  }

  /**
   * Swap plain <img> tags for <SmartImage> in a file, so a photo from src/assets is
   * optimised rather than broken. `match(node, doc)` picks which <img> tags.
   * Returns the new source (unchanged when nothing matched).
   */
  smarten(file, src, match) {
    let doc = A.parse(src);
    const targets = doc.all.filter((n) => n.type === 'element' && n.name === 'img' && match(n, doc));
    if (!targets.length) return src;
    this.ensureSmartImage();
    const { name, needsImport, source } = this.importNameFor(file, doc, SMART_IMAGE);
    let out = src;
    for (const n of targets.sort((a, b) => b.start - a.start)) {
      const close = out.slice(n.openEnd - 2, n.openEnd) === '/>' ? '' : ' /';
      out = out.slice(0, n.openEnd - (close ? 1 : 2)) + (close ? ' />' : '/>') + out.slice(n.openEnd);
      out = out.slice(0, n.start + 1) + name + out.slice(n.start + 4);
    }
    if (needsImport) out = A.addImport(A.parse(out), name, source).src;
    return out;
  }

  /** From a rendered image, find the <SmartImage> tag it came from: the nth one inside its parent element. */
  imagePlacement({ file, loc, index = 0 }) {
    const doc = this.doc(file);
    const parent = doc.findByLoc(loc);
    if (!parent) throw httpError(409, 'Couldn’t find that image in the source.');
    const imports = this.componentMap(file, doc);
    const inside = (n) => {
      const out = [];
      for (const c of n.children) {
        if (c.type === 'component' && imports[c.name.split('.')[0]] === SMART_IMAGE) out.push(c);
        else if (c.type !== 'element') out.push(...inside(c));
      }
      return out;
    };
    const list = inside(parent);
    const node = list[index] || list[0];
    if (!node) throw httpError(409, 'Couldn’t find that image in the source.');
    return { file, start: node.start, loc: node.loc, name: node.name, type: 'component' };
  }

  /** Copy a component so one page can have its own independent version. Returns the new file. */
  copyComponentFor(componentFile, pageFile) {
    const dir = path.posix.dirname(componentFile);
    const base = path.basename(componentFile, '.astro');
    const page = this.pages().find((p) => p.file === pageFile);
    const suffix = (page ? page.name : path.basename(pageFile, '.astro')).replace(/[^A-Za-z0-9]/g, '').replace(/^\w/, (c) => c.toUpperCase()) || 'Copy';
    let name = base + suffix;
    for (let k = 2; this.exists(`${dir}/${name}.astro`); k++) name = base + suffix + k;
    const to = `${dir}/${name}.astro`;
    this.write(to, this.read(componentFile));
    return to;
  }

  /** Where new blocks go when nothing is selected. */
  defaultContainer(doc) {
    const main = doc.all.find((x) => x.type === 'element' && x.name === 'main' && !x.inExpr);
    if (main) return main;
    const layout = doc.root.children.find((x) => x.type === 'component' && !x.isVoid);
    if (layout) return layout;
    const body = doc.all.find((x) => x.name === 'body');
    return body || null;
  }

  importNameFor(file, doc, componentFile) {
    const existing = Object.entries(this.componentMap(file, doc)).find(([, f]) => f === componentFile);
    if (existing) return { name: existing[0], needsImport: false };
    let base = path.basename(componentFile, '.astro').replace(/[^A-Za-z0-9_$]/g, '');
    base = base.charAt(0).toUpperCase() + base.slice(1);
    if (!/^[A-Z]/.test(base)) base = 'Block' + base;
    const taken = new Set(A.getImports(doc).map((i) => i.name));
    let name = base;
    for (let k = 2; taken.has(name); k++) name = base + k;
    let source = path.posix.relative(path.posix.dirname(file), componentFile);
    if (!source.startsWith('.')) source = './' + source;
    return { name, needsImport: true, source };
  }

  /** The single entry point for visual edits. Returns { select } describing what to select next. */
  async op(o) {
    const file = o.file;
    if (!file) throw httpError(400, 'Missing file');
    const src = this.read(file);
    let doc = A.parse(src);
    let res;
    let label = o.type;
    const target = o.target ? this.locate(doc, o.target) : null;

    // An element that is the direct result of a `{ ... }` expression (a loop body or a
    // condition) can be restyled, but not structurally rearranged without breaking the code.
    const structural = ['delete', 'duplicate', 'move', 'wrap'].includes(o.type) || (o.type === 'insert' && target && !o.pageLevel && (o.position || 'after') !== 'inside-end' && (o.position || 'after') !== 'inside-start');
    if (target?.exprRoot && structural) throw httpError(400, 'This element is produced by code (a loop or a condition), so it can’t be moved, copied or removed from here. Change it in the Source tab of its parent — or ask the AI to.');

    const extra = []; // other files to write in the same undo step
    switch (o.type) {
      case 'setField': {
        // One field of one placement of a widget.
        const imports = this.componentMap(file, doc);
        const compFile = imports[target.name.split('.')[0]];
        const compSrc = compFile ? this.read(compFile) : '';
        const field = compFile && W.placementFields(target, W.parseFields(compSrc).fields, compSrc).find((f) => f.name === o.name);
        if (!field || field.type === 'code') throw httpError(400, `“${o.name}” isn’t an editable field of ${target.name}.`);
        res = { src: W.setFieldValue(src, target, field, o.value), at: target.start };
        this.smartenFor(compFile, field, o.value, extra);
        label = o.value == null ? `Reset ${field.label.toLowerCase()}` : `Edit ${field.label.toLowerCase()}`;
        break;
      }
      case 'setItem': {
        // One value of one item in a list field — on a placement, or (no target) in the widget's defaults.
        const compFile = target ? this.componentMap(file, doc)[target.name.split('.')[0]] : file;
        const itemSrc = compFile ? this.read(compFile) : '';
        const declared = compFile ? W.parseFields(itemSrc).fields : [];
        const field = (target ? W.placementFields(target, declared, itemSrc) : declared).find((f) => f.name === o.name && f.type === 'list');
        if (!field) throw httpError(400, `“${o.name}” isn’t a list field.`);
        const current = target ? W.readValues(target, [field])[field.name] : { value: field.default };
        if (!Array.isArray(current.value)) throw httpError(400, 'This list is set from code on this page, so it can’t be edited here.');
        const list = current.value.map((it) => ({ ...it }));
        if (!list[o.index]) throw httpError(409, 'That item no longer exists.');
        list[o.index][o.key] = o.value;
        res = target ? { src: W.setFieldValue(src, target, field, list), at: target.start } : { src: W.setFieldDefault(src, o.name, list), at: null };
        if (target) this.smartenFor(compFile, field, list, extra);
        else res.src = this.smartenSource(file, res.src, field, list);
        label = `Edit ${field.label.toLowerCase()}`;
        break;
      }
      case 'setDefault': {
        res = { src: W.setFieldDefault(src, o.name, o.value), at: null };
        {
          const field = W.parseFields(src).fields.find((f) => f.name === o.name);
          if (field) res.src = this.smartenSource(file, res.src, field, o.value);
        }
        label = `Edit default ${o.name}`;
        break;
      }
      case 'toField': {
        const out = o.kind === 'list' ? W.turnIntoList(src, target, String(o.name || '').trim()) : W.turnIntoField(src, target, o.kind, String(o.name || '').trim());
        if (o.dryRun) return { ok: true, preview: W.diffLines(src, out.src), usedOn: this.usage().usedOn[file] || [] };
        res = { src: out.src, at: null };
        label = `Turn into field “${o.name}”`;
        break;
      }
      case 'detach': {
        // Give this page its own copy of a shared component.
        const imports = this.componentMap(file, doc);
        const oldName = target.name.split('.')[0];
        const compFile = imports[oldName];
        if (!compFile) throw httpError(400, 'Couldn’t find this component’s file.');
        const to = await this.transaction(`Make ${oldName} independent`, async () => {
          const copy = this.copyComponentFor(compFile, file);
          const newName = path.basename(copy, '.astro');
          let out = src;
          if (target.closeStart != null && !target.implicitClose) out = out.slice(0, target.closeStart + 2) + newName + out.slice(target.closeStart + 2 + target.name.length);
          out = out.slice(0, target.start + 1) + newName + out.slice(target.start + 1 + target.name.length);
          let source = path.posix.relative(path.posix.dirname(file), copy);
          if (!source.startsWith('.')) source = './' + source;
          out = A.addImport(A.parse(out), newName, source).src;
          out = A.pruneImport(out, oldName);
          this.write(file, out);
          return { copy, newName, out };
        });
        const d2 = A.parse(to.out);
        const node = d2.all.find((x) => x.type === 'component' && x.name === to.newName);
        return { ok: true, copy: to.copy, select: node ? { file, start: node.start, loc: node.loc, name: node.name, type: 'component' } : null };
      }
      case 'setImage': {
        // Give an <img> element a new picture. A photo from src/assets turns it into a SmartImage so Astro optimises it.
        const value = String(o.value || '');
        if (target.type === 'element' && target.name === 'img' && value.startsWith('/src/assets/')) {
          const withSrc = A.setAttr(doc, target, 'src', value).src;
          res = { src: this.smarten(file, withSrc, (n) => n.start === target.start), at: null };
          const d2 = A.parse(res.src);
          const node = d2.all.find((n) => n.type === 'component' && n.attrs.some((a) => a.name === 'src' && a.value === value) && n.line >= target.line - 1);
          res.at = node ? node.start : null;
        } else res = A.setAttr(doc, target, 'src', value);
        label = 'Change image';
        break;
      }
      case 'setAttr': {
        res = A.setAttr(doc, target, o.name, o.value);
        label = o.name === 'class' ? 'Change styles' : `Set ${o.name}`;
        break;
      }
      case 'setAttrs': {
        let cur = { src, at: target.start };
        for (const [name, value] of Object.entries(o.attrs)) {
          const d = A.parse(cur.src);
          cur = A.setAttr(d, d.findByStart(target.start), name, value);
        }
        res = cur;
        label = 'Change attributes';
        break;
      }
      case 'setText': {
        if (!A.isTextOnly(doc, target)) throw httpError(400, 'This element contains more than plain text — edit it in the Source tab.');
        res = A.setText(doc, target, o.text);
        label = 'Edit text';
        break;
      }
      case 'replace': {
        res = A.replaceNode(doc, target, o.source);
        label = 'Edit source';
        break;
      }
      case 'delete': {
        const name = target.name;
        res = A.deleteNode(doc, target);
        if (target.type === 'component') res.src = A.pruneImport(res.src, name.split('.')[0]);
        const parent = target.parent && target.parent.type !== 'root' ? target.parent : null;
        res.at = parent ? parent.start : null;
        label = `Delete ${name}`;
        break;
      }
      case 'duplicate': {
        res = A.duplicateNode(doc, target);
        label = `Duplicate ${target.name}`;
        break;
      }
      case 'move': {
        res = A.moveNode(doc, target, o.dir);
        label = `Move ${target.name} ${o.dir}`;
        break;
      }
      case 'wrap': {
        const inner = src.slice(target.start, target.end);
        const tag = o.tag || 'div';
        res = A.replaceNode(doc, target, `<${tag} class="${A.escapeAttr(o.cls || '')}">\n  ${inner}\n</${tag}>`);
        label = 'Wrap in container';
        break;
      }
      case 'insert': {
        // Resolve where to put it.
        let anchor = target;
        let position = o.position || 'after';
        if (o.dropRef && !anchor) {
          const r = o.dropRef;
          if (r.file === file) anchor = doc.findByLoc(r.loc);
          else {
            const imports = this.componentMap(file, doc);
            const inst = doc.all.filter((x) => x.type === 'component' && imports[x.name.split('.')[0]] === r.file);
            anchor = inst[r.index || 0] || inst[0] || null;
          }
          position = r.where === 'before' ? 'before' : 'after';
        }
        if (o.pageLevel) {
          const container = this.defaultContainer(doc);
          if (anchor && container) {
            let a = anchor;
            while (a.parent && a.parent !== container && a.parent.type !== 'root') a = a.parent;
            if (a.parent === container) anchor = a;
            else if (a === container) {
              anchor = container;
              position = 'inside-end';
            } else anchor = null;
          }
          if (!anchor) {
            anchor = container;
            position = 'inside-end';
          }
        }
        let snippet = o.html;
        let workDoc = doc;
        let shift = 0;
        if (o.component) {
          if (o.component === SMART_IMAGE) this.ensureSmartImage();
          let componentFile = o.component;
          if (o.copy) {
            // "Copy for this page": duplicate the file first, then place the copy.
            const dir = path.posix.dirname(o.component);
            const base = path.basename(o.component, '.astro');
            const page = this.pages().find((p) => p.file === file);
            const suffix = (page ? page.name : path.basename(file, '.astro')).replace(/[^A-Za-z0-9]/g, '').replace(/^\w/, (c) => c.toUpperCase()) || 'Copy';
            let n = base + suffix;
            for (let k = 2; this.exists(`${dir}/${n}.astro`); k++) n = base + suffix + k;
            componentFile = `${dir}/${n}.astro`;
            extra.push({ file: componentFile, content: this.read(o.component) });
          }
          const { name, needsImport, source } = this.importNameFor(file, doc, componentFile);
          snippet = o.withSlot ? `<${name}>\n  <p>Content</p>\n</${name}>` : `<${name}${o.attrs ? ' ' + o.attrs : ''} />`;
          if (needsImport) {
            const r = A.addImport(doc, name, source);
            shift = r.delta;
            workDoc = A.parse(r.src);
            if (anchor) anchor = workDoc.findByStart(anchor.start + shift);
          }
          label = `Add ${name}`;
        } else label = 'Add element';
        if (!snippet) throw httpError(400, 'Nothing to insert');
        res = A.insertAt(workDoc, anchor, anchor ? position : 'after', snippet);
        break;
      }
      default:
        throw httpError(400, `Unknown operation: ${o.type}`);
    }

    if (res.src !== src || extra.length)
      await this.transaction(label, () => {
        for (const e of extra) this.write(e.file, e.content);
        this.write(file, res.src);
      });
    let select = null;
    if (res.at != null) {
      doc = A.parse(res.src);
      const node = doc.findByStart(res.at) || doc.all.find((x) => x.start >= res.at);
      if (node) select = { file, start: node.start, loc: node.loc, name: node.name, type: node.type };
    }
    return { ok: true, select };
  }

  // ---- pages -------------------------------------------------------------
  createPage({ route, title, layout }) {
    let r = String(route || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9\-_/\[\].]+/g, '-');
    if (!r) throw httpError(400, 'Give the page a URL, like "about" or "pricing".');
    const file = `src/pages/${r}.astro`;
    if (this.exists(file) || this.exists(`src/pages/${r}/index.astro`)) throw httpError(409, `A page already exists at /${r}`);
    const t = title || titleCase(r.split('/').pop());
    const layouts = this.components().layouts;
    const lay = layout === null ? null : layouts.find((l) => l.file === layout) || layouts[0];
    let src;
    if (lay) {
      let imp = path.posix.relative(path.posix.dirname(file), lay.file);
      if (!imp.startsWith('.')) imp = './' + imp;
      src = `---\nimport ${lay.name} from '${imp}';\n---\n\n<${lay.name} title="${A.escapeAttr(t)}">\n  <section class="mx-auto max-w-5xl px-6 py-24">\n    <h1 class="font-display text-5xl font-semibold tracking-tight">${A.escapeText(t)}</h1>\n    <p class="mt-4 text-lg text-muted">This is a brand-new page. Double-click any text to edit it, or add blocks from the Assets panel.</p>\n  </section>\n</${lay.name}>\n`;
    } else {
      src = `---\n---\n\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width" />\n    <title>${A.escapeText(t)}</title>\n  </head>\n  <body>\n    <h1>${A.escapeText(t)}</h1>\n  </body>\n</html>\n`;
    }
    this.transaction(`Create page /${r}`, () => this.write(file, src));
    return { file, route: '/' + r };
  }

  renameFile(from, to) {
    if (this.exists(to)) throw httpError(409, `${to} already exists`);
    const content = this.read(from);
    this.transaction(`Rename ${path.basename(from)}`, () => {
      this.write(to, content);
      this.remove(from);
    });
  }

  duplicateFile(file) {
    const ext = path.extname(file);
    const base = file.slice(0, -ext.length);
    let to = `${base}-copy${ext}`;
    for (let k = 2; this.exists(to); k++) to = `${base}-copy-${k}${ext}`;
    this.transaction(`Duplicate ${path.basename(file)}`, () => this.write(to, this.read(file)));
    return to;
  }

  /** Create a new form component from the builder's template, pre-filled from a preset. */
  createForm({ name, preset }) {
    const clean = String(name || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
    if (!clean) throw httpError(400, 'Give the form a name, like “Quote request”.');
    let Name = clean.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    if (!/^[A-Z]/.test(Name)) Name = 'Form' + Name;
    if (!/form$/i.test(Name)) Name += 'Form';
    const file = `src/components/forms/${Name}.astro`;
    if (this.exists(file)) throw httpError(409, `A form called ${Name} already exists.`);
    let src = fs.readFileSync(path.join(TEMPLATES, 'Form.astro'), 'utf8');
    const p = FORM_PRESETS[preset] || FORM_PRESETS.contact;
    for (const [k, v] of Object.entries(p.values)) src = W.setFieldDefault(src, k, v);
    src = src.replace('// A form made with the form builder.', `// ${clean} — a form made with the form builder.`);
    this.transaction(`Create form ${Name}`, () => this.write(file, src));
    return { file };
  }

  createComponent({ name, folder, kind }) {
    const clean = String(name || '').replace(/[^A-Za-z0-9]/g, '');
    if (!clean) throw httpError(400, 'Give the component a name.');
    const Name = clean.charAt(0).toUpperCase() + clean.slice(1);
    const dir = kind === 'layout' ? 'src/layouts' : 'src/components' + (folder ? '/' + folder.replace(/[^A-Za-z0-9\-_/]/g, '') : '');
    const file = `${dir}/${Name}.astro`;
    if (this.exists(file)) throw httpError(409, `${Name} already exists`);
    const src =
      kind === 'layout'
        ? `---\nimport '../styles/global.css';\nconst { title = 'Untitled' } = Astro.props;\n---\n\n<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>{title}</title>\n  </head>\n  <body class="bg-bg text-fg antialiased">\n    <main>\n      <slot />\n    </main>\n  </body>\n</html>\n`
        : `---\n// ${Name} — a reusable block. Edit it visually or right here.\n---\n\n<section class="px-6 py-20">\n  <div class="mx-auto max-w-5xl">\n    <h2 class="font-display text-3xl font-semibold tracking-tight">${Name}</h2>\n    <p class="mt-3 text-muted">Describe this section.</p>\n  </div>\n</section>\n`;
    this.transaction(`Create ${Name}`, () => this.write(file, src));
    return { file };
  }

  // ---- media -------------------------------------------------------------
  async saveMedia(name, buffer, keepOriginal = false) {
    const ext = path.extname(name).toLowerCase();
    if (!MEDIA_EXT.has(ext)) throw httpError(400, `Unsupported file type: ${ext || 'unknown'}`);
    const base = path.basename(name, path.extname(name)).toLowerCase().replace(/[^a-z0-9\-_]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
    // Photos go where Astro can optimise them; everything else is served as it is.
    const dir = RASTER_EXT.has(ext) && !keepOriginal ? 'src/assets' : 'public/media';
    let rel = `${dir}/${base}${ext}`;
    for (let k = 2; this.exists(rel); k++) rel = `${dir}/${base}-${k}${ext}`;
    await fsp.mkdir(path.dirname(this.abs(rel)), { recursive: true });
    await fsp.writeFile(this.abs(rel), buffer);
    return { file: rel, url: rel.startsWith('public/') ? '/' + rel.replace(/^public\//, '') : '/' + rel, optimised: rel.startsWith('src/assets/') };
  }
  deleteMedia(file) {
    if (!file.startsWith('public/') && !file.startsWith('src/assets/')) throw httpError(400, 'Not a media file');
    fs.rmSync(this.abs(file), { force: true });
  }

  // ---- content collections ----------------------------------------------
  contentConfigFile() {
    return ['src/content.config.ts', 'src/content.config.mjs', 'src/content.config.js', 'src/content/config.ts'].find((f) => this.exists(f)) || null;
  }

  collections() {
    const cfgFile = this.contentConfigFile();
    const cfg = stripComments(cfgFile ? this.read(cfgFile) : '');
    // The name a collection goes by is its key in `export const collections = { blog: blogCollection }`,
    // which need not be the name of the variable that defines it.
    const exported = new Map();
    const exp = /export\s+const\s+collections\s*=\s*\{([\s\S]*?)\}/.exec(cfg);
    if (exp) for (const part of exp[1].split(',')) {
      const kv = /^\s*['"]?([\w-]+)['"]?\s*(?::\s*(\w+))?\s*$/.exec(part);
      if (kv) exported.set(kv[2] || kv[1], kv[1]);
    }
    const found = new Map();
    // const blog = defineCollection({ loader: glob({ base: './src/content/blog', ... }), schema: z.object({ ... }) })
    const re = /(?:const|let|var)\s+(\w+)\s*=\s*defineCollection\s*\(/g;
    let m;
    while ((m = re.exec(cfg))) {
      const open = cfg.indexOf('(', m.index + m[0].length - 1);
      const body = cfg.slice(open, matchingClose(cfg, open));
      const base = /base:\s*['"]([^'"]+)['"]/.exec(body);
      const pattern = /pattern:\s*(\[[^\]]*\]|['"][^'"]+['"])/.exec(body);
      const fields = [];
      const so = /z\.object\(\s*\{/.exec(body);
      if (so) {
        const from = so.index + so[0].length - 1;
        // `...commonFields` pulls in a set of fields declared once and shared between collections.
        const parts = splitTopLevel(body.slice(from + 1, matchingClose(body, from))).flatMap((part) => {
          const spread = /^\s*\.\.\.(\w+)\s*$/.exec(part);
          const decl = spread && new RegExp(`(?:const|let|var)\\s+${spread[1]}\\s*=\\s*\\{`).exec(cfg);
          if (!decl) return [part];
          const at = decl.index + decl[0].length - 1;
          return splitTopLevel(cfg.slice(at + 1, matchingClose(cfg, at)));
        });
        for (const part of parts) {
          const f = /^\s*['"]?(\w+)['"]?\s*:\s*([\s\S]+?)\s*$/.exec(part);
          if (!f) continue;
          const dup = fields.findIndex((x) => x.name === f[1]);
          if (dup >= 0) fields.splice(dup, 1); // a later declaration of the same field wins, as it does in the code
          const def = f[2];
          let type = 'text';
          if (/^z\s*\.\s*(object|record|tuple)\b|^z\s*\.\s*array\(\s*z\s*\.\s*object\b/.test(def)) type = 'group';
          else if (/z\.(coerce\.)?date/.test(def)) type = 'date';
          else if (/z\.boolean/.test(def)) type = 'boolean';
          else if (/z\.(coerce\.)?number/.test(def)) type = 'number';
          else if (/z\.array/.test(def)) type = 'tags';
          else if (/\bimage\(\)/.test(def) || (/image|cover|thumbnail|photo|avatar/i.test(f[1]) && !/(alt|caption|credit|title)$/i.test(f[1]))) type = 'image';
          else if (/description|summary|excerpt|bio/i.test(f[1])) type = 'textarea';
          // `image()` is Astro's own image type: it wants a path relative to the entry, into src/.
          fields.push({ name: f[1], type, required: /^(z\b|image\()/.test(def) && !/\.(optional|default|nullish|nullable)\(|z\s*\.\s*optional\(/.test(def), ...(/\bimage\(\)/.test(def) ? { asset: true } : {}) });
        }
      }
      const name = exported.get(m[1]) || m[1];
      found.set(name, { name, dir: base ? toPosix(path.posix.normalize(base[1])).replace(/^\.\//, '') : `src/content/${name}`, fields, match: pattern ? globMatcher(pattern[1]) : null });
    }
    // folders without config still show up
    const contentDir = path.join(this.root, 'src/content');
    const taken = new Set([...found.values()].map((c) => c.dir));
    if (fs.existsSync(contentDir)) {
      for (const ent of fs.readdirSync(contentDir, { withFileTypes: true })) {
        if (ent.isDirectory() && !ent.name.startsWith('_') && !found.has(ent.name) && !taken.has(`src/content/${ent.name}`)) found.set(ent.name, { name: ent.name, dir: `src/content/${ent.name}`, fields: [], unconfigured: true });
      }
    }
    return [...found.values()].map(({ match, ...c }) => {
      const entries = this.entries(c).filter((e) => !match || match(e.file.slice(c.dir.length + 1)));
      if (!c.fields.length) {
        const keys = new Map();
        for (const e of entries) for (const [k, v] of Object.entries(e.data)) if (!keys.has(k)) keys.set(k, v);
        c.fields = [...keys.entries()].map(([name, v]) => ({ name, required: false, type: v instanceof Date || /date/i.test(name) ? 'date' : typeof v === 'boolean' ? 'boolean' : isGroup(v) ? 'group' : Array.isArray(v) ? 'tags' : typeof v === 'number' ? 'number' : /image|cover/i.test(name) && !/(alt|caption|credit|title)$/i.test(name) ? 'image' : /description|summary|excerpt/i.test(name) ? 'textarea' : 'text' }));
        if (!c.fields.length) c.fields = [{ name: 'title', type: 'text', required: true }];
      }
      return { ...c, entries: entries.map(({ body, ...e }) => e) };
    });
  }

  entries(c) {
    return this.walk(c.dir, (n) => /\.(md|mdx)$/.test(n))
      .map((file) => {
        const parsed = matter(this.read(file));
        const data = normalizeData(parsed.data);
        return { id: file.slice(c.dir.length + 1).replace(/\.(md|mdx)$/, ''), file, data, title: data.title || path.basename(file).replace(/\.(md|mdx)$/, ''), draft: !!data.draft, body: parsed.content };
      })
      .sort((a, b) => String(b.data.pubDate || b.data.date || '').localeCompare(String(a.data.pubDate || a.data.date || '')));
  }

  entry(file) {
    const parsed = matter(this.read(file));
    return { file, data: normalizeData(parsed.data), body: parsed.content.replace(/^\n+/, '') };
  }

  saveEntry(file, data, body) {
    const tidy = (d) => {
      const out = {};
      for (const [k, v] of Object.entries(d || {})) if (v !== '' && v !== null && v !== undefined) out[k] = v;
      return out;
    };
    const clean = tidy(data);
    const text = String(body ?? '').replace(/^\n+/, '').replace(/\s*$/, '\n');
    // When only the writing changed, keep the fields above it exactly as they were typed.
    const raw = this.readOr(file, '');
    let out = null;
    if (raw) {
      const was = matter(raw);
      const head = raw.slice(0, raw.length - was.content.length);
      if (/^---/.test(head) && JSON.stringify(tidy(normalizeData(was.data))) === JSON.stringify(clean)) out = head.replace(/\n*$/, '\n\n') + text;
    }
    out ??= matter.stringify('\n' + text, clean, { lineWidth: -1 });
    if (out === raw) return;
    this.transaction(`Edit ${path.basename(file)}`, () => this.write(file, out));
  }

  createEntry(collectionName, title) {
    const c = this.collections().find((x) => x.name === collectionName);
    if (!c) throw httpError(404, 'No such collection');
    const slug = String(title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
    let file = `${c.dir}/${slug}.md`;
    for (let k = 2; this.exists(file); k++) file = `${c.dir}/${slug}-${k}.md`;
    const data = {};
    for (const f of c.fields) {
      if (f.name === 'title') data.title = title || 'Untitled';
      else if (f.type === 'date') data[f.name] = new Date().toISOString().slice(0, 10);
      else if (f.type === 'boolean') data[f.name] = f.name === 'draft';
      else if (f.type === 'tags') data[f.name] = [];
      else if (f.required) data[f.name] = f.type === 'number' ? 0 : f.name === 'description' ? 'A short summary of this entry.' : '';
    }
    if (!('title' in data)) data.title = title || 'Untitled';
    const out = matter.stringify('\nStart writing here. This editor speaks **Markdown**.\n', Object.fromEntries(Object.entries(data).filter(([, v]) => v !== '')));
    this.transaction(`New ${collectionName} entry`, () => this.write(file, out));
    return { file };
  }

  createCollection(name) {
    const n = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!n || !/^[a-z]/.test(n)) throw httpError(400, 'Collection names need to start with a letter (for example "docs").');
    if (this.collections().some((c) => c.name === n)) throw httpError(409, `A collection called "${n}" already exists.`);
    const decl = `const ${n} = defineCollection({\n  loader: glob({ base: './src/content/${n}', pattern: '**/*.{md,mdx}' }),\n  schema: z.object({\n    title: z.string(),\n    description: z.string().optional(),\n    pubDate: z.coerce.date().optional(),\n    draft: z.boolean().default(false),\n  }),\n});\n`;
    const cfgFile = this.contentConfigFile() || 'src/content.config.ts';
    let cfg = this.readOr(cfgFile, null);
    this.transaction(`Create collection ${n}`, () => {
      if (!cfg) {
        cfg = `import { defineCollection } from 'astro:content';\nimport { glob } from 'astro/loaders';\nimport { z } from 'astro/zod';\n\n${decl}\nexport const collections = { ${n} };\n`;
      } else {
        const exp = /export\s+const\s+collections\s*=\s*\{([\s\S]*?)\}/.exec(cfg);
        if (!exp) throw httpError(400, `Couldn't find "export const collections" in ${cfgFile}. Add the collection by hand in the code editor.`);
        const inner = exp[1].trim().replace(/,\s*$/, '');
        const next = `export const collections = { ${inner ? inner + ', ' : ''}${n} }`;
        cfg = cfg.slice(0, exp.index) + decl + '\n' + next + cfg.slice(exp.index + exp[0].length);
      }
      this.write(cfgFile, cfg);
      this.write(`src/content/${n}/hello-world.md`, matter.stringify('\nThis is the first entry in your new collection.\n', { title: 'Hello world', description: 'The first entry.', pubDate: new Date().toISOString().slice(0, 10), draft: false }));
    });
    return { name: n };
  }

  // ---- overall state -----------------------------------------------------
  state() {
    let pkg = {};
    try {
      pkg = JSON.parse(this.read('package.json'));
    } catch {}
    return {
      project: {
        name: pkg.name || path.basename(this.root),
        root: this.root,
        // The Design panel works by writing Tailwind classes, so it needs to know whether they would do anything.
        tailwind: ['tailwindcss', '@tailwindcss/vite', '@astrojs/tailwind'].some((d) => pkg.dependencies?.[d] || pkg.devDependencies?.[d]),
        packageManager: this.exists('pnpm-lock.yaml') ? 'pnpm' : this.exists('yarn.lock') ? 'yarn' : this.exists('bun.lock') || this.exists('bun.lockb') ? 'bun' : 'npm',
        // A dev script that does more than start Astro (generating files first, say) — the editor starts Astro itself and skips those steps.
        devScript: pkg.scripts?.dev && !/^\s*astro\s+dev(\s+--[\w-]+(=\S+)?)*\s*$/.test(pkg.scripts.dev) ? pkg.scripts.dev : null,
      },
      pages: this.pages(),
      ...this.components(),
      media: this.media(),
      collections: safe(() => this.collections(), []),
      theme: safe(() => this.theme(), { file: null, theme: {}, light: {}, dark: {} }),
      history: this.historyState(),
    };
  }
}

/**
 * A layout by where it is kept: in src/layouts, but not in one of the sub-folders projects use there
 * for the pieces layouts are built from (Astroplate keeps its components in src/layouts/components).
 * The preview route in preview/component.astro applies the same rule.
 */
const isLayoutPath = (file) => /^src\/layouts\//.test(file) && !/\/(components|partials|parts|helpers|widgets|ui|shortcodes|elements|blocks|sections)\//.test(file);

function safe(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    console.error('[astronut]', e.message);
    return fallback;
  }
}

function normalizeData(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  return out;
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// ---- reading content.config ----------------------------------------------
// Remove line and block comments, leaving anything inside a string alone: a glob such as "**" + "/*.md" is not a comment.
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const start = i;
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      out += src.slice(start, i + 1);
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 1;
    } else out += c;
  }
  return out;
}

/** Index of the bracket that closes the one at `open`. Strings are skipped. */
function matchingClose(src, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (pairs[c]) depth++;
    else if ((c === ')' || c === ']' || c === '}') && --depth === 0) return i;
  }
  return src.length;
}

/** Split "a: x, b: f(y, z)" at the commas that are not inside brackets or strings. */
function splitTopLevel(src) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(src.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(src.slice(start));
  return parts.filter((p) => p.trim());
}

/** A value the simple field controls can't hold: an object, or a list with objects in it. */
const isGroup = (v) => v != null && typeof v === 'object' && !(v instanceof Date) && (!Array.isArray(v) || v.some((x) => x != null && typeof x === 'object'));

/** Turn a loader's `pattern` (one glob, or a list of them, as written in the config) into a test for a path. */
function globMatcher(text) {
  const globs = [...text.matchAll(/['"]([^'"]+)['"]/g)].map((g) => g[1]);
  const tests = globs.map((g) => {
    let re = '';
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === '*' && g[i + 1] === '*') {
        re += g[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += g[i + 2] === '/' ? 2 : 1;
      } else if (c === '*') re += '[^/]*';
      else if (c === '?') re += '[^/]';
      else if (c === '{') re += '(?:';
      else if (c === '}') re += ')';
      else if (c === ',' && g.lastIndexOf('{', i) > g.lastIndexOf('}', i)) re += '|';
      else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
    }
    return { not: g.startsWith('!'), re: new RegExp('^' + re.replace(/^!/, '') + '$') };
  });
  if (!tests.length) return null;
  return (p) => tests.some((t) => !t.not && t.re.test(p)) && !tests.some((t) => t.not && t.re.test(p));
}
