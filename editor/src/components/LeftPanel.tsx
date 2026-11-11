import { useMemo, useRef, useState } from 'react';
import { ListTree, Box, ChevronRight, Code2, Component, Copy, Database, File, FileText, Folder, FolderPlus, Home, LayoutTemplate, MoreHorizontal, Palette, Pencil, Plus, ScanLine, Trash2, Type, Upload, X, Image as ImageIcon, Link2, List, Square, MousePointerClick, Minus, Heading, FormInput, PanelTop } from 'lucide-react';
import { useStore, act, type OutlineNode, EMPTY, SMART_IMAGE } from '../store';
import { api, q } from '../api';
import { Menu } from './ui';
import { AddChoice, SOURCES } from './Widgets';

export const DRAG_TYPE = 'application/x-astrophile';

const TAG_ICONS: Record<string, any> = { img: ImageIcon, a: Link2, ul: List, ol: List, button: MousePointerClick, h1: Heading, h2: Heading, h3: Heading, h4: Heading, p: Type, span: Type, hr: Minus, form: FormInput, input: FormInput, header: PanelTop, nav: PanelTop };

export function LeftPanel() {
  const tab = useStore((s) => s.tab);
  return (
    <aside className="left">
      <div className="tabs">
        <button className="brand tip down" data-tip="Go to the home page" onClick={() => act().navigate('/')}>
          <Home size={16} strokeWidth={2.4} />
        </button>
        {(['file', 'assets', 'content'] as const).map((t) => (
          <button key={t} className={'tab' + (tab === t ? ' on' : '')} onClick={() => act().setTab(t)}>
            {t === 'file' ? 'File' : t === 'assets' ? 'Assets' : 'Content'}
          </button>
        ))}
      </div>
      {tab === 'file' && <FileTab />}
      {tab === 'assets' && <AssetsTab />}
      {tab === 'content' && <ContentTab />}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// File tab: pages + layers
// ---------------------------------------------------------------------------

function FileTab() {
  const pages = useStore((s) => s.data?.pages || EMPTY);
  const pageFile = useStore((s) => s.pageFile);
  const [menu, setMenu] = useState<{ el: HTMLElement; page: any } | null>(null);

  const newPage = () =>
    useStore.setState({
      dialog: {
        type: 'prompt',
        title: 'New page',
        label: 'Page address',
        prefix: '/',
        placeholder: 'about-us',
        hint: 'Astro turns every file in src/pages into a page. “about-us” becomes src/pages/about-us.astro and lives at /about-us.',
        confirm: 'Create page',
        onSubmit: async (route: string) => {
          const r = await api.post('/pages', { route });
          await act().load();
          act().navigate(r.route);
          act().toast('Page created', 'ok');
        },
      },
    });

  return (
    <>
      <div className="section" style={{ flex: 'none', maxHeight: '38%', display: 'flex', flexDirection: 'column' }}>
        <div className="section-head">
          <span>Pages</span>
          <button className="icon-btn sm tip down" data-tip="New page" onClick={newPage}>
            <Plus size={15} />
          </button>
        </div>
        <div className="scroll">
          {pages.map((p: any) => (
            <div key={p.file} className={'row' + (p.file === pageFile ? ' on' : '')} onClick={() => act().openPage(p)} title={p.file}>
              <File size={14} style={{ color: p.dynamic ? 'var(--dyn)' : 'var(--muted)', flex: 'none' }} />
              <span className="label" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{p.route}</span>
              <span className="meta hide-on-hover">{p.dynamic ? 'dynamic' : p.name}</span>
              <span className="acts">
                <button
                  className="icon-btn sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu({ el: e.currentTarget, page: p });
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="section-head" style={{ flex: 'none' }}>
        <span>Layers</span>
        <span className="sub" style={{ fontWeight: 400, fontFamily: 'var(--mono)' }}>{pageFile?.split('/').pop()}</span>
      </div>
      <div className="scroll" style={{ paddingBottom: 16 }} onMouseLeave={() => act().hover(null)}>
        <Layers />
      </div>
      {menu && (
        <Menu
          anchor={menu.el}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open', icon: <File size={14} />, onClick: () => act().openPage(menu.page) },
            { label: 'Edit code', icon: <Code2 size={14} />, onClick: () => useStore.setState({ codeFile: menu.page.file }) },
            {
              label: 'Duplicate',
              icon: <Copy size={14} />,
              onClick: async () => {
                await api.post('/file/duplicate', { file: menu.page.file }).catch(act().fail);
                act().load();
              },
            },
            {
              label: 'Rename…',
              icon: <Pencil size={14} />,
              hidden: menu.page.route === '/',
              onClick: () =>
                useStore.setState({
                  dialog: {
                    type: 'prompt',
                    title: 'Rename page',
                    label: 'New address',
                    prefix: '/',
                    value: menu.page.route.slice(1),
                    confirm: 'Rename',
                    hint: 'Links pointing at the old address are not updated automatically.',
                    onSubmit: async (v: string) => {
                      const clean = v.trim().replace(/^\/+|\/+$/g, '').toLowerCase().replace(/[^a-z0-9\-_/\[\].]+/g, '-');
                      if (!clean) return;
                      const ext = menu.page.file.match(/\.\w+$/)[0];
                      await api.post('/file/rename', { from: menu.page.file, to: `src/pages/${clean}${ext}` });
                      await act().load();
                      act().navigate('/' + clean);
                    },
                  },
                }),
            },
            null,
            {
              label: 'Delete page',
              icon: <Trash2 size={14} />,
              danger: true,
              hidden: menu.page.route === '/',
              onClick: () =>
                useStore.setState({
                  dialog: {
                    type: 'confirm',
                    title: `Delete ${menu.page.route}?`,
                    text: `This removes ${menu.page.file}. You can bring it back with Undo.`,
                    confirm: 'Delete page',
                    danger: true,
                    onSubmit: async () => {
                      await api.del('/file' + q({ path: menu.page.file }));
                      await act().load();
                      if (useStore.getState().pageFile === menu.page.file) act().navigate('/');
                    },
                  },
                }),
            },
          ]}
        />
      )}
    </>
  );
}

function Layers() {
  const pageFile = useStore((s) => s.pageFile);
  const outlines = useStore((s) => s.outlines);
  const ready = useStore((s) => s.data);
  if (!ready) return null;
  if (!pageFile) return <div className="hint">This address isn’t one of your pages.</div>;
  const nodes = outlines[pageFile];
  if (!nodes) return <div className="hint">Loading…</div>;
  if (!nodes.length) return <div className="hint">No elements on this page yet.<br />Add a block from the Assets tab.</div>;
  return <Nodes file={pageFile} nodes={nodes} prefix="" depth={0} />;
}

function Nodes({ file, nodes, prefix, depth }: { file: string; nodes: OutlineNode[]; prefix: string; depth: number }) {
  if (depth > 14) return null;
  return (
    <>
      {nodes.map((n) => (
        <NodeRow key={n.start} file={file} node={n} prefix={prefix} depth={depth} />
      ))}
    </>
  );
}

function NodeRow({ file, node, prefix, depth }: { file: string; node: OutlineNode; prefix: string; depth: number }) {
  const id = `${prefix}/${file}:${node.start}`;
  const expandedState = useStore((s) => s.expanded[id]);
  const innerOpen = useStore((s) => s.expanded[id + '#in']);
  const inner = useStore((s) => (node.componentFile ? s.outlines[node.componentFile] : null));
  const selected = useStore((s) => !!s.selection && s.selection.file === file && (s.selection.start != null ? s.selection.start === node.start : s.selection.loc === node.loc));
  const slotted = node.children.length > 0;
  const expandable = slotted || !!(inner && inner.length);
  const isStructural = ['html', 'head', 'body', 'main'].includes(node.name);
  const open = expandedState ?? (depth < 1 || isStructural || (node.type === 'component' && slotted && depth < 2));
  const Icon = node.type === 'component' ? Component : node.type === 'slot' ? ScanLine : node.type === 'fragment' ? Box : TAG_ICONS[node.name] || Square;
  const cls = node.type === 'component' ? ' comp' : node.type === 'slot' ? ' slot' : '';
  const hint = node.text || (node.id ? '#' + node.id : node.cls ? '.' + node.cls.split(/\s+/)[0] : '');

  const hoverKey = () => {
    const a = act();
    if (node.type === 'component') return node.componentFile ? { component: true, file: a.abs(node.componentFile), index: 0 } : null;
    return { file: a.abs(file), loc: node.loc, index: 0 };
  };

  return (
    <>
      <div
        className={'row' + cls + (selected ? ' on' : '')}
        style={{ paddingLeft: 8 + depth * 13 }}
        onClick={() => act().selectNode(file, node)}
        onDoubleClick={() => expandable && act().toggleExpand(id, !open)}
        onMouseEnter={() => act().hover(hoverKey())}
      >
        <span
          className={'twist' + (open ? ' open' : '')}
          onClick={(e) => {
            e.stopPropagation();
            if (expandable) act().toggleExpand(id, !open);
          }}
        >
          {expandable && <ChevronRight size={12} />}
        </span>
        <Icon size={13} style={{ flex: 'none', opacity: node.type === 'element' ? 0.6 : 1 }} />
        <span className={node.type === 'element' ? 'tagname' : ''} style={{ flex: 'none', fontWeight: node.type === 'component' ? 550 : 400 }}>
          {node.type === 'slot' ? 'slot' : node.name}
        </span>
        <span className="preview-text label">{node.type === 'slot' ? 'page content goes here' : hint}</span>
        {node.inExpr && <span className="meta" title="Rendered from data (a loop or condition)">{'{ }'}</span>}
      </div>
      {open && slotted && <Nodes file={file} nodes={node.children} prefix={id} depth={depth + 1} />}
      {open && inner && inner.length > 0 && node.componentFile !== file && (
        slotted ? (
          <>
            <div className="row dim" style={{ paddingLeft: 8 + (depth + 1) * 13 }} onClick={() => act().toggleExpand(id + '#in')}>
              <span className={'twist' + (innerOpen ? ' open' : '')}>
                <ChevronRight size={12} />
              </span>
              <span className="label">inside {node.componentFile!.split('/').pop()}</span>
            </div>
            {innerOpen && <Nodes file={node.componentFile!} nodes={inner} prefix={id + '#in'} depth={depth + 2} />}
          </>
        ) : (
          <Nodes file={node.componentFile!} nodes={inner} prefix={id} depth={depth + 1} />
        )
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Assets tab: theme, components, layouts, media
// ---------------------------------------------------------------------------

const prettyFolder = (f: string) => {
  const n = f.split('/').pop()!.replace(/[-_]/g, ' ');
  return n.length <= 3 ? n.toUpperCase() : n.replace(/^\w/, (c) => c.toUpperCase());
};
const FOLDER_ORDER = ['navigation', 'header', 'hero', 'logos', 'features', 'feature', 'metrics', 'testimonials', 'team', 'pricing', 'faq', 'cta', 'media', 'embed', 'forms', 'footer', 'blog'];
const folderRank = (f: string) => {
  const i = FOLDER_ORDER.indexOf(f.toLowerCase());
  return i < 0 ? 100 : i;
};

function AssetsTab() {
  const data = useStore((s) => s.data);
  const pageFile = useStore((s) => s.pageFile);
  const selection = useStore((s) => s.selection);
  const [openFolders, setOpen] = useState<Record<string, boolean>>(() => JSON.parse(localStorage.getItem('astrophile:folders') || '{}'));
  const [menu, setMenu] = useState<{ el: HTMLElement; c: any } | null>(null);
  const [add, setAdd] = useState<{ el: HTMLElement; c: any } | null>(null);
  const folders = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const c of data?.components || []) {
      if (!map.has(c.folder)) map.set(c.folder, []);
      map.get(c.folder)!.push(c);
    }
    return [...map.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : folderRank(a[0]) - folderRank(b[0]) || a[0].localeCompare(b[0])));
  }, [data]);
  if (!data) return null;

  const toggle = (f: string) => {
    const next = { ...openFolders, [f]: !(openFolders[f] ?? false) };
    setOpen(next);
    localStorage.setItem('astrophile:folders', JSON.stringify(next));
  };
  const create = (kind: 'component' | 'layout') =>
    useStore.setState({
      dialog: {
        type: 'prompt',
        title: kind === 'layout' ? 'New layout' : 'New component',
        label: 'Name',
        placeholder: kind === 'layout' ? 'BlogLayout' : 'Banner',
        hint: kind === 'layout' ? 'A layout is the shared shell around a page: the <head>, header and footer. Pages are placed where its <slot /> is.' : 'A component is a reusable piece of a page. It is created in src/components and you can then design it visually.',
        confirm: 'Create',
        onSubmit: async (name: string) => {
          const r = await api.post('/components', { name, kind });
          await act().load();
          const c = [...useStore.getState().data.components, ...useStore.getState().data.layouts].find((x: any) => x.file === r.file);
          if (c) act().openComponent(c);
        },
      },
    });

  const newForm = async () => {
    const choices = await api.get('/forms/presets').catch(() => []);
    useStore.setState({
      dialog: {
        type: 'prompt',
        title: 'New form',
        label: 'Form name',
        placeholder: 'Quote request',
        choices,
        choiceLabel: 'Start from',
        hint: 'The form is saved under Forms as its own widget. You then build it on the right: add, remove and reorder fields, and paste in your Formspree form ID so submissions reach you.',
        confirm: 'Create form',
        onSubmit: async (name: string, preset: string) => {
          const r = await api.post('/forms', { name, preset });
          await act().load();
          const next = { ...openFolders, forms: true };
          setOpen(next);
          localStorage.setItem('astrophile:folders', JSON.stringify(next));
          const c = useStore.getState().data.components.find((x: any) => x.file === r.file);
          if (c) act().openComponent(c);
          act().deselect();
        },
      },
    });
  };

  const row = (c: any, depth = 1) => (
    <div
      key={c.file}
      className={'row src-' + c.source + (pageFile === c.file ? ' on' : '') + (!c.usedOn.length && c.kind !== 'layout' ? ' unused' : '')}
      style={{ paddingLeft: 10 + depth * 14 }}
      draggable={c.kind !== 'layout'}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ component: c.file, hasSlot: c.hasSlot && c.kind !== 'layout' }));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => act().openComponent(c)}
      title={`${c.file}\n${SOURCES[c.source]?.label}: ${SOURCES[c.source]?.tip}\n${c.usedOn.length ? 'Used on ' + c.usedOn.map((u: any) => u.route).join(', ') : 'Not used on any page yet'}\nClick to open · drag onto the page to add`}
    >
      {c.kind === 'layout' ? <LayoutTemplate size={14} style={{ flex: 'none' }} /> : <Component size={14} style={{ flex: 'none' }} />}
      <span className="label">{c.name}</span>
      {c.source !== 'block' && c.source !== 'layout' && <span className="meta hide-on-hover">{SOURCES[c.source]?.label.toLowerCase()}</span>}
      {c.source === 'block' && c.usedOn.length > 0 && <span className="meta hide-on-hover" title={'Used on ' + c.usedOn.map((u: any) => u.route).join(', ')}>{c.usedOn.length}</span>}
      <span className="acts">
        {c.kind !== 'layout' && (
          <button
            className="icon-btn sm"
            title="Add to the current page"
            onClick={(e) => {
              e.stopPropagation();
              // Already on other pages? Ask whether to share it or make a copy.
              const elsewhere = c.usedOn.some((u: any) => u.file !== pageFile);
              if (elsewhere) setAdd({ el: e.currentTarget, c });
              else act().insertBlock({ component: c.file, hasSlot: false });
            }}
          >
            <Plus size={14} />
          </button>
        )}
        <button
          className="icon-btn sm"
          onClick={(e) => {
            e.stopPropagation();
            setMenu({ el: e.currentTarget, c });
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </span>
    </div>
  );

  return (
    <>
      <div className="scroll">
        <div className="section">
          <div className="section-head">
            <span>Styles</span>
          </div>
          <div className={'row' + (!selection ? ' on' : '')} onClick={() => act().deselect()}>
            <Palette size={14} style={{ flex: 'none' }} />
            <span className="label">Theme</span>
            <span className="meta">colours · fonts</span>
          </div>
        </div>
        <div className="section">
          <div className="section-head">
            <span>Components</span>
            <span className="acts">
              <button className="icon-btn sm tip down" data-tip="Inventory — what is used where" onClick={() => useStore.setState({ inventoryOpen: true })}>
                <ListTree size={15} />
              </button>
              <button className="icon-btn sm tip down" data-tip="New form — open the form builder" onClick={newForm}>
                <FormInput size={15} />
              </button>
              <button className="icon-btn sm tip down" data-tip="New component" onClick={() => create('component')}>
                <Plus size={15} />
              </button>
            </span>
          </div>
          {folders.map(([folder, list]) => {
            if (!folder) return list.map((c) => row(c, 0));
            const open = openFolders[folder] ?? false;
            return (
              <div key={folder}>
                <div className="row" onClick={() => toggle(folder)}>
                  <span className={'twist' + (open ? ' open' : '')}>
                    <ChevronRight size={12} />
                  </span>
                  <Folder size={14} style={{ color: 'var(--muted)', flex: 'none' }} />
                  <span className="label" style={{ fontWeight: 500, color: 'var(--fg)' }}>{prettyFolder(folder)}</span>
                  <span className="meta">{list.length}</span>
                </div>
                {open && list.map((c) => row(c))}
              </div>
            );
          })}
          <div className="hint" style={{ padding: '10px 16px 2px', textAlign: 'left', fontSize: 11.5 }}>
            Drag a block onto the page, or press <b>+</b> to add it after your selection.
          </div>
        </div>
        <div className="section">
          <div className="section-head">
            <span>Layouts</span>
            <button className="icon-btn sm tip down" data-tip="New layout" onClick={() => create('layout')}>
              <Plus size={15} />
            </button>
          </div>
          {data.layouts.map((c: any) => row(c, 0))}
        </div>
        <Media />
      </div>
      {add && <AddChoice anchor={add.el} c={add.c} onClose={() => setAdd(null)} />}
      {menu && (
        <Menu
          anchor={menu.el}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open in canvas', icon: <Component size={14} />, onClick: () => act().openComponent(menu.c) },
            { label: 'Add to current page', icon: <Plus size={14} />, hidden: menu.c.kind === 'layout', onClick: () => act().insertBlock({ component: menu.c.file }) },
            { label: 'Edit code', icon: <Code2 size={14} />, onClick: () => useStore.setState({ codeFile: menu.c.file }) },
            {
              label: 'Duplicate',
              icon: <Copy size={14} />,
              onClick: async () => {
                await api.post('/file/duplicate', { file: menu.c.file }).catch(act().fail);
                act().load();
              },
            },
            null,
            {
              label: 'Delete',
              icon: <Trash2 size={14} />,
              danger: true,
              onClick: () =>
                useStore.setState({
                  dialog: {
                    type: 'confirm',
                    title: `Delete ${menu.c.name}?`,
                    text: `This removes ${menu.c.file}. Pages that still use it will show an error until you remove it from them. Undo brings it back.`,
                    usedOn: menu.c.usedOn,
                    confirm: 'Delete',
                    danger: true,
                    onSubmit: async () => {
                      await api.del('/file' + q({ path: menu.c.file }));
                      await act().load();
                      if (useStore.getState().pageFile === menu.c.file) act().navigate('/');
                    },
                  },
                }),
            },
          ]}
        />
      )}
    </>
  );
}

