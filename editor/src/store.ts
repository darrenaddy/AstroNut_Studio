// Central app state + every action the UI can take.
import { create } from 'zustand';
import { api, q } from './api';

export interface OutlineNode {
  start: number;
  loc: string;
  type: 'element' | 'component' | 'fragment' | 'slot';
  name: string;
  id: string | null;
  cls: string | null;
  text: string | null;
  inExpr: boolean;
  componentFile: string | null;
  children: OutlineNode[];
}

export interface Selection {
  kind: 'element' | 'component';
  file: string; // project-relative file that owns the node
  loc: string;
  start?: number;
  index: number; // which rendered copy (for repeated elements)
  el: any | null; // live description from the canvas
  info: any | null; // source description from the server
}

export const BREAKPOINTS = [
  { id: 'mobile', label: 'Mobile', width: 390, prefix: '' },
  { id: 'sm', label: 'sm', width: 640, prefix: 'sm:' },
  { id: 'md', label: 'md', width: 768, prefix: 'md:' },
  { id: 'lg', label: 'lg', width: 1024, prefix: 'lg:' },
  { id: 'xl', label: 'xl', width: 1280, prefix: 'xl:' },
  { id: '2xl', label: '2xl', width: 1536, prefix: '2xl:' },
];

type Toast = { id: number; text: string; kind: 'info' | 'error' | 'ok' };
type ChatItem = { role: 'user' | 'assistant'; text: string; thinking?: string; tools?: any[]; error?: string; code?: string; changed?: string[]; pending?: boolean; stopped?: boolean; models?: any[]; providers?: any[]; current?: any };

// The app has been renamed twice (Astrolabe, then Astrophile Studio): carry saved preferences over once.
try {
  for (const legacy of ['astro' + 'phile:', 'astro' + 'labe:']) {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(legacy) && localStorage.getItem('astronut:' + k.slice(legacy.length)) === null) localStorage.setItem('astronut:' + k.slice(legacy.length), localStorage.getItem(k)!);
    }
  }
} catch {}

const saved = (k: string, d: any) => {
  try {
    const v = localStorage.getItem('astronut:' + k);
    return v == null ? d : JSON.parse(v);
  } catch {
    return d;
  }
};
const save = (k: string, v: any) => {
  try {
    localStorage.setItem('astronut:' + k, JSON.stringify(v));
  } catch {}
};

interface State {
  data: any | null;
  dev: { status: string; url: string | null; building: boolean };
  logs: any[];
  history: { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null };
  ai: any;
  loadError: string | null;

  tab: 'file' | 'assets' | 'content';
  path: string; // what the canvas iframe shows
  reloadKey: number;
  pageFile: string | null; // the file behind `path`
  ready: boolean;

  selection: Selection | null;
  outlines: Record<string, OutlineNode[]>;
  expanded: Record<string, boolean>;
  hoverKey: any;

  bp: string;
  theme: 'light' | 'dark';
  zoom: number | 'fit';
  mode: 'edit' | 'browse';
  variant: string; // '' | 'sm:' …  which breakpoint the Design panel writes to
  stateVariant: string; // '' | 'hover:' | 'dark:'
  uiTheme: 'light' | 'dark' | 'system';

  chatOpen: boolean;
  chat: ChatItem[];
  chatBusy: boolean;
  terminalOpen: boolean;
  settingsOpen: boolean;
  addOpen: boolean;
  welcomeOpen: boolean;
  codeFile: string | null;
  entryFile: string | null;
  widgetOpen: boolean;
  checksOpen: boolean;
  checksTab: string;
  inventoryOpen: boolean;
  inspectorTab: 'design' | 'classes' | 'source';
  menu: { x: number; y: number } | null;
  dialog: any | null;
  toasts: Toast[];
  editingText: boolean;

  [k: string]: any;
}

let iframe: HTMLIFrameElement | null = null;
export const setIframe = (el: HTMLIFrameElement | null) => {
  iframe = el;
};
export const getIframe = () => iframe;
const cmd = (type: string, data: any = {}) => iframe?.contentWindow?.postMessage({ __astronut_cmd: true, type, ...data }, '*');

