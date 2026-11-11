// Floating panels and dialogs: AI chat, dev log, settings, code editor, welcome.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, CircleAlert, Code2, Eye, FilePen, FilePlus2, FolderSearch, KeyRound, Loader2, MousePointerClick, Palette, RotateCcw, Sparkles, Square, Trash2, Undo2, X, LayoutGrid, MessageSquarePlus } from 'lucide-react';
import { useStore, act } from '../store';
import { api, q } from '../api';
import { Modal, Seg } from './ui';
import { Code } from './Code';
import { useDark } from './Inspector';

const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

// ---------------------------------------------------------------------------
// AI chat
// ---------------------------------------------------------------------------

const TOOL_LABEL: Record<string, [string, any]> = {
  list_files: ['Looking through the project', FolderSearch],
  read_file: ['Reading', Eye],
  write_file: ['Writing', FilePlus2],
  edit_file: ['Editing', FilePen],
  delete_file: ['Deleting', Trash2],
};

export function Chat() {
  const chat = useStore((s) => s.chat);
  const busy = useStore((s) => s.chatBusy);
  const sel = useStore((s) => s.selection);
  const path = useStore((s) => s.path);
  const pageFile = useStore((s) => s.pageFile);
  const ai = useStore((s) => s.ai);
  const [text, setText] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [chat]);
  useEffect(() => {
    input.current?.focus();
  }, []);

  const send = (t = text) => {
    if (!t.trim() || busy) return;
    setText('');
    act().ask(t.trim());
  };
  const isComponent = path.startsWith('/__astrophile/');
  const suggestions = sel
    ? ['Make this stand out more', 'Rewrite this text to be punchier', 'Add a subtle hover effect to this', 'Make this look better on phones']
    : ['Add a section with three customer stories after the hero', 'Create a “Careers” page with two open roles and add it to the header', 'Change the whole site to a warm, earthy colour scheme', 'Write a new blog post about our approach to remote work'];

  return (
    <div className="float chat">
      <div className="float-head">
        <Sparkles size={15} style={{ color: 'var(--accent)' }} />
        <span className="grow">Ask AI</span>
        {chat.length > 0 && (
          <button className="icon-btn tip down" data-tip="New conversation" onClick={() => act().resetChat()} disabled={busy}>
            <MessageSquarePlus size={15} />
          </button>
        )}
        <button className="icon-btn" onClick={() => useStore.setState({ chatOpen: false })}>
          <X size={15} />
        </button>
      </div>
      <div className="chat-body" ref={body}>
        {!chat.length && (
          <div className="chat-empty">
            <h3>What would you like to change?</h3>
            <p>Describe it in plain words. The assistant edits your site’s files directly, and every answer is one Undo step.</p>
            {ai && !ai.hasKey && !ai.mock && (
              <div className="msg">
                <div className="err" style={{ display: 'grid', gap: 8 }}>
                  {ai.provider === 'anthropic' ? (
                    <span>The assistant isn’t signed in yet. Run <code>ant auth login</code> in a terminal, add an Anthropic API key, or type <code>/model</code> to use another provider or a local model.</span>
                  ) : (
                    <span>{ai.providerLabel} isn’t set up yet. Add its details in Settings, or type <code>/model</code> to pick something else.</span>
                  )}
                  <button className="btn sm primary" style={{ justifySelf: 'start' }} onClick={() => useStore.setState({ settingsOpen: true })}>
                    <KeyRound size={13} /> Set it up
                  </button>
                </div>
              </div>
            )}
            {suggestions.map((s) => (
              <button key={s} className="suggest" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {chat.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="msg user">
              {m.text}
            </div>
          ) : (
            <div key={i} className="msg assistant">
              {m.thinking && !m.text && !m.tools?.length && <div className="thinking">{m.thinking.slice(-220)}</div>}
              {!!m.tools?.length && (
                <div className="tools">
                  {m.tools.map((t: any) => {
                    const [label, Icon] = TOOL_LABEL[t.name] || [t.name, Square];
                    return (
                      <div key={t.id} className={'toolchip ' + t.status} title={t.status === 'error' ? t.summary : t.path}>
                        {t.status === 'writing' ? <Loader2 size={13} className="spin" style={{ animation: 'spin .8s linear infinite' }} /> : t.status === 'error' ? <CircleAlert size={13} /> : <Icon size={13} />}
                        <span>{label}</span>
                        <span className="p">{(t.path || '').replace(/^src\//, '')}</span>
                        {t.status === 'done' && <Check size={12} style={{ marginLeft: 'auto', color: 'var(--ok)' }} />}
                      </div>
                    );
                  })}
                </div>
              )}
              {m.text}
              {m.models && <ModelList item={m} busy={busy} />}
              {m.pending && !m.text && (
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
              )}
              {m.error && (
                <div className="err">
                  {m.error}
                  {(m.code === 'billing' || m.code === 'limit' || m.code === 'eligible' || m.code === 'tools' || m.code === 'model') && i === chat.length - 1 && (
                    <div style={{ marginTop: 8 }}>
                      <button className="btn sm primary" onClick={() => act().ask('/model')}>
                        Switch model
                      </button>
                    </div>
                  )}
                  {m.code === 'auth' && (
                    <div style={{ marginTop: 8 }}>
                      <button className="btn sm primary" onClick={() => useStore.setState({ settingsOpen: true })}>
                        <KeyRound size={13} /> Open Settings
                      </button>
                    </div>
                  )}
                </div>
              )}
              {!m.pending && !!m.changed?.length && (
                <div className="changed">
                  <span>
                    {m.stopped ? 'Stopped — ' : ''}
                    {m.changed.length} file{m.changed.length > 1 ? 's' : ''} changed
                  </span>
                  {i === chat.length - 1 && (
                    <button className="btn sm ghost" onClick={() => act().undo()}>
                      <Undo2 size={12} /> Undo this
                    </button>
                  )}
                </div>
              )}
            </div>
          ),
        )}
      </div>
      <div className="chat-input">
        <textarea
          ref={input}
          rows={2}
          placeholder={sel ? 'Describe a change to the selected element…' : 'Describe a change to this page or the whole site…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
            if (e.key === 'Escape') useStore.setState({ chatOpen: false });
          }}
        />
        <div className="bar">
          {sel?.info ? (
            <span className="ctx sel" title="The assistant knows which element you have selected">
              <MousePointerClick size={11} />
              {sel.info.name} · {sel.file.split('/').pop()}
            </span>
          ) : (
            <span className="ctx" title="The assistant knows which page you are looking at">
              {isComponent ? pageFile?.split('/').pop() : 'Page ' + path}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <button className="ctx" style={{ cursor: 'pointer', maxWidth: 150 }} title={`${ai?.providerLabel || ''} — click to switch model (or type /model)`} onClick={() => act().ask('/model')} disabled={busy}>
            {ai?.mock ? 'mock' : (ai?.modelLabel || '').replace('Claude ', '')}
          </button>
          {busy ? (
            <button className="btn sm dark" onClick={() => act().stopAsk()}>
              <Square size={11} fill="currentColor" /> Stop
            </button>
          ) : (
            <button className="btn sm primary" disabled={!text.trim()} onClick={() => send()} title="Send (Enter)">
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelList({ item, busy }: { item: any; busy: boolean }) {
  const ai = useStore((s) => s.ai);
  const groups = (item.providers || []).map((p: any) => ({ ...p, models: item.models.filter((m: any) => m.provider === p.id) }));
  return (
    <div className="modellist">
      {groups.map((g: any) =>
        g.models.length ? (
          <div key={g.id}>
            <div className="lbl">{g.label}</div>
            {g.models.map((m: any) => {
              const on = ai?.provider === m.provider && ai?.model === m.id;
              return (
                <button key={m.id} className={'modelrow' + (on ? ' on' : '')} disabled={busy} onClick={() => act().setModel(m)} title={`/model ${m.provider} ${m.id}`}>
                  <span>{m.label}</span>
                  {on ? <Check size={13} /> : m.provider === 'anthropic' ? <span className="sub">{m.note}</span> : null}
                </button>
              );
            })}
          </div>
        ) : g.status !== 'ready' && item.models.length === (item.models || []).length && !item.text?.includes('matches several') ? (
          <div key={g.id} className="sub" style={{ padding: '2px 0' }}>
            {g.label} — {g.status}
          </div>
        ) : null,
      )}
      <button className="btn sm ghost" style={{ justifySelf: 'start', marginTop: 4 }} onClick={() => useStore.setState({ settingsOpen: true })}>
        Set up providers…
      </button>
    </div>
  );
}

/** Connection details for every non-Claude provider. */
function Providers({ list, onSaved }: { list: any; onSaved: () => void }) {
  const save = async (id: string, patch: any) => {
    try {
      await api.put('/settings', { providers: { [id]: patch } });
      onSaved();
    } catch (e) {
      act().fail(e);
    }
  };
  const rows = (list?.providers || []).filter((p: any) => p.id !== 'anthropic' && !p.signIn);
  const gpt = (list?.providers || []).find((p: any) => p.signIn);
  return (
    <div className="field">
      <label>Other providers and local models</label>
      <div className="providers">
        {gpt && <ChatGPTRow p={gpt} onChanged={onSaved} />}
        {rows.map((p: any) => (
          <div className="provider" key={p.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={'status-dot ' + (p.status === 'ready' ? 'running' : p.status === 'not set up' || p.status === 'not running' ? '' : 'error')} />
              <b style={{ flex: 1 }}>{p.label}</b>
              <span className="sub">{p.status === 'ready' ? `${p.count} model${p.count === 1 ? '' : 's'}` : p.status}</span>
            </div>
            {(p.local || p.id === 'custom') && <LazyInput label="Address" value={p.baseUrl} placeholder="http://localhost:8080/v1" onCommit={(v) => save(p.id, { baseUrl: v })} />}
            {!p.local && <LazyInput label="API key" secret value="" placeholder={p.keyHint ? `Saved (${p.keyHint}) — type to replace` : p.id === 'custom' ? 'Optional' : 'Paste a key to enable'} onCommit={(v) => v && save(p.id, { apiKey: v })} />}
            {!p.local && p.keyHint && p.keyHint !== 'from environment' && (
              <button className="sub" style={{ textDecoration: 'underline', justifySelf: 'start' }} onClick={() => save(p.id, { apiKey: '' })}>
                remove key
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="sub" style={{ margin: 0, lineHeight: 1.5 }}>
        Local models run entirely on this Mac: install Ollama or LM Studio, download a model that supports tool use (for example <code>qwen3</code> or <code>qwen2.5-coder</code>), and it appears here. Any other service that speaks the OpenAI-compatible API works through “Custom endpoint”. Keys are stored only in <code>.astrophile/settings.json</code> on this computer.
      </p>
    </div>
  );
}

/** "Sign in with ChatGPT": bills the assistant to the person's ChatGPT plan. */
function ChatGPTRow({ p, onChanged }: { p: any; onChanged: () => void }) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      const st = await api.get('/ai/chatgpt').catch(() => null);
      if (!st || st.pending) return;
      setWaiting(false);
      setError(st.signedIn ? '' : st.error || '');
      // You just signed in, so start using it: switch the assistant to the first ChatGPT model.
      if (st.sharing && useStore.getState().ai?.provider !== 'chatgpt') {
        try {
          const list = await api.get('/ai/models?refresh=1');
          const first = list.models.find((m: any) => m.provider === 'chatgpt');
          if (first) {
            const ai = await api.put('/settings', { model: { provider: first.provider, id: first.id } });
            useStore.setState({ ai });
            act().toast(`Signed in — the assistant now uses ${first.label}`, 'ok');
          }
        } catch {}
      }
      onChanged();
    }, 1200);
    return () => clearInterval(t);
  }, [waiting]);
  const signIn = async () => {
    setError('');
    // Open the tab first (inside the click) so the browser doesn't block it.
    const tab = window.open('about:blank', '_blank');
    try {
      const { url } = await api.post('/ai/chatgpt/signin');
      if (tab) tab.location.href = url;
      else window.location.assign(url);
      setWaiting(true);
    } catch (e: any) {
      tab?.close();
      setError(e.message);
    }
  };
  return (
    <div className="provider">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={'status-dot ' + (p.status === 'ready' ? 'running' : p.signedIn ? 'error' : '')} />
        <b style={{ flex: 1 }}>ChatGPT plan</b>
        <span className="sub">{waiting ? 'waiting for the browser…' : p.status === 'ready' ? `${p.email || 'signed in'} · ${p.count} model${p.count === 1 ? '' : 's'}` : p.status}</span>
      </div>
      <div className="actions">
        {p.signedIn ? (
          <>
            {!p.sharing && (
              <button className="btn sm primary" onClick={signIn}>
                Sign in again
              </button>
            )}
            <button
              className="btn sm"
              onClick={async () => {
                const r = await api.post('/ai/chatgpt/signout').catch(() => null);
                if (r && !r.revoked) act().toast('Signed out here. OpenAI didn’t confirm it — you can also disconnect Astrophile Studio in ChatGPT settings.');
                onChanged();
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <button className="btn sm primary" onClick={signIn} disabled={waiting}>
            Sign in with ChatGPT
          </button>
        )}
      </div>
      {error && <span style={{ color: 'var(--err)', fontSize: 11.5 }}>{error}</span>}
      <span className="sub" style={{ lineHeight: 1.45 }}>Uses your ChatGPT Plus or Pro plan’s allowance — no API key. Opens a browser tab to sign in.</span>
    </div>
  );
}

function LazyInput({ label, value, placeholder, onCommit, secret }: { label: string; value: string; placeholder?: string; onCommit: (v: string) => void; secret?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v.trim() !== value) onCommit(v.trim());
    if (secret) setV('');
  };
  return (
    <div className="inp">
      <span className="pre">{label}</span>
      <input type={secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} value={v} placeholder={placeholder} style={{ fontFamily: 'var(--mono)', fontSize: 11.5 }} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dev log
// ---------------------------------------------------------------------------

export function Terminal() {
  const logs = useStore((s) => s.logs);
  const dev = useStore((s) => s.dev);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [logs]);
  return (
    <div className="float terminal">
      <div className="float-head">
        <span className={'status-dot ' + dev.status} />
        <span className="grow">
          Astro dev server <span className="sub" style={{ fontWeight: 400 }}>· {dev.status}{dev.url ? ' · ' + dev.url : ''}</span>
        </span>
        <button className="btn sm ghost" onClick={() => api.post('/dev/restart').catch(act().fail)}>
          <RotateCcw size={12} /> Restart
        </button>
        <button className="icon-btn" onClick={() => useStore.setState({ terminalOpen: false })}>
          <X size={15} />
        </button>
      </div>
      <div className="term-body" ref={ref}>
        {logs.map((l, i) => (
          <div key={i} className={(l.stream === 'err' ? 'err ' : '') + (l.source === 'build' ? 'build' : '')}>
            {l.text}
          </div>
        ))}
        {!logs.length && <span style={{ opacity: 0.5 }}>No output yet.</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function Settings() {
  const ai = useStore((s) => s.ai);
  const uiTheme = useStore((s) => s.uiTheme);
  const project = useStore((s) => s.data?.project);
  const [key, setKey] = useState('');
  const [list, setList] = useState<any>(null);
  const refresh = () => {
    api.get('/ai/models?refresh=1').then(setList).catch(() => setList({ stale: true, models: [], providers: [] }));
    api.get('/settings').then((next) => useStore.setState({ ai: next })).catch(() => {});
  };
  useEffect(refresh, []);
  const save = async (patch: any) => {
    try {
      const next = await api.put('/settings', patch);
      useStore.setState({ ai: next });
      act().toast('Saved', 'ok');
    } catch (e) {
      act().fail(e);
    }
  };
  return (
    <Modal title="Settings" className="settings" onClose={() => useStore.setState({ settingsOpen: false })} footer={<button className="btn primary" onClick={() => useStore.setState({ settingsOpen: false })}>Done</button>}>
      <div className="modal-body">
        <div className="field">
          <label>Claude — sign-in</label>
          {ai?.keySource ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="inp set" style={{ flex: 1, color: 'var(--fg2)' }}>
                <Check size={13} style={{ color: 'var(--ok)' }} />
                {ai.keySource === 'saved' ? `Saved key ${ai.keyHint}` : ai.keySource === 'login' ? 'Signed in with ant auth login (no API key needed)' : 'Using ANTHROPIC_API_KEY from your environment'}
              </span>
              {ai.keySource === 'saved' && (
                <button className="btn" onClick={() => save({ apiKey: null })}>
                  Remove
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="inp" style={{ flex: 1 }}>
                <KeyRound size={13} style={{ color: 'var(--muted)' }} />
                <input type="password" placeholder="sk-ant-…" value={key} autoComplete="off" onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              </div>
              <button className="btn primary" disabled={!key.trim()} onClick={() => save({ apiKey: key }).then(() => setKey(''))}>
                Save
              </button>
            </div>
          )}
          <p className="sub" style={{ margin: 0, lineHeight: 1.5 }}>
            No key needed if you sign in: run <code>ant auth login</code> in a terminal and reopen Settings. Or paste a key from console.anthropic.com — it is stored only on this computer (in <code>.astrophile/settings.json</code>, which Git ignores) and is sent only to Anthropic. A saved key takes priority over the sign-in.
          </p>
        </div>
        <div className="cols">
          <div className="field">
            <label>Model</label>
            <div className="inp">
              <select
                value={`${ai?.provider}\n${ai?.model}`}
                onChange={(e) => {
                  const [provider, id] = e.target.value.split('\n');
                  save({ model: { provider, id } });
                }}
              >
                {!list && <option value={`${ai?.provider}\n${ai?.model}`}>{ai?.modelLabel}</option>}
                {list && !list.models.some((m: any) => m.provider === ai?.provider && m.id === ai?.model) && <option value={`${ai?.provider}\n${ai?.model}`}>{ai?.modelLabel} (unavailable)</option>}
                {(list?.providers || []).map((p: any) => {
                  const ms = list.models.filter((m: any) => m.provider === p.id);
                  return ms.length ? (
                    <optgroup key={p.id} label={p.label}>
                      {ms.map((m: any) => (
                        <option key={m.id} value={`${m.provider}\n${m.id}`}>
                          {m.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </div>
            <span className="sub">{ai?.providerLabel} · or type /model in the chat</span>
          </div>
          <div className="field">
            <label>Thinking effort</label>
            <div className="inp">
              <select value={ai?.effort} onChange={(e) => save({ effort: e.target.value })}>
                <option value="low">Low — quickest</option>
                <option value="medium">Medium</option>
                <option value="high">High — most careful</option>
              </select>
            </div>
          </div>
        </div>
        {list?.stale && (
          <div className="msg">
            <div className="err">
              The editor needs a restart to show providers and models: it was updated while running. In the terminal where it runs, press Ctrl+C, then run <code>npm start</code> again and reload this page.
            </div>
          </div>
        )}
        <Providers list={list} onSaved={refresh} />
        <div className="field">
          <label>Editor appearance</label>
          <Seg value={uiTheme} onChange={(v) => v && act().setUiTheme(v)} options={[{ value: 'system', label: 'Match system' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </div>
        <div className="field">
          <label>Project folder</label>
          <span className="inp" style={{ fontFamily: 'var(--mono)', fontSize: 11.5, overflow: 'hidden', whiteSpace: 'nowrap', color: 'var(--fg2)' }}>{project?.root}</span>
          <span className="sub">To edit a different Astro site, start the editor with its path: <code>npm start -- /path/to/site</code></span>
        </div>
        <button className="btn ghost" onClick={() => useStore.setState({ settingsOpen: false, welcomeOpen: true })}>
          Show the welcome tour again
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Full-file code editor
// ---------------------------------------------------------------------------

export function CodeEditor() {
  const file = useStore((s) => s.codeFile)!;
  const dark = useDark();
  const [original, setOriginal] = useState<string | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    setOriginal(null);
    api.get('/file' + q({ path: file })).then((r) => {
      setOriginal(r.content);
      setText(r.content);
    }).catch((e) => {
      act().fail(e);
      useStore.setState({ codeFile: null });
    });
  }, [file]);
  const dirty = original !== null && text !== original;
  const save = async () => {
    if (!dirty) return;
    try {
      await api.put('/file', { path: file, content: text });
      setOriginal(text);
      act().ensureFresh();
      act().toast('Saved ' + file.split('/').pop(), 'ok');
    } catch (e) {
      act().fail(e);
    }
  };
  const close = () => {
    if (dirty && !confirm('Discard your unsaved changes to this file?')) return;
    useStore.setState({ codeFile: null });
  };
  return (
    <Modal
      wide
      onClose={close}
      title={
        <>
          <Code2 size={15} />
          <span style={{ fontFamily: 'var(--mono)', fontSize: 12.5, fontWeight: 500 }}>{file}</span>
          {dirty && <span className="badge" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>unsaved</span>}
        </>
      }
      footer={
        <>
          <span className="sub" style={{ marginRight: 'auto' }}>
            {file.endsWith('.astro') ? 'An .astro file: JavaScript between the --- fences runs when the page is built; the HTML below is what gets rendered.' : ''}
          </span>
          <button className="btn" onClick={close}>
            Close
          </button>
          <button className="btn primary" disabled={!dirty} onClick={save}>
            Save <span className="kbd">{mod}S</span>
          </button>
        </>
      }
    >
      <div className="code-host">{original !== null && <Code value={text} onChange={setText} filename={file} dark={dark} onSave={save} wrap={false} autoFocus />}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Dialogs + welcome
// ---------------------------------------------------------------------------

export function Dialog() {
  const d = useStore((s) => s.dialog);
  const [value, setValue] = useState(d?.value || '');
  const [choice, setChoice] = useState(d?.choices?.[0]?.value || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => useStore.setState({ dialog: null });
  const submit = async () => {
    if (d.type === 'prompt' && !value.trim()) return;
    setBusy(true);
    setError('');
    try {
      await d.onSubmit(value.trim(), choice);
      close();
    } catch (e: any) {
      setError(e.message || String(e));
    }
    setBusy(false);
  };
  return (
    <Modal
      title={d.title}
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className={'btn ' + (d.danger ? 'dark' : 'primary')} disabled={busy || (d.type === 'prompt' && !value.trim())} onClick={submit}>
            {d.confirm || 'OK'}
          </button>
        </>
      }
    >
      <div className="modal-body">
        {d.text && <p>{d.text}</p>}
        {d.preview && (d.preview.removed.length > 0 || d.preview.added.length > 0) && (
          <div className="diff">
            {d.preview.removed.map((l: string, i: number) => (
              <div key={'r' + i} className="del">
                − {l.trim()}
              </div>
            ))}
            {d.preview.added.map((l: string, i: number) => (
              <div key={'a' + i} className="add">
                + {l.trim()}
              </div>
            ))}
          </div>
        )}
        {d.usedOn?.length > 0 && (
          <p className="sub" style={{ lineHeight: 1.6 }}>
            Used on:{' '}
            {d.usedOn.map((u: any) => (
              <span key={u.file} className="pagechip" style={{ marginRight: 4 }}>
                {u.route}
              </span>
            ))}
          </p>
        )}
        {d.type === 'prompt' && (
          <div className="field">
            <label>{d.label}</label>
            <div className="inp big-inp">
              {d.prefix && <span className="pre" style={{ fontFamily: 'var(--mono)' }}>{d.prefix}</span>}
              <input
                autoFocus
                value={value}
                placeholder={d.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') submit();
                  if (e.key === 'Escape') close();
                }}
              />
            </div>
          </div>
        )}
        {d.choices && (
          <div className="field">
            <label>{d.choiceLabel}</label>
            <div className="choices">
              {d.choices.map((c: any) => (
                <button key={c.value} className={choice === c.value ? 'on' : ''} onClick={() => setChoice(c.value)}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {d.hint && <p className="sub" style={{ lineHeight: 1.55 }}>{d.hint}</p>}
        {error && <p style={{ color: 'var(--err)' }}>{error}</p>}
      </div>
    </Modal>
  );
}

export function Welcome() {
  const name = useStore((s) => s.data?.project?.name);
  return (
    <Modal onClose={() => act().closeWelcome()} className="welcome">
      <div className="hero">
        <img src="/astrophile.svg" width={40} height={40} alt="" />
        <h1>Build your Astro site by pointing, clicking and asking.</h1>
        <p>
          This is a live preview of <b>{name}</b> — a real Astro project on your computer. Everything you do here is written straight into its source files, so there is nothing to export and nothing locked in.
        </p>
      </div>
      <div className="steps">
        <div className="step">
          <b>
            <MousePointerClick size={15} /> Click to select, double-click to type
          </b>
          <span>Select anything on the page and restyle it on the right. Double-click text to rewrite it in place.</span>
        </div>
        <div className="step">
          <b>
            <LayoutGrid size={15} /> Drag in ready-made blocks
          </b>
          <span>The Assets tab has heroes, pricing tables, FAQs and more. Drag one onto the page or press +.</span>
        </div>
        <div className="step">
          <b>
            <Sparkles size={15} /> Ask the AI
          </b>
          <span>Press {mod}K and describe what you want — “add a testimonials section”, “make this heading bolder”.</span>
        </div>
        <div className="step">
          <b>
            <Palette size={15} /> Theme once, change everywhere
          </b>
          <span>With nothing selected, the right panel sets your brand colour, fonts and corner style site-wide.</span>
        </div>
      </div>
      <div className="modal-foot" style={{ borderTop: 0, padding: '14px 28px 24px' }}>
        <span className="sub" style={{ marginRight: 'auto' }}>Made a mistake? {mod}Z undoes anything, including what the AI did.</span>
        <button className="btn primary" style={{ height: 36, padding: '0 18px' }} onClick={() => act().closeWelcome()}>
          Start editing
        </button>
      </div>
    </Modal>
  );
}
