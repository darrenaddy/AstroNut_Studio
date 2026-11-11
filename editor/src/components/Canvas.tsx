import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, ExternalLink, Hand, Heading, Image as ImageIcon, LayoutGrid, Link2, List, Minus, Monitor, Moon, MousePointer2, MousePointerClick, Plus, Redo2, RefreshCw, Rocket, Settings, Smartphone, Sparkles, Square, Sun, Tablet, TerminalSquare, Type, Undo2, Columns2, Columns3, RectangleHorizontal, PanelTop, X } from 'lucide-react';
import { useStore, act, setIframe, BREAKPOINTS } from '../store';
import { Dropdown, Seg } from './ui';

const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

export function TopBar() {
  const path = useStore((s) => s.path);
  const bp = useStore((s) => s.bp);
  const theme = useStore((s) => s.theme);
  const zoom = useStore((s) => s.zoom);
  const dev = useStore((s) => s.dev);
  const pageFile = useStore((s) => s.pageFile);
  const isComponent = path.startsWith('/__astrophile/');
  return (
    <div className="topbar">
      <div className="url" title={pageFile || path}>
        <span className={'status-dot ' + dev.status} title={'Astro dev server: ' + dev.status} />
        <span>{isComponent ? pageFile?.replace('src/', '') : path}</span>
        <button className="icon-btn sm" title="Reload preview" onClick={() => act().reloadCanvas()}>
          <RefreshCw size={12} />
        </button>
      </div>
      {isComponent && <span className="badge" style={{ color: 'var(--comp)', borderColor: 'var(--comp)' }}>Component preview</span>}
      <div className="grow" />
      <Dropdown
        tip="Screen size to preview"
        value={bp}
        onChange={(v) => act().setCanvas({ bp: v })}
        options={[{ value: 'fit', label: 'Fit', hint: 'fill' }, ...BREAKPOINTS.map((b) => ({ value: b.id, label: b.label, hint: b.width + 'px' }))]}
        label={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {bp === 'mobile' ? <Smartphone size={14} /> : bp === 'sm' || bp === 'md' ? <Tablet size={14} /> : <Monitor size={14} />}
            {bp === 'fit' ? 'Fit' : BREAKPOINTS.find((b) => b.id === bp)?.label}
          </span>
        }
        small={<small>{bp === 'fit' ? '' : BREAKPOINTS.find((b) => b.id === bp)?.width}</small>}
      />
      <Seg
        full={false}
        value={theme}
        onChange={(v) => v && act().setCanvas({ theme: v })}
        options={[
          { value: 'light', icon: <Sun size={14} />, tip: 'Preview light mode' },
          { value: 'dark', icon: <Moon size={14} />, tip: 'Preview dark mode' },
        ]}
      />
      <Dropdown
        tip="Zoom"
        value={zoom}
        onChange={(v) => act().setCanvas({ zoom: v })}
        options={[
          { value: 'fit', label: 'Fit' },
          { value: 0.5, label: '50%' },
          { value: 0.75, label: '75%' },
          { value: 1, label: '100%' },
          { value: 1.25, label: '125%' },
        ]}
      />
      <div className="grow" />
      <button className="btn sm ghost" onClick={() => window.open((dev.url || '') + path, '_blank')} disabled={!dev.url}>
        <ExternalLink size={13} /> Open site
      </button>
      <button
        className="btn sm dark"
        disabled={dev.building}
        onClick={() => {
          useStore.setState({ terminalOpen: true });
          import('../api').then(({ api }) => api.post('/build').then((r) => act().toast(r.ok ? `Site built in ${r.seconds.toFixed(1)}s → dist/` : r.message || 'Build failed — see the log', r.ok ? 'ok' : 'error')));
        }}
      >
        <Rocket size={13} /> {dev.building ? 'Building…' : 'Build'}
      </button>
    </div>
  );
}

