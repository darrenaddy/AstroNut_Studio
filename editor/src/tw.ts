// A small model of Tailwind utility classes: enough to read the current value
// of a "property" out of a class list and to swap it for another one.

export type Variant = string; // '' | 'sm:' | 'md:' | 'dark:' | 'md:hover:' …

const SIZE_WORDS = 'xs|sm|base|lg|xl|[2-9]xl';
const NON_COLOR_TEXT = `${SIZE_WORDS}|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip`;
const isColorArb = (v: string) => /^\[(#|rgb|hsl|oklch|oklab|color:|var\(--color|--color)/.test(v);
const isLenArb = (v: string) => /^\[/.test(v) && !isColorArb(v);

/** Each group is one CSS concern. `test` gets the class with variants stripped. */
export const GROUPS: Record<string, (c: string) => boolean> = {
  display: (c) => /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|hidden|contents)$/.test(c),
  flexDir: (c) => /^flex-(row|col|row-reverse|col-reverse)$/.test(c),
  wrap: (c) => /^flex-(wrap|nowrap|wrap-reverse)$/.test(c),
  justify: (c) => /^justify-(start|end|center|between|around|evenly|stretch|normal)$/.test(c),
  items: (c) => /^items-(start|end|center|baseline|stretch)$/.test(c),
  gap: (c) => /^gap-(?!x-|y-)/.test(c),
  gridCols: (c) => /^grid-cols-/.test(c),
  p: (c) => /^p-/.test(c),
  px: (c) => /^px-/.test(c),
  py: (c) => /^py-/.test(c),
  pt: (c) => /^pt-/.test(c),
  pr: (c) => /^pr-/.test(c),
  pb: (c) => /^pb-/.test(c),
  pl: (c) => /^pl-/.test(c),
  m: (c) => /^-?m-/.test(c),
  mx: (c) => /^-?mx-/.test(c),
  my: (c) => /^-?my-/.test(c),
  mt: (c) => /^-?mt-/.test(c),
  mr: (c) => /^-?mr-/.test(c),
  mb: (c) => /^-?mb-/.test(c),
  ml: (c) => /^-?ml-/.test(c),
  w: (c) => /^w-/.test(c),
  h: (c) => /^h-/.test(c),
  maxW: (c) => /^max-w-/.test(c),
  minH: (c) => /^min-h-/.test(c),
  fontSize: (c) => new RegExp(`^text-(${SIZE_WORDS})$`).test(c) || (/^text-\[/.test(c) && isLenArb(c.slice(5))),
  textColor: (c) => /^text-/.test(c) && !new RegExp(`^text-(${NON_COLOR_TEXT})$`).test(c) && !(c.startsWith('text-[') && isLenArb(c.slice(5))),
  textAlign: (c) => /^text-(left|center|right|justify)$/.test(c),
  fontWeight: (c) => /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(c),
  fontFamily: (c) => /^font-(sans|serif|mono|display)$/.test(c),
  leading: (c) => /^leading-/.test(c),
  tracking: (c) => /^tracking-/.test(c),
  transform: (c) => /^(uppercase|lowercase|capitalize|normal-case)$/.test(c),
  bg: (c) => /^bg-/.test(c) && !/^bg-(gradient|linear|radial|conic|cover|contain|center|fixed|no-repeat|repeat|clip|origin|blend|none|auto|top|bottom|left|right|local|scroll)(-|$)/.test(c) && !/^bg-\[(url|image:|length:)/.test(c),
  borderWidth: (c) => /^border(-(0|2|4|8))?$/.test(c),
  borderColor: (c) => /^border-/.test(c) && !/^border-(0|2|4|8|x|y|t|r|b|l|s|e|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing)(-|$)/.test(c),
  radius: (c) => /^rounded(-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|card|button|\[.+\]))?$/.test(c),
  shadow: (c) => /^shadow(-(2xs|xs|sm|md|lg|xl|2xl|none|inner))?$/.test(c),
  opacity: (c) => /^opacity-/.test(c),
  position: (c) => /^(static|relative|absolute|fixed|sticky)$/.test(c),
  z: (c) => /^-?z-/.test(c),
  overflow: (c) => /^overflow-(visible|hidden|auto|scroll|clip)$/.test(c),
  objectFit: (c) => /^object-(cover|contain|fill|none|scale-down)$/.test(c),
  aspect: (c) => /^aspect-/.test(c),
};

export function splitVariant(token: string): [Variant, string] {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth--;
    else if (ch === ':' && depth === 0) cut = i;
  }
  return cut < 0 ? ['', token] : [token.slice(0, cut + 1), token.slice(cut + 1)];
}

export const tokens = (cls: string) => cls.split(/\s+/).filter(Boolean);

/** The class in `group` that applies under `variant` (exact variant match), or null. */
export function get(cls: string, group: string, variant: Variant = ''): string | null {
  const test = GROUPS[group];
  let found: string | null = null;
  for (const t of tokens(cls)) {
    const [v, base] = splitVariant(t);
    if (v === variant && test(base.replace(/^!|!$/g, ''))) found = base;
  }
  return found;
}

/** Replace whatever is in `group` under `variant` with `value` (a full class like "p-4"), or remove it. */
export function set(cls: string, group: string, variant: Variant, value: string | null): string {
  const test = GROUPS[group];
  const out: string[] = [];
  let placed = false;
  for (const t of tokens(cls)) {
    const [v, base] = splitVariant(t);
    if (v === variant && test(base.replace(/^!|!$/g, ''))) {
      if (value && !placed) {
        out.push(variant + value);
        placed = true;
      }
      continue;
    }
    out.push(t);
  }
  if (value && !placed) out.push(variant + value);
  return out.join(' ');
}

export function setMany(cls: string, variant: Variant, changes: Record<string, string | null>) {
  let c = cls;
  for (const [g, v] of Object.entries(changes)) c = set(c, g, variant, v);
  return c;
}

// ---- lengths --------------------------------------------------------------

/** "p-4" → "16", "p-[18px]" → "18", "w-full" → "full", "w-1/2" → "50%" */
export function lengthToInput(base: string | null, prefix: string): string {
  if (!base) return '';
  const neg = base.startsWith('-');
  let v = base.replace(/^-/, '').slice(prefix.length + 1);
  const arb = /^\[(.+)\]$/.exec(v);
  if (arb) {
    const px = /^(-?[\d.]+)px$/.exec(arb[1]);
    if (px) return (neg ? '-' : '') + px[1];
    const rem = /^(-?[\d.]+)rem$/.exec(arb[1]);
    if (rem) return (neg ? '-' : '') + String(parseFloat(rem[1]) * 16);
    return arb[1].replace(/_/g, ' ');
  }
  if (v === 'px') return (neg ? '-' : '') + '1';
  if (/^[\d.]+$/.test(v)) return (neg ? '-' : '') + String(parseFloat(v) * 4);
  const frac = /^(\d+)\/(\d+)$/.exec(v);
  if (frac) return +((+frac[1] / +frac[2]) * 100).toFixed(2) + '%';
  return v;
}

const KEYWORDS = new Set(['auto', 'full', 'screen', 'fit', 'min', 'max', 'svh', 'dvh', 'lvh', 'svw', 'dvw', 'prose', 'none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl']);

/** Turn what a person typed ("16", "50%", "full", "2rem") into a class like "p-4". */
export function inputToLength(input: string, prefix: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (KEYWORDS.has(s)) return `${prefix}-${s}`;
  let neg = false;
  if (s.startsWith('-')) {
    neg = true;
    s = s.slice(1);
  }
  const sign = neg ? '-' : '';
  const num = /^([\d.]+)(px)?$/.exec(s);
  if (num) {
    const px = parseFloat(num[1]);
    if (Number.isNaN(px)) return null;
    const n = px / 4;
    if (Number.isInteger(n * 2)) return `${sign}${prefix}-${n}`;
    return `${sign}${prefix}-[${px}px]`;
  }
  const pct = /^([\d.]+)%$/.exec(s);
  if (pct) {
    const p = parseFloat(pct[1]);
    const fr: Record<string, string> = { '50': '1/2', '33.33': '1/3', '66.67': '2/3', '25': '1/4', '75': '3/4', '20': '1/5', '40': '2/5', '60': '3/5', '80': '4/5', '100': 'full' };
    const key = String(+p.toFixed(2));
    return `${sign}${prefix}-${fr[key] ?? `[${p}%]`}`;
  }
  return `${sign}${prefix}-[${s.replace(/\s+/g, '_')}]`;
}

export const pxOf = (computed: string | undefined) => {
  if (!computed) return '';
  const m = /^(-?[\d.]+)px$/.exec(computed);
  return m ? String(Math.round(parseFloat(m[1]) * 10) / 10) : computed === 'normal' ? '' : computed;
};

// ---- colours ----------------------------------------------------------------

export const TW_HUES: Record<string, string[]> = {
  // shades: 100, 300, 500, 600, 800
  slate: ['#f1f5f9', '#cbd5e1', '#64748b', '#475569', '#1e293b'],
  zinc: ['#f4f4f5', '#d4d4d8', '#71717a', '#52525b', '#27272a'],
  stone: ['#f5f5f4', '#d6d3d1', '#78716c', '#57534e', '#292524'],
  red: ['#fee2e2', '#fca5a5', '#ef4444', '#dc2626', '#991b1b'],
  orange: ['#ffedd5', '#fdba74', '#f97316', '#ea580c', '#9a3412'],
  amber: ['#fef3c7', '#fcd34d', '#f59e0b', '#d97706', '#92400e'],
  lime: ['#ecfccb', '#bef264', '#84cc16', '#65a30d', '#3f6212'],
  emerald: ['#d1fae5', '#6ee7b7', '#10b981', '#059669', '#065f46'],
  teal: ['#ccfbf1', '#5eead4', '#14b8a6', '#0d9488', '#115e59'],
  sky: ['#e0f2fe', '#7dd3fc', '#0ea5e9', '#0284c7', '#075985'],
  blue: ['#dbeafe', '#93c5fd', '#3b82f6', '#2563eb', '#1e40af'],
  indigo: ['#e0e7ff', '#a5b4fc', '#6366f1', '#4f46e5', '#3730a3'],
  violet: ['#ede9fe', '#c4b5fd', '#8b5cf6', '#7c3aed', '#5b21b6'],
  pink: ['#fce7f3', '#f9a8d4', '#ec4899', '#db2777', '#9d174d'],
  rose: ['#ffe4e6', '#fda4af', '#f43f5e', '#e11d48', '#9f1239'],
};
export const TW_SHADES = [100, 300, 500, 600, 800];

/** "bg-brand-600" → "brand-600"; "text-[#ff0000]" → "#ff0000" */
export function colorName(base: string | null, prefix: string): string {
  if (!base) return '';
  const v = base.slice(prefix.length + 1);
  const arb = /^\[(.+)\]$/.exec(v);
  return arb ? arb[1] : v;
}
export function colorClass(prefix: string, name: string): string {
  return /^(#|rgb|hsl|oklch)/.test(name) ? `${prefix}-[${name.replace(/\s+/g, '_')}]` : `${prefix}-${name}`;
}

// ---- brand scale generator ---------------------------------------------------

function hexToHsl(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hh = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hh = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh /= 6;
  }
  return [hh * 360, s * 100, l * 100];
}
function hslToHex(h: number, s: number, l: number) {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Build a full 50–950 scale around one colour (which becomes the 500–600 region). */
export function makeScale(hex: string): Record<number, string> {
  const [h, s] = hexToHsl(hex);
  const L = [97, 94, 87, 78, 68, 58, 50, 42, 34, 27, 16];
  const S = [0.9, 0.95, 1, 1, 1, 1, 0.98, 0.95, 0.9, 0.85, 0.85];
  const out: Record<number, string> = {};
  SCALE_STEPS.forEach((step, i) => {
    const sat = Math.min(100, Math.max(8, s * S[i] + (i < 3 ? 6 : 0)));
    out[step] = hslToHex(h, sat, L[i]);
  });
  return out;
}

export function isHex(v: string) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}

/** Other variants (breakpoints / states) under which `group` is also set. */
export function otherVariants(cls: string, group: string, variant: Variant): string[] {
  const test = GROUPS[group];
  const out: string[] = [];
  for (const t of tokens(cls)) {
    const [v, base] = splitVariant(t);
    if (v !== variant && test(base.replace(/^!|!$/g, '')) && !out.includes(v)) out.push(v);
  }
  return out;
}
