// A small, tolerant scanner for .astro templates.
//
// It does not try to understand JavaScript — it only needs to find every tag in
// the template with exact character offsets, so the editor can map a rendered
// DOM element (which Astro annotates with `data-astro-source-loc`) back to the
// source and splice edits in without reformatting anything else in the file.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);
const NAME_CHAR = /[A-Za-z0-9.:_-]/;

export function parse(src) {
  const n = src.length;

  const lineStarts = [0];
  for (let k = 0; k < n; k++) if (src.charCodeAt(k) === 10) lineStarts.push(k + 1);

  function locOf(offset) {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    // Astro counts columns in code points, 1-based.
    const col = [...src.slice(lineStarts[lo], offset)].length + 1;
    return { line: lo + 1, col };
  }

  // ---- frontmatter -------------------------------------------------------
  let frontmatter = null;
  let templateStart = 0;
  const open = /^\s*---[ \t]*\r?\n/.exec(src);
  if (open) {
    const contentStart = open[0].length;
    const closeRe = /^---[ \t]*\r?$/gm;
    closeRe.lastIndex = contentStart;
    const close = closeRe.exec(src);
    if (close) {
      frontmatter = {
        start: open[0].indexOf('---'),
        contentStart,
        contentEnd: close.index,
        end: close.index + close[0].length,
      };
      templateStart = frontmatter.end;
    }
  }

  // ---- low level skippers ------------------------------------------------
  function skipString(i) {
    const q = src[i];
    i++;
    while (i < n) {
      const c = src[i];
      if (c === '\\') i += 2;
      else if (c === q) return i + 1;
      else if (q !== '`' && c === '\n') return i;
      else if (q === '`' && c === '$' && src[i + 1] === '{') i = skipBraces(i + 1);
      else i++;
    }
    return n;
  }

  function skipComment(i) {
    if (src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      return e < 0 ? n : e;
    }
    const e = src.indexOf('*/', i + 2);
    return e < 0 ? n : e + 2;
  }

  // `i` points at "{" — returns the index just past the matching "}".
  function skipBraces(i) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '"' || c === "'" || c === '`') {
        i = skipString(i);
        continue;
      }
      if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
        i = skipComment(i);
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return n;
  }

  const isTagStart = (i) => /[A-Za-z>]/.test(src[i + 1] || '');

  function readName(i) {
    let s = i;
    while (i < n && NAME_CHAR.test(src[i])) i++;
    return src.slice(s, i);
  }

  // ---- tree --------------------------------------------------------------
  const root = { type: 'root', name: '#root', start: templateStart, openEnd: templateStart, closeStart: n, end: n, attrs: [], children: [], parent: null, inExpr: false };
  const all = [];
  const openNames = [];

  function parseElement(i, parent, inExpr, exprRoot = false) {
    const start = i;
    i++;
    const name = readName(i);
    i += name.length;
    const node = { type: 'element', name, start, attrs: [], children: [], parent, inExpr: !!inExpr, exprRoot, selfClosing: false };
    node.nameEnd = i;

    // attributes
    while (i < n) {
      while (i < n && /\s/.test(src[i])) i++;
      if (i >= n) break;
      if (src[i] === '/' && src[i + 1] === '>') {
        node.selfClosing = true;
        i += 2;
        break;
      }
      if (src[i] === '>') {
        i++;
        break;
      }
      const s = i;
      if (src[i] === '{') {
        i = skipBraces(i);
        const raw = src.slice(s, i);
        node.attrs.push({ kind: raw.startsWith('{...') ? 'spread' : 'shorthand', name: raw.startsWith('{...') ? null : raw.slice(1, -1).trim(), start: s, end: i, raw });
        continue;
      }
      while (i < n && !/[\s=>]/.test(src[i]) && !(src[i] === '/' && src[i + 1] === '>')) i++;
      const an = src.slice(s, i);
      if (!an) {
        i++;
        continue;
      }
      if (src[i] === '=') {
        i++;
        const vs = i;
        let kind = 'string';
        let value;
        if (src[i] === '"' || src[i] === "'") {
          const e = src.indexOf(src[i], i + 1);
          const ve = e < 0 ? n : e;
          value = src.slice(i + 1, ve);
          i = Math.min(n, ve + 1);
        } else if (src[i] === '{') {
          kind = 'expr';
          i = skipBraces(i);
          value = src.slice(vs + 1, i - 1);
        } else if (src[i] === '`') {
          kind = 'expr';
          i = skipString(i);
          value = src.slice(vs, i);
        } else {
          while (i < n && !/[\s>]/.test(src[i])) i++;
          value = src.slice(vs, i);
        }
        node.attrs.push({ kind, name: an, value, start: s, end: i, valueStart: vs, raw: src.slice(s, i) });
      } else {
        node.attrs.push({ kind: 'bool', name: an, value: true, start: s, end: i, raw: an });
      }
    }
    node.openEnd = i;

    if (name === '' || name === 'Fragment') node.type = 'fragment';
    else if (name === 'slot') node.type = 'slot';
    else if (/^[A-Z]/.test(name) || name.includes('.')) node.type = 'component';

    parent.children.push(node);
    all.push(node);

    if (node.selfClosing || (node.type === 'element' && VOID.has(name.toLowerCase()))) {
      node.isVoid = true;
      node.closeStart = null;
      node.end = i;
      return i;
    }

    if (RAW.has(name.toLowerCase())) {
      const idx = src.toLowerCase().indexOf('</' + name.toLowerCase(), i);
      node.raw = true;
      if (idx < 0) {
        node.closeStart = n;
        node.end = n;
        return n;
      }
      node.closeStart = idx;
      const e = src.indexOf('>', idx);
      node.end = e < 0 ? n : e + 1;
      return node.end;
    }

    openNames.push(name);
    i = parseChildren(node, i);
    openNames.pop();

    if (i < n && src.startsWith('</', i) && readName(i + 2) === name) {
      node.closeStart = i;
      const e = src.indexOf('>', i);
      node.end = e < 0 ? n : e + 1;
      return node.end;
    }
    // unclosed tag (or closed implicitly by an ancestor's close tag)
    node.closeStart = i;
    node.end = i;
    node.implicitClose = true;
    return i;
  }

  function parseChildren(node, i) {
    while (i < n) {
      const c = src[i];
      if (c === '<') {
        if (src.startsWith('<!--', i)) {
          const e = src.indexOf('-->', i);
          i = e < 0 ? n : e + 3;
          continue;
        }
        if (src[i + 1] === '/') {
          const nm = readName(i + 2);
          if (node.type !== 'root' && (nm === node.name || openNames.includes(nm))) return i;
          const e = src.indexOf('>', i);
          i = e < 0 ? n : e + 1;
          continue;
        }
        if (isTagStart(i)) {
          i = parseElement(i, node, node.inExpr);
          continue;
        }
        i++;
        continue;
      }
      if (c === '{') {
        i = parseExpr(i, node);
        continue;
      }
      i++;
    }
    return n;
  }

  function parseExpr(i, parent) {
    let depth = 0;
    let prev = '';
    while (i < n) {
      const c = src[i];
      if (c === '"' || c === "'" || c === '`') {
        i = skipString(i);
        prev = '"';
        continue;
      }
      if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
        i = skipComment(i);
        continue;
      }
      if (c === '{') {
        depth++;
        prev = c;
        i++;
        continue;
      }
      if (c === '}') {
        depth--;
        i++;
        if (depth <= 0) return i;
        prev = c;
        continue;
      }
      if (c === '<' && isTagStart(i)) {
        const before = src.slice(Math.max(0, i - 12), i);
        if (prev === '' || '({[,?:&|=>;!'.includes(prev) || /\breturn\s*$/.test(before)) {
          i = parseElement(i, parent, true, true);
          prev = ')';
          continue;
        }
      }
      if (!/\s/.test(c)) prev = c;
      i++;
    }
    return n;
  }

  parseChildren(root, templateStart);

  // ---- location index ----------------------------------------------------
  const byLoc = new Map();
  for (const node of all) {
    const a = locOf(node.openEnd);
    const b = locOf(node.start + 1);
    node.loc = node.isVoid ? `${b.line}:${b.col}` : `${a.line}:${a.col}`;
    node.line = locOf(node.start).line;
    for (const l of [a, b]) {
      const key = `${l.line}:${l.col}`;
      if (!byLoc.has(key)) byLoc.set(key, node);
    }
  }

  function findByLoc(loc) {
    if (byLoc.has(loc)) return byLoc.get(loc);
    const [line, col] = String(loc).split(':').map(Number);
    let best = null;
    let bestD = Infinity;
    for (const node of all) {
      for (const off of [node.openEnd, node.start + 1]) {
        const l = locOf(off);
        if (l.line !== line) continue;
        const d = Math.abs(l.col - col);
        if (d < bestD) {
          bestD = d;
          best = node;
        }
      }
    }
    return best;
  }

  const findByStart = (start) => all.find((x) => x.start === start) || null;

  return { src, frontmatter, templateStart, root, all, locOf, findByLoc, findByStart, lineStarts };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getAttr(node, name) {
  return node.attrs.find((a) => a.name === name) || null;
}