let opChain: Promise<any> = Promise.resolve();
export const SMART_IMAGE = 'src/components/media/SmartImage.astro';
/** Whether a file is one of the project's layouts (the server decides; they need not live in src/layouts). */
export const isLayoutFile = (file?: string | null) => !!file && (useStore.getState().data?.layouts || []).some((l: any) => l.file === file);
let readyCount = 0;
let pendingField: any = null;
let retries = 0;
/** Astro normally hot-reloads the preview after a file changes. If it hasn't within a moment, do it ourselves. */
function ensureFresh(delay = 1300) {
  const n = readyCount;
  setTimeout(() => {
    if (readyCount === n) cmd('reload');
  }, delay);
}
let toastId = 1;
let loadTimer: any = null;

export const useStore = create<State>((set, get) => {
  const root = () => get().data?.project?.root || '';
  const abs = (file: string) => root() + '/' + file;
  const rel = (file: string) => (file && file.startsWith(root() + '/') ? file.slice(root().length + 1) : null);
  const keyOf = (s: Selection | null) => (s && s.kind === 'element' ? { file: abs(s.file), loc: s.loc, index: s.index || 0 } : null);

  function fileForPath(path: string): string | null {
    const data = get().data;
    if (!data) return null;
    const m = /^\/__astronut\/c\/([^/?#]+)/.exec(path);
    if (m) return 'src/' + decodeURIComponent(m[1]).split('~').join('/') + '.astro';
    const clean = path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
    const exact = data.pages.find((p: any) => p.route === clean);
    if (exact) return exact.file;
    for (const p of data.pages) {
      if (!p.dynamic) continue;
      const re = new RegExp('^' + p.route.replace(/\[\.\.\.[^\]]+\]/g, '.*').replace(/\[[^\]]+\]/g, '[^/]+') + '$');
      if (re.test(clean)) return p.file;
    }
    return null;
  }

  async function loadOutline(file: string, depth = 0, force = false): Promise<void> {
    if (!file || depth > 5) return;
    if (!force && get().outlines[file]) return;
    try {
      const o = await api.get('/outline' + q({ file }));
      set((s) => ({ outlines: { ...s.outlines, [file]: o.nodes } }));
      const kids = new Set<string>();
      const walk = (n: OutlineNode) => {
        if (n.componentFile) kids.add(n.componentFile);
        n.children.forEach(walk);
      };
      o.nodes.forEach(walk);
      await Promise.all([...kids].map((k) => loadOutline(k, depth + 1, force)));
    } catch {
      /* file may be gone */
    }
  }

  function componentInstanceIndex(file: string, start: number, componentFile: string): number {
    const nodes = get().outlines[file] || [];
    const flat: OutlineNode[] = [];
    const walk = (n: OutlineNode) => {
      if (n.type === 'component' && n.componentFile === componentFile) flat.push(n);
      n.children.forEach(walk);
    };
    nodes.forEach(walk);
    return Math.max(0, flat.findIndex((n) => n.start === start));
  }

  function syncCanvasSelection(scroll = false) {
    const s = get().selection;
    if (!s) return cmd('deselect');
    if (s.kind === 'element') cmd('select', { key: keyOf(s), scroll });
    else if (s.info?.componentFile) cmd('select-component', { file: abs(s.info.componentFile), index: componentInstanceIndex(s.file, s.start!, s.info.componentFile), label: `${s.info.name} · component`, scroll });
    else cmd('deselect');
  }

  /** Open the layers tree down to the selected node. */
  function reveal() {
    const { selection: sel, pageFile, outlines } = get();
    if (!sel || !pageFile) return;
    const open: Record<string, boolean> = {};
    const seen = new Set<string>();
    const visit = (file: string, nodes: OutlineNode[], prefix: string, trail: string[]): boolean => {
      for (const n of nodes) {
        const id = `${prefix}/${file}:${n.start}`;
        const here = file === sel.file && (sel.start != null ? n.start === sel.start : n.loc === sel.loc);
        if (here) {
          trail.forEach((t) => (open[t] = true));
          return true;
        }
        if (visit(file, n.children, id, [...trail, id])) return true;
        if (n.componentFile && outlines[n.componentFile] && !seen.has(id)) {
          seen.add(id);
          const inner = n.children.length ? id + '#in' : id;
          if (visit(n.componentFile, outlines[n.componentFile], inner, [...trail, id, inner])) return true;
        }
      }
      return false;
    };
    if (visit(pageFile, outlines[pageFile] || [], '', [])) set((s) => ({ expanded: { ...s.expanded, ...open } }));
  }

  async function refreshSelectionInfo() {
    const s = get().selection;
    if (!s) return;
    try {
      const info = await api.post('/node', { file: s.file, ref: s.start != null ? { start: s.start, loc: s.loc, name: s.info?.name } : { loc: s.loc } });
      const cur = get().selection;
      if (cur && cur.file === s.file && cur.loc === s.loc) set({ selection: { ...cur, info, start: info.start, loc: info.loc } });
    } catch {
      if (get().selection === s) set({ selection: null });
    }
  }

  const actions = {
    abs,
    rel,
    cmd,
    ensureFresh,

    /** The iframe finished loading. If our bridge never reports in, the page is an
     *  error/404 (often just a route Astro hasn't registered yet) — retry a few times. */
    frameLoaded() {
      const n = readyCount;
      const key = get().reloadKey;
      setTimeout(() => {
        if (readyCount !== n || get().reloadKey !== key || get().ready) return;
        if (retries < 4) {
          retries++;
          set((s) => ({ reloadKey: s.reloadKey + 1 }));
        }
      }, 700 + retries * 500);
    },

    toast(text: string, kind: Toast['kind'] = 'info') {
      const id = toastId++;
      set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6000 : 2600);
    },
    fail(e: any) {
      actions.toast(e?.message || String(e), 'error');
    },

    async load() {
      try {
        const data = await api.get('/state');
        set({ data, dev: data.dev, history: data.history, ai: data.ai, loadError: null });
        const st = get();
        const pf = fileForPath(st.path);
        if (pf !== st.pageFile) set({ pageFile: pf });
      } catch (e: any) {
        set({ loadError: e.message });
      }
    },
    scheduleLoad() {
      clearTimeout(loadTimer);
      loadTimer = setTimeout(async () => {
        await actions.load();
        const { pageFile } = get();
        if (pageFile) {
          set({ outlines: {} });
          await loadOutline(pageFile, 0, true);
        }
        if (!get().editingText) refreshSelectionInfo();
      }, 120);
    },

    connect() {
      const es = new EventSource('/api/events');
      es.onmessage = (m) => {
        const ev = JSON.parse(m.data);
        if (ev.type === 'hello') set({ dev: ev.dev, logs: ev.logs });
        else if (ev.type === 'log') set((s) => ({ logs: [...s.logs.slice(-500), ev.entry] }));
        else if (ev.type === 'dev') {
          const was = get().dev.status;
          set({ dev: ev.dev });
          if (ev.dev.status === 'running' && was !== 'running') set((s) => ({ reloadKey: s.reloadKey + 1, ready: false }));
        }
        else if (ev.type === 'history') set({ history: ev.history });
        else if (ev.type === 'fs') actions.scheduleLoad();
        else if (ev.type === 'check') window.dispatchEvent(new CustomEvent('astronut-check', { detail: ev }));
      };
      es.onerror = () => {};
      return () => es.close();
    },

    // ---- canvas ------------------------------------------------------------
    navigate(path: string) {
      retries = 0;
      set((s) => ({ path, pageFile: fileForPath(path), selection: null, ready: false, reloadKey: s.reloadKey + 1, entryFile: null }));
      save('path', path);
      const pf = get().pageFile;
      if (pf) loadOutline(pf, 0, true);
    },
    openPage(page: any) {
      if (!page.dynamic) return actions.navigate(page.route);
      // dynamic routes need a real URL — borrow the first entry of a matching collection
      const data = get().data;
      const seg = page.route.split('/').filter(Boolean);
      const col = data.collections.find((c: any) => seg.includes(c.name)) || data.collections[0];
      const entry = col?.entries?.[0];
      if (entry) return actions.navigate(page.route.replace(/\[\.\.\.[^\]]+\]|\[[^\]]+\]/, entry.id));
      actions.toast('This is a dynamic page — it needs content to preview. Open it from a link on another page.', 'info');
    },
    openComponent(c: any) {
      actions.navigate('/__astronut/c/' + c.previewId);
    },
    reloadCanvas() {
      set((s) => ({ reloadKey: s.reloadKey + 1, ready: false }));
    },
    setCanvas(patch: Partial<State>) {
      set(patch as any);
      if ('theme' in patch) {
        cmd('theme', { theme: patch.theme });
        save('theme', patch.theme);
      }
      if ('mode' in patch) cmd('mode', { mode: patch.mode });
      if ('bp' in patch) {
        save('bp', patch.bp);
        const bp = BREAKPOINTS.find((b) => b.id === patch.bp);
        set({ variant: '' });
        void bp;
      }
      if ('zoom' in patch) save('zoom', patch.zoom);
    },

    onBridge(m: any) {
      const st = get();
      switch (m.type) {
        case 'ready': {
          readyCount++;
          retries = 0;
          const path = m.path;
          const pf = fileForPath(path);
          set({ ready: true, ...(path !== st.path ? { path, selection: null } : {}), pageFile: pf });
          if (path !== st.path) save('path', path);
          cmd('config', { root: root(), opaque: [abs(SMART_IMAGE)] });
          cmd('theme', { theme: st.theme });
          cmd('mode', { mode: st.mode });
          if (pf && !get().outlines[pf]) loadOutline(pf);
          if (get().selection) syncCanvasSelection();
          break;
        }
        case 'select':
        case 'selected': {
          const file = rel(m.el.file);
          if (!file) {
            if (m.type === 'select') set({ selection: null });
            cmd('deselect');
            break;
          }
          const cur = st.selection;
          if (m.type === 'selected' && cur && cur.kind === 'element' && cur.file === file && cur.loc === m.el.loc) {
            set({ selection: { ...cur, el: m.el, index: m.el.index } });
            break;
          }
          if (m.type === 'selected' && cur && cur.kind === 'component') break;
          set({ selection: { kind: 'element', file, loc: m.el.loc, index: m.el.index, el: m.el, info: null }, menu: null });
          loadOutline(file).then(reveal);
          refreshSelectionInfo().then(reveal);
          break;
        }
        case 'select-image': {
          // An optimised image was clicked: select the <SmartImage> tag that placed it.
          const file = rel(m.parent.file);
          if (!file) break;
          api
            .post('/image-placement', { file, loc: m.parent.loc, index: m.index })
            .then(async (ref) => {
              set({ selection: { kind: 'component', file: ref.file, loc: ref.loc, start: ref.start, index: 0, el: m.el, info: null }, menu: null });
              await refreshSelectionInfo();
              reveal();
            })
            .catch(actions.fail);
          break;
        }
        case 'deselect':
          set({ selection: null, menu: null });
          break;
        case 'css-missing':
          actions.toast('That element isn’t on this page as it stands — it may have changed since the check ran.');
          break;
        case 'select-lost':
          if (st.selection) syncCanvasSelection();
          break;
        case 'dblclick': {
          const file = rel(m.el.file);
          if (!file) break;
          api
            .post('/node', { file, ref: { loc: m.el.loc } })
            .then((info) => {
              const key = { file: m.el.file, loc: m.el.loc, index: m.el.index };
              if (info.textEditable) cmd('edit-text', { key });
              else if (info.field) {
                // Text that comes from a widget field: type on the canvas, save to this placement.
                pendingField = { key, field: info.field, component: file, runIndex: m.el.runIndex || 0, text: m.el.text };
                cmd('edit-text', { key });
              } else if (info.listItem) {
                // Text of one item in a list field.
                pendingField = { key, field: info.listItem.field, itemKey: info.listItem.key, itemIndex: m.el.itemIndex || 0, component: file, runIndex: m.el.runIndex || 0 };
                cmd('edit-text', { key });
              } else if (info.inExpr) actions.toast('This text comes from data (a loop or a variable), so it can’t be typed over here. Edit it in the Source tab or in the Content tab.');
              else actions.toast('This element contains other elements. Double-click the text itself, or use the Source tab.');
            })
            .catch(actions.fail);
          break;
        }
        case 'editing':
          set({ editingText: m.on });
          break;
        case 'text-commit': {
          const file = rel(m.key.file);
          const pf = pendingField;
          pendingField = null;
          if (pf && pf.key.file === m.key.file && pf.key.loc === m.key.loc) actions.commitFieldText(pf, m.text);
          else if (file) actions.rawOp({ type: 'setText', file, target: { loc: m.key.loc }, text: m.text }, m.key.index);
          break;
        }
        case 'contextmenu': {
          const r = iframe?.getBoundingClientRect();
          if (!r) break;
          const scale = r.width / (iframe!.offsetWidth || 1);
          set({ menu: { x: r.left + m.x * scale, y: r.top + m.y * scale } });
          break;
        }
        case 'key':
          window.dispatchEvent(new CustomEvent('astronut-key', { detail: m }));
          break;
        case 'drop':
          if (m.data?.image) {
            const pf = get().pageFile;
            const dropRef = m.ref ? { ...m.ref, file: rel(m.ref.file) } : undefined;
            const cls = 'mx-auto my-10 w-full max-w-4xl rounded-card';
            // A photo from src/assets is placed as a SmartImage so Astro optimises it; anything else as a plain <img>.
            if (pf && String(m.data.image).startsWith('/src/assets/')) actions.rawOp({ type: 'insert', file: pf, pageLevel: true, dropRef, component: SMART_IMAGE, attrs: `src="${m.data.image}" alt="" class="${cls}"` });
            else if (pf) actions.rawOp({ type: 'insert', file: pf, pageLevel: true, dropRef, html: `<img src="${m.data.image}" alt="" class="${cls}" />` });
          } else actions.insertBlock(m.data, m.ref);
          break;
      }
    },

    // ---- selection ------------------------------------------------------------
    async selectNode(file: string, node: OutlineNode) {
      const kind = node.type === 'component' ? 'component' : 'element';
      set({ selection: { kind, file, loc: node.loc, start: node.start, index: 0, el: null, info: null }, menu: null });
      await refreshSelectionInfo();
      syncCanvasSelection(true);
    },
    async selectRef(file: string, ref: { start?: number; loc: string; type?: string }) {
      const kind = ref.type === 'component' ? 'component' : 'element';
      set({ selection: { kind, file, loc: ref.loc, start: ref.start, index: 0, el: null, info: null }, menu: null });
      await refreshSelectionInfo();
      syncCanvasSelection(true);
      reveal();
    },
    deselect() {
      set({ selection: null, menu: null });
      cmd('deselect');
    },
    selectParent() {
      const s = get().selection;
      const parent = s?.info?.ancestors?.at(-1);
      if (!s || !parent) return actions.deselect();
      actions.selectRef(s.file, parent);
    },
    hover(key: any) {
      cmd('hover', { key });
    },
    toggleExpand(id: string, on?: boolean) {
      set((s) => ({ expanded: { ...s.expanded, [id]: on ?? !s.expanded[id] } }));
    },

    // ---- edits -----------------------------------------------------------------
    /** Queue an operation against the server; keeps selection in sync afterwards. */
    rawOp(o: any, index = 0): Promise<any> {
      const run = async () => {
        try {
          const res = await api.post('/op', o);
          ensureFresh();
          set({ outlines: {} });
          const pf = get().pageFile;
          if (pf) await loadOutline(pf, 0, true);
          if (res.select) {
            const kind = res.select.type === 'component' ? 'component' : 'element';
            const prev = get().selection;
            set({ selection: { kind, file: res.select.file, loc: res.select.loc, start: res.select.start, index: kind === 'element' ? index : 0, el: prev && prev.loc === res.select.loc ? prev.el : prev?.el ?? null, info: prev?.info ?? null } });
            await refreshSelectionInfo();
            syncCanvasSelection();
            reveal();
          } else if (o.type === 'delete') actions.deselect();
          return res;
        } catch (e) {
          actions.fail(e);
          refreshSelectionInfo();
          return null;
        }
      };
      opChain = opChain.then(run, run);
      return opChain;
    },
    /** Run an op against the current selection (resolved when the op actually runs). */
    op(build: (s: Selection) => any): Promise<any> {
      const run = () => {
        const s = get().selection;
        if (!s) return null;
        const o = build(s);
        if (!o) return null;
        return { ...o, file: s.file, target: { start: s.start, loc: s.loc, name: s.info?.name } };
      };
      const prev = opChain;
      const exec = async () => {
        await prev.catch(() => {});
        const o = run();
        if (!o) return null;
        return actions.rawOp(o, get().selection?.index || 0);
      };
      return exec();
    },
    setClasses(classes: string) {
      const s = get().selection;
      if (!s || s.kind !== 'element') return;
      const key = keyOf(s);
      cmd('preview-class', { key, classes });
      set({ selection: { ...s, info: s.info ? { ...s.info, classes } : s.info } });
      return actions.op(() => ({ type: 'setAttr', name: 'class', value: classes.trim() || null }));
    },
    /** Give the selected image a new picture (an <img> element, or an optimised SmartImage). */
    setImage(url: string) {
      const s = get().selection;
      if (s?.kind === 'component') return actions.setField('src', url);
      return actions.op(() => ({ type: 'setImage', value: url }));
    },
    setAttr(name: string, value: string | null) {
      return actions.op(() => ({ type: 'setAttr', name, value }));
    },
    remove() {
      return actions.op(() => ({ type: 'delete' }));
    },
    duplicate() {
      return actions.op(() => ({ type: 'duplicate' }));
    },
    move(dir: 'up' | 'down') {
      return actions.op(() => ({ type: 'move', dir }));
    },
    editText() {
      const s = get().selection;
      if (!s || s.kind !== 'element') return;
      if (s.info?.textEditable) cmd('edit-text', { key: keyOf(s) });
      else actions.toast('This element has no plain text of its own. Double-click the text inside it.');
    },

    /** Insert a raw HTML snippet relative to the selection (or at the end of the page). */
    insertHtml(html: string, where: 'after' | 'inside' = 'after') {
      const { selection: s, pageFile } = get();
      if (s) return actions.rawOp({ type: 'insert', file: s.file, target: { start: s.start, loc: s.loc }, position: where === 'inside' ? 'inside-end' : 'after', html });
      if (!pageFile) return;
      return actions.rawOp({ type: 'insert', file: pageFile, pageLevel: true, html });
    },
    /** Add a component block to the current page (via drag-drop ref, selection, or at the end). */
    // ---- widgets ----------------------------------------------------------------
    /** Set one field on the selected placement (null resets it to the widget's default). */
    setField(name: string, value: any) {
      return actions.op(() => ({ type: 'setField', name, value }));
    },
    /** Change a field's default inside the widget's own file. */
    setDefault(file: string, name: string, value: any) {
      return actions.rawOp({ type: 'setDefault', file, name, value });
    },
    /** Text typed on the canvas into a field: save it to that placement, or to the default when viewing the widget alone. */
    async commitFieldText(pf: any, text: string) {
      const { pageFile } = get();
      const item = pf.itemKey ? { type: 'setItem', name: pf.field, index: pf.itemIndex, key: pf.itemKey, value: text } : null;
      if (pageFile === pf.component) return item ? actions.rawOp({ ...item, file: pf.component }) : actions.setDefault(pf.component, pf.field, text);
      try {
        const ref = await api.post('/placement', { page: pageFile, component: pf.component, index: pf.runIndex, ...(item ? {} : { field: pf.field, text: pf.text }) });
        const target = { start: ref.start, loc: ref.loc };
        if (item) await actions.rawOp({ ...item, file: ref.file, target });
        else await actions.rawOp({ type: 'setField', file: ref.file, target, name: pf.field, value: text });
      } catch (e) {
        actions.fail(e);
        ensureFresh(0);
      }
    },
    /** From an element inside a widget, select the placement it belongs to. */
    async selectPlacement(open = false) {
      const { selection: s, pageFile } = get();
      if (!s || !pageFile) return;
      try {
        const ref = await api.post('/placement', { page: pageFile, component: s.file, index: s.el?.runIndex || 0 });
        await actions.selectRef(ref.file, ref);
        if (open) set({ widgetOpen: true });
      } catch (e) {
        actions.fail(e);
      }
    },
    /** Give this page its own copy of the selected shared component. */
    async detach() {
      const r = await actions.op(() => ({ type: 'detach' }));
      if (r?.copy) {
        await actions.load();
        actions.toast(`This page now has its own copy: ${r.copy.split('/').pop()}`, 'ok');
      }
    },
    /** Turn the selected text / image / link into a field, after showing what will change. */
    async toField(kind: string, name: string) {
      const s = get().selection;
      if (!s) return;
      const o = { type: 'toField', file: s.file, target: { start: s.start, loc: s.loc }, kind, name };
      const pre = await api.post('/op', { ...o, dryRun: true });
      set({
        dialog: {
          type: 'confirm',
          title: kind === 'list' ? `Make these items a list called “${name}”?` : `Make “${name}” a field?`,
          preview: pre.preview,
          usedOn: pre.usedOn,
          text: kind === 'list' ? 'The first item becomes the pattern and each item’s text and images become the list. Every page looks the same afterwards; from then on each placement can add, remove and reorder items.' : 'Today’s content becomes the default, so every page looks exactly the same afterwards. From then on each placement can have its own value.',
          confirm: 'Turn into a field',
          onSubmit: async () => {
            await actions.rawOp(o);
            actions.deselect();
            await actions.load();
            actions.toast(`“${name}” is now a field`, 'ok');
          },
        },
      });
    },

    insertBlock(data: { component: string; hasSlot?: boolean; copy?: boolean }, dropRef?: any) {
      const { pageFile, selection: s, data: d } = get();
      if (!pageFile) return;
      const isPage = d.pages.some((p: any) => p.file === pageFile);
      if (!isPage && !isLayoutFile(pageFile)) return actions.toast('Open a page first — blocks are added to pages.', 'info');
      if (data.component === pageFile) return actions.toast('A component can’t contain itself.', 'error');
      const o: any = { type: 'insert', file: pageFile, component: data.component, withSlot: !!data.hasSlot, pageLevel: true, copy: !!data.copy };
      if (dropRef) o.dropRef = { ...dropRef, file: rel(dropRef.file) };
      else if (s && s.file === pageFile) o.target = { start: s.start, loc: s.loc };
      return actions.rawOp(o).then((r) => r && actions.toast(`Added ${data.component.split('/').pop()!.replace('.astro', '')} to the page`, 'ok'));
    },

    async undo() {
      try {
        const r = await api.post('/undo');
        if (r.step) actions.toast('Undid: ' + r.step);
        ensureFresh();
      } catch (e) {
        actions.fail(e);
      }
    },
    async redo() {
      try {
        const r = await api.post('/redo');
        if (r.step) actions.toast('Redid: ' + r.step);
        ensureFresh();
      } catch (e) {
        actions.fail(e);
      }
    },

    // ---- assistant -----------------------------------------------------------
    /** `/model` lists every available model; `/model <words>` switches to the one that matches. */
    async modelCommand(arg: string) {
      const say = (item: Partial<ChatItem>) => set((x) => ({ chat: [...x.chat, { role: 'assistant', text: '', ...item } as ChatItem] }));
      set((x) => ({ chatOpen: true, chat: [...x.chat, { role: 'user', text: ('/model ' + arg).trim() }] }));
      let list: any;
      try {
        list = await api.get('/ai/models?refresh=1');
      } catch (e: any) {
        return say({ error: e.message });
      }
      const words = arg.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return say({ text: 'Pick a model. The conversation carries over when you switch.', ...list });
      const hay = (m: any) => `${m.provider} ${m.id} ${m.label}`.toLowerCase();
      const exact = list.models.filter((m: any) => m.id.toLowerCase() === arg.toLowerCase() || m.label.toLowerCase() === arg.toLowerCase());
      const matches = exact.length ? exact : list.models.filter((m: any) => words.every((w) => hay(m).includes(w)));
      if (matches.length === 1) return actions.setModel(matches[0]);
      if (!matches.length) return say({ text: `No model matches “${arg}”. Here is everything available:`, ...list });
      say({ text: `“${arg}” matches several models — pick one:`, ...list, models: matches });
    },
    async setModel(m: { provider: string; id: string; label?: string }) {
      try {
        const ai = await api.put('/settings', { model: { provider: m.provider, id: m.id } });
        set((x) => ({ ai, chat: [...x.chat, { role: 'assistant', text: `Now using ${ai.modelLabel} · ${ai.providerLabel}.${ai.hasKey ? '' : ' This provider still needs setting up — open Settings.'}` } as ChatItem] }));
      } catch (e) {
        actions.fail(e);
      }
    },

    async ask(prompt: string) {
      if (get().chatBusy || !prompt.trim()) return;
      const slash = /^\/models?\b\s*(.*)$/i.exec(prompt.trim());
      if (slash) return actions.modelCommand(slash[1].trim());
      const st = get();
      const s = st.selection;
      const context = {
        pageFile: st.pageFile,
        route: st.path,
        selection: s?.info ? { name: s.info.name, file: s.file, line: s.info.line, source: s.info.source } : null,
      };
      set((x) => ({ chatBusy: true, chatOpen: true, chat: [...x.chat, { role: 'user', text: prompt }, { role: 'assistant', text: '', tools: [], pending: true }] }));
      const patch = (fn: (m: ChatItem) => ChatItem) => set((x) => ({ chat: x.chat.map((m, i) => (i === x.chat.length - 1 ? fn(m) : m)) }));
      try {
        const res = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, context }) });
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (!line.startsWith('data: ')) continue;
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'text') patch((m) => ({ ...m, text: m.text + ev.delta }));
            else if (ev.type === 'thinking') patch((m) => ({ ...m, thinking: (m.thinking || '') + ev.delta }));
            else if (ev.type === 'tool')
              patch((m) => {
                const tools = [...(m.tools || [])];
                const k = tools.findIndex((t) => t.id === ev.id);
                if (k >= 0) tools[k] = { ...tools[k], ...ev };
                else tools.push(ev);
                return { ...m, tools };
              });
            else if (ev.type === 'done') patch((m) => ({ ...m, pending: false, changed: ev.changed, stopped: ev.stopped }));
            else if (ev.type === 'error') patch((m) => ({ ...m, pending: false, error: ev.message, code: ev.code, changed: ev.changed }));
          }
        }
      } catch (e: any) {
        patch((m) => ({ ...m, pending: false, error: e.message }));
      }
      patch((m) => ({ ...m, pending: false }));
      set({ chatBusy: false });
      actions.scheduleLoad();
      ensureFresh(1800);
    },
    stopAsk() {
      api.post('/ai/stop').catch(() => {});
    },
    resetChat() {
      api.post('/ai/reset').catch(() => {});
      set({ chat: [] });
    },

    setUiTheme(t: State['uiTheme']) {
      set({ uiTheme: t });
      save('uiTheme', t);
    },
    setTab(tab: State['tab']) {
      set({ tab });
      save('tab', tab);
    },
    closeWelcome() {
      set({ welcomeOpen: false });
      save('welcomed', true);
    },
  };

  return {
    data: null,
    dev: { status: 'starting', url: null, building: false },
    logs: [],
    history: { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null },
    ai: null,
    loadError: null,

    tab: saved('tab', 'file'),
    path: saved('path', '/'),
    reloadKey: 0,
    pageFile: null,
    ready: false,

    selection: null,
    outlines: {},
    expanded: {},
    hoverKey: null,

    bp: saved('bp', 'xl'),
    theme: saved('theme', 'light'),
    zoom: saved('zoom', 'fit'),
    mode: 'edit',
    variant: '',
    stateVariant: '',
    uiTheme: saved('uiTheme', 'system'),

    chatOpen: false,
    chat: [],
    chatBusy: false,
    terminalOpen: false,
    settingsOpen: false,
    addOpen: false,
    welcomeOpen: !saved('welcomed', false),
    codeFile: null,
    entryFile: null,
    widgetOpen: false,
    checksOpen: false,
    checksTab: 'images',
    inventoryOpen: false,
    inspectorTab: 'design',
    menu: null,
    dialog: null,
    toasts: [],
    editingText: false,

    ...actions,
  };
});

export const act = () => useStore.getState() as any;
(window as any).__astronut = useStore;
export const EMPTY: any[] = [];
