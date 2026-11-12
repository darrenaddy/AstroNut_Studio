// Fonts, the Astro way: the site's fonts are declared in astro.config under
// `fonts: [...]`, and Astro downloads and self-hosts them. This module reads
// and edits that list, and looks fonts up in the Fontsource catalogue.
import fs from 'node:fs';
import path from 'node:path';

/** The three roles the Theme panel manages, by the CSS variable each one fills. */
export const ROLES = [
  { id: 'heading', label: 'Headings', cssVariable: '--font-heading', sample: 'Calm software for busy teams' },
  { id: 'body', label: 'Body text', cssVariable: '--font-body', sample: 'The quick brown fox jumps over the lazy dog.' },
  { id: 'code', label: 'Code', cssVariable: '--font-code', sample: 'const answer = 42;' },
];

const CATALOGUE_URL = 'https://api.fontsource.org/v1/fonts';
const WEEK = 7 * 24 * 3600 * 1000;

export class Fonts {
  constructor(project, cacheDir) {
    this.project = project;
    this.cacheFile = path.join(cacheDir, 'font-catalogue.json');
    this.memory = null;
  }

  configFile() {
    return ['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.mts'].find((f) => this.project.exists(f)) || null;
  }

  /** The Fontsource catalogue (about 2,000 open-source families), cached for a week. */
  async catalogue() {
    if (this.memory) return this.memory;
    let cached = null;
    try {
      cached = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
    } catch {}
    if (!cached || Date.now() - cached.at > WEEK) {
      try {
        const res = await fetch(CATALOGUE_URL, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`error ${res.status}`);
        const list = (await res.json())
          .filter((f) => f.category !== 'icons' && f.subsets?.includes('latin'))
          .map((f) => ({ id: f.id, family: f.family, category: f.category, weights: f.weights, styles: f.styles, variable: !!f.variable }));
        cached = { at: Date.now(), list };
        fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
        fs.writeFileSync(this.cacheFile, JSON.stringify(cached));
      } catch (e) {
        if (!cached) throw new Error('Couldn’t load the font catalogue. Check your internet connection and try again.');
      }
    }
    this.memory = cached.list;
    return this.memory;
  }

  async search({ q = '', category = '', limit = 60 } = {}) {
    const list = await this.catalogue();
    const needle = q.trim().toLowerCase();
    const hits = list.filter((f) => (!category || f.category === category) && (!needle || f.family.toLowerCase().includes(needle)));
    // names that start with the search come first
    if (needle) hits.sort((a, b) => Number(b.family.toLowerCase().startsWith(needle)) - Number(a.family.toLowerCase().startsWith(needle)) || a.family.localeCompare(b.family));
    return { total: hits.length, fonts: hits.slice(0, limit) };
  }

  /** What astro.config currently declares: { file, supported, roles: [{ id, label, cssVariable, name, provider }] }. */
  state() {
    const file = this.configFile();
    if (!file) return { file: null, supported: false, roles: [] };
    const parsed = readFonts(this.project.read(file));
    const entries = parsed?.entries || [];
    // The three roles the starter uses are offered when the project declares them or its styles refer to
    // them. Any other font the project declares is listed under its own CSS variable, so it can be changed too.
    const used = this.project
      .walk('src', (n) => /\.(css|astro)$/.test(n))
      .map((f) => this.project.readOr(f, ''))
      .join('\n');
    const own = ROLES.map((r) => {
      const e = entries.find((x) => x.cssVariable === r.cssVariable);
      return { ...r, name: e?.name || null, provider: e?.provider || null };
    }).filter((r) => r.name || (used.includes(`var(${r.cssVariable}`) && !new RegExp(`${r.cssVariable}\\s*:`).test(used))); // not when the project's CSS sets that variable itself
    const others = entries
      .filter((e) => e.cssVariable && !ROLES.some((r) => r.cssVariable === e.cssVariable))
      .map((e) => ({ id: e.cssVariable, label: e.cssVariable, cssVariable: e.cssVariable, sample: 'The quick brown fox jumps over the lazy dog.', name: e.name, provider: e.provider || null }));
    const roles = [...own, ...others];
    return { file, supported: roles.some((r) => r.name), roles };
  }

  /** Point a role at a font from the catalogue. */
  async setRole(roleId, fontId) {
    const role = this.state().roles.find((r) => r.id === roleId);
    if (!role) throw new Error('Unknown font role.');
    const font = (await this.catalogue()).find((f) => f.id === fontId);
    if (!font) throw new Error('That font isn’t in the catalogue.');
    const file = this.configFile();
    if (!file) throw new Error('This project has no astro.config file.');
    const src = this.project.read(file);
    const next = setFont(src, role.cssVariable, entryFor(font, role));
    await this.project.transaction(`Use ${font.family} for ${role.label.toLowerCase()}`, () => this.project.write(file, next));
    return { family: font.family };
  }
}

