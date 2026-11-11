// Widgets: the per-placement field form, the floating widget editor, and the project inventory.
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Blocks, Component, Database, Image as ImageIcon, LayoutTemplate, MapPin, RotateCcw, Search, SlidersHorizontal, Trash2, X, Code2, Plus, Copy as CopyIcon, Link2 } from 'lucide-react';
import { useStore, act, EMPTY } from '../store';
import { api, q } from '../api';
import { Modal, Popover, Switch } from './ui';
import { Media } from './LeftPanel';

/** How each kind of asset gets its content — shown as a small coloured tag everywhere. */
export const SOURCES: Record<string, { label: string; tip: string; color: string; Icon: any }> = {
  block: { label: 'Block', tip: 'Its text lives in the block itself. Type on the page to change it — the change shows wherever the block is used.', color: 'var(--comp)', Icon: Component },
  widget: { label: 'Widget', tip: 'Has fields. Every placement can have its own text and images while sharing one design.', color: 'var(--widget)', Icon: SlidersHorizontal },
  data: { label: 'Data', tip: 'Fills itself from a content collection. Edit the entries in the Content tab.', color: 'var(--dyn)', Icon: Database },
  page: { label: 'Page-aware', tip: 'Works out what to show from the page it sits on. Nothing to fill in.', color: 'var(--slot)', Icon: MapPin },
  code: { label: 'Coded', tip: 'Its content is passed in by code. Edit it in the code editor.', color: 'var(--dyn)', Icon: Code2 },
  layout: { label: 'Layout', tip: 'The shared shell around pages.', color: 'var(--comp)', Icon: LayoutTemplate },
};

