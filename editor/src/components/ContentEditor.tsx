// Markdown + frontmatter editor for content collection entries.
import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import { ExternalLink, FileText, Trash2 } from 'lucide-react';
import { useStore, act, EMPTY } from '../store';
import { api, q } from '../api';
import { Code } from './Code';
import { Modal, Switch } from './ui';
import { Media } from './LeftPanel';
import { useDark } from './Inspector';

export function ContentEditor() {
  const file = useStore((s) => s.entryFile);
  const collections = useStore((s) => s.data?.collections || EMPTY);
  const devUrl = useStore((s) => s.dev.url);
  const pages = useStore((s) => s.data?.pages || EMPTY);
  const dark = useDark();
  const [entry, setEntry] = useState<any>(null);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [picking, setPicking] = useState<string | null>(null);
  const timer = useRef<any>(null);
  const latest = useRef<any>(null);

  const collection = collections.find((c: any) => file && file.startsWith(c.dir + '/'));

  useEffect(() => {
    setEntry(null);
    if (!file) return;
    let live = true;
    api.get('/content/entry' + q({ file })).then((e) => live && setEntry(e)).catch(act().fail);
    return () => {
      live = false;
      clearTimeout(timer.current);
      if (latest.current) flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

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

  const html = useMemo(() => (entry ? (marked.parse(entry.body || '', { async: false }) as string) : ''), [entry?.body]);

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
  for (const k of Object.keys(entry.data)) if (!fields.some((f: any) => f.name === k)) fields.push({ name: k, type: typeof entry.data[k] === 'boolean' ? 'boolean' : Array.isArray(entry.data[k]) ? 'tags' : 'text' });

  return (
    <div className="content">
      <div className="content-top">
        <span className="badge" style={{ color: 'var(--dyn)', borderColor: 'var(--dyn)' }}>{collection.name}</span>
        <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.data.title || id}</b>
        <span className="sub" style={{ fontFamily: 'var(--mono)' }}>{file.replace('src/content/', '')}</span>
        <span className="grow" />
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
                setField(picking, m.url);
                setPicking(null);
              }}
            />
          </div>
        </Modal>
      )}
      <div className="content-main">
        <div className="fm">
          <div className="sub" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Fields</div>
          {fields.map((f: any) => {
            const v = entry.data[f.name];
            const label = f.name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c: string) => c.toUpperCase());
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
                    <input type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} value={v ?? ''} onChange={(e) => setField(f.name, f.type === 'number' ? Number(e.target.value) : e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                  </div>
                )}
                {f.type === 'image' && (
                  <button className="btn sm ghost" style={{ justifySelf: 'start' }} onClick={() => setPicking(f.name)}>
                    Choose an image
                  </button>
                )}
                {f.type === 'image' && v && <img src={(devUrl || '') + v} alt="" style={{ width: '100%', aspectRatio: '2/1', objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} />}
              </div>
            );
          })}
          <p className="sub" style={{ lineHeight: 1.5, margin: 0 }}>
            These fields are the entry’s <b>frontmatter</b>. Which fields exist is decided by the collection’s schema in <button style={{ textDecoration: 'underline' }} onClick={() => useStore.setState({ codeFile: 'src/content.config.ts' })}>content.config.ts</button>.
          </p>
        </div>
        <div className="md-edit">
          <Code key={file} value={entry.body} onChange={(body) => update({ body })} filename="entry.md" minimal dark={dark} />
        </div>
        <div className="md-preview">
          {entry.data.heroImage && <img className="cover" src={(devUrl || '') + entry.data.heroImage} alt="" />}
          <h1>{entry.data.title}</h1>
          {entry.data.description && <p className="lede">{entry.data.description}</p>}
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
