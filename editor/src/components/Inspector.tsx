import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowRight, ArrowUp, Code2, Component, Copy, CornerLeftUp, EyeOff, FileCode2, Image as ImageIcon, MoveDown, MoveUp, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useStore, act, BREAKPOINTS, EMPTY, SMART_IMAGE } from '../store';
import { api } from '../api';
import * as tw from '../tw';
import { Group, Modal, Popover, Seg, SelectField, TextField } from './ui';
import { Code } from './Code';
import { Media } from './LeftPanel';
import { SourceTag, WidgetFields } from './Widgets';
import { FontRoles } from './Fonts';

const FRIENDLY: Record<string, string> = { h1: 'Heading 1', h2: 'Heading 2', h3: 'Heading 3', h4: 'Heading 4', h5: 'Heading 5', h6: 'Heading 6', p: 'Paragraph', a: 'Link', img: 'Image', section: 'Section', div: 'Container', span: 'Text', ul: 'List', ol: 'Numbered list', li: 'List item', button: 'Button', nav: 'Navigation', header: 'Header', footer: 'Footer', main: 'Main content', body: 'Body', form: 'Form', input: 'Input', textarea: 'Text area', label: 'Label', svg: 'Icon', article: 'Article', figure: 'Figure', blockquote: 'Quote', table: 'Table', iframe: 'Embed', details: 'Disclosure', summary: 'Disclosure title', select: 'Dropdown', hr: 'Divider', video: 'Video', aside: 'Aside', strong: 'Bold text', em: 'Italic text', small: 'Small text', time: 'Time', path: 'Icon shape' };