export function Canvas() {
  const dev = useStore((s) => s.dev);
  const reloadKey = useStore((s) => s.reloadKey);
  const bp = useStore((s) => s.bp);
  const zoomSetting = useStore((s) => s.zoom);
  const ready = useStore((s) => s.ready);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });

  useEffect(() => {
    const el = stage.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth - 48, h: el.clientHeight - 24 - 92 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data && e.data.__astrophile) act().onBridge(e.data);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const src = useMemo(() => (dev.url ? dev.url + useStore.getState().path : null), [reloadKey, dev.url]);

  const width = bp === 'fit' ? Math.max(320, size.w) : BREAKPOINTS.find((b) => b.id === bp)!.width;
  const fit = Math.min(1, size.w / width);
  const zoom = zoomSetting === 'fit' ? fit : (zoomSetting as number);
  const height = Math.max(200, size.h / zoom);

  return (
    <div className="stage" ref={stage} onMouseDown={(e) => e.target === e.currentTarget && act().deselect()}>
      <div className="stage-inner" style={{ overflow: zoom * width > size.w + 1 ? 'auto' : 'hidden', justifyContent: zoom * width > size.w + 1 ? 'flex-start' : 'center' }} onMouseDown={(e) => e.target === e.currentTarget && act().deselect()}>
        <div style={{ width: width * zoom, height: size.h, position: 'relative', flex: 'none' }}>
          <div className="frame" style={{ width, height, transform: `scale(${zoom})`, transformOrigin: 'top left', position: 'absolute', left: 0, top: 0 }}>
            {src && <iframe key={reloadKey + src} ref={setIframe} src={src} title="Site preview" onLoad={() => act().frameLoaded()} />}
            {(!src || dev.status !== 'running') && (
              <div className="veil">
                <div className="box">
                  {dev.status === 'error' ? (
                    <>
                      <b>The Astro dev server stopped.</b>
                      <span>Open the log to see why, then restart it.</span>
                      <button className="btn primary" onClick={() => useStore.setState({ terminalOpen: true })}>Show log</button>
                    </>
                  ) : (
                    <>
                      <div className="spinner" />
                      <b>Starting Astro…</b>
                      <span className="sub">Your site’s dev server is warming up.</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <span className="frame-label">
        {Math.round(width)} × {Math.round(height)} · {Math.round(zoom * 100)}%{!ready && src ? ' · loading…' : ''}
      </span>
      <Dock />
    </div>
  );
}

const ELEMENTS: { label: string; icon: any; html: string }[] = [
  { label: 'Section', icon: PanelTop, html: `<section class="px-6 py-20">\n  <div class="mx-auto max-w-5xl">\n    <h2 class="font-display text-4xl font-semibold tracking-tight">A new section</h2>\n    <p class="mt-4 text-lg text-muted">Describe what this part of the page is about.</p>\n  </div>\n</section>` },
  { label: 'Container', icon: Square, html: `<div class="rounded-card border border-line p-8">\n  <p>An empty container. Add things inside it.</p>\n</div>` },
  { label: 'Heading', icon: Heading, html: `<h2 class="font-display text-3xl font-semibold tracking-tight">A clear, friendly heading</h2>` },
  { label: 'Text', icon: Type, html: `<p class="mt-4 text-lg text-muted">Double-click this paragraph to write your own text.</p>` },
  { label: 'Button', icon: MousePointerClick, html: `<a href="#" class="mt-6 inline-flex items-center rounded-button bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-700">Get started</a>` },
  { label: 'Link', icon: Link2, html: `<a href="#" class="font-semibold text-brand-600 underline-offset-4 hover:underline">Learn more →</a>` },
  { label: 'Image', icon: ImageIcon, html: `<img src="/media/abstract-1.svg" alt="Describe this image" class="mt-8 aspect-video w-full rounded-card object-cover" />` },
  { label: 'List', icon: List, html: `<ul class="mt-4 list-disc space-y-2 pl-6 text-muted">\n  <li>First point</li>\n  <li>Second point</li>\n  <li>Third point</li>\n</ul>` },
  { label: '2 columns', icon: Columns2, html: `<div class="mt-8 grid gap-8 md:grid-cols-2">\n  <div class="rounded-card bg-surface p-8">\n    <h3 class="font-display text-xl font-semibold">Left column</h3>\n    <p class="mt-2 text-muted">Something worth saying.</p>\n  </div>\n  <div class="rounded-card bg-surface p-8">\n    <h3 class="font-display text-xl font-semibold">Right column</h3>\n    <p class="mt-2 text-muted">Something else worth saying.</p>\n  </div>\n</div>` },
  { label: '3 columns', icon: Columns3, html: `<div class="mt-8 grid gap-6 md:grid-cols-3">\n  <div class="rounded-card border border-line p-6">\n    <h3 class="font-display text-lg font-semibold">One</h3>\n    <p class="mt-2 text-muted">A short description.</p>\n  </div>\n  <div class="rounded-card border border-line p-6">\n    <h3 class="font-display text-lg font-semibold">Two</h3>\n    <p class="mt-2 text-muted">A short description.</p>\n  </div>\n  <div class="rounded-card border border-line p-6">\n    <h3 class="font-display text-lg font-semibold">Three</h3>\n    <p class="mt-2 text-muted">A short description.</p>\n  </div>\n</div>` },
  { label: 'Card', icon: RectangleHorizontal, html: `<div class="max-w-sm overflow-hidden rounded-card border border-line bg-bg shadow-sm">\n  <img src="/media/abstract-2.svg" alt="" class="aspect-video w-full object-cover" />\n  <div class="p-6">\n    <h3 class="font-display text-xl font-semibold">Card title</h3>\n    <p class="mt-2 text-muted">A sentence or two that explains the card.</p>\n  </div>\n</div>` },
  { label: 'Divider', icon: Minus, html: `<hr class="my-12 border-line" />` },
];

function Dock() {
  const mode = useStore((s) => s.mode);
  const history = useStore((s) => s.history);
  const chatOpen = useStore((s) => s.chatOpen);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const addOpen = useStore((s) => s.addOpen);
  const pageFile = useStore((s) => s.pageFile);
  return (
    <>
      {addOpen && <AddPanel />}
      <div className="dock">
        <button className={'tool tip' + (mode === 'edit' ? ' on' : '')} data-tip="Select & edit  (V)" onClick={() => act().setCanvas({ mode: 'edit' })}>
          <MousePointer2 size={17} />
        </button>
        <button className={'tool tip' + (mode === 'browse' ? ' on' : '')} data-tip="Browse — use the site normally  (B)" onClick={() => act().setCanvas({ mode: 'browse' })}>
          <Hand size={17} />
        </button>
        <span className="sep" />
        <button className={'tool tip' + (addOpen ? ' on' : '')} data-tip="Add an element  (A)" onClick={() => useStore.setState({ addOpen: !addOpen })}>
          <Plus size={18} />
        </button>
        <button className="tool tip" data-tip="Add text" onClick={() => act().insertHtml(ELEMENTS[3].html)}>
          <Type size={17} />
        </button>
        <button className="tool tip" data-tip="Add an image" onClick={() => act().insertHtml(ELEMENTS[6].html)}>
          <ImageIcon size={17} />
        </button>
        <button className="tool tip" data-tip="Browse blocks" onClick={() => act().setTab('assets')}>
          <LayoutGrid size={17} />
        </button>
        <span className="sep" />
        <button className="tool tip" data-tip={history.undoLabel ? `Undo: ${history.undoLabel}  (${mod}Z)` : 'Nothing to undo'} disabled={!history.canUndo} onClick={() => act().undo()}>
          <Undo2 size={17} />
        </button>
        <button className="tool tip" data-tip={history.redoLabel ? `Redo: ${history.redoLabel}` : 'Nothing to redo'} disabled={!history.canRedo} onClick={() => act().redo()}>
          <Redo2 size={17} />
        </button>
        <span className="sep" />
        <button className={'tool wide ai tip'} data-tip={`Describe a change and let AI make it  (${mod}K)`} onClick={() => useStore.setState({ chatOpen: !chatOpen })}>
          <Sparkles size={16} /> Ask AI
        </button>
        <button className={'tool tip' + (terminalOpen ? ' on' : '')} data-tip="Dev server log" onClick={() => useStore.setState({ terminalOpen: !terminalOpen })}>
          <TerminalSquare size={17} />
        </button>
        <button className="tool tip" data-tip={`Edit this file’s code  (${mod}E)`} disabled={!pageFile} onClick={() => useStore.setState({ codeFile: useStore.getState().selection?.file || pageFile })}>
          <Code2 size={17} />
        </button>
        <button className="tool tip" data-tip="Settings" onClick={() => useStore.setState({ settingsOpen: true })}>
          <Settings size={17} />
        </button>
      </div>
    </>
  );
}

function AddPanel() {
  const selection = useStore((s) => s.selection);
  const [where, setWhere] = useState<'after' | 'inside'>('after');
  const canInside = !!selection && selection.kind === 'element' && !selection.info?.isVoid;
  const name = selection?.info?.name;
  return (
    <div className="float addpanel">
      <div className="float-head">
        <span className="grow">Add an element</span>
        {selection ? (
          <Seg
            full={false}
            value={canInside ? where : 'after'}
            onChange={(v) => v && setWhere(v as any)}
            options={[
              { value: 'after', label: `After <${name || '…'}>` },
              ...(canInside ? [{ value: 'inside', label: `Inside it` }] : []),
            ]}
          />
        ) : (
          <span className="sub" style={{ fontWeight: 400 }}>goes at the end of the page</span>
        )}
        <button className="icon-btn" onClick={() => useStore.setState({ addOpen: false })}>
          <X size={15} />
        </button>
      </div>
      <div className="addgrid">
        {ELEMENTS.map((el) => (
          <button key={el.label} onClick={() => act().insertHtml(el.html, canInside ? where : 'after')}>
            <el.icon size={20} strokeWidth={1.6} />
            {el.label}
          </button>
        ))}
      </div>
    </div>
  );
}