export function Media({ onPick }: { onPick?: (m: any) => void }) {
  const media = useStore((s) => s.data?.media || EMPTY);
  const selection = useStore((s) => s.selection);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const upload = async (files: FileList | File[] | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        await api.upload(f);
      } catch (e) {
        act().fail(e);
      }
    }
    act().load();
  };
  const pick = (m: any) => {
    if (onPick) return onPick(m);
    const isImg = selection?.kind === 'element' && selection.info?.name === 'img';
    const isSmart = selection?.kind === 'component' && selection.info?.componentFile === SMART_IMAGE;
    if (isImg || isSmart) {
      act().setImage(m.url);
      act().toast(m.optimised ? 'Image replaced — Astro will optimise it' : 'Image replaced', 'ok');
    } else {
      navigator.clipboard?.writeText(m.url).catch(() => {});
      act().toast(`Copied ${m.url} — select an image on the page first to replace it`);
    }
  };
  return (
    <div
      className="section"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        upload(e.dataTransfer.files);
      }}
    >
      <div className="section-head">
        <span>Media</span>
        <button className="icon-btn sm tip down" data-tip="Upload files" onClick={() => input.current?.click()}>
          <Upload size={14} />
        </button>
      </div>
      <input ref={input} type="file" multiple hidden accept="image/*,video/mp4,video/webm,application/pdf" onChange={(e) => upload(e.target.files)} />
      <div className={'dropzone' + (over ? ' over' : '')}>{over ? 'Drop to upload' : 'Drop images here, or click an image to use it. Photos are optimised automatically.'}</div>
      <div className="media-grid">
        {media.filter((m: any) => m.image).map((m: any) => (
          <div
            key={m.file}
            className={'media-item' + (/logo|favicon/.test(m.name) || m.name.endsWith('.ico') ? ' contain' : '')}
            title={`${m.name} · ${(m.size / 1024).toFixed(0)} KB\n${m.optimised ? 'Photo — Astro resizes it for each screen when the site is built' : m.name.endsWith('.svg') ? 'SVG — scales without resizing' : 'Served as it is'}`}
            onClick={() => pick(m)}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ image: m.url }));
              e.dataTransfer.effectAllowed = 'copy';
            }}
          >
            <img src={(useStore.getState().dev.url || '') + m.url} alt={m.name} loading="lazy" draggable={false} />
            {m.optimised && <span className="opt" title="Optimised by Astro">✓</span>}
            {!onPick && (
              <button
                className="x"
                title="Delete file"
                onClick={(e) => {
                  e.stopPropagation();
                  useStore.setState({
                    dialog: {
                      type: 'confirm',
                      title: `Delete ${m.name}?`,
                      text: 'The file is removed from public/ for good — this one can’t be undone.',
                      confirm: 'Delete file',
                      danger: true,
                      onSubmit: async () => {
                        await api.del('/media' + q({ file: m.file }));
                        act().load();
                      },
                    },
                  });
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content tab
// ---------------------------------------------------------------------------

function ContentTab() {
  const collections = useStore((s) => s.data?.collections || EMPTY);
  const entryFile = useStore((s) => s.entryFile);
  const newCollection = () =>
    useStore.setState({
      dialog: {
        type: 'prompt',
        title: 'New content collection',
        label: 'Collection name',
        placeholder: 'docs',
        hint: 'A collection is a folder of Markdown files that share the same fields — blog posts, docs, team members. It is declared in src/content.config.ts.',
        confirm: 'Create collection',
        onSubmit: async (name: string) => {
          await api.post('/content/collection', { name });
          await act().load();
          act().toast('Collection created', 'ok');
        },
      },
    });
  const newEntry = (c: any) =>
    useStore.setState({
      dialog: {
        type: 'prompt',
        title: `New entry in “${c.name}”`,
        label: 'Title',
        placeholder: 'My first post',
        confirm: 'Create',
        onSubmit: async (title: string) => {
          const r = await api.post('/content/entry', { collection: c.name, title });
          await act().load();
          useStore.setState({ entryFile: r.file });
        },
      },
    });
  return (
    <div className="scroll">
      <div className="section-head">
        <span>Content Collections</span>
        <button className="icon-btn sm tip down" data-tip="New collection" onClick={newCollection}>
          <FolderPlus size={15} />
        </button>
      </div>
      {!collections.length && <div className="hint">No collections yet.<br />Create one to manage blog posts or docs as Markdown.</div>}
      {collections.map((c: any) => (
        <div key={c.name} style={{ marginBottom: 10 }}>
          <div className="row" style={{ color: 'var(--fg)', fontWeight: 600 }}>
            <Database size={14} style={{ color: 'var(--dyn)', flex: 'none' }} />
            <span className="label">{c.name}</span>
            <span className="meta hide-on-hover">{c.entries.length}</span>
            <span className="acts">
              <button className="icon-btn sm" title="New entry" onClick={() => newEntry(c)}>
                <Plus size={14} />
              </button>
            </span>
          </div>
          {c.entries.map((e: any) => (
            <div key={e.file} className={'row' + (entryFile === e.file ? ' on' : '')} style={{ paddingLeft: 24 }} onClick={() => useStore.setState({ entryFile: e.file })} title={e.file}>
              <FileText size={13} style={{ color: 'var(--muted)', flex: 'none' }} />
              <span className="label">{e.title}</span>
              {e.draft && <span className="badge">Draft</span>}
            </div>
          ))}
          {!c.entries.length && <div className="hint" style={{ padding: '4px 14px' }}>Empty — press + to add an entry.</div>}
        </div>
      ))}
    </div>
  );
}