export const useDark = () => {
  const ui = useStore((s) => s.uiTheme);
  const [sys, setSys] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const fn = () => setSys(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return ui === 'dark' || (ui === 'system' && sys);
};

export function Inspector() {
  const sel = useStore((s) => s.selection);
  return (
    <aside className="right">
      {!sel ? <PagePanel /> : sel.kind === 'component' ? <ComponentPanel /> : <ElementPanel />}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Shared header
// ---------------------------------------------------------------------------

function Head({ title, badge, purple }: { title: string; badge?: string; purple?: boolean }) {
  const sel = useStore((s) => s.selection)!;
  const pageFile = useStore((s) => s.pageFile);
  const info = sel.info;
  const foreign = sel.file !== pageFile;
  const compName = sel.file.split('/').pop()!.replace('.astro', '');
  return (
    <div className="insp-head">
      <div className="insp-title">
        <span style={purple ? { color: 'var(--comp)' } : undefined}>{title}</span>
        {badge && <span className="badge tagname">{badge}</span>}
        <span className="grow" />
        <button className="icon-btn sm" title="Select parent (Esc)" onClick={() => act().selectParent()}>
          <CornerLeftUp size={14} />
        </button>
        <button className="icon-btn sm" title="Move up (Alt+↑)" disabled={!info?.canMoveUp} onClick={() => act().move('up')}>
          <MoveUp size={14} />
        </button>
        <button className="icon-btn sm" title="Move down (Alt+↓)" disabled={!info?.canMoveDown} onClick={() => act().move('down')}>
          <MoveDown size={14} />
        </button>
        <button className="icon-btn sm" title="Duplicate" onClick={() => act().duplicate()}>
          <Copy size={14} />
        </button>
        <button className="icon-btn sm" title="Delete" onClick={() => act().remove()}>
          <Trash2 size={14} />
        </button>
      </div>
      {info?.ancestors?.length > 0 && (
        <div className="crumbs">
          {info.ancestors.slice(-3).map((a: any) => (
            <span key={a.start} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => act().selectRef(sel.file, a)} onMouseEnter={() => a.type !== 'component' && act().hover({ file: act().abs(sel.file), loc: a.loc, index: 0 })} onMouseLeave={() => act().hover(null)}>
                {a.name}
              </button>
              ›
            </span>
          ))}
          <span className="cur">{info.name}</span>
        </div>
      )}
      <button className={'filechip' + (foreign ? ' comp' : '')} title="Open this file in the code editor" onClick={() => useStore.setState({ codeFile: sel.file })}>
        <FileCode2 size={12} />
        {sel.file.replace(/^src\//, '')}
        {info?.line ? ':' + info.line : ''}
      </button>
      {foreign && sel.kind === 'element' && (
        <p className="note">
          Part of the <b>{compName}</b> {sel.file.startsWith('src/layouts/') ? 'layout' : 'component'} — a change here shows up everywhere it is used.
        </p>
      )}
      {info?.inExpr && sel.kind === 'element' && (
        <p className="note">
          Repeated from data{sel.el?.instances > 1 ? ` (${sel.el.instances} copies)` : ''} — styling one styles them all.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Element
// ---------------------------------------------------------------------------

function ElementPanel() {
  const sel = useStore((s) => s.selection)!;
  const tab = useStore((s) => s.inspectorTab);
  const name = sel.info?.name || sel.el?.tag || '…';
  return (
    <>
      <Head title={FRIENDLY[name] || name} badge={name} />
      <div className="itabs">
        {(['design', 'classes', 'source'] as const).map((t) => (
          <button key={t} className={'tab' + (tab === t ? ' on' : '')} onClick={() => useStore.setState({ inspectorTab: t })}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="scroll">
        {!sel.info ? <div className="hint">Reading the source…</div> : tab === 'design' ? <DesignTab /> : tab === 'classes' ? <ClassesTab /> : <SourceTab />}
      </div>
    </>
  );
}

function useColors() {
  const theme = useStore((s) => s.data?.theme);
  const mode = useStore((s) => s.theme);
  return useMemo(() => {
    const sem = (mode === 'dark' ? theme?.dark : theme?.light) || {};
    const brand: Record<string, string> = {};
    for (const [k, v] of Object.entries(theme?.theme || {})) {
      const m = /^--color-([a-z]+-\d+)$/.exec(k);
      if (m) brand[m[1]] = v as string;
    }
    const semantic: Record<string, string> = {};
    for (const n of ['bg', 'surface', 'fg', 'muted', 'line']) if (sem['--' + n]) semantic[n] = sem['--' + n];
    const resolve = (name: string): string | null => {
      if (!name) return null;
      const n = name.replace(/\/\d+$/, '');
      if (n in semantic) return semantic[n];
      if (n in brand) return brand[n];
      if (n === 'white') return '#ffffff';
      if (n === 'black') return '#000000';
      if (n === 'transparent') return 'transparent';
      if (n === 'current' || n === 'inherit') return 'currentColor';
      if (/^(#|rgb|hsl|oklch)/.test(n)) return n.replace(/_/g, ' ');
      const m = /^([a-z]+)-(\d+)$/.exec(n);
      if (m && tw.TW_HUES[m[1]]) {
        const i = tw.TW_SHADES.indexOf(+m[2]);
        if (i >= 0) return tw.TW_HUES[m[1]][i];
        const shade = +m[2];
        const near = tw.TW_SHADES.reduce((a, b) => (Math.abs(b - shade) < Math.abs(a - shade) ? b : a));
        return tw.TW_HUES[m[1]][tw.TW_SHADES.indexOf(near)];
      }
      return null;
    };
    return { semantic, brand, resolve };
  }, [theme, mode]);
}

function ColorField({ value, onChange, placeholder }: { value: string; onChange: (name: string | null) => void; placeholder?: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { semantic, brand, resolve } = useColors();
  const [custom, setCustom] = useState('');
  const timer = useRef<any>(null);
  const css = resolve(value);
  const pick = (n: string | null) => {
    onChange(n);
    setAnchor(null);
  };
  const brandNames = Object.keys(brand).sort((a, b) => parseInt(a.split('-')[1]) - parseInt(b.split('-')[1]));
  return (
    <>
      <button className={'inp colorbtn' + (value ? ' set' : '')} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <span className="swatch">{(css || placeholder) && <i style={{ background: css || placeholder }} />}</span>
        <span className={'name' + (value ? '' : ' none')}>{value || 'inherited'}</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="right">
          <div className="palette">
            <div>
              <div className="lbl" style={{ marginBottom: 5 }}>Theme</div>
              <div className="sw-row">
                {Object.entries(semantic).map(([n, c]) => (
                  <button key={n} className={'sw' + (value === n ? ' on' : '')} style={{ background: c }} title={n} onClick={() => pick(n)} />
                ))}
                <span style={{ width: 6 }} />
                {['white', 'black'].map((n) => (
                  <button key={n} className={'sw' + (value === n ? ' on' : '')} style={{ background: n }} title={n} onClick={() => pick(n)} />
                ))}
                <button className={'sw swatch' + (value === 'transparent' ? ' on' : '')} title="transparent" onClick={() => pick('transparent')} />
              </div>
            </div>
            {brandNames.length > 0 && (
              <div>
                <div className="lbl" style={{ marginBottom: 5 }}>Brand</div>
                <div className="sw-row">
                  {brandNames.map((n) => (
                    <button key={n} className={'sw' + (value === n ? ' on' : '')} style={{ background: brand[n] }} title={n} onClick={() => pick(n)} />
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="lbl" style={{ marginBottom: 5 }}>Tailwind palette</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(15, 1fr)', gap: 2 }}>
                {tw.TW_SHADES.map((shade, i) =>
                  Object.entries(tw.TW_HUES).map(([hue, list]) => (
                    <button key={hue + shade} className={'sw' + (value === `${hue}-${shade}` ? ' on' : '')} style={{ background: list[i], width: 'auto', aspectRatio: '1', borderRadius: 4 }} title={`${hue}-${shade}`} onClick={() => pick(`${hue}-${shade}`)} />
                  )),
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="color"
                value={tw.isHex(css || '') ? (css as string) : '#7445ff'}
                onChange={(e) => {
                  const v = e.target.value;
                  setCustom(v);
                  clearTimeout(timer.current);
                  timer.current = setTimeout(() => onChange(v), 220);
                }}
              />
              <HexField value={tw.isHex(css || '') ? (css as string) : ''} width="auto" onCommit={(hex) => pick(hex)} />
              <span style={{ flex: 1 }} />
              <button className="btn sm ghost" onClick={() => pick(null)}>
                Clear
              </button>
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

/** A text box for typing or pasting a hex colour ("#1a2b3c", "1a2b3c" or "#abc"). */
function HexField({ value, onCommit, width = 92 }: { value: string; onCommit: (hex: string) => void; width?: number | string }) {
  const shown = tw.normalizeHex(value || '') || '';
  const [v, setV] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setV(shown);
    setBad(false);
  }, [shown]);
  const commit = () => {
    if (!v.trim()) return setV(shown);
    const hex = tw.normalizeHex(v);
    if (!hex) return setBad(true);
    setBad(false);
    setV(hex);
    if (hex !== shown) onCommit(hex);
  };
  return (
    <div className="inp" style={{ width, flex: 'none', borderColor: bad ? 'var(--err)' : undefined }} title={bad ? 'Not a hex colour — use 3 or 6 digits, like #1a2b3c' : 'Type or paste a hex colour, then press Enter'}>
      <input
        value={v}
        placeholder="#rrggbb"
        spellCheck={false}
        maxLength={9}
        style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}
        onChange={(e) => {
          setV(e.target.value);
          setBad(false);
        }}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setV(shown);
            setBad(false);
          }
        }}
      />
    </div>
  );
}

const opt = (list: (string | [string, string])[]) => list.map((x) => (Array.isArray(x) ? { value: x[0], label: x[1] } : { value: x, label: x }));

const DesignCtx = createContext<{ g: (group: string) => string | null; setG: (group: string, value: string | null) => void; others: (group: string) => string[] }>(null as any);

/** Tells people when the same property is also set for other screen sizes / states. */
function Also({ group }: { group: string }) {
  const { others } = useContext(DesignCtx);
  const list = others(group);
  if (!list.length) return null;
  const names = list.map((v) => (v === '' ? 'All' : v.replace(/:$/, '')));
  return (
    <div className="also" title={`This is also set for: ${names.join(', ')}. Use “Apply changes to” above to edit those.`}>
      also set: {names.join(' · ')}
    </div>
  );
}

function Len({ group, prefix, pre, ph, title }: { group: string; prefix: string; pre?: ReactNode; ph?: string; title?: string }) {
  const { g, setG } = useContext(DesignCtx);
  return (
    <div style={{ minWidth: 0 }}>
      <TextField value={tw.lengthToInput(g(group), prefix)} placeholder={ph ?? ''} pre={pre} title={title} onCommit={(val) => setG(group, tw.inputToLength(val, prefix))} />
      <Also group={group} />
    </div>
  );
}
function Sel({ group, prefix, options, pre, ph }: { group: string; prefix: string; options: any[]; pre?: ReactNode; ph?: string }) {
  const { g, setG } = useContext(DesignCtx);
  const cur = g(group);
  const val = cur == null ? '' : prefix ? (cur === prefix ? 'DEFAULT' : cur.slice(prefix.length + 1)) : cur;
  return (
    <div style={{ minWidth: 0 }}>
      <SelectField value={val} pre={pre} placeholder={ph} options={options} onChange={(x) => setG(group, x === '' ? null : x === 'DEFAULT' ? prefix : prefix ? `${prefix}-${x}` : x)} />
      <Also group={group} />
    </div>
  );
}
function Color({ group, prefix, ph }: { group: string; prefix: string; ph?: string }) {
  const { g, setG } = useContext(DesignCtx);
  return (
    <div style={{ minWidth: 0 }}>
      <ColorField value={tw.colorName(g(group), prefix)} placeholder={ph} onChange={(n) => setG(group, n ? tw.colorClass(prefix, n) : null)} />
      <Also group={group} />
    </div>
  );
}

function DesignTab() {
  const sel = useStore((s) => s.selection)!;
  const variantBp = useStore((s) => s.variant);
  const variantState = useStore((s) => s.stateVariant);
  const pages = useStore((s) => s.data?.pages || EMPTY);
  const tailwind = useStore((s) => s.data?.project?.tailwind !== false);
  const [sides, setSides] = useState<Record<string, boolean>>({});
  const [picker, setPicker] = useState(false);
  const info = sel.info;
  const cs = sel.el?.computed || {};
  const classes: string = info.classes || '';
  const v = variantBp + variantState;
  const tag = info.name;

  const g = (group: string) => tw.get(classes, group, v);
  const setG = (group: string, value: string | null) => act().setClasses(tw.set(classes, group, v, value));
  const setMany = (changes: Record<string, string | null>) => act().setClasses(tw.setMany(classes, v, changes));

  const ctx = { g, setG, others: (group: string) => tw.otherVariants(classes, group, v) };

  if (!tailwind) {
    return (
      <div className="empty-insp">
        {ContentGroup()}
        <p className="note" style={{ padding: '4px 0 12px' }}>
          The style controls work by writing <b>Tailwind CSS</b> classes, and this project doesn’t use Tailwind, so they are switched off here. Text, images, moving and deleting still work. To restyle this element, edit its CSS in the <b>Source</b> tab — or ask the AI to.
        </p>
        <button className="btn block" onClick={() => useStore.setState({ inspectorTab: 'source' })}>
          <Code2 size={14} /> Open Source tab
        </button>
      </div>
    );
  }

  if (!info.classEditable) {
    return (
      <div className="empty-insp">
        {ContentGroup()}
        <p className="note" style={{ padding: '4px 0 12px' }}>
          This element’s classes are computed in code (a <code>class:list</code> or an expression), so the visual controls are switched off for it. You can still change it in the <b>Source</b> tab — or ask the AI to.
        </p>
        <button className="btn block" onClick={() => useStore.setState({ inspectorTab: 'source' })}>
          <Code2 size={14} /> Open Source tab
        </button>
      </div>
    );
  }

  const display = g('display') || '';
  const isFlex = /flex/.test(display) || (!display && /flex/.test(cs.display || ''));
  const isGrid = /grid/.test(display) || (!display && /grid/.test(cs.display || ''));
  const pad4 = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(tw.pxOf);
  const mar4 = [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(tw.pxOf);
  const same = (a: string[]) => (a.every((x) => x === a[0]) ? a[0] : 'mixed');
  const curBp = BREAKPOINTS.find((b) => b.prefix === variantBp);

  function ContentGroup() {
    if (!(info.textEditable || tag === 'a' || tag === 'img' || tag === 'iframe' || tag === 'input' || tag === 'textarea')) return null;
    const attr = (n: string) => {
      const a = info.attrs.find((x: any) => x.name === n);
      return a && a.kind === 'string' ? a.value : '';
    };
    const dyn = (n: string) => info.attrs.some((x: any) => x.name === n && x.kind !== 'string');
    return (
      <Group title="Content">
        {info.textEditable && (
          <div className="field">
            <label>Text</label>
            <TextArea value={info.text || ''} onCommit={(t) => act().op(() => ({ type: 'setText', text: t }))} />
          </div>
        )}
        {tag === 'a' && (
          <div className="field">
            <label>Links to</label>
            {dyn('href') ? <p className="note">Set from data in code.</p> : <TextField value={attr('href')} placeholder="/about or https://…" list="al-pages" mono onCommit={(x) => act().setAttr('href', x || null)} />}
            <datalist id="al-pages">
              {pages.filter((p: any) => !p.dynamic).map((p: any) => (
                <option key={p.route} value={p.route} />
              ))}
            </datalist>
          </div>
        )}
        {(tag === 'img' || tag === 'iframe') && (
          <div className="field">
            <label>{tag === 'img' ? 'Image' : 'Embed address'}</label>
            {dyn('src') ? (
              <p className="note">Set from data in code.</p>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextField value={attr('src')} placeholder="/media/photo.jpg" mono onCommit={(x) => (tag === 'img' ? act().setImage(x) : act().setAttr('src', x || null))} />
                </div>
                {tag === 'img' && (
                  <button className="btn sm" onClick={() => setPicker(true)}>
                    <ImageIcon size={13} /> Choose
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {tag === 'img' && !dyn('alt') && (
          <div className="field">
            <label>Description for screen readers (alt)</label>
            <TextField value={attr('alt')} placeholder="What the image shows" set={!!attr('alt')} onCommit={(x) => act().setAttr('alt', x)} />
          </div>
        )}
        {(tag === 'input' || tag === 'textarea') && (
          <div className="field">
            <label>Placeholder</label>
            <TextField value={attr('placeholder')} onCommit={(x) => act().setAttr('placeholder', x || null)} />
          </div>
        )}
        {picker && (
          <Modal title="Choose an image" onClose={() => setPicker(false)}>
            <div style={{ overflowY: 'auto', paddingBottom: 10 }}>
              <Media
                onPick={(m) => {
                  act().setImage(m.url);
                  setPicker(false);
                }}
              />
            </div>
          </Modal>
        )}
      </Group>
    );
  }

  return (
    <DesignCtx.Provider value={ctx}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="lbl">Apply changes to</span>
          <span className="sub">{variantBp ? `screens ${curBp?.width}px and wider` : 'all screen sizes'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <Seg
              value={variantBp || 'all'}
              onChange={(x) => useStore.setState({ variant: !x || x === 'all' ? '' : x })}
              options={[{ value: 'all', label: 'All' }, ...BREAKPOINTS.filter((b) => b.prefix).slice(0, 4).map((b) => ({ value: b.prefix, label: b.label, tip: `${b.width}px and up` }))]}
            />
          </div>
          <div style={{ width: 84 }}>
            <SelectField value={variantState} placeholder="Normal" options={opt([['hover:', 'Hover'], ['dark:', 'Dark'], ['focus:', 'Focus']])} onChange={(x) => useStore.setState({ stateVariant: x })} />
          </div>
        </div>
      </div>

      {ContentGroup()}
      <FieldTools />

      <Group title="Layout">
        <Seg
          value={display === 'inline-flex' ? 'flex' : display === 'inline-grid' ? 'grid' : display}
          onChange={(x) => setG('display', x || null)}
          options={[
            { value: 'block', label: 'Block' },
            { value: 'flex', label: 'Flex' },
            { value: 'grid', label: 'Grid' },
            { value: 'inline-block', label: 'Inline' },
            { value: 'hidden', icon: <EyeOff size={13} />, tip: 'Hidden' },
          ]}
        />
        {isFlex && (
          <>
            <div className="cols">
              <div className="field">
                <label>Direction</label>
                <Seg
                  value={g('flexDir')?.replace('flex-', '') || ''}
                  onChange={(x) => setG('flexDir', x ? 'flex-' + x : null)}
                  options={[
                    { value: 'row', icon: <ArrowRight size={13} />, tip: 'Row' },
                    { value: 'col', icon: <ArrowDown size={13} />, tip: 'Column' },
                  ]}
                />
              </div>
              <div className="field">
                <label>Gap</label>
                <Len group="gap" prefix="gap" ph={tw.pxOf(cs.gap) || '0'} />
              </div>
            </div>
            <div className="cols">
              <div className="field">
                <label>Distribute</label>
                <Sel group="justify" prefix="justify" options={opt([['start', 'Start'], ['center', 'Center'], ['end', 'End'], ['between', 'Space between'], ['around', 'Space around'], ['evenly', 'Space evenly']])} />
              </div>
              <div className="field">
                <label>Align</label>
                <Sel group="items" prefix="items" options={opt([['start', 'Start'], ['center', 'Center'], ['end', 'End'], ['stretch', 'Stretch'], ['baseline', 'Baseline']])} />
              </div>
            </div>
            <Sel group="wrap" prefix="flex" ph="No wrapping" options={opt([['wrap', 'Wrap onto new lines'], ['nowrap', 'Never wrap']])} />
          </>
        )}
        {isGrid && (
          <div className="cols">
            <div className="field">
              <label>Columns</label>
              <Sel group="gridCols" prefix="grid-cols" options={opt(['1', '2', '3', '4', '5', '6', '12'])} />
            </div>
            <div className="field">
              <label>Gap</label>
              <Len group="gap" prefix="gap" ph={tw.pxOf(cs.gap) || '0'} />
            </div>
          </div>
        )}
        <div className="cols3">
          <div className="field">
            <label>Width</label>
            <Len group="w" prefix="w" ph={tw.pxOf(cs.width)} title="A number (px), a %, or: auto, full, screen, fit" />
          </div>
          <div className="field">
            <label>Height</label>
            <Len group="h" prefix="h" ph={tw.pxOf(cs.height)} title="A number (px), a %, or: auto, full, screen, fit" />
          </div>
          <div className="field">
            <label>Max width</label>
            <Len group="maxW" prefix="max-w" ph="none" title="A number (px) or a size name: sm, md, lg, xl, 2xl … 7xl, prose, full" />
          </div>
        </div>
      </Group>

      <Group title="Spacing">
        {(['p', 'm'] as const).map((k) => {
          const four = k === 'p' ? pad4 : mar4;
          const open = sides[k] ?? ['t', 'r', 'b', 'l'].some((d) => g(k + d));
          return (
            <div className="field" key={k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="lbl">{k === 'p' ? 'Padding (space inside)' : 'Margin (space outside)'}</label>
                <button className="sub" style={{ textDecoration: 'underline' }} onClick={() => setSides({ ...sides, [k]: !open })}>
                  {open ? 'fewer' : 'each side'}
                </button>
              </div>
              <div className="cols3">
                <Len group={k} prefix={k} pre="All" ph={same(four)} />
                <Len group={k + 'x'} prefix={k + 'x'} pre="↔" ph={four[1] === four[3] ? four[1] : 'mixed'} title="Left & right" />
                <Len group={k + 'y'} prefix={k + 'y'} pre="↕" ph={four[0] === four[2] ? four[0] : 'mixed'} title="Top & bottom" />
              </div>
              {open && (
                <div className="cols4">
                  {(['t', 'r', 'b', 'l'] as const).map((d, i) => (
                    <Len key={d} group={k + d} prefix={k + d} pre={['↑', '→', '↓', '←'][i]} ph={four[i]} title={['Top', 'Right', 'Bottom', 'Left'][i]} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Group>

      <Group title="Typography">
        <div className="cols">
          <div className="field">
            <label>Font</label>
            <Sel group="fontFamily" prefix="font" options={opt([['sans', 'Body (sans)'], ['display', 'Display'], ['serif', 'Serif'], ['mono', 'Mono']])} />
          </div>
          <div className="field">
            <label>Weight</label>
            <Sel group="fontWeight" prefix="font" ph={cs.fontWeight} options={opt([['light', 'Light'], ['normal', 'Regular'], ['medium', 'Medium'], ['semibold', 'Semibold'], ['bold', 'Bold'], ['extrabold', 'Extra bold'], ['black', 'Black']])} />
          </div>
        </div>
        <div className="cols">
          <div className="field">
            <label>Size</label>
            <Sel group="fontSize" prefix="text" ph={tw.pxOf(cs.fontSize) + 'px'} options={opt([['xs', 'XS · 12'], ['sm', 'SM · 14'], ['base', 'Base · 16'], ['lg', 'LG · 18'], ['xl', 'XL · 20'], ['2xl', '2XL · 24'], ['3xl', '3XL · 30'], ['4xl', '4XL · 36'], ['5xl', '5XL · 48'], ['6xl', '6XL · 60'], ['7xl', '7XL · 72'], ['8xl', '8XL · 96']])} />
          </div>
          <div className="field">
            <label>Colour</label>
            <Color group="textColor" prefix="text" ph={cs.color} />
          </div>
        </div>
        <div className="cols">
          <div className="field">
            <label>Line height</label>
            <Sel group="leading" prefix="leading" options={opt([['none', 'None · 1'], ['tight', 'Tight'], ['snug', 'Snug'], ['normal', 'Normal'], ['relaxed', 'Relaxed'], ['loose', 'Loose']])} />
          </div>
          <div className="field">
            <label>Letter spacing</label>
            <Sel group="tracking" prefix="tracking" options={opt([['tighter', 'Tighter'], ['tight', 'Tight'], ['normal', 'Normal'], ['wide', 'Wide'], ['wider', 'Wider'], ['widest', 'Widest']])} />
          </div>
        </div>
        <div className="cols">
          <Seg
            value={g('textAlign')?.replace('text-', '') || ''}
            onChange={(x) => setG('textAlign', x ? 'text-' + x : null)}
            options={[
              { value: 'left', icon: <AlignLeft size={13} />, tip: 'Left' },
              { value: 'center', icon: <AlignCenter size={13} />, tip: 'Center' },
              { value: 'right', icon: <AlignRight size={13} />, tip: 'Right' },
              { value: 'justify', icon: <AlignJustify size={13} />, tip: 'Justify' },
            ]}
          />
          <Seg
            value={g('transform') || ''}
            onChange={(x) => setG('transform', x || null)}
            options={[
              { value: 'uppercase', label: 'AA', tip: 'Uppercase' },
              { value: 'capitalize', label: 'Aa', tip: 'Capitalise' },
              { value: 'lowercase', label: 'aa', tip: 'Lowercase' },
            ]}
          />
        </div>
      </Group>

      <Group title="Fill">
        <div className="field">
          <label>Background colour</label>
          <Color group="bg" prefix="bg" ph={cs.backgroundColor} />
        </div>
      </Group>

      <Group title="Stroke" defaultOpen={false}>
        <div className="cols">
          <div className="field">
            <label>Border</label>
            <Sel group="borderWidth" prefix="border" ph={tw.pxOf(cs.borderTopWidth) + 'px'} options={opt([['0', 'None'], ['DEFAULT', '1px'], ['2', '2px'], ['4', '4px'], ['8', '8px']])} />
          </div>
          <div className="field">
            <label>Border colour</label>
            <Color group="borderColor" prefix="border" ph={cs.borderTopColor} />
          </div>
        </div>
        <div className="field">
          <label>Corner radius</label>
          <Sel group="radius" prefix="rounded" ph={tw.pxOf(cs.borderTopLeftRadius) + 'px'} options={opt([['none', 'Square'], ['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large'], ['xl', 'XL'], ['2xl', '2XL'], ['3xl', '3XL'], ['full', 'Fully round'], ['card', 'Theme: card'], ['button', 'Theme: button']])} />
        </div>
      </Group>

      <Group title="Effects" defaultOpen={false}>
        <div className="cols">
          <div className="field">
            <label>Shadow</label>
            <Sel group="shadow" prefix="shadow" options={opt([['none', 'None'], ['sm', 'Small'], ['DEFAULT', 'Regular'], ['md', 'Medium'], ['lg', 'Large'], ['xl', 'XL'], ['2xl', '2XL']])} />
          </div>
          <div className="field">
            <label>Opacity</label>
            <TextField value={g('opacity')?.replace('opacity-', '') || ''} placeholder="100" suf="%" onCommit={(x) => setG('opacity', x.trim() === '' ? null : 'opacity-' + Math.max(0, Math.min(100, parseInt(x) || 0)))} />
          </div>
        </div>
        {tag === 'img' && (
          <div className="cols">
            <div className="field">
              <label>Image fit</label>
              <Sel group="objectFit" prefix="object" options={opt([['cover', 'Cover (crop)'], ['contain', 'Contain'], ['fill', 'Stretch']])} />
            </div>
            <div className="field">
              <label>Shape</label>
              <Sel group="aspect" prefix="aspect" options={opt([['auto', 'Original'], ['square', 'Square'], ['video', '16 : 9'], ['[4/3]', '4 : 3'], ['[3/4]', '3 : 4'], ['[21/9]', '21 : 9']])} />
            </div>
          </div>
        )}
      </Group>

      <Group title="Position" defaultOpen={false}>
        <div className="cols3">
          <div className="field">
            <label>Position</label>
            <Sel group="position" prefix="" ph={cs.position} options={opt([['static', 'Static'], ['relative', 'Relative'], ['absolute', 'Absolute'], ['fixed', 'Fixed'], ['sticky', 'Sticky']])} />
          </div>
          <div className="field">
            <label>Stack (z)</label>
            <Sel group="z" prefix="z" ph="auto" options={opt(['0', '10', '20', '30', '40', '50'])} />
          </div>
          <div className="field">
            <label>Overflow</label>
            <Sel group="overflow" prefix="overflow" options={opt([['visible', 'Visible'], ['hidden', 'Hidden'], ['auto', 'Scroll']])} />
          </div>
        </div>
      </Group>

      <div style={{ padding: 14 }}>
        <button className="btn block ghost" onClick={() => useStore.setState({ chatOpen: true })}>
          <Sparkles size={14} style={{ color: 'var(--accent)' }} /> Ask AI to change this element
        </button>
      </div>
    </DesignCtx.Provider>
  );
}

function TextArea({ value, onCommit, mono, rows = 3 }: { value: string; onCommit: (v: string) => void; mono?: boolean; rows?: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      className={'area' + (mono ? ' mono' : '')}
      rows={rows}
      value={v}
      spellCheck={!mono}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
      }}
    />
  );
}

function ClassesTab() {
  const sel = useStore((s) => s.selection)!;
  const info = sel.info;
  const [text, setText] = useState(info.classes || '');
  const [add, setAdd] = useState('');
  useEffect(() => setText(info.classes || ''), [info.classes]);
  if (!info.classEditable) return <div className="hint">This element’s classes are computed in code. Edit them in the Source tab.</div>;
  const list = tw.tokens(info.classes || '');
  const dirty = text.trim() !== (info.classes || '').trim();
  return (
    <div style={{ padding: 14, display: 'grid', gap: 12 }}>
      <p className="note" style={{ margin: 0 }}>
        Styling in this project is done with <b>Tailwind classes</b> — short names like <code>p-4</code> (padding) or <code>text-center</code>. The Design tab writes these for you.
      </p>
      <div className="chips">
        {list.map((t, i) => {
          const [variant, base] = tw.splitVariant(t);
          return (
            <span className="chip" key={t + i}>
              <span>
                <span className="v">{variant}</span>
                {base}
              </span>
              <button onClick={() => act().setClasses(list.filter((_, k) => k !== i).join(' '))}>
                <X size={10} />
              </button>
            </span>
          );
        })}
        {!list.length && <span className="sub">No classes yet.</span>}
      </div>
      <div className="inp">
        <span className="pre">
          <Plus size={12} />
        </span>
        <input
          placeholder="Add classes, then press Enter"
          value={add}
          spellCheck={false}
          style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }}
          onChange={(e) => setAdd(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && add.trim()) {
              act().setClasses([...list, ...tw.tokens(add)].join(' '));
              setAdd('');
            }
          }}
        />
      </div>
      <div className="field">
        <label>All classes</label>
        <textarea className="area mono" rows={7} placeholder="Enter Tailwind classes…" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </div>
      <div className="actions">
        <button className="btn primary" style={{ flex: 1 }} disabled={!dirty} onClick={() => act().setClasses(text.replace(/\s+/g, ' ').trim())}>
          Apply
        </button>
        <button className="btn" disabled={!dirty} onClick={() => setText(info.classes || '')}>
          Reset
        </button>
      </div>
    </div>
  );
}

function SourceTab() {
  const sel = useStore((s) => s.selection)!;
  const dark = useDark();
  const info = sel.info;
  const [text, setText] = useState(info.source);
  useEffect(() => setText(info.source), [info.source]);
  const dirty = text !== info.source;
  const apply = () => dirty && act().op(() => ({ type: 'replace', source: text }));
  return (
    <div style={{ padding: 14, display: 'grid', gap: 10 }}>
      <p className="note" style={{ margin: 0 }}>
        The exact code for this element in <b>{sel.file.split('/').pop()}</b>. Edit it and press Apply ({navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+'}S).
      </p>
      <div className="src-host">
        <Code value={text} onChange={setText} filename="x.astro" minimal dark={dark} onSave={apply} />
      </div>
      <div className="actions">
        <button className="btn primary" style={{ flex: 1 }} disabled={!dirty} onClick={apply}>
          Apply
        </button>
        <button className="btn" disabled={!dirty} onClick={() => setText(info.source)}>
          Reset
        </button>
      </div>
      <button className="btn ghost block" onClick={() => useStore.setState({ codeFile: sel.file })}>
        <FileCode2 size={14} /> Open the whole file
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component instance
// ---------------------------------------------------------------------------

function ComponentPanel() {
  const sel = useStore((s) => s.selection)!;
  const data = useStore((s) => s.data);
  const info = sel.info;
  const [newProp, setNewProp] = useState('');
  if (!info) return <div className="hint">Reading the source…</div>;
  const all = [...(data?.components || []), ...(data?.layouts || [])];
  const comp = all.find((c: any) => c.file === info.componentFile);
  const isLayout = info.componentFile?.startsWith('src/layouts/');
  const widgetFields = (info.fields || []).filter((f: any) => f.type !== 'code');
  const fieldNames = new Set(widgetFields.map((f: any) => f.name));
  const props = info.attrs.filter((a: any) => a.name && !fieldNames.has(a.name));
  return (
    <>
      <Head title={info.name} badge={isLayout ? 'layout' : 'component'} purple />
      <div className="scroll">
        <div style={{ padding: 14, display: 'grid', gap: 10, borderBottom: '1px solid var(--line)' }}>
          <p className="note" style={{ margin: 0 }}>
            {isLayout ? (
              <>A <b>layout</b> wraps this page with the parts every page shares — the header, the footer, the fonts. The page’s own content sits inside it.</>
            ) : (
              <>A <b>component</b> is a reusable block that lives in its own file. This page just places it; open it to change what’s inside.</>
            )}
          </p>
          {info.componentFile ? (
            <div className="actions">
              <button className="btn primary" style={{ flex: 1 }} onClick={() => comp && act().openComponent(comp)}>
                <Pencil size={13} /> Edit {isLayout ? 'layout' : 'component'}
              </button>
              <button className="btn" onClick={() => useStore.setState({ codeFile: info.componentFile })}>
                <Code2 size={13} /> Code
              </button>
            </div>
          ) : (
            <p className="note">AstroNut Studio couldn’t find this component’s file from the page’s imports.</p>
          )}
          {comp && comp.kind !== 'layout' && info.componentFile !== SMART_IMAGE && (
            <div className="usedon">
              <SourceTag source={comp.source} />
              <span className="sub">
                {comp.usedOn.length > 1 ? `Shared with ${comp.usedOn.length - 1} other page${comp.usedOn.length === 2 ? '' : 's'}` : 'Only used on this page'}
              </span>
              {comp.usedOn.length > 1 && (
                <button className="sub" style={{ textDecoration: 'underline', marginLeft: 'auto' }} title="Give this page its own copy, so changes here no longer affect the other pages" onClick={() => act().detach()}>
                  make independent
                </button>
              )}
            </div>
          )}
          <p className="sub" style={{ margin: 0 }}>Tip: click anything inside it on the page to edit that part directly.</p>
        </div>
        {widgetFields.length > 0 && (
          <Group title={comp?.source === 'page' || comp?.source === 'data' ? 'Settings for this placement' : 'Content for this placement'} id="widget-fields">
            <p className="note" style={{ margin: 0 }}>
              {comp?.source === 'page' ? (
                <>
                  <b>{info.name}</b> works out what to show from the page it is on. These settings only adjust how.
                </>
              ) : comp?.source === 'data' ? (
                <>
                  <b>{info.name}</b> fills itself from your content. Choose what this placement shows; edit the entries themselves in the Content tab.
                </>
              ) : (
                <>
                  <b>{info.name}</b> is a widget: these values are just for this page. Its design is shared.
                </>
              )}
            </p>
            <WidgetFields fields={info.fields} values={info.values} onChange={(n, v) => act().setField(n, v)} onReset={(n) => act().setField(n, null)} />
            <button className="btn sm ghost" onClick={() => useStore.setState({ widgetOpen: true })}>
              Open in the widget editor
            </button>
          </Group>
        )}
        <Group title={widgetFields.length ? 'Other properties' : 'Properties'} id="comp-props" defaultOpen={!widgetFields.length}>
          {!props.length && <p className="note" style={{ margin: 0 }}>No properties are passed to this {isLayout ? 'layout' : 'component'}.</p>}
          {props.map((a: any) => (
            <div className="field" key={a.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <label className="lbl">{a.name}</label>
                <button className="sub" onClick={() => act().setAttr(a.name, null)}>
                  remove
                </button>
              </div>
              {a.kind === 'string' ? <TextField value={a.value} onCommit={(x) => act().setAttr(a.name, x)} /> : <div className="inp" style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', whiteSpace: 'nowrap' }}>{a.raw.slice(a.name.length + 1) || 'true'}</div>}
            </div>
          ))}
          <div className="inp">
            <span className="pre">
              <Plus size={12} />
            </span>
            <input
              placeholder="Add a property, e.g. title"
              value={newProp}
              onChange={(e) => setNewProp(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && /^[A-Za-z][\w-]*$/.test(newProp.trim())) {
                  act().setAttr(newProp.trim(), '');
                  setNewProp('');
                }
              }}
            />
          </div>
        </Group>
        <Group title="Arrange" id="comp-arrange">
          <div className="cols">
            <button className="btn" disabled={!info.canMoveUp} onClick={() => act().move('up')}>
              <ArrowUp size={13} /> Move up
            </button>
            <button className="btn" disabled={!info.canMoveDown} onClick={() => act().move('down')}>
              <ArrowDown size={13} /> Move down
            </button>
            <button className="btn" onClick={() => act().duplicate()}>
              <Copy size={13} /> Duplicate
            </button>
            <button className="btn danger" onClick={() => act().remove()}>
              <Trash2 size={13} /> Remove
            </button>
          </div>
        </Group>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Nothing selected: page settings + theme
// ---------------------------------------------------------------------------

const PRESETS: [string, string][] = [
  ['Iris', '#7445ff'],
  ['Ocean', '#2563eb'],
  ['Teal', '#0d9488'],
  ['Forest', '#16a34a'],
  ['Amber', '#d97706'],
  ['Tangerine', '#f2590d'],
  ['Rose', '#e11d48'],
  ['Orchid', '#c026d3'],
  ['Graphite', '#475569'],
];
const SEM: [string, string, string][] = [
  ['--bg', 'Page background', 'bg-bg'],
  ['--surface', 'Panels', 'bg-surface'],
  ['--fg', 'Text', 'text-fg'],
  ['--muted', 'Quiet text', 'text-muted'],
  ['--line', 'Borders', 'border-line'],
];

/** For an element inside a component: say which field it shows, or offer to make it one. */
function FieldTools() {
  const sel = useStore((s) => s.selection)!;
  const pageFile = useStore((s) => s.pageFile);
  const info = sel.info;
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => setNames(info?.fieldNames || {}), [info?.start, sel.file, JSON.stringify(info?.fieldNames || {})]);
  if (!info) return null;
  const onPage = pageFile !== sel.file;
  if (info.field) {
    return (
      <Group title="Widget field" id="field-tools">
        <p className="note" style={{ margin: 0 }}>
          This shows the <b>{info.field}</b> field. {onPage ? 'Double-click it on the page to change it for this page only.' : 'Double-click it to change the default text.'}
        </p>
        {onPage && (
          <button className="btn sm" onClick={() => act().selectPlacement(true)}>
            Edit this placement’s fields
          </button>
        )}
      </Group>
    );
  }
  if (info.listItem) {
    return (
      <Group title="Widget field" id="field-tools">
        <p className="note" style={{ margin: 0 }}>
          This is the <b>{info.listItem.key}</b> of one item in the <b>{info.listItem.field}</b> list. Double-click it to change just this item{onPage ? ' on this page' : ''}. Add, remove or reorder items in the widget’s fields.
        </p>
        {onPage && (
          <button className="btn sm" onClick={() => act().selectPlacement(true)}>
            Edit the whole list
          </button>
        )}
      </Group>
    );
  }
  const kinds: string[] = info.fieldKinds || [];
  if (!kinds.length) return null;
  const what: Record<string, string> = { text: 'this text', image: 'this image', link: 'this link’s address', list: `these ${info.repeatCount} repeating items` };
  return (
    <Group title="Make it a field" id="field-tools" defaultOpen={false}>
      <p className="note" style={{ margin: 0 }}>Turn a piece of this block into a field, and each page that uses the block can have its own value for it.</p>
      {kinds.map((k) => (
        <div className="field" key={k}>
          <label>Field name for {what[k]}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <div className="inp" style={{ flex: 1, minWidth: 0 }}>
              <input value={names[k] ?? ''} spellCheck={false} style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }} onChange={(e) => setNames({ ...names, [k]: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
            </div>
            <button className="btn sm" disabled={!(names[k] || '').trim()} onClick={() => act().toField(k, names[k].trim()).catch(act().fail)}>
              {k === 'list' ? 'Turn into a list' : 'Turn into a field'}
            </button>
          </div>
        </div>
      ))}
    </Group>
  );
}

/** When a widget is open on its own, edit the default value of each field. */
function WidgetDefaults({ file }: { file: string }) {
  const stamp = useStore((s) => s.data);
  const [fields, setFields] = useState<any[]>([]);
  useEffect(() => {
    let live = true;
    api.get('/fields?file=' + encodeURIComponent(file)).then((r) => live && setFields(r.fields)).catch(() => live && setFields([]));
    return () => {
      live = false;
    };
  }, [file, stamp]);
  if (!fields.filter((f) => f.type !== 'code').length) return null;
  const isForm = fields.some((f) => f.name === 'fields' && f.type === 'list') && fields.some((f) => f.name === 'sendTo');
  return (
    <Group title={isForm ? 'Form builder' : 'Default content'} id="widget-defaults">
      <p className="note" style={{ margin: 0 }}>{isForm ? 'Build the form here: add, remove and reorder its fields, set where it sends submissions, and watch it update on the left.' : 'What this widget shows when a page doesn’t set its own value.'}</p>
      <WidgetFields fields={fields} onChange={(n, v) => act().setDefault(file, n, v)} />
    </Group>
  );
}

function PagePanel() {
  const data = useStore((s) => s.data);
  const pageFile = useStore((s) => s.pageFile);
  const outlines = useStore((s) => s.outlines);
  const canvasTheme = useStore((s) => s.theme);
  const [rootInfo, setRootInfo] = useState<any>(null);
  const timer = useRef<any>(null);
  const page = data?.pages.find((p: any) => p.file === pageFile);
  const rootNode = pageFile ? (outlines[pageFile] || []).find((n) => n.type === 'component') : null;

  useEffect(() => {
    setRootInfo(null);
    if (!pageFile || !rootNode || !page) return;
    let live = true;
    api.post('/node', { file: pageFile, ref: { start: rootNode.start, loc: rootNode.loc } }).then((i) => live && setRootInfo(i)).catch(() => {});
    return () => {
      live = false;
    };
  }, [pageFile, rootNode?.start, rootNode?.loc, !!page]);

  if (!data) return <div className="hint">Loading…</div>;
  const theme = data.theme;
  const putTheme = (scope: string, vars: Record<string, string | null>, debounce = false) => {
    const go = () => api.put('/theme', { scope, vars }).catch(act().fail);
    clearTimeout(timer.current);
    if (debounce) timer.current = setTimeout(go, 200);
    else go();
  };
  const brand500 = theme.theme['--color-brand-500'] || '#7445ff';
  // Only offer the controls whose values this project actually defines.
  const tailwind = data?.project?.tailwind !== false;
  const hasBrand = '--color-brand-500' in theme.theme;
  const hasSem = ['--bg', '--fg'].every((name) => name in theme.light || name in theme.dark); // one shared name (shadcn's --muted, say) is a coincidence, not our colour set
  const hasShape = '--radius-card' in theme.theme || '--radius-button' in theme.theme;
  const setBrand = (hex: string, debounce = false) => {
    const scale = tw.makeScale(hex);
    const vars: Record<string, string> = {};
    for (const [k, v] of Object.entries(scale)) vars[`--color-brand-${k}`] = v;
    putTheme('theme', vars, debounce);
  };
  const scope = canvasTheme === 'dark' ? 'dark' : 'light';
  const sem = theme[scope] || {};
  const radius = parseFloat(theme.theme['--radius-card'] || '1') || 0;
  const btnRadius = theme.theme['--radius-button'] || '';
  const titleAttr = rootInfo?.attrs.find((a: any) => a.name === 'title');
  const descAttr = rootInfo?.attrs.find((a: any) => a.name === 'description');
  const setRootAttr = (name: string, value: string | null) => act().rawOp({ type: 'setAttr', file: pageFile, target: { start: rootInfo.start, loc: rootInfo.loc }, name, value }).then(() => act().deselect());

  return (
    <>
      <div className="insp-head">
        <div className="insp-title">
          <span>{page ? page.name : pageFile ? pageFile.split('/').pop()!.replace('.astro', '') : 'Styles'}</span>
          {page && <span className="badge">page</span>}
          {!page && pageFile && <span className="badge" style={{ color: 'var(--comp)', borderColor: 'var(--comp)' }}>{pageFile.startsWith('src/layouts') ? 'layout' : 'component'}</span>}
        </div>
        {pageFile && (
          <button className="filechip" onClick={() => useStore.setState({ codeFile: pageFile })} title="Open this file in the code editor">
            <FileCode2 size={12} />
            {pageFile.replace(/^src\//, '')}
          </button>
        )}
        <p className="note">Nothing is selected. Click anything on the page to style it — or set up the page and your site-wide theme here.</p>
      </div>
      <div className="scroll">
        {data?.project?.devScript && (
          <div className="hint" style={{ textAlign: 'left' }}>
            This project’s own start command does more than start Astro: <code>{data.project.devScript}</code>. AstroNut Studio starts Astro on its own, so those extra steps don’t run here. If the preview shows a missing-file error, run <code>{data.project.packageManager || 'npm'} run dev</code> once in the project’s folder, stop it, then restart the preview.
          </div>
        )}
        {!page && pageFile && <WidgetDefaults file={pageFile} />}
        {page && rootInfo && (
          <Group title="Page" id="page-settings">
            <div className="field">
              <label>Browser tab title</label>
              {titleAttr && titleAttr.kind !== 'string' ? <p className="note" style={{ margin: 0 }}>Set from data in code.</p> : <TextField value={titleAttr?.value || ''} placeholder="Uses the layout’s default" onCommit={(x) => setRootAttr('title', x || null)} />}
            </div>
            <div className="field">
              <label>Description for search engines</label>
              {descAttr && descAttr.kind !== 'string' ? <p className="note" style={{ margin: 0 }}>Set from data in code.</p> : <TextArea value={descAttr?.value || ''} rows={2} onCommit={(x) => setRootAttr('description', x || null)} />}
            </div>
            <p className="sub" style={{ margin: 0 }}>
              Address <b style={{ fontFamily: 'var(--mono)' }}>{page.route}</b> · wrapped by <b>{rootInfo.name}</b>
            </p>
          </Group>
        )}

        {!theme.file || (!hasBrand && !hasSem && !hasShape) ? (
          <>
            <div className="hint" style={{ textAlign: 'left' }}>
              The colour and shape controls edit named values in a Tailwind <code>@theme</code> block (<code>--color-brand-500</code>, <code>--radius-card</code> and so on). This project’s CSS doesn’t define them, so there is nothing for them to change here.
            </div>
            {tailwind && <FontRoles />}
            {theme.file && (
              <div style={{ padding: 14 }}>
                <button className="btn block ghost" onClick={() => useStore.setState({ codeFile: theme.file })}>
                  <Code2 size={14} /> Edit the site’s CSS
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {hasBrand && <Group title="Brand colour" id="theme-brand">
              <div className="scale">
                {tw.SCALE_STEPS.map((s) => (
                  <i key={s} style={{ background: theme.theme[`--color-brand-${s}`] }} title={`brand-${s}`} />
                ))}
              </div>
              <div className="presets">
                {PRESETS.map(([n, c]) => (
                  <button key={n} title={n} style={{ background: c }} onClick={() => setBrand(c)} />
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="color" title="Pick any colour" value={tw.normalizeHex(brand500) || '#7445ff'} onChange={(e) => setBrand(e.target.value, true)} />
                <span style={{ flex: 1 }}>Custom colour</span>
                <HexField value={brand500} onCommit={(hex) => setBrand(hex)} />
              </div>
              <p className="sub" style={{ margin: 0 }}>Buttons, links and highlights follow this colour. Lighter and darker shades are generated from it.</p>
            </Group>}

            {hasSem && <Group title={`Colours · ${scope} mode`} id="theme-sem">
              {SEM.map(([name, label, util]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="color" value={tw.normalizeHex(sem[name] || '') || '#888888'} onChange={(e) => putTheme(scope, { [name]: e.target.value }, true)} />
                  <span style={{ flex: 1 }} title={`Used by the ${util} class`}>{label}</span>
                  <HexField value={sem[name] || ''} onCommit={(hex) => putTheme(scope, { [name]: hex })} />
                </div>
              ))}
              <p className="sub" style={{ margin: 0 }}>Switch the preview to {scope === 'dark' ? 'light' : 'dark'} mode (☀︎ / ☾ above the page) to edit the other set.</p>
            </Group>}

            <FontRoles />

            {hasShape && <Group title="Shape" id="theme-shape">
              <div className="field">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <label className="lbl">Card corners</label>
                  <span className="sub">{radius}rem</span>
                </div>
                <input type="range" min={0} max={2.5} step={0.125} value={radius} onChange={(e) => putTheme('theme', { '--radius-card': e.target.value + 'rem' }, true)} />
              </div>
              <div className="field">
                <label>Buttons</label>
                <Seg
                  value={btnRadius === '9999px' ? 'pill' : btnRadius === '0' || btnRadius === '0px' || btnRadius === '0rem' ? 'square' : 'round'}
                  onChange={(v) => v && putTheme('theme', { '--radius-button': v === 'pill' ? '9999px' : v === 'square' ? '0px' : '0.625rem' })}
                  options={[
                    { value: 'square', label: 'Square' },
                    { value: 'round', label: 'Rounded' },
                    { value: 'pill', label: 'Pill' },
                  ]}
                />
              </div>
            </Group>}
            <div style={{ padding: 14 }}>
              <button className="btn block ghost" onClick={() => useStore.setState({ codeFile: theme.file })}>
                <Code2 size={14} /> Edit theme CSS
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export { Component };
