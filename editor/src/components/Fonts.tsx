// Fonts in the Theme panel. The site's fonts are declared in astro.config and
// downloaded by Astro itself; this just picks which font fills each role.
import { useEffect, useRef, useState } from 'react';
import { Search, Type } from 'lucide-react';
import { useStore, act } from '../store';
import { api, q } from '../api';
import { Group, Modal } from './ui';

// Preview faces are loaded on demand, straight from the Fontsource CDN, into the editor only.
const loaded = new Set<string>();
function usePreviewFace(id: string | null) {
  const [ready, setReady] = useState(id ? loaded.has(id) : false);
  useEffect(() => {
    if (!id) return;
    if (loaded.has(id)) return setReady(true);
    let live = true;
    const face = new FontFace(`preview-${id}`, `url(https://cdn.jsdelivr.net/fontsource/fonts/${id}@latest/latin-400-normal.woff2)`);
    face
      .load()
      .then((f) => {
        (document as any).fonts.add(f);
        loaded.add(id);
        if (live) setReady(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return ready && id ? `"preview-${id}", sans-serif` : undefined;
}
const idOf = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export function FontRoles() {
  const stamp = useStore((s) => s.data);
  const [state, setState] = useState<any>(null);
  const [picking, setPicking] = useState<any>(null);
  const refresh = () => api.get('/fonts').then(setState).catch(() => setState({ supported: false, roles: [] }));
  useEffect(() => {
    refresh();
  }, [stamp]);
  if (!state) return null;
  return (
    <Group title="Typography" id="theme-type">
      {!state.supported ? (
        <p className="note" style={{ margin: 0 }}>
          This project doesn’t declare fonts in its Astro config yet. Pick one below and it will be added for you.
        </p>
      ) : null}
      {state.roles.map((r: any) => (
        <RoleRow key={r.id} role={r} onPick={() => setPicking(r)} />
      ))}
      <p className="sub" style={{ margin: 0, lineHeight: 1.45 }}>Astro downloads each font and serves it from your own site — nothing loads from a font service when visitors arrive.</p>
      {picking && (
        <FontPicker
          role={picking}
          onClose={() => setPicking(null)}
          onDone={() => {
            setPicking(null);
            refresh();
          }}
        />
      )}
    </Group>
  );
}

function RoleRow({ role, onPick }: { role: any; onPick: () => void }) {
  const face = usePreviewFace(role.name ? idOf(role.name) : null);
  return (
    <div className="field">
      <label>{role.label}</label>
      <button className="fontrow" onClick={onPick} title="Choose a different font">
        <span className="name" style={{ fontFamily: face }}>{role.name || 'Not set'}</span>
        <span className="sub">Change</span>
      </button>
    </div>
  );
}

const CATEGORIES: [string, string][] = [
  ['', 'All'],
  ['sans-serif', 'Sans'],
  ['serif', 'Serif'],
  ['display', 'Display'],
  ['handwriting', 'Handwriting'],
  ['monospace', 'Mono'],
];

function FontPicker({ role, onClose, onDone }: { role: any; onClose: () => void; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(role.id === 'code' ? 'monospace' : '');
  const [result, setResult] = useState<{ total: number; fonts: any[] } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const timer = useRef<any>(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api
        .get('/fonts/search' + q({ q: query, category }))
        .then((r) => {
          setResult(r);
          setError('');
        })
        .catch((e) => setError(e.message));
    }, 180);
    return () => clearTimeout(timer.current);
  }, [query, category]);

  const choose = async (f: any) => {
    setBusy(f.id);
    try {
      await api.put('/fonts', { role: role.id, font: f.id });
      act().toast(`${f.family} is now the ${role.label.toLowerCase()} font — Astro is fetching it`, 'ok');
      onDone();
    } catch (e: any) {
      setError(e.message);
      setBusy('');
    }
  };

  return (
    <Modal
      wide
      className="fontpicker"
      onClose={onClose}
      title={
        <>
          <Type size={16} /> Choose a font for {role.label.toLowerCase()}
          {role.name && <span className="sub" style={{ fontWeight: 400 }}>currently {role.name}</span>}
        </>
      }
    >
      <div className="inv-bar">
        <div className="inp" style={{ width: 240 }}>
          <Search size={13} style={{ color: 'var(--muted)' }} />
          <input autoFocus placeholder="Search 2,000 open-source fonts" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <div className="seg">
          {CATEGORIES.map(([value, label]) => (
            <button key={value} className={category === value ? 'on' : ''} onClick={() => setCategory(value)}>
              {label}
            </button>
          ))}
        </div>
        <span className="sub" style={{ marginLeft: 'auto' }}>{result ? `${result.total} font${result.total === 1 ? '' : 's'}${result.total > result.fonts.length ? ` — showing ${result.fonts.length}, search to narrow` : ''}` : ''}</span>
      </div>
      <div className="inv-list">
        {error && <div className="hint" style={{ color: 'var(--err)' }}>{error}</div>}
        {result?.fonts.map((f) => (
          <FontOption key={f.id} font={f} sample={role.sample} current={role.name === f.family} busy={busy === f.id} disabled={!!busy} onChoose={() => choose(f)} />
        ))}
        {result && !result.fonts.length && !error && <div className="hint">No fonts match.</div>}
      </div>
      <div className="inv-legend" style={{ gridTemplateColumns: '1fr' }}>
        <span>Fonts come from the Fontsource catalogue (open-source, including the Google Fonts library). Choosing one updates <code>astro.config</code>; Astro then downloads it and hosts it with your site. The preview restarts for a moment.</span>
      </div>
    </Modal>
  );
}

function FontOption({ font, sample, current, busy, disabled, onChoose }: { font: any; sample: string; current: boolean; busy: boolean; disabled: boolean; onChoose: () => void }) {
  const face = usePreviewFace(font.id);
  return (
    <button className={'fontopt' + (current ? ' on' : '')} disabled={disabled} onClick={onChoose}>
      <span className="meta">
        <b>{font.family}</b>
        <span className="sub">
          {font.category}
          {font.variable ? ' · variable' : ` · ${font.weights.length} weight${font.weights.length === 1 ? '' : 's'}`}
          {current ? ' · in use' : ''}
        </span>
      </span>
      <span className="sample" style={{ fontFamily: face, opacity: face ? 1 : 0.25 }}>{busy ? 'Applying…' : sample}</span>
    </button>
  );
}
