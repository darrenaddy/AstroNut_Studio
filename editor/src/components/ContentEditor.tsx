// Markdown + frontmatter editor for content collection entries.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { ExternalLink, FileText, Trash2 } from 'lucide-react';
import { useStore, act, EMPTY } from '../store';
import { api, q } from '../api';
import { Code } from './Code';
import { Modal, Seg, Switch } from './ui';
import { Media } from './LeftPanel';
import { useDark } from './Inspector';
import { previewUrl, srcForMedia, visualBlocker } from './postPaths';

const PostEditor = lazy(() => import('./PostEditor'));
const MODE_KEY = 'astronut.postMode';
const preferred = () => {
  try {
    return localStorage.getItem(MODE_KEY) === 'markdown' ? 'markdown' : 'visual';
  } catch {
    return 'visual';
  }
};

/** A value the simple controls can't hold: an object, or a list with objects in it. */
const isGroup = (v: any) => v != null && typeof v === 'object' && (!Array.isArray(v) || v.some((x) => x != null && typeof x === 'object'));

/** What a date field shows. Dates are often typed as "Jul 08 2022"; the picker needs 2022-07-08. */
function dateValue(v: any) {
  if (!v) return '';
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ContentEditor() {
  const file = useStore((s) => s.entryFile);
  const collections = useStore((s) => s.data?.collections || EMPTY);
  const devUrl = useStore((s) => s.dev.url);
  const pages = useStore((s) => s.data?.pages || EMPTY);
  const dark = useDark();
  const [entry, setEntry] = useState<any>(null);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [picking, setPicking] = useState<string | null>(null);
  const [mode, setMode] = useState<'visual' | 'markdown'>('visual');
  const [why, setWhy] = useState<string | null>(null); // why this post has to stay in Markdown view
  const [mount, setMount] = useState(0);
  const timer = useRef<any>(null);
  const latest = useRef<any>(null);

  const collection = collections.find((c: any) => file && file.startsWith(c.dir + '/'));

  useEffect(() => {
    setEntry(null);
    if (!file) return;
    let live = true;
    api
      .get('/content/entry' + q({ file }))
      .then((e) => {
        if (!live) return;
        const blocked = visualBlocker(file, e.body || '');
        setWhy(blocked);
        setMode(blocked ? 'markdown' : preferred());
        setEntry(e);
      })
      .catch(act().fail);
    return () => {
      live = false;
      clearTimeout(timer.current);
      if (latest.current) flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // A group of fields is edited in the file itself; pick up what was changed there when the code editor closes.
  const codeFile = useStore((s) => s.codeFile);
  useEffect(() => {
    if (codeFile || !file || latest.current) return;
    api
      .get('/content/entry' + q({ file }))
      .then((e) => setEntry((was: any) => (was ? { ...was, data: e.data, body: e.body } : was)))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFile]);

  const flush = async () => {
    const e = latest.current;
    latest.current = null;
    if (!e) return;
    setSaved('saving');
    try {
      await api.put('/content/entry', e);
      setSaved('saved');
    } catch (err) {
      act().fail(err);
      setSaved('dirty');
    }
  };
  const update = (patch: any) => {
    const next = { ...entry, ...patch };
    setEntry(next);
    latest.current = next;
    setSaved('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };
  const setField = (name: string, value: any) => update({ data: { ...entry.data, [name]: value } });

  const html = useMemo(() => {
    if (!entry || !file) return '';
    const out = marked.parse(entry.body || '', { async: false }) as string;
    // Pictures are written relative to the post; point them at the running site so they show here.
    return out.replace(/(<img[^>]*\ssrc=")([^"]*)"/g, (_m, pre, src) => `${pre}${previewUrl(file, src, devUrl || '')}"`);
  }, [entry?.body, file, devUrl]);

  const switchMode = (next: string) => {
    if (!next || next === mode) return;
    if (next === 'visual') {
      const blocked = visualBlocker(file!, entry.body || '');
      setWhy(blocked);
      if (blocked) return;
      setMount((n) => n + 1);
    }
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {}
    setMode(next as any);
  };

  if (!file) {
    return (
      <div className="content">
        <div className="center-empty">
          <div>
            <FileText size={28} strokeWidth={1.4} />
            <p style={{ fontSize: 14, color: 'var(--fg2)', margin: '10px 0 4px' }}>Select a post to edit</p>
            <p style={{ margin: 0, maxWidth: 340 }}>Content collections hold your writing as Markdown files. Pages like the blog read from them automatically.</p>
          </div>
        </div>
      </div>
    );
  }
  if (!entry || !collection) return <div className="content"><div className="center-empty">Loading…</div></div>;

  const id = file.slice(collection.dir.length + 1).replace(/\.(md|mdx)$/, '');
  const page = pages.find((p: any) => p.dynamic && p.route.split('/').includes(collection.name));
  const liveUrl = page ? page.route.replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/, id) : null;
  const fields = [...collection.fields];
  for (const k of Object.keys(entry.data)) if (!fields.some((f: any) => f.name === k)) fields.push({ name: k, type: typeof entry.data[k] === 'boolean' ? 'boolean' : isGroup(entry.data[k]) ? 'group' : Array.isArray(entry.data[k]) ? 'tags' : 'text' });
  const pickingField = fields.find((f: any) => f.name === picking);

  return (
    <div className="content">
      <div className="content-top">
        <span className="badge" style={{ color: 'var(--dyn)', borderColor: 'var(--dyn)' }}>{collection.name}</span>
        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.data.title || id}</b>
        <span className="sub" style={{ fontFamily: 'var(--mono)' }}>{file.replace('src/content/', '')}</span>
        <span className="grow" />
        <Seg full={false} value={mode} onChange={switchMode} options={[{ value: 'visual', label: 'Visual', tip: 'Write and format the post as it will read' }, { value: 'markdown', label: 'Markdown', tip: 'Edit the Markdown file directly' }]} />
        <span className="sub">{saved === 'saved' ? 'All changes saved' : saved === 'saving' ? 'Saving…' : 'Unsaved…'}</span>
        {liveUrl && (
          <button
            className="btn sm ghost"
            onClick={() => {
              act().setTab('file');
              act().navigate(liveUrl);
            }}
          >
            <ExternalLink size={13} /> View on the site
          </button>
        )}
        <button
          className="icon-btn"
          title="Delete entry"
          onClick={() =>
            useStore.setState({
              dialog: {
                type: 'confirm',
                title: 'Delete this entry?',
                text: `${file} will be removed. Undo brings it back.`,
                confirm: 'Delete',
                danger: true,
                onSubmit: async () => {
                  latest.current = null;
                  await api.del('/file' + q({ path: file }));
                  useStore.setState({ entryFile: null });
                  act().load();
                },
              },
            })
          }
        >
          <Trash2 size={15} />
        </button>
      </div>
      {picking && (
        <Modal title="Choose an image" onClose={() => setPicking(null)}>
          <div style={{ overflowY: 'auto', paddingBottom: 10 }}>
            <Media
              onPick={(m) => {
                setField(picking, pickingField?.asset ? srcForMedia(file, m) : m.url);
                setPicking(null);
              }}
            />
          </div>
        </Modal>
      )}
      <div className={'content-main' + (mode === 'visual' ? ' visual' : '')}>
        <div className="fm">
          <div className="sub" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Fields</div>
          {fields.map((f: any) => {
            const v = entry.data[f.name];
            const label = f.name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c: string) => c.toUpperCase());
            if (f.type === 'group' || isGroup(v))
              return (
                <div className="field" key={f.name}>
                  <label>
                    {label}
                    {f.required ? ' *' : ''}
                  </label>
                  <p className="note" style={{ margin: 0 }}>
                    {v == null ? 'Not set. ' : Array.isArray(v) ? `A list of ${v.length} ${v.length === 1 ? 'item' : 'items'}, each with its own fields. ` : `A group of fields (${Object.keys(v).slice(0, 4).join(', ')}${Object.keys(v).length > 4 ? '…' : ''}). `}
                    <button style={{ textDecoration: 'underline' }} onClick={() => useStore.setState({ codeFile: file })}>
                      Edit it in the file
                    </button>
                  </p>
                </div>
              );
            if (f.type === 'boolean') return <Switch key={f.name} on={!!v} onChange={(x) => setField(f.name, x)} label={label} />;
            return (
              <div className="field" key={f.name}>
                <label>
                  {label}
                  {f.required ? ' *' : ''}
                </label>
                {f.type === 'textarea' ? (
                  <textarea className="area" rows={3} value={v ?? ''} onChange={(e) => setField(f.name, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                ) : f.type === 'tags' ? (
                  <div className="inp">
                    <input value={Array.isArray(v) ? v.join(', ') : v ?? ''} placeholder="comma, separated" onChange={(e) => setField(f.name, e.target.value.split(',').map((s) => s.trimStart()).filter((s, i, a) => s || i === a.length - 1))} onBlur={(e) => setField(f.name, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} onKeyDown={(e) => e.stopPropagation()} />
                  </div>
                ) : (
                  <div className="inp">
                    <input type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} value={f.type === 'date' ? dateValue(v) : v ?? ''} onChange={(e) => setField(f.name, f.type === 'number' ? Number(e.target.value) : e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                  </div>
                )}
                {f.type === 'image' && (
                  <button className="btn sm ghost" style={{ justifySelf: 'start' }} onClick={() => setPicking(f.name)}>
                    Choose an image
                  </button>
                )}
                {f.type === 'image' && v && <img src={previewUrl(file, String(v), devUrl || '')} alt="" style={{ width: '100%', aspectRatio: '2/1', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />}
              </div>
            );
          })}
          <p className="sub" style={{ lineHeight: 1.5, margin: 0 }}>
            These fields are the entry’s <b>frontmatter</b>. Which fields exist is decided by the collection’s schema in <button style={{ textDecoration: 'underline' }} onClick={() => useStore.setState({ codeFile: 'src/content.config.ts' })}>content.config.ts</button>.
          </p>
        </div>
        {mode === 'visual' ? (
          <div className="md-visual">
            <Suspense fallback={<div className="center-empty">Loading the editor…</div>}>
              <PostEditor
                key={file + ':' + mount}
                file={file}
                body={entry.body || ''}
                devUrl={devUrl || ''}
                onChange={(body) => update({ body })}
                onFallback={(reason) => {
                  setWhy(reason);
                  setMode('markdown');
                }}
              />
            </Suspense>
          </div>
        ) : (
          <>
            <div className="md-edit">
              {why && (
                <p className="md-why">
                  This post opens as Markdown because {why}. Editing it here keeps it exactly as written.
                </p>
              )}
              <Code key={file} value={entry.body} onChange={(body) => update({ body })} filename="entry.md" minimal dark={dark} />
            </div>
            <div className="md-preview">
              {entry.data.heroImage && <img className="cover" src={previewUrl(file, String(entry.data.heroImage), devUrl || '')} alt="" />}
              <h1>{entry.data.title}</h1>
              {entry.data.description && <p className="lede">{entry.data.description}</p>}
              <div dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