export function innerSource(doc, node) {
  if (node.closeStart == null) return '';
  return doc.src.slice(node.openEnd, node.closeStart);
}

/** True when the element holds nothing but literal text (so it can be edited in place). */
export function isTextOnly(doc, node) {
  if (node.type !== 'element' || node.isVoid || node.raw || node.inExpr) return false;
  if (node.children.length) return false;
  const inner = innerSource(doc, node);
  return !inner.includes('{') && !inner.includes('<');
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&#123;': '{', '&#125;': '}', '&lbrace;': '{', '&rbrace;': '}' };
export const decodeEntities = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp|#123|#125|lbrace|rbrace);/g, (m) => ENTITIES[m] ?? m);
export const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
export const escapeAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export function textOf(doc, node) {
  return decodeEntities(innerSource(doc, node).replace(/\s+/g, ' ').trim());
}

/** Imports declared in the frontmatter: [{ name, source, start, end }] */
export function getImports(doc) {
  if (!doc.frontmatter) return [];
  const fm = doc.src.slice(doc.frontmatter.contentStart, doc.frontmatter.contentEnd);
  const out = [];
  const re = /^[ \t]*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"];?[ \t]*\r?\n?/gm;
  let m;
  while ((m = re.exec(fm))) {
    out.push({ name: m[1], source: m[2], start: doc.frontmatter.contentStart + m.index, end: doc.frontmatter.contentStart + m.index + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Edits — each returns { src, at } where `at` is the start offset of the node
// the editor should select afterwards (or null).
// ---------------------------------------------------------------------------

function lineIndent(src, offset) {
  const ls = src.lastIndexOf('\n', offset - 1) + 1;
  const m = /^[ \t]*/.exec(src.slice(ls, offset));
  return { lineStart: ls, indent: m ? m[0] : '', onlyWhitespaceBefore: src.slice(ls, offset).trim() === '' };
}

function reindent(snippet, indent) {
  const lines = snippet.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const min = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)[0].length), Infinity);
  const cut = Number.isFinite(min) ? min : 0;
  return lines.map((l, k) => (k === 0 ? '' : indent) + l.slice(Math.min(cut, /^[ \t]*/.exec(l)[0].length))).join('\n');
}

export function setAttr(doc, node, name, value) {
  const { src } = doc;
  const attr = getAttr(node, name);
  if (value === null || value === undefined || value === false) {
    if (!attr) return { src, at: node.start };
    let s = attr.start;
    while (s > node.nameEnd && /[ \t]/.test(src[s - 1])) s--;
    return { src: src.slice(0, s) + src.slice(attr.end), at: node.start };
  }
  const text = value === true ? name : `${name}="${escapeAttr(value)}"`;
  if (attr) return { src: src.slice(0, attr.start) + text + src.slice(attr.end), at: node.start };
  // class goes first for readability; everything else is appended.
  const pos = name === 'class' || !node.attrs.length ? node.nameEnd : node.attrs[node.attrs.length - 1].end;
  return { src: src.slice(0, pos) + ' ' + text + src.slice(pos), at: node.start };
}

export function setText(doc, node, text) {
  if (node.closeStart == null) throw new Error('This element cannot contain text.');
  const { src } = doc;
  return { src: src.slice(0, node.openEnd) + escapeText(text) + src.slice(node.closeStart), at: node.start };
}

export function replaceNode(doc, node, source) {
  const { src } = doc;
  const { indent } = lineIndent(src, node.start);
  return { src: src.slice(0, node.start) + reindent(source, indent) + src.slice(node.end), at: node.start };
}

export function deleteNode(doc, node) {
  const { src } = doc;
  let s = node.start;
  let e = node.end;
  const before = lineIndent(src, s);
  const nl = src.indexOf('\n', e);
  const restOfLine = src.slice(e, nl < 0 ? src.length : nl);
  if (before.onlyWhitespaceBefore && restOfLine.trim() === '') {
    s = before.lineStart;
    e = nl < 0 ? src.length : nl + 1;
  }
  return { src: src.slice(0, s) + src.slice(e), at: null };
}

export function duplicateNode(doc, node) {
  const { src } = doc;
  const { indent, onlyWhitespaceBefore } = lineIndent(src, node.start);
  const text = src.slice(node.start, node.end);
  const sep = onlyWhitespaceBefore ? '\n' + indent : '';
  return { src: src.slice(0, node.end) + sep + text + src.slice(node.end), at: node.end + sep.length };
}

export function moveNode(doc, node, dir) {
  const sibs = node.parent.children;
  const idx = sibs.indexOf(node);
  const other = sibs[idx + (dir === 'up' ? -1 : 1)];
  if (!other) return { src: doc.src, at: node.start };
  const [a, b] = dir === 'up' ? [other, node] : [node, other];
  const { src } = doc;
  const A = src.slice(a.start, a.end);
  const mid = src.slice(a.end, b.start);
  const B = src.slice(b.start, b.end);
  const out = src.slice(0, a.start) + B + mid + A + src.slice(b.end);
  const at = dir === 'up' ? a.start : a.start + B.length + mid.length;
  return { src: out, at };
}

/** position: 'before' | 'after' | 'inside-start' | 'inside-end' */
export function insertAt(doc, node, position, snippet) {
  const { src } = doc;
  if (!node || node.type === 'root') {
    const trimmedEnd = src.replace(/\s+$/, '').length;
    const text = '\n' + reindent(snippet, '') + '\n';
    return { src: src.slice(0, trimmedEnd) + text + src.slice(trimmedEnd).replace(/^\s*/, ''), at: trimmedEnd + 1 };
  }
  if ((position === 'inside-start' || position === 'inside-end') && node.closeStart == null) position = 'after';

  if (position === 'before') {
    const { indent, onlyWhitespaceBefore } = lineIndent(src, node.start);
    const text = reindent(snippet, indent) + (onlyWhitespaceBefore ? '\n' + indent : '');
    return { src: src.slice(0, node.start) + text + src.slice(node.start), at: node.start };
  }
  if (position === 'after') {
    const { indent, onlyWhitespaceBefore } = lineIndent(src, node.start);
    const lead = onlyWhitespaceBefore ? '\n' + indent : '';
    return { src: src.slice(0, node.end) + lead + reindent(snippet, indent) + src.slice(node.end), at: node.end + lead.length };
  }
  const outer = lineIndent(src, node.start).indent;
  const inner = outer + '  ';
  const body = src.slice(node.openEnd, node.closeStart);
  if (position === 'inside-start') {
    const multiline = body.includes('\n') || body.trim() === '';
    if (multiline) {
      const text = '\n' + inner + reindent(snippet, inner);
      const tail = body.trim() === '' ? '\n' + outer : '';
      const rest = body.trim() === '' ? src.slice(node.closeStart) : src.slice(node.openEnd);
      return { src: src.slice(0, node.openEnd) + text + tail + rest, at: node.openEnd + 1 + inner.length };
    }
    return { src: src.slice(0, node.openEnd) + reindent(snippet, inner) + src.slice(node.openEnd), at: node.openEnd };
  }
  // inside-end
  if (body.trim() === '') {
    const text = '\n' + inner + reindent(snippet, inner) + '\n' + outer;
    return { src: src.slice(0, node.openEnd) + text + src.slice(node.closeStart), at: node.openEnd + 1 + inner.length };
  }
  const close = lineIndent(src, node.closeStart);
  if (close.onlyWhitespaceBefore) {
    const text = inner + reindent(snippet, inner) + '\n';
    return { src: src.slice(0, close.lineStart) + text + src.slice(close.lineStart), at: close.lineStart + inner.length };
  }
  return { src: src.slice(0, node.closeStart) + reindent(snippet, inner) + src.slice(node.closeStart), at: node.closeStart };
}

/** Adds `import Name from 'source'` to the frontmatter (creating it if needed). Returns { src, delta }. */
export function addImport(doc, name, source) {
  const { src } = doc;
  const imports = getImports(doc);
  if (imports.some((i) => i.name === name)) return { src, delta: 0 };
  const line = `import ${name} from '${source}';\n`;
  if (!doc.frontmatter) {
    const text = `---\n${line}---\n`;
    return { src: text + src, delta: text.length };
  }
  const pos = imports.length ? imports[imports.length - 1].end : doc.frontmatter.contentStart;
  const needsNl = pos > 0 && src[pos - 1] !== '\n';
  const text = (needsNl ? '\n' : '') + line;
  return { src: src.slice(0, pos) + text + src.slice(pos), delta: text.length };
}

/** Drops the import for `name` when no tag in the template uses it any more. */
export function pruneImport(src, name) {
  const doc = parse(src);
  if (doc.all.some((x) => x.name === name || x.name.startsWith(name + '.'))) return src;
  const imp = getImports(doc).find((i) => i.name === name);
  if (!imp) return src;
  const rest = src.slice(0, imp.start) + src.slice(imp.end);
  const fmBody = doc.frontmatter ? src.slice(doc.frontmatter.contentStart, doc.frontmatter.contentEnd) : '';
  // if the identifier is still referenced in frontmatter code, keep the import
  const others = fmBody.replace(src.slice(imp.start, imp.end), '');
  if (new RegExp(`\\b${name}\\b`).test(others)) return src;
  return rest;
}

// ---------------------------------------------------------------------------
// Source markers
// ---------------------------------------------------------------------------

/**
 * Mark every HTML element in a template with the file and position it came from, the way Astro's
 * own compiler does in dev mode. Some Astro versions leave these marks out; the editor adds them
 * itself there so that clicking an element in the preview can still find its source.
 * Positions are those of the original text, so they match what `parse` reports.
 */
export function stampSource(src, file) {
  const doc = parse(src);
  const marks = doc.all
    .filter((node) => node.type === 'element' && !RAW.has(node.name.toLowerCase()) && !getAttr(node, 'data-astro-source-file'))
    .sort((a, b) => b.nameEnd - a.nameEnd);
  let out = src;
  for (const node of marks) out = out.slice(0, node.nameEnd) + ` data-astro-source-file="${escapeAttr(file)}" data-astro-source-loc="${node.loc}"` + out.slice(node.nameEnd);
  return out;
}
