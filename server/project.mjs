// Everything that reads or writes the Astro project on disk.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import * as A from './astro-source.mjs';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.avif', '.ico']);
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
      const route = '/' + r.replace(/\/$/, '');
      const dynamic = /\[/.test(route);
      let title = null;
      const src = this.readOr(file, '');
      const m = /<title>([^<{]+)<\/title>/.exec(src) || /\btitle=["']([^"']+)["']/.exec(src) || /^title:\s*["']?(.+?)["']?\s*$/m.exec(src);
      if (m) title = m[1].trim();
      return { file, route, dynamic, title, name: route === '/' ? 'Home' : titleCase(route.split('/').filter(Boolean).pop().replace(/[\[\]\.]/g, '')) };
    });
  }

  components() {
    const map = (dir, kind) =>
      this.walk(dir, (n) => n.endsWith('.astro')).map((file) => {
        const relToDir = file.slice(dir.length + 1);
        const parts = relToDir.split('/');
        const src = this.readOr(file, '');
        return {
          file,
          kind,
          name: path.basename(file, '.astro'),
          folder: parts.length > 1 ? parts.slice(0, -1).join('/') : '',
          dynamic: /getCollection|getEntry|Astro\.props|\.map\(/.test(src),
          hasSlot: /<slot[\s/>]/.test(src),
          previewId: file.replace(/^src\//, '').replace(/\.astro$/, '').split('/').join('~'),
        };
      });
    return { components: map('src/components', 'component'), layouts: map('src/layouts', 'layout') };
  }

  media() {
    return this.walk('public', (n) => MEDIA_EXT.has(path.extname(n).toLowerCase())).map((file) => {
      const st = fs.statSync(this.abs(file));
      return { file, url: '/' + file.replace(/^public\//, ''), name: path.basename(file), size: st.size, image: IMAGE_EXT.has(path.extname(file).toLowerCase()), mtime: st.mtimeMs };
    });
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
    if (!node && ref?.loc) node = doc.findByLoc(ref.loc);
    if (!node) throw httpError(409, 'That element could not be found in the source — it may have changed. Try selecting it again.');
    if (ref.name && node.name !== ref.name && ref.start != null && ref.loc) {
      const alt = doc.findByLoc(ref.loc);
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
    };
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

    switch (o.type) {
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
          const { name, needsImport, source } = this.importNameFor(file, doc, o.component);
          snippet = o.withSlot ? `<${name}>\n  <p>Content</p>\n</${name}>` : `<${name} />`;
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

    if (res.src !== src) await this.transaction(label, () => this.write(file, res.src));
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
  async saveMedia(name, buffer) {
    const ext = path.extname(name).toLowerCase();
    if (!MEDIA_EXT.has(ext)) throw httpError(400, `Unsupported file type: ${ext || 'unknown'}`);
    const base = path.basename(name, path.extname(name)).toLowerCase().replace(/[^a-z0-9\-_]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
    let rel = `public/media/${base}${ext}`;
    for (let k = 2; this.exists(rel); k++) rel = `public/media/${base}-${k}${ext}`;
    await fsp.mkdir(path.dirname(this.abs(rel)), { recursive: true });
    await fsp.writeFile(this.abs(rel), buffer);
    return { file: rel, url: '/' + rel.replace(/^public\//, '') };
  }
  deleteMedia(file) {
    if (!file.startsWith('public/')) throw httpError(400, 'Not a media file');
    fs.rmSync(this.abs(file), { force: true });
  }

  // ---- content collections ----------------------------------------------
  contentConfigFile() {
    return ['src/content.config.ts', 'src/content.config.mjs', 'src/content.config.js', 'src/content/config.ts'].find((f) => this.exists(f)) || null;
  }

  collections() {
    const cfgFile = this.contentConfigFile();
    const cfg = cfgFile ? this.read(cfgFile) : '';
    const found = new Map();
    // const blog = defineCollection({ loader: glob({ base: './src/content/blog', ... }), schema: z.object({ ... }) })
    const re = /(?:const|let|var)\s+(\w+)\s*=\s*defineCollection\s*\(/g;
    let m;
    while ((m = re.exec(cfg))) {
      const open = cfg.indexOf('(', m.index + m[0].length - 1);
      let depth = 0;
      let end = open;
      for (let i = open; i < cfg.length; i++) {
        if (cfg[i] === '(') depth++;
        else if (cfg[i] === ')' && --depth === 0) {
          end = i;
          break;
        }
      }
      const body = cfg.slice(open, end);
      const base = /base:\s*['"]([^'"]+)['"]/.exec(body);
      const fields = [];
      const so = /z\.object\(\s*\{/.exec(body);
      if (so) {
        const lines = body.slice(so.index + so[0].length).split('\n');
        for (const line of lines) {
          const f = /^\s*(\w+)\s*:\s*(.+?),?\s*$/.exec(line);
          if (!f) {
            if (/^\s*\}\s*\)/.test(line)) break;
            continue;
          }
          const def = f[2];
          let type = 'text';
          if (/z\.(coerce\.)?date/.test(def)) type = 'date';
          else if (/z\.boolean/.test(def)) type = 'boolean';
          else if (/z\.(coerce\.)?number/.test(def)) type = 'number';
          else if (/z\.array/.test(def)) type = 'tags';
          else if (/image|cover|thumbnail|photo|avatar/i.test(f[1])) type = 'image';
          else if (/description|summary|excerpt|bio/i.test(f[1])) type = 'textarea';
          fields.push({ name: f[1], type, required: !/\.optional\(\)|\.default\(/.test(def) });
        }
      }
      found.set(m[1], { name: m[1], dir: base ? toPosix(path.posix.normalize(base[1])).replace(/^\.\//, '') : `src/content/${m[1]}`, fields });
    }
    // folders without config still show up
    const contentDir = path.join(this.root, 'src/content');
    if (fs.existsSync(contentDir)) {
      for (const ent of fs.readdirSync(contentDir, { withFileTypes: true })) {
        if (ent.isDirectory() && !ent.name.startsWith('_') && !found.has(ent.name)) found.set(ent.name, { name: ent.name, dir: `src/content/${ent.name}`, fields: [], unconfigured: true });
      }
    }
    return [...found.values()].map((c) => {
      const entries = this.entries(c);
      if (!c.fields.length) {
        const keys = new Map();
        for (const e of entries) for (const [k, v] of Object.entries(e.data)) if (!keys.has(k)) keys.set(k, v);
        c.fields = [...keys.entries()].map(([name, v]) => ({ name, required: false, type: v instanceof Date || /date/i.test(name) ? 'date' : typeof v === 'boolean' ? 'boolean' : Array.isArray(v) ? 'tags' : typeof v === 'number' ? 'number' : /image|cover/i.test(name) ? 'image' : /description|summary|excerpt/i.test(name) ? 'textarea' : 'text' }));
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
    const clean = {};
    for (const [k, v] of Object.entries(data || {})) if (v !== '' && v !== null && v !== undefined) clean[k] = v;
    const out = matter.stringify('\n' + String(body ?? '').replace(/^\n+/, ''), clean);
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
      project: { name: pkg.name || path.basename(this.root), root: this.root },
      pages: this.pages(),
      ...this.components(),
      media: this.media(),
      collections: safe(() => this.collections(), []),
      theme: safe(() => this.theme(), { file: null, theme: {}, light: {}, dark: {} }),
      history: this.historyState(),
    };
  }
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    console.error('[astrolabe]', e.message);
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
