import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Code2, Copy, CornerLeftUp, Pencil, Settings as SettingsIcon, Sparkles, Trash2 } from 'lucide-react';
import { useStore, act } from './store';
import { LeftPanel } from './components/LeftPanel';
import { Canvas, TopBar } from './components/Canvas';
import { Inspector, useDark } from './components/Inspector';
import { Chat, CodeEditor, Dialog, Settings, Terminal, Welcome } from './components/Panels';
import { ContentEditor } from './components/ContentEditor';
import { Menu } from './components/ui';
import { Inventory, WidgetEditor } from './components/Widgets';

export default function App() {
  const tab = useStore((s) => s.tab);
  const data = useStore((s) => s.data);
  const loadError = useStore((s) => s.loadError);
  const chatOpen = useStore((s) => s.chatOpen);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const codeFile = useStore((s) => s.codeFile);
  const inventoryOpen = useStore((s) => s.inventoryOpen);
  const widgetOpen = useStore((s) => s.widgetOpen);
  const dialog = useStore((s) => s.dialog);
  const welcomeOpen = useStore((s) => s.welcomeOpen);
  const toasts = useStore((s) => s.toasts);
  const menu = useStore((s) => s.menu);
  const sel = useStore((s) => s.selection);
  const dark = useDark();
  const contentMode = tab === 'content';

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  useEffect(() => {
    act().load().then(() => {
      const s = useStore.getState();
      if (s.data) act().navigate(s.path);
    });
    return act().connect();
  }, []);

  // Keyboard shortcuts (also forwarded from inside the canvas).
  useEffect(() => {
    const handle = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean; preventDefault?: () => void; target?: any }) => {
      const t = e.target as HTMLElement | undefined;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const s = useStore.getState();
      const m = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const stop = () => e.preventDefault?.();
      if (m && k === 'k') return stop(), useStore.setState({ chatOpen: !s.chatOpen });
      if (s.dialog || s.codeFile || s.settingsOpen || s.welcomeOpen) return;
      if (m && k === 'z') return stop(), e.shiftKey ? act().redo() : act().undo();
      if (m && k === 'y') return stop(), act().redo();
      if (s.tab === 'content') return;
      if (m && k === 'e') return stop(), useStore.setState({ codeFile: s.selection?.file || s.pageFile });
      if (!m && k === 'v') return act().setCanvas({ mode: 'edit' });
      if (!m && k === 'b') return act().setCanvas({ mode: 'browse' });
      if (!m && k === 'a') return useStore.setState({ addOpen: !s.addOpen });
      if (e.key === 'Escape') {
        if (s.menu) return useStore.setState({ menu: null });
        if (s.addOpen) return useStore.setState({ addOpen: false });
        if (s.selection) return act().selectParent();
        return;
      }
      if (!s.selection) return;
      if (e.key === 'Backspace' || e.key === 'Delete') return stop(), act().remove();
      if (m && k === 'd') return stop(), act().duplicate();
      if (e.altKey && e.key === 'ArrowUp') return stop(), act().move('up');
      if (e.altKey && e.key === 'ArrowDown') return stop(), act().move('down');
      if (e.key === 'Enter') return stop(), act().editText();
    };
    const onKey = (e: KeyboardEvent) => handle(e);
    const onForwarded = (e: any) => handle(e.detail);
    window.addEventListener('keydown', onKey);
    window.addEventListener('astrolabe-key', onForwarded);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('astrolabe-key', onForwarded);
    };
  }, []);

  if (loadError && !data) {
    return (
      <div className="center-empty" style={{ height: '100%' }}>
        <div>
          <b>Couldn’t reach the editor server.</b>
          <p>{loadError}</p>
          <button className="btn primary" onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className={'app' + (contentMode ? ' content-mode' : '')}>
      <LeftPanel />
      <main className="center">
        {contentMode ? (
          <ContentEditor />
        ) : (
          <>
            <TopBar />
            <Canvas />
          </>
        )}
        {chatOpen && <Chat />}
        {terminalOpen && <Terminal />}
        {widgetOpen && !contentMode && <WidgetEditor />}
        {contentMode && <MiniDock />}
      </main>
      {!contentMode && <Inspector />}

      {menu && sel && (
        <Menu
          anchor={menu}
          onClose={() => useStore.setState({ menu: null })}
          items={[
            { heading: sel.info?.name || sel.el?.tag || 'Element' },
            { label: 'Edit text', icon: <Pencil size={14} />, k: '↵', hidden: !sel.info?.textEditable, onClick: () => act().editText() },
            { label: 'Ask AI about this…', icon: <Sparkles size={14} />, k: '⌘K', onClick: () => useStore.setState({ chatOpen: true }) },
            { label: 'Select parent', icon: <CornerLeftUp size={14} />, k: 'Esc', onClick: () => act().selectParent() },
            null,
            { label: 'Move up', icon: <ArrowUp size={14} />, k: '⌥↑', hidden: !sel.info?.canMoveUp, onClick: () => act().move('up') },
            { label: 'Move down', icon: <ArrowDown size={14} />, k: '⌥↓', hidden: !sel.info?.canMoveDown, onClick: () => act().move('down') },
            { label: 'Duplicate', icon: <Copy size={14} />, k: '⌘D', onClick: () => act().duplicate() },
            { label: 'Edit source', icon: <Code2 size={14} />, onClick: () => useStore.setState({ inspectorTab: 'source' }) },
            null,
            { label: 'Delete', icon: <Trash2 size={14} />, k: '⌫', danger: true, onClick: () => act().remove() },
          ]}
        />
      )}

      {inventoryOpen && <Inventory />}
      {codeFile && <CodeEditor />}
      {settingsOpen && <Settings />}
      {dialog && <Dialog key={dialog.title} />}
      {welcomeOpen && data && <Welcome />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + t.kind}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniDock() {
  const chatOpen = useStore((s) => s.chatOpen);
  return (
    <div className="dock">
      <button className="tool wide ai" onClick={() => useStore.setState({ chatOpen: !chatOpen })}>
        <Sparkles size={16} /> Ask AI
      </button>
      <button className="tool" title="Settings" onClick={() => useStore.setState({ settingsOpen: true })}>
        <SettingsIcon size={17} />
      </button>
    </div>
  );
}