/** The config entry for a catalogue font. */
function entryFor(font, role) {
  // Variable fonts take a weight range; others list the weights the site's styles use.
  const want = [300, 400, 500, 600, 700, 800];
  const weights = font.variable ? [`${Math.min(...font.weights)} ${Math.max(...font.weights)}`] : font.weights.filter((w) => want.includes(w));
  const w = weights.length ? weights : [font.weights.includes(400) ? 400 : font.weights[0]];
  const styles = ['normal', 'italic'].filter((s) => font.styles.includes(s));
  const fallback = role.id === 'code' || font.category === 'monospace' ? 'monospace' : font.category === 'serif' ? 'serif' : font.category === 'handwriting' ? 'cursive' : 'sans-serif';
  return `{ provider: fontProviders.fontsource(), name: ${JSON.stringify(font.family)}, cssVariable: ${JSON.stringify(role.cssVariable)}, weights: ${JSON.stringify(w).replace(/,/g, ', ')}, styles: ${JSON.stringify(styles.length ? styles : ['normal']).replace(/,/g, ', ')}, fallbacks: [${JSON.stringify(fallback)}] }`;
}

// ---- reading and editing the `fonts: [...]` array in astro.config ---------------

function matchBracket(s, i) {
  const pairs = { '[': ']', '{': '}', '(': ')' };
  const open = s[i];
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === '"' || c === "'" || c === '`') {
      for (k++; k < s.length && s[k] !== c; k++) if (s[k] === '\\') k++;
      continue;
    }
    if (c === '/' && s[k + 1] === '/') {
      k = s.indexOf('\n', k);
      if (k < 0) return -1;
      continue;
    }
    if (c === open) depth++;
    else if (c === pairs[open] && --depth === 0) return k + 1;
  }
  return -1;
}

/** Finds `fonts: [ … ]` and its entries: { open, close, entries: [{ start, end, raw, name, cssVariable, provider }] }. */
export function readFonts(src) {
  const m = /(^|[\s,{])fonts\s*:\s*\[/.exec(src);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const end = matchBracket(src, open);
  if (end < 0) return null;
  const entries = [];
  for (let k = open + 1; k < end - 1; k++) {
    if (src[k] === '/' && src[k + 1] === '/') {
      k = src.indexOf('\n', k);
      continue;
    }
    if (src[k] !== '{') continue;
    const e = matchBracket(src, k);
    if (e < 0) break;
    const raw = src.slice(k, e);
    entries.push({
      start: k,
      end: e,
      raw,
      name: /\bname\s*:\s*(["'])(.*?)\1/.exec(raw)?.[2] || null,
      cssVariable: /\bcssVariable\s*:\s*(["'])(.*?)\1/.exec(raw)?.[2] || null,
      provider: /fontProviders\.(\w+)\s*\(/.exec(raw)?.[1] || null,
    });
    k = e - 1;
  }
  return { open, close: end - 1, entries };
}

/** Replace (or add) the entry that fills `cssVariable`. */
export function setFont(src, cssVariable, entry) {
  let out = src;
  // make sure fontProviders is imported
  if (!/\bfontProviders\b/.test(out.split(/defineConfig\s*\(/)[0])) {
    const imp = /import\s*\{([^}]*)\}\s*from\s*(['"])astro\/config\2/.exec(out);
    if (imp) out = out.slice(0, imp.index) + imp[0].replace(imp[1], imp[1].replace(/\s*$/, '') + ', fontProviders ') + out.slice(imp.index + imp[0].length);
    else out = `import { fontProviders } from 'astro/config';\n` + out;
  }
  const parsed = readFonts(out);
  if (!parsed) {
    const dc = /defineConfig\s*\(\s*\{/.exec(out);
    if (!dc) throw new Error('Couldn’t find defineConfig({ … }) in the Astro config. Add the font by hand in the code editor.');
    const at = dc.index + dc[0].length;
    return out.slice(0, at) + `\n  // Fonts — Astro downloads these and serves them from your own site.\n  fonts: [\n    ${entry},\n  ],` + out.slice(at);
  }
  const existing = parsed.entries.find((e) => e.cssVariable === cssVariable);
  if (existing) return out.slice(0, existing.start) + entry + out.slice(existing.end);
  const before = out.slice(parsed.open + 1, parsed.close).replace(/\s*$/, '');
  const sep = !before.trim() ? '' : before.trimEnd().endsWith(',') ? '' : ',';
  return out.slice(0, parsed.open + 1) + before + sep + `\n    ${entry},\n  ` + out.slice(parsed.close);
}
