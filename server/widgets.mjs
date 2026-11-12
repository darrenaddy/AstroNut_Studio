// Widgets: components whose content comes from named fields.
//
// Nothing here is AstroNut Studio-specific on disk. A "field" is an ordinary Astro
// prop with a default value:
//
//   const { title = "Calm software", image = "/media/a.svg" } = Astro.props;
//
// and a placement's own values are ordinary attributes on its tag:
//
//   <Hero title="Simple pricing" />
//
// This module reads that convention out of a component file and edits it.
import * as A from './astro-source.mjs';

const RESERVED = new Set(['class', 'default', 'function', 'return', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'new', 'delete', 'import', 'export', 'true', 'false', 'null', 'undefined', 'this', 'typeof', 'in', 'of', 'slot', 'Astro', 'props', 'await', 'async', 'switch', 'case', 'break', 'try', 'catch', 'void', 'with', 'yield', 'enum', 'super', 'static']);

// ---- tiny JS helpers ----------------------------------------------------------

/** Index just past the bracket that closes the one at `i`, skipping strings. */
function matchBracket(s, i) {
  const open = s[i];
  const close = { '{': '}', '(': ')', '[': ']' }[open];
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === '"' || c === "'" || c === '`') {
      k = skipString(s, k) - 1;
      continue;
    }
    if (c === '/' && s[k + 1] === '/') {
      const e = s.indexOf('\n', k);
      k = e < 0 ? s.length : e;
      continue;
    }
    if (c === '/' && s[k + 1] === '*') {
      const e = s.indexOf('*/', k + 2);
      k = e < 0 ? s.length : e + 1;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return k + 1;
  }
  return -1;
}
function skipString(s, i) {
  const q = s[i];
  for (let k = i + 1; k < s.length; k++) {
    if (s[k] === '\\') k++;
    else if (s[k] === q) return k + 1;
  }
  return s.length;
}
/** Split on top-level commas; returns [{ text, start, end }] with offsets into `s`. */
function splitTop(s) {
  const out = [];
  let start = 0;
  let depth = 0;
  for (let k = 0; k <= s.length; k++) {
    const c = s[k];
    if (c === '"' || c === "'" || c === '`') {
      k = skipString(s, k) - 1;
      continue;
    }
    if (c === '/' && s[k + 1] === '/') {
      const e = s.indexOf('\n', k);
      k = e < 0 ? s.length : e;
      continue;
    }
    if ('{([<'.includes(c) && c !== '<') depth++;
    else if ('})]'.includes(c)) depth--;
    if (k === s.length || (c === ',' && depth === 0)) {
      if (s.slice(start, k).trim()) out.push({ text: s.slice(start, k), start, end: k });
      start = k + 1;
    }
  }
  return out;
}
/** Parse a JS literal we know how to edit. Returns { ok, value }. */
export function parseLiteral(text) {
  const t = String(text).trim();
  if (t === 'true') return { ok: true, value: true };
  if (t === 'false') return { ok: true, value: false };
  if (/^-?\d+(\.\d+)?$/.test(t)) return { ok: true, value: Number(t) };
  const q = t[0];
  if ((q === '"' || q === "'" || q === '`') && t.length >= 2 && t.at(-1) === q && skipString(t, 0) === t.length) {
    if (q === '`' && /\$\{/.test(t)) return { ok: false };
    let out = '';
    for (let k = 1; k < t.length - 1; k++) {
      const c = t[k];
      if (c !== '\\') {
        out += c;
        continue;
      }
      const n = t[++k];
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(t.slice(k + 1, k + 5))) {
        out += String.fromCharCode(parseInt(t.slice(k + 1, k + 5), 16));
        k += 4;
      } else if (n === '\n') out += '';
      else out += n;
    }
    return { ok: true, value: out };
  }
  return { ok: false };
}

/** `'a' | 'b'` → ['a', 'b'] */
const unionOf = (t) => (t && /^(['"][^'"]*['"]\s*\|\s*)+['"][^'"]*['"]$/.test(t.trim()) ? t.split('|').map((s) => s.trim().slice(1, -1)) : null);
/** `name?: type;` pairs at the top level of an interface body. */
function propTypes(body) {
  const out = {};
  let depth = 0;
  let start = 0;
  const flush = (end) => {
    const seg = body.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
    const t = /^\s*(\w+)\??\s*:\s*([\s\S]+?)\s*$/.exec(seg);
    if (t) out[t[1]] = t[2];
    start = end + 1;
  };
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c === '"' || c === "'") k = skipString(body, k) - 1;
    else if (c === '/' && body[k + 1] === '*') k = Math.max(k, body.indexOf('*/', k + 2) + 1);
    else if ('{(<['.includes(c)) depth++;
    else if ('})>]'.includes(c)) depth--;
    else if ((c === ';' || c === '\n') && depth === 0) flush(k);
  }
  flush(body.length);
  return out;
}
/** The `/** … *\/` comment written above each prop becomes its help text. */
function propDocs(body) {
  const out = {};
  for (const m of body.matchAll(/\/\*\*([\s\S]*?)\*\/\s*(\w+)\??\s*:/g)) out[m[2]] = m[1].replace(/^\s*\*\s?/gm, '').replace(/\s+/g, ' ').trim();
  return out;
}