export function SourceTag({ source, small }: { source: string; small?: boolean }) {
  const s = SOURCES[source] || SOURCES.block;
  return (
    <span className="srctag" style={{ color: s.color, borderColor: s.color, fontSize: small ? 10 : undefined }} title={s.tip}>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The field form
// ---------------------------------------------------------------------------

function FieldInput({ field, value, onChange }: { field: any; value: any; onChange: (v: any) => void }) {
  const [v, setV] = useState<any>(value ?? '');
  const [picker, setPicker] = useState(false);
  const pages = useStore((s) => s.data?.pages || EMPTY);
  useEffect(() => setV(value ?? ''), [value]);
  const commit = () => v !== (value ?? '') && onChange(v);
  const keys = (e: any, multiline = false) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) (e.target as HTMLElement).blur();
    if (e.key === 'Escape') setV(value ?? '');
  };
  if (field.type === 'toggle') return <Switch on={!!value} onChange={onChange} label={value ? 'On' : 'Off'} />;
  if (field.type === 'choice')
    return (
      <div className="inp set">
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o: string) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  if (field.type === 'lines') {
    const text = Array.isArray(value) ? value.join('\n') : '';
    return <LinesInput text={text} onChange={(t) => onChange(t.split('\n').map((x) => x.trim()).filter(Boolean))} />;
  }
  if (field.type === 'html') return <textarea className="area mono" rows={3} value={v} spellCheck={false} title="Icon markup (SVG)" onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => keys(e, true)} />;
  if (field.type === 'longtext') return <textarea className="area" rows={4} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => keys(e, true)} />;
  return (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        <div className="inp" style={{ flex: 1, minWidth: 0 }}>
          {field.type === 'link' && <Link2 size={12} style={{ color: 'var(--muted)', flex: 'none' }} />}
          <input
            type={field.type === 'number' ? 'number' : 'text'}
            list={field.type === 'link' ? 'al-widget-pages' : undefined}
            value={v}
            spellCheck={field.type === 'text'}
            style={field.type === 'image' || field.type === 'link' ? { fontFamily: 'var(--mono)', fontSize: 11.5 } : undefined}
            onChange={(e) => setV(e.target.value)}
            onBlur={commit}
            onKeyDown={keys}
          />
        </div>
        {field.type === 'image' && (
          <button className="btn sm" onClick={() => setPicker(true)}>
            <ImageIcon size={13} /> Choose
          </button>
        )}
      </div>
      {field.type === 'image' && value && <img src={(useStore.getState().dev.url || '') + value} alt="" className="fieldthumb" />}
      {field.type === 'link' && (
        <datalist id="al-widget-pages">
          {pages.filter((p: any) => !p.dynamic).map((p: any) => (
            <option key={p.route} value={p.route} />
          ))}
        </datalist>
      )}
      {picker && (
        <Modal title="Choose an image" onClose={() => setPicker(false)}>
          <div style={{ overflowY: 'auto', paddingBottom: 10 }}>
            <Media
              onPick={(m) => {
                onChange(m.url);
                setPicker(false);
              }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

function LinesInput({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  const [v, setV] = useState(text);
  useEffect(() => setV(text), [text]);
  return <textarea className="area" rows={Math.max(3, v.split('\n').length)} value={v} placeholder="One per line" onChange={(e) => setV(e.target.value)} onBlur={() => v !== text && onChange(v)} onKeyDown={(e) => e.stopPropagation()} />;
}

/** A repeating group: add, remove, reorder, and edit each item's own fields. */
function ListField({ field, value, onChange }: { field: any; value: any[]; onChange: (v: any[]) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const items = Array.isArray(value) ? value : [];
  const titleKey = (field.itemFields.find((k: any) => k.type === 'text') || field.itemFields.find((k: any) => k.type === 'longtext') || field.itemFields[0])?.name;
  const update = (next: any[], keepOpen: number | null = open) => {
    setOpen(keepOpen);
    onChange(next);
  };
  const blank = () => {
    const o: any = {};
    for (const k of field.itemFields) o[k.name] = k.type === 'toggle' ? false : k.type === 'number' ? 0 : k.type === 'lines' ? [] : k.type === 'image' || k.type === 'html' || k.type === 'link' ? (items.at(-1)?.[k.name] ?? '') : k.type === 'longtext' ? 'Describe it here.' : `New ${k.label.toLowerCase()}`;
    return o;
  };
  const move = (i: number, d: number) => {
    const next = [...items];
    const [it] = next.splice(i, 1);
    next.splice(i + d, 0, it);
    update(next, open === i ? i + d : open === i + d ? i : open);
  };
  return (
    <div className="listfield">
      {items.map((it, i) => (
        <div className={'listitem' + (open === i ? ' open' : '')} key={i}>
          <div className="listhead" onClick={() => setOpen(open === i ? null : i)}>
            <ChevronRight size={12} className="tw" />
            <span className="num">{i + 1}</span>
            <span className="ttl">{String(it[titleKey] ?? '').replace(/<[^>]+>/g, '') || `Item ${i + 1}`}</span>
            <span className="acts" onClick={(e) => e.stopPropagation()}>
              <button className="icon-btn sm" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={12} />
              </button>
              <button className="icon-btn sm" title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={12} />
              </button>
              <button className="icon-btn sm" title="Duplicate" onClick={() => update([...items.slice(0, i + 1), { ...it }, ...items.slice(i + 1)], i + 1)}>
                <CopyIcon size={12} />
              </button>
              <button className="icon-btn sm" title="Remove" disabled={items.length <= 1} onClick={() => update(items.filter((_, k) => k !== i), null)}>
                <Trash2 size={12} />
              </button>
            </span>
          </div>
          {open === i && (
            <div className="listbody">
              {field.itemFields.map((k: any) => (
                <div className="field" key={k.name}>
                  <label className="lbl">{k.label}</label>
                  <FieldInput field={k} value={it[k.name]} onChange={(v) => update(items.map((x, j) => (j === i ? { ...x, [k.name]: v } : x)))} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <button className="btn sm ghost" onClick={() => update([...items, blank()], items.length)}>
        <Plus size={13} /> Add {field.label.toLowerCase().replace(/s$/, '')}
      </button>
    </div>
  );
}

/**
 * The form for a widget's fields.
 *  - with `values`: one placement's values (changes are written on the page)
 *  - without: the widget's defaults (changes are written in the widget's own file)
 */
export function WidgetFields({ fields, values, onChange, onReset }: { fields: any[]; values?: Record<string, any>; onChange: (name: string, value: any) => void; onReset?: (name: string) => void }) {
  const editable = fields.filter((f) => f.type !== 'code');
  const coded = fields.filter((f) => f.type === 'code');
  return (
    <div className="wfields">
      {editable.map((f) => {
        const st = values ? values[f.name] : { set: false, value: f.default };
        return (
          <div className="field" key={f.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <label className="lbl" title={`Field “${f.name}”`}>
                {f.label}
                {values && st?.set && <span className="setdot" title="This placement has its own value" />}
              </label>
              {values && st?.set && onReset && (
                <button className="sub" title="Go back to the widget’s default" onClick={() => onReset(f.name)}>
                  <RotateCcw size={10} /> default
                </button>
              )}
            </div>
            {st?.code ? (
              <div className="inp" style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', whiteSpace: 'nowrap' }} title="Set from code on this page — edit it in the Source tab">
                {st.code}
              </div>
            ) : f.type === 'list' ? (
              <ListField field={f} value={st?.value} onChange={(v) => onChange(f.name, v)} />
            ) : (
              <FieldInput field={f} value={st?.value} onChange={(v) => onChange(f.name, v)} />
            )}
          </div>
        );
      })}
      {coded.length > 0 && (
        <p className="sub" style={{ margin: 0, lineHeight: 1.45 }}>
          Also takes {coded.map((f) => f.name).join(', ')} — {coded.length === 1 ? 'a value' : 'values'} passed in by code (a list or a content entry), not editable here yet.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating widget editor (the canvas stays visible, so it doubles as the preview)
// ---------------------------------------------------------------------------

export function WidgetEditor() {
  const sel = useStore((s) => s.selection);
  const pageFile = useStore((s) => s.pageFile);
  const info = sel?.kind === 'component' ? sel.info : null;
  const close = () => useStore.setState({ widgetOpen: false });
  const page = useStore((s) => s.data?.pages.find((p: any) => p.file === pageFile));
  return (
    <div className="float widgeted">
      <div className="float-head">
        <SlidersHorizontal size={15} style={{ color: 'var(--widget)' }} />
        <span className="grow">{info ? info.name : 'Widget editor'}</span>
        {info && <span className="sub" style={{ fontWeight: 400 }}>{page ? `on ${page.route}` : ''}</span>}
        <button className="icon-btn" onClick={close}>
          <X size={15} />
        </button>
      </div>
      <div className="scroll" style={{ padding: 14 }}>
        {!info ? (
          <p className="note" style={{ margin: 0 }}>Select a widget on the page (or in the Layers list) to edit its content here.</p>
        ) : !info.fields?.filter((f: any) => f.type !== 'code').length ? (
          <p className="note" style={{ margin: 0 }}>
            <b>{info.name}</b> has no fields yet. Open it, select a piece of text or an image, and choose “Turn into a field” to make it editable per page.
          </p>
        ) : (
          <>
            <p className="note" style={{ margin: '0 0 12px' }}>These values belong to <b>this placement only</b>. The design is shared with every other place {info.name} is used.</p>
            <WidgetFields fields={info.fields} values={info.values} onChange={(n, v) => act().setField(n, v)} onReset={(n) => act().setField(n, null)} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Linked or copy?" when adding something that other pages already use
// ---------------------------------------------------------------------------

export function AddChoice({ anchor, c, onClose }: { anchor: HTMLElement; c: any; onClose: () => void }) {
  const where = c.usedOn.map((u: any) => u.route).slice(0, 4).join(', ') + (c.usedOn.length > 4 ? '…' : '');
  const add = (copy: boolean) => {
    onClose();
    act().insertBlock({ component: c.file, hasSlot: false, copy });
  };
  return (
    <Popover anchor={anchor} onClose={onClose}>
      <div className="addchoice">
        <div className="menu-label" style={{ padding: '4px 4px 6px' }}>{c.name} is already used on {where}</div>
        <button onClick={() => add(false)}>
          <b>
            <Link2 size={13} /> Linked
          </b>
          <span>{c.source === 'widget' ? 'Same design everywhere; this placement gets its own field values.' : 'The same block. Editing it changes every page that uses it.'}</span>
        </button>
        <button onClick={() => add(true)}>
          <b>
            <CopyIcon size={13} /> Copy for this page
          </b>
          <span>A separate copy you can change freely without touching other pages.</span>
        </button>
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export function Inventory() {
  const data = useStore((s) => s.data);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const close = () => useStore.setState({ inventoryOpen: false });
  const all = useMemo(() => [...(data?.components || []), ...(data?.layouts || [])], [data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length, unused: 0 };
    for (const x of all) {
      c[x.source] = (c[x.source] || 0) + 1;
      if (!x.usedOn.length && x.kind !== 'layout') c.unused++;
    }
    return c;
  }, [all]);
  const rows = all.filter((c: any) => (filter === 'all' || (filter === 'unused' ? !c.usedOn.length && c.kind !== 'layout' : c.source === filter)) && (!query || (c.name + ' ' + c.folder).toLowerCase().includes(query.toLowerCase())));
  const go = (route: string, c: any) => {
    close();
    act().setTab('file');
    const page = data.pages.find((p: any) => p.route === route);
    if (page) act().openPage(page);
    void c;
  };
  const remove = (c: any) =>
    useStore.setState({
      dialog: {
        type: 'confirm',
        title: `Delete ${c.name}?`,
        text: c.usedOn.length ? `${c.name} is still used. Those pages will show an error until you remove it from them. Undo brings the file back.` : `${c.file} isn’t used anywhere. Undo brings it back.`,
        usedOn: c.usedOn,
        confirm: 'Delete',
        danger: true,
        onSubmit: async () => {
          await api.del('/file' + q({ path: c.file }));
          await act().load();
        },
      },
    });
  return (
    <Modal
      wide
      className="inventory"
      onClose={close}
      title={
        <>
          <Blocks size={16} /> Inventory
          <span className="sub" style={{ fontWeight: 400 }}>everything reusable in this project, and where it is used</span>
        </>
      }
    >
      <div className="inv-bar">
        <div className="inp" style={{ width: 220 }}>
          <Search size={13} style={{ color: 'var(--muted)' }} />
          <input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoFocus />
        </div>
        <div className="seg">
          {['all', 'block', 'widget', 'data', 'page', 'code', 'layout', 'unused'].filter((k) => k === 'all' || counts[k]).map((k) => (
            <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {k === 'all' ? 'All' : k === 'unused' ? 'Unused' : SOURCES[k].label} <small style={{ color: 'var(--muted)' }}>{counts[k]}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="inv-list">
        <div className="inv-row head">
          <span>Name</span>
          <span>Kind</span>
          <span>Fields</span>
          <span>Used on</span>
          <span />
        </div>
        {rows.map((c: any) => {
          const S = SOURCES[c.source] || SOURCES.block;
          return (
            <div className="inv-row" key={c.file}>
              <span className="inv-name" title={c.file}>
                <S.Icon size={14} style={{ color: S.color, flex: 'none' }} />
                <button
                  onClick={() => {
                    close();
                    act().setTab('assets');
                    act().openComponent(c);
                  }}
                >
                  {c.name}
                </button>
                {c.folder && <span className="sub">{c.folder}</span>}
              </span>
              <span>
                <SourceTag source={c.source} />
              </span>
              <span className="sub" title={c.fields.map((f: any) => f.label).join(', ')}>{c.fields.length ? c.fields.map((f: any) => f.label + (f.type === 'list' ? ` ×${f.count}` : '')).slice(0, 3).join(', ') + (c.fields.length > 3 ? ` +${c.fields.length - 3}` : '') : '—'}</span>
              <span className="inv-pages">
                {c.kind === 'layout' ? (
                  <span className="sub">{c.usedOn.length} page{c.usedOn.length === 1 ? '' : 's'}</span>
                ) : c.usedOn.length ? (
                  c.usedOn.map((u: any) => (
                    <button key={u.file} className="pagechip" title={u.direct ? `Placed ${u.count}× on this page` : 'Shown here through a layout or another component'} onClick={() => go(u.route, c)}>
                      {u.route}
                      {u.direct && u.count > 1 ? ` ×${u.count}` : ''}
                      {!u.direct && <i>indirectly</i>}
                    </button>
                  ))
                ) : (
                  <span className="unused">not used</span>
                )}
              </span>
              <span className="inv-acts">
                {c.kind !== 'layout' && (
                  <button
                    className="icon-btn sm"
                    title="Add to the current page"
                    onClick={() => {
                      close();
                      act().insertBlock({ component: c.file });
                    }}
                  >
                    <Plus size={14} />
                  </button>
                )}
                <button className="icon-btn sm" title="Edit code" onClick={() => useStore.setState({ codeFile: c.file, inventoryOpen: false })}>
                  <Code2 size={14} />
                </button>
                <button className="icon-btn sm" title="Delete" onClick={() => remove(c)}>
                  <Trash2 size={14} />
                </button>
              </span>
            </div>
          );
        })}
        {!rows.length && <div className="hint">Nothing matches.</div>}
      </div>
      <div className="inv-legend">
        {['block', 'widget', 'data', 'page'].map((k) => (
          <span key={k}>
            <SourceTag source={k} /> {SOURCES[k].tip}
          </span>
        ))}
      </div>
    </Modal>
  );
}
