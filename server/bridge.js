// Astrophile Studio canvas bridge.
// Injected into every page of the site *only* by the editor's dev server, and
// it does nothing unless the page is inside the editor's canvas iframe.
(() => {
  if (window.parent === window || window.__astrophile) return;
  window.__astrophile = true;

  // Astro's dev server stamps every element with the file + position it came
  // from, but its dev toolbar strips those attributes again once it boots. We
  // copy them to our own attributes as elements appear, so they survive.
  const SRC_FILE = 'data-astro-source-file';
  const SRC_LOC = 'data-astro-source-loc';
  const FILE = 'data-al-file';
  const LOC = 'data-al-loc';
  const adopt = (el) => {
    if (el.nodeType !== 1) return;
    const f = el.getAttribute(SRC_FILE);
    if (f) {
      el.setAttribute(FILE, f);
      el.setAttribute(LOC, el.getAttribute(SRC_LOC) || '');
    }
  };
  const adoptTree = (rootEl) => {
    if (rootEl.nodeType !== 1) return;
    adopt(rootEl);
    for (const el of rootEl.querySelectorAll(`[${SRC_FILE}]`)) adopt(el);
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach(adoptTree);
      else if (r.oldValue && !r.target.hasAttribute(r.attributeName === SRC_FILE ? FILE : LOC)) r.target.setAttribute(r.attributeName === SRC_FILE ? FILE : LOC, r.oldValue);
    }
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: [SRC_FILE, SRC_LOC], attributeOldValue: true });
  adoptTree(document.documentElement);
  const DRAG_TYPE = 'application/x-astrophile';
  const post = (type, data) => window.parent.postMessage({ __astrophile: true, type, ...data }, '*');
  const store = {
    get(k) {
      try {
        return sessionStorage.getItem('__al_' + k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v == null) sessionStorage.removeItem('__al_' + k);
        else sessionStorage.setItem('__al_' + k, v);
      } catch {}
    },
  };

  let mode = store.get('mode') || 'edit';
  const applyTheme = (t) => document.documentElement.classList.toggle('dark', t === 'dark');
  if (store.get('theme')) applyTheme(store.get('theme'));

  let hoverEl = null;
  let selected = null; // { els: Element[], key }
  let editing = null; // { el, original }
  let overlay, hoverBox, selectBox, selectLabel, dropLine, extHoverEls = null;

  // ---- element helpers ---------------------------------------------------
  const pick = (el) => (el && el.closest ? el.closest(`[${FILE}]`) : null);

  // Some rendered elements come from files the editor shouldn't open directly:
  // Astro's own <Image> component, and the project's SmartImage wrapper around it.
  // A click on one of those selects the image as placed in the page instead.
  let cfg = { root: '', opaque: [] };
  const isOpaque = (el) => !!cfg.root && (!fileOf(el).startsWith(cfg.root + '/') || fileOf(el).includes('/node_modules/') || cfg.opaque.includes(fileOf(el)));
  const hostOf = (el) => {
    let p = pick(el.parentElement);
    while (p && isOpaque(p)) p = pick(p.parentElement);
    return p;
  };
  const fileOf = (el) => el.getAttribute(FILE);
  const locOf = (el) => el.getAttribute(LOC);

  function sameLoc(file, loc) {
    return [...document.querySelectorAll(`[${LOC}="${loc}"]`)].filter((e) => fileOf(e) === file);
  }
  function keyOf(el) {
    const file = fileOf(el);
    const loc = locOf(el);
    return { file, loc, index: Math.max(0, sameLoc(file, loc).indexOf(el)) };
  }
  function find(key) {
    if (!key) return null;
    const list = sameLoc(key.file, key.loc);
    return list[key.index || 0] || list[0] || null;
  }
  /** First elements of every rendered instance of a component file. */
  function componentRuns(file) {
    const runs = [];
    for (const el of document.querySelectorAll(`[${FILE}]`)) {
      if (fileOf(el) !== file) continue;
      const up = pick(el.parentElement);
      if (up && fileOf(up) === file) continue;
      const prev = el.previousElementSibling;
      if (prev && prev.hasAttribute(FILE) && fileOf(prev) === file && runs.length && runs[runs.length - 1].includes(prev)) runs[runs.length - 1].push(el);
      else runs.push([el]);
    }
    return runs;
  }

  const CS = ['display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'gap', 'gridTemplateColumns', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign', 'color', 'backgroundColor', 'backgroundImage', 'width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'borderTopWidth', 'borderTopColor', 'borderTopLeftRadius', 'opacity', 'boxShadow', 'position', 'overflow', 'zIndex'];

  function describe(el) {
    const cs = getComputedStyle(el);
    const computed = {};
    for (const k of CS) computed[k] = cs[k];
    const r = el.getBoundingClientRect();
    const path = [];
    for (let p = pick(el.parentElement); p; p = pick(p.parentElement)) path.unshift({ ...keyOf(p), tag: p.tagName.toLowerCase() });
    const attrs = {};
    for (const n of ['href', 'src', 'alt', 'id', 'target', 'placeholder', 'type']) if (el.hasAttribute(n)) attrs[n] = el.getAttribute(n);
    return {
      ...keyOf(el),
      tag: el.tagName.toLowerCase(),
      classes: el.getAttribute('class') || '',
      text: (el.textContent || '').trim().slice(0, 80),
      attrs,
      computed,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      path,
      instances: sameLoc(fileOf(el), locOf(el)).length,
      // which repeated item this is within its own copy of the component (0 for non-repeated)
      itemIndex: (() => {
        const run = componentRuns(fileOf(el)).find((r) => r.some((x) => x === el || x.contains(el)));
        const mates = sameLoc(fileOf(el), locOf(el)).filter((e) => !run || run.some((x) => x === e || x.contains(e)));
        return Math.max(0, mates.indexOf(el));
      })(),
      // which rendered copy of its component this element belongs to
      runIndex: Math.max(0, componentRuns(fileOf(el)).findIndex((run) => run.some((r) => r === el || r.contains(el)))),
    };
  }

  // ---- overlay -----------------------------------------------------------
  function buildOverlay() {
    if (overlay) return;
    const host = document.createElement('astrophile-overlay');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .box{position:fixed;box-sizing:border-box;pointer-events:none;display:none;border-radius:2px}
        .hover{border:1.5px dashed #ff7a1a}
        .select{border:2px solid #ff5d01;box-shadow:0 0 0 1px rgba(255,255,255,.65)}
        .select.component{border-color:#8b5cf6}
        .label{position:absolute;left:-2px;top:-22px;height:20px;line-height:20px;padding:0 7px;border-radius:5px 5px 5px 0;background:#ff5d01;color:#fff;font:600 11px/20px ui-sans-serif,system-ui,-apple-system,sans-serif;white-space:nowrap;letter-spacing:.01em}
        .select.component .label{background:#8b5cf6}
        .label.below{top:auto;bottom:-22px;border-radius:0 5px 5px 5px}
        .label.inside{top:0;left:0;border-radius:0 0 5px 0}
        .drop{position:fixed;height:4px;border-radius:4px;background:#8b5cf6;box-shadow:0 0 0 3px rgba(139,92,246,.25);display:none;pointer-events:none}
        .drop::before{content:attr(data-label);position:absolute;left:50%;top:-11px;transform:translateX(-50%);background:#8b5cf6;color:#fff;font:600 11px/22px ui-sans-serif,system-ui,sans-serif;padding:0 10px;border-radius:11px;white-space:nowrap}
      </style>
      <div class="box hover"></div>
      <div class="box select"><div class="label"></div></div>
      <div class="drop" data-label="Drop here"></div>`;
    hoverBox = root.querySelector('.hover');
    selectBox = root.querySelector('.select');
    selectLabel = root.querySelector('.label');
    dropLine = root.querySelector('.drop');
    overlay = host;
    document.documentElement.appendChild(host);
    const style = document.createElement('style');
    style.textContent = `astro-dev-toolbar{display:none!important}[contenteditable="plaintext-only"]{outline:none!important;cursor:text!important}html.__al-edit, html.__al-edit *{cursor:default}`;
    document.head.appendChild(style);
    document.documentElement.classList.toggle('__al-edit', mode === 'edit');
  }

  function union(els) {
    let a = null;
    for (const el of els) {
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      a = a ? { l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom) } : { l: r.left, t: r.top, r: r.right, b: r.bottom };
    }
    return a;
  }
  function place(box, els) {
    const u = els && els.length ? union(els) : null;
    if (!u) {
      box.style.display = 'none';
      return null;
    }
    box.style.display = 'block';
    box.style.left = u.l + 'px';
    box.style.top = u.t + 'px';
    box.style.width = u.r - u.l + 'px';
    box.style.height = u.b - u.t + 'px';
    return u;
  }
  function frame() {
    if (overlay) {
      const showHover = mode === 'edit' && !editing;
      const h = extHoverEls || (hoverEl ? [hoverEl] : null);
      place(hoverBox, showHover && h && !(selected && h.length === 1 && selected.els.includes(h[0])) ? h : null);
      if (selected && mode === 'edit') {
        if (selected.els.some((e) => !e.isConnected)) {
          const again = selected.key.component ? componentRuns(selected.key.file)[selected.key.index || 0] : [find(selected.key)].filter(Boolean);
          selected.els = again && again.length ? again : [];
        }
        const u = place(selectBox, selected.els);
        if (u) {
          selectLabel.classList.toggle('below', u.t < 24 && u.b < innerHeight - 24);
          selectLabel.classList.toggle('inside', u.t < 24 && u.b >= innerHeight - 24);
        }
      } else if (selectBox) selectBox.style.display = 'none';
    }
    requestAnimationFrame(frame);
  }

  function setSelected(els, key, label, isComponent) {
    selected = els && els.length ? { els, key } : null;
    store.set('sel', selected ? JSON.stringify({ key, label, isComponent: !!isComponent }) : null);
    if (!overlay) return;
    selectBox.classList.toggle('component', !!isComponent);
    selectLabel.textContent = label || '';
  }
  const baseName = (f) => (f || '').split('/').pop();
  const labelFor = (el) => `${el.tagName.toLowerCase()} · ${baseName(fileOf(el))}`;

  function selectEl(el, opts = {}) {
    if (!el) {
      setSelected(null);
      if (!opts.silent) post('deselect', {});
      return;
    }
    setSelected([el], keyOf(el), labelFor(el), false);
    if (opts.scroll) reveal(el);
    if (!opts.silent) post('select', { el: describe(el) });
  }
  function reveal(el) {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block: r.height > innerHeight ? 'start' : 'center', behavior: 'smooth' });
  }

  // ---- text editing ------------------------------------------------------
  function startEdit(el) {
    if (!el || editing) return;
    editing = { el, original: el.innerHTML, key: keyOf(el) };
    el.setAttribute('contenteditable', 'plaintext-only');
    if (el.contentEditable !== 'plaintext-only') el.setAttribute('contenteditable', 'true');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.addEventListener('blur', () => finishEdit(true), { once: true });
    post('editing', { on: true });
  }
  function finishEdit(commit) {
    if (!editing) return;
    const { el, original, key } = editing;
    editing = null;
    el.removeAttribute('contenteditable');
    const text = el.innerText.replace(/ /g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    post('editing', { on: false });
    if (!commit) {
      el.innerHTML = original;
      return;
    }
    const before = document.createElement('div');
    before.innerHTML = original;
    if (text !== before.innerText.replace(/\s+/g, ' ').trim()) post('text-commit', { key, text });
    else el.innerHTML = original;
  }

  // ---- pointer + keyboard ------------------------------------------------
  const inOverlay = (t) => t === overlay;

  document.addEventListener(
    'mousemove',
    (e) => {
      if (mode !== 'edit' || editing) return;
      hoverEl = pick(e.target);
    },
    true,
  );
  document.addEventListener('mouseleave', () => (hoverEl = null), true);

  document.addEventListener(
    'click',
    (e) => {
      if (mode !== 'edit' || inOverlay(e.target)) return;
      if (editing) {
        if (editing.el.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        editing.el.blur();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const el = pick(e.target);
      const host = el && isOpaque(el) ? hostOf(el) : null;
      if (el && isOpaque(el)) {
        if (!host) return selectEl(null);
        // which image inside its host element this is
        const mates = [...host.querySelectorAll('img')].filter((i) => { const a = pick(i); return a && isOpaque(a) && hostOf(a) === host; });
        const img = el.tagName === 'IMG' ? el : el.querySelector('img') || el;
        setSelected([img], keyOf(img), 'image · optimised', true);
        post('select-image', { parent: keyOf(host), index: Math.max(0, mates.indexOf(img)), el: describe(img) });
        return;
      }
      selectEl(el);
    },
    true,
  );
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'submit']) {
    document.addEventListener(
      type,
      (e) => {
        if (mode !== 'edit' || editing) return;
        if (type === 'submit') e.preventDefault();
        e.stopPropagation();
        if (type === 'mousedown' && e.detail > 1) e.preventDefault();
      },
      true,
    );
  }
  document.addEventListener(
    'dblclick',
    (e) => {
      if (mode !== 'edit' || editing) return;
      e.preventDefault();
      e.stopPropagation();
      const el = pick(e.target);
      if (el && !isOpaque(el)) post('dblclick', { el: describe(el) });
    },
    true,
  );
  document.addEventListener(
    'contextmenu',
    (e) => {
      if (mode !== 'edit' || editing) return;
      e.preventDefault();
      const el = pick(e.target);
      if (!el || isOpaque(el)) return;
      selectEl(el);
      post('contextmenu', { x: e.clientX, y: e.clientY });
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (e) => {
      if (editing) {
        if (e.key === 'Escape') {
          e.preventDefault();
          const el = editing.el;
          finishEdit(false);
          el.blur();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          editing.el.blur();
        }
        e.stopPropagation();
        return;
      }
      if (mode !== 'edit') {
        if ((e.metaKey || e.ctrlKey) && ['z', 'k', 'e'].includes(e.key.toLowerCase())) {
          e.preventDefault();
          post('key', { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey });
        }
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const handled = ['Backspace', 'Delete', 'Escape', 'Enter'].includes(e.key) || (mod && ['z', 'y', 'd', 'k', 'e', 's', 'c', 'v'].includes(e.key.toLowerCase())) || (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key));
      if (handled) e.preventDefault();
      post('key', { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey });
    },
    true,
  );

  // ---- drag & drop of blocks from the editor ----------------------------
  function dropTarget(y) {
    const container = document.querySelector('main') || document.body;
    const kids = [...container.children].filter((c) => c.hasAttribute(FILE) && !['SCRIPT', 'STYLE'].includes(c.tagName) && c.getBoundingClientRect().height > 0);
    if (!kids.length) return { ref: null, y: container.getBoundingClientRect().top + 8, rect: container.getBoundingClientRect() };
    let el = kids[kids.length - 1];
    let where = 'after';
    for (const k of kids) {
      const r = k.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        el = k;
        where = 'before';
        break;
      }
    }
    const r = el.getBoundingClientRect();
    const file = fileOf(el);
    const runs = componentRuns(file);
    const index = Math.max(0, runs.findIndex((run) => run.includes(el)));
    return { ref: { file, loc: locOf(el), index, where }, y: where === 'before' ? r.top : r.bottom, rect: container.getBoundingClientRect() };
  }
  document.addEventListener(
    'dragover',
    (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      buildOverlay();
      const t = dropTarget(e.clientY);
      dropLine.style.display = 'block';
      dropLine.style.left = Math.max(8, t.rect.left + 8) + 'px';
      dropLine.style.width = Math.max(40, Math.min(innerWidth, t.rect.width) - 16) + 'px';
      dropLine.style.top = Math.min(innerHeight - 6, Math.max(2, t.y - 2)) + 'px';
    },
    true,
  );
  document.addEventListener('dragleave', (e) => {
    if (dropLine && (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= innerWidth || e.clientY >= innerHeight)) dropLine.style.display = 'none';
  }, true);
  document.addEventListener(
    'drop',
    (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes(DRAG_TYPE)) return;
      e.preventDefault();
      if (dropLine) dropLine.style.display = 'none';
      let data = null;
      try {
        data = JSON.parse(e.dataTransfer.getData(DRAG_TYPE));
      } catch {}
      if (data) post('drop', { data, ref: dropTarget(e.clientY).ref });
    },
    true,
  );

  // ---- messages from the editor -----------------------------------------
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || !m.__astrophile_cmd) return;
    switch (m.type) {
      case 'select': {
        const el = find(m.key);
        if (el) {
          setSelected([el], keyOf(el), labelFor(el), false);
          if (m.scroll) reveal(el);
          post('selected', { el: describe(el) });
        } else {
          // remember it — the page is probably about to hot-reload
          store.set('sel', JSON.stringify({ key: m.key, pending: true }));
        }
        break;
      }
      case 'select-component': {
        const runs = componentRuns(m.file);
        const run = runs[m.index || 0] || runs[0];
        setSelected(run || null, { file: m.file, index: m.index || 0, component: true }, m.label, true);
        if (run && m.scroll) reveal(run[0]);
        break;
      }
      case 'deselect':
        setSelected(null);
        break;
      case 'hover':
        extHoverEls = m.key ? (m.key.component ? componentRuns(m.key.file)[m.key.index || 0] || null : [find(m.key)].filter(Boolean)) : null;
        if (extHoverEls && !extHoverEls.length) extHoverEls = null;
        break;
      case 'config':
        cfg = { root: m.root || '', opaque: m.opaque || [] };
        break;
      case 'mode':
        mode = m.mode;
        store.set('mode', mode);
        hoverEl = null;
        document.documentElement.classList.toggle('__al-edit', mode === 'edit');
        break;
      case 'theme':
        store.set('theme', m.theme);
        applyTheme(m.theme);
        break;
      case 'edit-text':
        startEdit(find(m.key));
        break;
      case 'preview-class': {
        const el = find(m.key);
        if (el) el.setAttribute('class', m.classes);
        break;
      }
      case 'preview-attr': {
        const el = find(m.key);
        if (el) el.setAttribute(m.name, m.value);
        break;
      }
      case 'reload':
        location.reload();
        break;
      case 'debug-drop': // lets automated tests exercise the drop path without a real drag
        post('drop', { data: m.data, ref: dropTarget(m.y).ref });
        break;
    }
  });

  // ---- lifecycle ---------------------------------------------------------
  const scrollKey = 'scroll:' + location.pathname;
  addEventListener('pagehide', () => store.set(scrollKey, String(scrollY)));
  addEventListener('beforeunload', () => store.set(scrollKey, String(scrollY)));

  function boot() {
    adoptTree(document.documentElement);
    buildOverlay();
    const y = Number(store.get(scrollKey) || 0);
    if (y) {
      const html = document.documentElement;
      const prev = html.style.scrollBehavior;
      html.style.scrollBehavior = 'auto';
      scrollTo(0, y);
      html.style.scrollBehavior = prev;
    }
    post('ready', { path: location.pathname, title: document.title, files: [...new Set([...document.querySelectorAll(`[${FILE}]`)].map(fileOf))] });
    try {
      const saved = JSON.parse(store.get('sel') || 'null');
      if (saved && saved.key) {
        if (saved.key.component) {
          const run = componentRuns(saved.key.file)[saved.key.index || 0];
          if (run) {
            setSelected(run, saved.key, saved.label, true);
            reveal(run[0]);
          }
        } else {
          const el = find(saved.key);
          if (el) {
            setSelected([el], keyOf(el), labelFor(el), false);
            reveal(el);
            post('selected', { el: describe(el) });
          } else post('select-lost', {});
        }
      }
    } catch {}
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