const labelOf = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
    .replace(/\bcta\b/g, 'CTA')
    .replace(/\burl\b/g, 'URL');

// ---- reading a component's fields --------------------------------------------

/**
 * Returns { fields, destructure, iface, doc }.
 * A field: { name, label, type, default, options? } where type is one of
 * text | longtext | image | link | toggle | choice | number | code.
 */
export function parseFields(src) {
  const doc = A.parse(src);
  const empty = { fields: [], destructure: null, iface: null, doc };
  if (!doc.frontmatter) return empty;
  const fmStart = doc.frontmatter.contentStart;
  const fm = src.slice(fmStart, doc.frontmatter.contentEnd);

  // const { a = 1, b } = Astro.props
  let destructure = null;
  const re = /\b(?:const|let|var)\s*\{/g;
  let m;
  while ((m = re.exec(fm))) {
    const open = m.index + m[0].length - 1;
    const end = matchBracket(fm, open);
    if (end < 0) break;
    const tail = /^\s*=\s*Astro\.props\b\s*;?/.exec(fm.slice(end));
    if (tail) {
      destructure = { start: fmStart + m.index, bodyStart: fmStart + open + 1, bodyEnd: fmStart + end - 1, end: fmStart + end + tail[0].length };
      break;
    }
  }

  // interface Props { a?: string; b?: 'x' | 'y' }   (or: type Props = { ... })
  let iface = null;
  const types = {};
  const docs = {};
  let ifaceBody = '';
  const im = /\b(?:interface\s+Props\s*(?:extends\s+[^{]+)?|type\s+Props\s*=\s*)\{/.exec(fm);
  if (im) {
    const open = im.index + im[0].length - 1;
    const end = matchBracket(fm, open);
    if (end > 0) {
      iface = { bodyStart: fmStart + open + 1, bodyEnd: fmStart + end - 1 };
      const body = fm.slice(open + 1, end - 1);
      Object.assign(types, propTypes(body));
      Object.assign(docs, propDocs(body));
      ifaceBody = body;
    }
  }
  if (!destructure) return { ...empty, iface };

  // How each prop is used in the template tells us what kind of field it is.
  const usage = {};
  for (const node of doc.all) {
    for (const a of node.attrs) {
      if (a.kind !== 'expr' && a.kind !== 'shorthand') continue;
      const v = a.kind === 'shorthand' ? a.name : String(a.value).trim();
      if (!/^\w+$/.test(v || '')) continue;
      const an = a.kind === 'shorthand' ? a.name : a.name;
      if (/^(src|poster)$/.test(an)) usage[v] ??= 'image';
      else if (an === 'href') usage[v] ??= 'link';
    }
    const inner = node.closeStart != null && !node.children.length ? /^\s*\{\s*(\w+)\s*\}\s*$/.exec(src.slice(node.openEnd, node.closeStart)) : null;
    if (inner) usage[inner[1]] ??= 'text';
  }

  const fields = [];
  const body = src.slice(destructure.bodyStart, destructure.bodyEnd);
  for (const part of splitTop(body)) {
    const text = part.text.trim();
    if (text.startsWith('...')) continue;
    const eq = (() => {
      // first top-level "=" (not "=>", "==")
      let depth = 0;
      for (let k = 0; k < text.length; k++) {
        const c = text[k];
        if (c === '"' || c === "'" || c === '`') {
          k = skipString(text, k) - 1;
          continue;
        }
        if ('{(['.includes(c)) depth++;
        else if ('})]'.includes(c)) depth--;
        else if (c === '=' && depth === 0 && text[k + 1] !== '=' && text[k + 1] !== '>') return k;
      }
      return -1;
    })();
    const left = (eq < 0 ? text : text.slice(0, eq)).trim();
    const name = left.split(':')[0].trim();
    if (!/^[A-Za-z_$][\w$]*$/.test(name) || left.includes(':')) {
      if (/^[A-Za-z_$][\w$]*$/.test(name)) fields.push({ name, label: labelOf(name), type: 'code', default: null, raw: text.slice(eq + 1).trim() });
      continue;
    }
    const rawDefault = eq < 0 ? null : text.slice(eq + 1).trim();
    const lit = rawDefault == null ? { ok: true, value: undefined } : parseLiteral(rawDefault);
    const declared = types[name] || '';
    const union = unionOf(declared);
    let type;
    let def = lit.ok ? lit.value : null;
    const list = !lit.ok && rawDefault != null ? parseJs(rawDefault) : { ok: false };
    const isList = list.ok && Array.isArray(list.value) && list.value.length > 0 && list.value.every(isSimpleItem);
    if (isList) {
      type = 'list';
      def = list.value;
    } else if (!lit.ok) type = 'code';
    // A prop with no default that isn't shown as text, an image or a link is data
    // handed in by code (a blog post object, say) — not something to type into a form.
    else if (rawDefault == null && !usage[name] && !union && !/^(string|boolean|number)$/.test(declared)) type = 'code';
    else if (typeof def === 'boolean' || /^boolean$/.test(declared)) type = 'toggle';
    else if (union) type = 'choice';
    else if (typeof def === 'number' || /^number$/.test(declared)) type = 'number';
    else if (usage[name] === 'image' || /^(src|image|photo|picture|avatar|logo|heroImage|cover)$/.test(name)) type = 'image';
    else if (usage[name] === 'link') type = 'link';
    else if (typeof def === 'string' && (def.length > 90 || def.includes('\n'))) type = 'longtext';
    else type = 'text';
    if (def === undefined) def = type === 'toggle' ? false : type === 'number' ? null : '';
    const field = { name, label: labelOf(name), type, default: def };
    if (docs[name]) field.help = docs[name];
    if (type === 'list') {
      Object.assign(field, listShape(src, doc, name, def));
      // The item type in the interface (`fields?: Array<{ type: 'a' | 'b'; … }>`) adds choices and help text.
      const im2 = new RegExp(`\\b${name}\\??\\s*:\\s*(?:Array<\\s*)?\\{`).exec(ifaceBody);
      if (im2) {
        const o = im2.index + im2[0].length - 1;
        const e = matchBracket(ifaceBody, o);
        if (e > 0) {
          const inner = ifaceBody.slice(o + 1, e - 1);
          const it = propTypes(inner);
          const idocs = propDocs(inner);
          for (const k of field.itemFields) {
            const u = unionOf(it[k.name]);
            if (u) Object.assign(k, { type: 'choice', options: u });
            else if (it[k.name] === 'boolean') k.type = 'toggle';
            if (idocs[k.name]) k.help = idocs[k.name];
          }
        }
      }
    }
    if (union) field.options = union;
    if (type === 'code') field.raw = rawDefault;
    fields.push(field);
  }
  return { fields, destructure, iface, doc };
}

/** The field an element displays, when its whole content is `{fieldName}`. */
export function fieldOfNode(doc, node, fields) {
  if (node.closeStart == null || node.children.length) return null;
  const m = /^\s*\{\s*(\w+)\s*\}\s*$/.exec(doc.src.slice(node.openEnd, node.closeStart));
  return m && fields.some((f) => f.name === m[1] && f.type !== 'code') ? m[1] : null;
}

// ---- a placement's values ------------------------------------------------------

/** What a placement (`<Hero title="…" />`) sets for each field. */
export function readValues(node, fields) {
  const out = {};
  for (const f of fields) {
    const a = node.attrs.find((x) => x.name === f.name);
    if (!a) {
      out[f.name] = { set: false, value: f.default };
      continue;
    }
    if (a.kind === 'bool') out[f.name] = { set: true, value: f.type === 'toggle' ? true : '' };
    else if (a.kind === 'string') out[f.name] = { set: true, value: f.type === 'toggle' ? a.value !== 'false' : f.type === 'number' ? Number(a.value) : A.decodeEntities(a.value) };
    else {
      let lit = a.kind === 'expr' ? parseLiteral(a.value) : { ok: false };
      if (f.type === 'list') {
        const js = a.kind === 'expr' ? parseJs(a.value) : { ok: false };
        lit = js.ok && Array.isArray(js.value) && js.value.every(isSimpleItem) ? js : { ok: false };
      }
      out[f.name] = lit.ok ? { set: true, value: lit.value } : { set: true, value: null, code: a.raw.slice(f.name.length + 1) || `{${f.name}}` };
    }
  }
  return out;
}

/** The attribute text for a value, e.g. `title="Hello"` or `open={false}`. */
export function attrText(name, value) {
  if (typeof value === 'boolean' || typeof value === 'number') return `${name}={${value}}`;
  const s = String(value ?? '');
  // Plain quoted form when it is unambiguous; a JS string otherwise.
  return /["&{}\n\r\\]/.test(s) ? `${name}={${JSON.stringify(s)}}` : `${name}="${s}"`;
}

function putAttr(src, node, name, text) {
  const attr = node.attrs.find((a) => a.name === name);
  if (text == null) {
    if (!attr) return src;
    let s = attr.start;
    while (s > node.nameEnd && /[ \t]/.test(src[s - 1])) s--;
    return src.slice(0, s) + src.slice(attr.end);
  }
  if (attr) return src.slice(0, attr.start) + text + src.slice(attr.end);
  const pos = node.attrs.length ? node.attrs.at(-1).end : node.nameEnd;
  return src.slice(0, pos) + ' ' + text + src.slice(pos);
}

/** Set (or with `null`, reset to the default) one field on a placement. */
export function setFieldValue(src, node, field, value) {
  if (value === null || value === undefined) return putAttr(src, node, field.name, null);
  if (field.type === 'list') {
    if (!Array.isArray(value)) throw new Error('A list field needs a list of items.');
    if (JSON.stringify(value) === JSON.stringify(field.default)) return putAttr(src, node, field.name, null);
    const ls = src.lastIndexOf('\n', node.start - 1) + 1;
    const indent = /^[ \t]*/.exec(src.slice(ls, node.start))[0];
    return putAttr(src, node, field.name, `${field.name}={${toJs(value, indent + '  ')}}`);
  }
  let v = value;
  if (field.type === 'toggle') v = !!value;
  else if (field.type === 'number') v = Number(value);
  else v = String(value);
  // Storing the default is the same as not setting it — keep pages tidy.
  if (v === field.default) return putAttr(src, node, field.name, null);
  return putAttr(src, node, field.name, attrText(field.name, v));
}

/** Change a field's default value inside the component file. */
export function setFieldDefault(src, name, value) {
  const { fields, destructure } = parseFields(src);
  const field = fields.find((f) => f.name === name);
  if (!field || !destructure || field.type === 'code') throw new Error(`“${name}” is not an editable field of this component.`);
  const body = src.slice(destructure.bodyStart, destructure.bodyEnd);
  for (const part of splitTop(body)) {
    const text = part.text;
    const m = /^(\s*)([A-Za-z_$][\w$]*)(\s*=\s*)?/.exec(text);
    if (!m || m[2] !== name) continue;
    const lit = field.type === 'list' ? toJs(value, '  ') : field.type === 'toggle' ? String(!!value) : field.type === 'number' ? String(Number(value)) : JSON.stringify(String(value ?? ''));
    const trailing = /\s*$/.exec(text)[0];
    const next = `${m[1]}${name} = ${lit}${trailing}`;
    return src.slice(0, destructure.bodyStart + part.start) + next + src.slice(destructure.bodyStart + part.end);
  }
  throw new Error(`Couldn't find “${name}” in the component.`);
}

// ---- turning literal content into a field -------------------------------------

export function fieldKindsFor(doc, node) {
  const kinds = [];
  if (node.type !== 'element' || node.inExpr) return kinds;
  if (A.isTextOnly(doc, node) && A.textOf(doc, node)) kinds.push('text');
  const str = (n) => {
    const a = A.getAttr(node, n);
    return a && a.kind === 'string' ? a : null;
  };
  if (node.name === 'img' && str('src')) kinds.push('image');
  if (node.name === 'a' && str('href')) kinds.push('link');
  if (repeatingChildren(doc, node)) kinds.push('list');
  return kinds;
}

export function suggestName(node, kind, taken) {
  let base;
  if (kind === 'list') base = 'items';
  else if (kind === 'image') base = 'image';
  else if (kind === 'link') base = node.children.length ? 'link' : 'buttonLink';
  else if (/^h[1-2]$/.test(node.name)) base = 'title';
  else if (/^h[3-6]$/.test(node.name)) base = 'heading';
  else if (node.name === 'p') base = 'text';
  else if (node.name === 'a' || node.name === 'button') base = 'buttonLabel';
  else base = 'label';
  let name = base;
  for (let k = 2; taken.has(name); k++) name = base + k;
  return name;
}

export function checkFieldName(src, name) {
  if (!/^[a-z][A-Za-z0-9]*$/.test(name)) return 'Use a short name made of letters and numbers, starting with a lower-case letter — for example “title” or “buttonLabel”.';
  if (RESERVED.has(name)) return `“${name}” is a reserved word. Pick another name.`;
  const doc = A.parse(src);
  // It only clashes with real names: existing fields, imports, and declared variables or functions.
  // (A key inside a list item, like `title:` in `items = [{ title: … }]`, is not a clash.)
  const fm = (doc.frontmatter ? src.slice(doc.frontmatter.contentStart, doc.frontmatter.contentEnd) : '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
  const taken = new Set(parseFields(src).fields.map((f) => f.name));
  for (const m of fm.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) taken.add(m[1]);
  for (const m of fm.matchAll(/\bimport\s+([^'"]+?)\s+from\b/g)) for (const n of m[1].replace(/[{}*]/g, ' ').split(/[\s,]+/)) if (n && n !== 'as' && n !== 'type') taken.add(n);
  for (const m of src.slice(doc.templateStart).matchAll(/\.map\(\s*\(?\s*([A-Za-z_$][\w$]*)/g)) taken.add(m[1]);
  if (taken.has(name)) return `“${name}” is already used in this component. Pick another name.`;
  return null;
}

/**
 * Replace an element's literal text (or an image's src / a link's href) with a
 * field, keeping today's content as the field's default — so every existing
 * placement looks exactly the same afterwards.
 */
export function turnIntoField(src, node, kind, name) {
  const problem = checkFieldName(src, name);
  if (problem) throw new Error(problem);
  const doc = A.parse(src);
  let value;
  let out;
  if (kind === 'text') {
    if (!A.isTextOnly(doc, node)) throw new Error('Only an element that holds plain text can become a text field.');
    value = A.textOf(doc, node);
    out = src.slice(0, node.openEnd) + `{${name}}` + src.slice(node.closeStart);
  } else {
    const attrName = kind === 'image' ? 'src' : 'href';
    const a = A.getAttr(node, attrName);
    if (!a || a.kind !== 'string') throw new Error(`This element's ${attrName} is already set from code.`);
    value = A.decodeEntities(a.value);
    out = src.slice(0, a.start) + `${attrName}={${name}}` + src.slice(a.end);
  }
  return { src: addFieldDecl(out, name, JSON.stringify(value), 'string'), value };
}


/** Add `name = <default>` to the component's props (creating the frontmatter / destructure if needed). */
function addFieldDecl(out, name, defaultText, tsType) {
  if (defaultText.includes('\n')) out = tidyDestructure(out, true);
  const decl = `${name} = ${defaultText}`;
  const info = parseFields(out);

  // Interface first (it sits after or before the destructure — handle by offset order).
  const edits = [];
  if (info.iface) {
    const body = out.slice(info.iface.bodyStart, info.iface.bodyEnd);
    const indent = /\n([ \t]+)\S/.exec(body)?.[1] ?? '  ';
    const trimmedEnd = info.iface.bodyStart + body.replace(/\s*$/, '').length;
    edits.push({ at: trimmedEnd, text: `\n${indent}${name}?: ${tsType};` });
  }
  if (info.destructure) {
    const body = out.slice(info.destructure.bodyStart, info.destructure.bodyEnd);
    const multiline = body.includes('\n');
    const trimmed = body.replace(/\s*$/, '');
    const at = info.destructure.bodyStart + trimmed.replace(/,$/, '').length;
    const hadComma = /,$/.test(trimmed);
    if (!trimmed.trim()) edits.push({ at: info.destructure.bodyStart, text: ` ${decl}`, del: 0 });
    else if (multiline) {
      const indent = /\n([ \t]+)\S/.exec(body)?.[1] ?? '  ';
      edits.push({ at, text: `,\n${indent}${decl}${hadComma ? '' : ','}` });
    } else edits.push({ at, text: `, ${decl}` });
  } else if (info.doc.frontmatter) {
    const end = info.doc.frontmatter.contentEnd;
    const before = out.slice(info.doc.frontmatter.contentStart, end);
    edits.push({ at: end, text: `${before && !before.endsWith('\n') ? '\n' : ''}const { ${decl} } = Astro.props;\n` });
  } else {
    edits.push({ at: 0, text: `---\nconst { ${decl} } = Astro.props;\n---\n\n` });
  }
  for (const e of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, e.at) + e.text + out.slice(e.at);
  return tidyDestructure(out, defaultText.includes('\n'));
}

/** A short before/after of the lines an edit changes, for confirmation dialogs. */
export function diffLines(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  const removed = [];
  const added = [];
  // walk with a simple LCS-free heuristic: collect lines that only exist on one side
  const setA = new Map();
  for (const l of a) setA.set(l, (setA.get(l) || 0) + 1);
  const setB = new Map();
  for (const l of b) setB.set(l, (setB.get(l) || 0) + 1);
  for (const l of a) if ((setB.get(l) || 0) < (setA.get(l) || 0) && l.trim() && !removed.includes(l)) removed.push(l);
  for (const l of b) if ((setA.get(l) || 0) < (setB.get(l) || 0) && l.trim() && !added.includes(l)) added.push(l);
  // Long lines usually differ in one small spot: show that spot, not the unchanged start.
  const focus = (line, others) => {
    let best = 0;
    for (const o of others) {
      let k = 0;
      while (k < line.length && k < o.length && line[k] === o[k]) k++;
      best = Math.max(best, k);
    }
    const t = line.trim();
    const lead = line.length - line.trimStart().length;
    const from = Math.max(0, best - lead - 40);
    const cut = from > 0 ? '…' + t.slice(from) : t;
    return cut.length > 170 ? cut.slice(0, 170) + '…' : cut;
  };
  return { removed: removed.slice(0, 8).map((l) => focus(l, added)), added: added.slice(0, 8).map((l) => focus(l, removed)) };
}

/** Put a long one-line `const { … } = Astro.props` on one line per field, so it stays readable. */
export function tidyDestructure(src, force = false) {
  const { destructure } = parseFields(src);
  if (!destructure) return src;
  const body = src.slice(destructure.bodyStart, destructure.bodyEnd);
  if (!body.trim() || /^[ \t]*\r?\n/.test(body)) return src; // empty, or already one per line
  if (!force && !body.includes('\n') && destructure.end - destructure.start <= 100) return src;
  const parts = splitTop(body).map((p) => p.text.trim());
  return src.slice(0, destructure.bodyStart) + '\n' + parts.map((p) => `  ${p},`).join('\n') + '\n' + src.slice(destructure.bodyEnd);
}

// ---- list fields ----------------------------------------------------------------
// A list field is a prop whose default is an array of simple objects:
//
//   const { items = [{ title: "Plans", text: "…" }, { title: "Focus", text: "…" }] } = Astro.props;
//   {items.map((item) => <div><h3>{item.title}</h3><p>{item.text}</p></div>)}

const isSimple = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
const isSimpleItem = (o) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 0 && Object.values(o).every(isSimple);

/** Parse a JS literal made of arrays, plain objects, strings, numbers and booleans. */
export function parseJs(text) {
  const s = String(text);
  let i = 0;
  const ws = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s[i] === '/' && s[i + 1] === '/') {
        const e = s.indexOf('\n', i);
        i = e < 0 ? s.length : e;
      } else if (s[i] === '/' && s[i + 1] === '*') {
        const e = s.indexOf('*/', i + 2);
        i = e < 0 ? s.length : e + 2;
      } else return;
    }
  };
  const fail = () => {
    throw new Error('not a plain literal');
  };
  const value = () => {
    ws();
    const c = s[i];
    if (c === '[') {
      i++;
      const arr = [];
      for (;;) {
        ws();
        if (s[i] === ']') {
          i++;
          return arr;
        }
        arr.push(value());
        ws();
        if (s[i] === ',') i++;
        else if (s[i] !== ']') fail();
      }
    }
    if (c === '{') {
      i++;
      const obj = {};
      for (;;) {
        ws();
        if (s[i] === '}') {
          i++;
          return obj;
        }
        let key;
        if (s[i] === '"' || s[i] === "'") {
          const e = skipString(s, i);
          key = parseLiteral(s.slice(i, e)).value;
          i = e;
        } else {
          const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i));
          if (!m) fail();
          key = m[0];
          i += key.length;
        }
        ws();
        if (s[i] !== ':') fail();
        i++;
        obj[key] = value();
        ws();
        if (s[i] === ',') i++;
        else if (s[i] !== '}') fail();
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      const e = skipString(s, i);
      const lit = parseLiteral(s.slice(i, e));
      if (!lit.ok) fail();
      i = e;
      return lit.value;
    }
    const m = /^(true|false|-?\d+(\.\d+)?)/.exec(s.slice(i));
    if (!m) fail();
    i += m[0].length;
    return m[0] === 'true' ? true : m[0] === 'false' ? false : Number(m[0]);
  };
  try {
    const v = value();
    ws();
    return i === s.length ? { ok: true, value: v } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Write a value back as tidy JS: one item per line, long items one key per line. */
export function toJs(value, indent = '') {
  const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
  const flat = (v) => (Array.isArray(v) ? `[${v.map(flat).join(', ')}]` : v && typeof v === 'object' ? `{ ${Object.entries(v).map(([k, x]) => `${key(k)}: ${flat(x)}`).join(', ')} }` : JSON.stringify(v));
  if (!Array.isArray(value)) return flat(value);
  if (!value.length) return '[]';
  const inner = indent + '  ';
  const items = value.map((item) => {
    const one = flat(item);
    if (one.length + inner.length <= 110 || !item || typeof item !== 'object' || Array.isArray(item)) return `${inner}${one},`;
    const lines = Object.entries(item).map(([k, x]) => {
      const f = flat(x);
      if (Array.isArray(x) && f.length > 90) return `${inner}  ${key(k)}: [\n${x.map((y) => `${inner}    ${flat(y)},`).join('\n')}\n${inner}  ],`;
      return `${inner}  ${key(k)}: ${f},`;
    });
    return `${inner}{\n${lines.join('\n')}\n${inner}},`;
  });
  return `[\n${items.join('\n')}\n${indent}]`;
}

/** Work out the per-item fields of a list from its default items and how the template uses them. */
function listShape(src, doc, name, items) {
  const m = new RegExp(`\\b${name}\\s*\\.map\\(\\s*\\(?\\s*([A-Za-z_$][\\w$]*)`).exec(src.slice(doc.templateStart));
  const param = m ? m[1] : null;
  const usage = {};
  if (param) {
    for (const node of doc.all) {
      for (const a of node.attrs) {
        if (a.kind !== 'expr') continue;
        const k = new RegExp(`^${param}\\.(\\w+)$`).exec(String(a.value).trim());
        if (!k) continue;
        if (/^(src|poster)$/.test(a.name)) usage[k[1]] ??= 'image';
        else if (a.name === 'href') usage[k[1]] ??= 'link';
        else if (a.name === 'set:html') usage[k[1]] ??= 'html';
      }
    }
  }
  const keys = [];
  for (const it of items) for (const k of Object.keys(it)) if (!keys.includes(k)) keys.push(k);
  const itemFields = keys.map((k) => {
    const sample = items.map((it) => it[k]).find((v) => v !== undefined);
    let type;
    if (Array.isArray(sample)) type = 'lines';
    else if (typeof sample === 'boolean') type = 'toggle';
    else if (typeof sample === 'number') type = 'number';
    else if (usage[k]) type = usage[k];
    else if (/^(image|img|photo|avatar|logo|picture|src)$/i.test(k)) type = 'image';
    else if (/^(href|link|url)$/i.test(k)) type = 'link';
    else if (/^(icon|svg|html)$/i.test(k) && /^\s*</.test(String(sample))) type = 'html';
    else if (items.some((it) => String(it[k] ?? '').length > 80)) type = 'longtext';
    else type = 'text';
    return { name: k, label: labelOf(k), type };
  });
  return { itemFields, param };
}

/** The list item value an element shows, when its whole content is `{item.key}`. */
export function listItemOfNode(doc, node, fields) {
  if (node.closeStart == null || node.children.length) return null;
  const m = /^\s*\{\s*(\w+)\.(\w+)\s*\}\s*$/.exec(doc.src.slice(node.openEnd, node.closeStart));
  if (!m) return null;
  const f = fields.find((x) => x.type === 'list' && x.param === m[1] && x.itemFields.some((k) => k.name === m[2] && (k.type === 'text' || k.type === 'longtext')));
  return f ? { field: f.name, key: m[2] } : null;
}

const clean = (s) => s.replace(/<!--[\s\S]*?-->/g, '').trim();

/** The element's children, when they look like a repeated set that could become a list. */
function repeatingChildren(doc, node) {
  if (node.type !== 'element' || node.inExpr || node.raw || node.closeStart == null) return null;
  const kids = node.children;
  if (kids.length < 2 || kids.some((k) => k.type !== 'element' || k.inExpr || k.name !== kids[0].name || k.name === 'script' || k.name === 'style')) return null;
  // nothing but whitespace/comments between or around them
  let pos = node.openEnd;
  for (const k of kids) {
    if (clean(doc.src.slice(pos, k.start))) return null;
    pos = k.end;
  }
  if (clean(doc.src.slice(pos, node.closeStart))) return null;
  return kids;
}

const insideTag = (node, stop, tag) => {
  for (let p = node.parent; p && p !== stop.parent; p = p.parent) if (p.name === tag) return true;
  return false;
};

const SLOT_ATTRS = new Set(['src', 'href', 'alt', 'title', 'datetime', 'aria-label', 'poster', 'width', 'height']);

/**
 * Turn an element's repeated children (three cards, six questions…) into one
 * list field: the first child becomes the template inside `.map()`, and
 * whatever differs between the children becomes each item's values.
 */
export function turnIntoList(src, node, name) {
  const problem = checkFieldName(src, name);
  if (problem) throw new Error(problem);
  const doc = A.parse(src);
  const kids = repeatingChildren(doc, node);
  if (!kids) throw new Error('Select the element that directly contains the repeating items (the row of cards, the list of questions). Its children need to be the items and nothing else.');
  const fm = doc.frontmatter ? src.slice(doc.frontmatter.contentStart, doc.frontmatter.contentEnd) : '';
  const param = /\bitem\b/.test(fm) ? 'entry' : 'item';

  const slots = []; // { kind: 'text'|'attr'|'html', attr?, nodes: [one per item], key }
  const differ = (what, n) => new Error(`The items aren’t alike enough to become a list: ${what} differs (at <${n.name}> on line ${n.line}). Make the items match, or ask the AI to convert this block.`);
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  const walk = (nodes) => {
    const first = nodes[0];
    for (const n of nodes) {
      if (n.name !== first.name || n.type !== first.type) throw differ('the structure', n);
      if (n.inExpr) throw differ('code-generated content', n);
    }
    if (first.name === 'svg') {
      if (nodes.some((n) => norm(src.slice(n.start, n.end)) !== norm(src.slice(first.start, first.end)))) slots.push({ kind: 'html', nodes });
      return;
    }
    if (nodes.some((n) => n.attrs.length !== first.attrs.length || n.children.length !== first.children.length)) throw differ('the structure', nodes.find((n) => n.attrs.length !== first.attrs.length || n.children.length !== first.children.length));
    first.attrs.forEach((a, k) => {
      const all = nodes.map((n) => n.attrs[k]);
      if (all.some((x) => x.name !== a.name)) throw differ('an attribute', first);
      if (all.every((x) => x.raw === a.raw)) return;
      if (all.every((x) => x.kind === 'string') && SLOT_ATTRS.has(a.name)) slots.push({ kind: 'attr', attr: a.name, index: k, nodes });
      else throw differ(a.name === 'class' ? 'the styling (class)' : `the “${a.name}” attribute`, nodes.find((n, j) => all[j].raw !== a.raw));
    });
    if (!first.children.length) {
      if (first.closeStart == null) return;
      const inners = nodes.map((n) => src.slice(n.openEnd, n.closeStart));
      if (inners.every((t) => norm(t) === norm(inners[0]))) return;
      if (nodes.every((n) => A.isTextOnly(doc, n))) slots.push({ kind: 'text', nodes });
      else throw differ('the content', first);
      return;
    }
    // text mixed in between child elements has to match
    const loose = (n) => {
      let t = '';
      let pos = n.openEnd;
      for (const c of n.children) {
        t += src.slice(pos, c.start);
        pos = c.end;
      }
      return norm(clean(t + src.slice(pos, n.closeStart)));
    };
    if (nodes.some((n) => loose(n) !== loose(first))) throw differ('some loose text', first);
    first.children.forEach((_, k) => walk(nodes.map((n) => n.children[k])));
  };
  walk(kids);
  if (!slots.length) throw new Error('These items are all identical, so there is nothing to put in a list.');

  // name each slot
  const used = new Set();
  const unique = (base) => {
    let k = base;
    for (let n = 2; used.has(k); n++) k = base + n;
    used.add(k);
    return k;
  };
  for (const sl of slots) {
    const tag = sl.nodes[0].name;
    if (sl.kind === 'html') sl.key = unique('icon');
    else if (sl.kind === 'attr') sl.key = unique(sl.attr === 'src' ? 'image' : sl.attr === 'href' ? 'link' : sl.attr === 'alt' ? 'alt' : sl.attr.replace(/-(\w)/g, (_, c) => c.toUpperCase()));
    else if (sl.nodes[0].name !== 'summary' && insideTag(sl.nodes[0], kids[0], 'summary')) sl.key = unique('question');
    else if (kids[0].name === 'details' && tag === 'p') sl.key = unique('answer');
    else sl.key = unique(/^h[1-6]$/.test(tag) ? 'title' : tag === 'summary' ? 'question' : tag === 'blockquote' ? 'quote' : tag === 'p' ? 'text' : tag === 'a' || tag === 'button' ? 'label' : tag === 'dt' ? 'term' : tag === 'dd' ? 'value' : tag === 'figcaption' ? 'caption' : tag === 'li' ? 'point' : 'label');
  }

  // Cards with a portrait are people: call their text quote / name / role rather than text, text2…
  if (slots.some((s) => s.kind === 'attr' && s.attr === 'src')) {
    const texts = slots.filter((s) => s.kind === 'text');
    const avg = (s) => s.nodes.reduce((n, x) => n + A.textOf(doc, x).length, 0) / s.nodes.length;
    const quoted = (s) => ['blockquote', 'q'].includes(s.nodes[0].name) || insideTag(s.nodes[0], kids[0], 'blockquote') || /^[“"‘«]/.test(A.textOf(doc, s.nodes[0]));
    const quote = texts.find((s) => avg(s) > 70 && quoted(s));
    const rest = texts.filter((s) => s !== quote);
    const names = ['name', 'role', 'bio', 'detail', 'label'];
    for (const s of texts) used.delete(s.key);
    if (quote) quote.key = unique('quote');
    rest.forEach((s, k) => (s.key = unique(avg(s) > 70 ? 'bio' : names[Math.min(k, names.length - 1)])));
  }

  // each item's values
  const items = kids.map((_, i) => {
    const item = {};
    for (const sl of slots) {
      const n = sl.nodes[i];
      if (sl.kind === 'text') item[sl.key] = A.textOf(doc, n);
      else if (sl.kind === 'attr') item[sl.key] = A.decodeEntities(n.attrs[sl.index].value);
      else item[sl.key] = norm(src.slice(n.start, n.end));
    }
    return item;
  });

  // the first child becomes the template
  const first = kids[0];
  const edits = slots
    .map((sl) => {
      const n = sl.nodes[0];
      if (sl.kind === 'text') return { start: n.openEnd, end: n.closeStart, text: `{${param}.${sl.key}}` };
      if (sl.kind === 'attr') return { start: n.attrs[sl.index].start, end: n.attrs[sl.index].end, text: `${sl.attr}={${param}.${sl.key}}` };
      return { start: n.start, end: n.end, text: `<Fragment set:html={${param}.${sl.key}} />` };
    })
    .sort((a, b) => b.start - a.start);
  let tpl = src.slice(first.start, first.end);
  for (const e of edits) tpl = tpl.slice(0, e.start - first.start) + e.text + tpl.slice(e.end - first.start);
  const ls = src.lastIndexOf('\n', first.start - 1) + 1;
  const indent = /^[ \t]*/.exec(src.slice(ls, first.start))[0];
  const block = `{\n${indent}  ${name}.map((${param}) => (\n${tpl
    .split('\n')
    .map((l, k) => (k === 0 ? indent + '    ' + l : l ? '    ' + l : l))
    .join('\n')}\n${indent}  ))\n${indent}}`;
  let out = src.slice(0, first.start) + block + src.slice(kids.at(-1).end);
  out = addFieldDecl(out, name, toJs(items, '  '), 'Array<Record<string, any>>');
  return { src: out, count: items.length, keys: slots.map((s) => s.key) };
}
