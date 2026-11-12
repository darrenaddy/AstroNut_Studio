// Site checks: images while editing, images in the built site, and Lighthouse.
import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Gauge, Info, Loader2, Monitor, MousePointerClick, Smartphone, Square, TriangleAlert } from 'lucide-react';
import { useStore, act } from '../store';
import { api } from '../api';
import { Modal } from './ui';

const ICON: Record<string, any> = { error: CircleAlert, warn: TriangleAlert, info: Info };

export function Checks() {
  const tab = useStore((s) => s.checksTab);
  const close = () => useStore.setState({ checksOpen: false });
  const tabs: [string, string][] = [
    ['images', 'Images · while editing'],
    ['built', 'Images · built site'],
    ['lighthouse', 'Lighthouse'],
  ];
  return (
    <Modal
      wide
      className="checks"
      onClose={close}
      title={
        <>
          <Gauge size={16} /> Site checks
        </>
      }
    >
      <div className="itabs" style={{ padding: '0 14px' }}>
        {tabs.map(([id, label]) => (
          <button key={id} className={'tab' + (tab === id ? ' on' : '')} onClick={() => useStore.setState({ checksTab: id })}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'images' && <ImageCheck />}
      {tab === 'built' && <BuiltCheck />}
      {tab === 'lighthouse' && <LighthouseCheck />}
    </Modal>
  );
}

/** Jump to a finding: open its page, close the panel and select the element. */
async function show(f: any) {
  const st = useStore.getState();
  useStore.setState({ checksOpen: false });
  act().setTab('file');
  const page = f.route ? st.data.pages.find((p: any) => p.route === f.route) : null;
  const comp = !page && f.file ? [...st.data.components, ...st.data.layouts].find((c: any) => c.file === f.file) : null;
  if (page && st.pageFile !== page.file) act().openPage(page);
  else if (comp && st.pageFile !== comp.file) act().openComponent(comp);
  if (f.start != null) {
    await new Promise((r) => setTimeout(r, page || comp ? 2200 : 0));
    act().selectRef(f.file, { start: f.start, loc: f.loc, type: f.type });
  }
}

function Finding({ f, onFix }: { f: any; onFix?: () => void }) {
  const Icon = ICON[f.level] || Info;
  const dev = useStore((s) => s.dev.url);
  return (
    <div className={'finding ' + f.level}>
      <Icon size={16} className="lvl" />
      {f.thumb && <img className="fthumb" src={(dev || '') + f.thumb} alt="" />}
      <div className="ftext">
        <b>{f.title}</b>
        <span>{f.detail}</span>
        {f.file && (
          <span className="where">
            {f.file.replace(/^src\//, '')}
            {f.line ? ':' + f.line : ''}
          </span>
        )}
      </div>
      <div className="facts">
        {f.file && f.start != null && (
          <button className="btn sm ghost" onClick={() => show(f)}>
            <MousePointerClick size={12} /> Show
          </button>
        )}
        {f.entry && (
          <button className="btn sm ghost" onClick={() => (useStore.setState({ checksOpen: false, entryFile: f.entry }), act().setTab('content'))}>
            <MousePointerClick size={12} /> Open post
          </button>
        )}
        {f.fix && onFix && (
          <button className="btn sm" onClick={onFix}>
            {f.fix.label}
          </button>
        )}
      </div>
    </div>
  );
}

// ---- 1. while editing ------------------------------------------------------------

function ImageCheck() {
  const stamp = useStore((s) => s.data);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const load = () => api.get('/checks/images').then(setResult).catch(act().fail);
  useEffect(() => {
    load();
  }, [stamp]);
  const fix = async (f: any) => {
    if (f.fix.confirm && !confirm(f.fix.confirm)) return;
    setBusy(f.id);
    try {
      await api.post('/checks/fix', f.fix);
      act().ensureFresh();
      await act().load();
      await load();
    } catch (e) {
      act().fail(e);
    }
    setBusy('');
  };
  if (!result) return <div className="hint">Checking…</div>;
  const { findings, counts } = result;
  return (
    <>
      <div className="checkbar">
        <span>
          {findings.length ? (
            <>
              <b>{counts.error + counts.warn}</b> to fix{counts.info ? `, ${counts.info} to consider` : ''}
            </>
          ) : (
            <>
              <CircleCheck size={14} style={{ color: 'var(--ok)', verticalAlign: -2 }} /> <b>No image problems</b>
            </>
          )}
          <span className="sub"> · {result.images} images checked</span>
        </span>
        <span className="sub">Updates as you edit</span>
      </div>
      <div className="inv-list">
        {!findings.length && <div className="hint">Every image has a description, photos are optimised, and nothing is oversized or unused.</div>}
        {findings.map((f: any) => (
          <div key={f.id} style={{ opacity: busy === f.id ? 0.4 : 1 }}>
            <Finding f={f} onFix={() => fix(f)} />
          </div>
        ))}
      </div>
    </>
  );
}

// ---- 2. the built site -----------------------------------------------------------

function BuiltCheck() {
  const building = useStore((s) => s.dev.building);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/checks/built').then(setResult).catch(() => setResult({ built: false }));
  }, []);
  const build = async () => {
    setBusy(true);
    try {
      const r = await api.post('/checks/build');
      if (!r.build.ok) act().toast('The build failed — open the log (toolbar) to see why', 'error');
      setResult(r);
    } catch (e) {
      act().fail(e);
    }
    setBusy(false);
  };
  const working = busy || building;
  return (
    <>
      <div className="checkbar">
        <span>
          {result?.built ? (
            <>
              <b>{result.totals.pages}</b> pages · whole site <b>{result.totals.siteKB} KB</b>
              {result.totals.savedKB > 0 && (
                <>
                  {' '}
                  · optimisation saves about <b>{result.totals.savedKB} KB</b> on a phone
                </>
              )}
              <span className="sub"> · built {new Date(result.builtAt).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</span>
            </>
          ) : (
            <span className="sub">Measures the real files Astro produces, so it needs a build first.</span>
          )}
        </span>
        <button className="btn sm primary" disabled={working} onClick={build}>
          {working ? <Loader2 size={12} className="spin" /> : null} {working ? 'Building…' : result?.built ? 'Build again and re-check' : 'Build and check'}
        </button>
      </div>
      <div className="inv-list">
        {result?.built && (
          <>
            {result.findings.map((f: any) => (
              <Finding key={f.id} f={f} />
            ))}
            {!result.findings.length && (
              <div className="finding ok">
                <CircleCheck size={16} className="lvl" />
                <div className="ftext">
                  <b>No missing or unoptimised images in the built site</b>
                </div>
              </div>
            )}
            <div className="inv-row head" style={{ gridTemplateColumns: 'minmax(0,1fr) 90px 130px 130px' }}>
              <span>Page</span>
              <span>Images</span>
              <span>On a phone</span>
              <span>On a laptop</span>
            </div>
            {result.pages.map((p: any) => (
              <div className="inv-row" key={p.route} style={{ gridTemplateColumns: 'minmax(0,1fr) 90px 130px 130px' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{p.route}</span>
                <span>{p.images}</span>
                <span>{p.phoneKB} KB</span>
                <span>{p.desktopKB} KB</span>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="inv-legend" style={{ gridTemplateColumns: '1fr' }}>
        <span>Image weight is what a visitor downloads for the pictures on each page: the size a phone would pick, and the size a laptop would pick. Embedded maps and videos are not counted.</span>
      </div>
    </>
  );
}

// ---- 3. Lighthouse ---------------------------------------------------------------

const band = (n: number | null) => (n == null ? 'none' : n >= 90 ? 'good' : n >= 50 ? 'mid' : 'bad');
const CATS: [string, string][] = [
  ['performance', 'Performance'],
  ['accessibility', 'Accessibility'],
  ['best-practices', 'Best practices'],
  ['seo', 'SEO'],
];

function Score({ value, before, label }: { value: number | null; before?: number | null; label: string }) {
  const delta = value != null && before != null ? value - before : 0;
  return (
    <div className={'score ' + band(value)} title={label}>
      <b>{value ?? '–'}</b>
      <span>{label}</span>
      {delta !== 0 && <i className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? '+' : ''}{delta}</i>}
    </div>
  );
}

function LighthouseCheck() {
  const path = useStore((s) => s.path);
  const [state, setState] = useState<any>(null);
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [running, setRunning] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const load = () => api.get('/checks/lighthouse').then((r) => {
    setState(r);
    if (r.last?.device) setDevice(r.last.device);
  }).catch(() => {});
  useEffect(() => {
    load();
    const on = (e: any) => e.detail.kind === 'lighthouse' && setProgress(e.detail.state === 'running' ? e.detail : null);
    window.addEventListener('astronut-check', on);
    return () => window.removeEventListener('astronut-check', on);
  }, []);

  const run = async (routes?: string[]) => {
    setRunning(routes || 'all');
    try {
      let pages = state?.pages || [];
      if (!pages.length) {
        const b = await api.post('/checks/build');
        if (!b.build.ok) throw new Error('The build failed — open the log to see why.');
        pages = (await api.get('/checks/lighthouse')).pages;
      }
      const result = await api.post('/checks/lighthouse', { routes, device });
      setState({ last: result, pages, running: false });
      setOpen(result.pages.find((p: any) => !p.stale)?.route || null);
    } catch (e) {
      act().fail(e);
    }
    setRunning(null);
    setProgress(null);
  };
  const rebuildAndRun = async () => {
    setRunning('all');
    try {
      const b = await api.post('/checks/build');
      if (!b.build.ok) throw new Error('The build failed — open the log to see why.');
    } catch (e) {
      act().fail(e);
      setRunning(null);
      return;
    }
    run();
  };
  const showNode = (route: string, item: any) => {
    useStore.setState({ checksOpen: false });
    act().setTab('file');
    const go = () => act().cmd('select-css', { selector: item.selector });
    if (useStore.getState().path !== route) {
      act().navigate(route);
      setTimeout(go, 2600);
    } else go();
  };

  const last = state?.last;
  const current = path.replace(/\/$/, '') || '/';
  const canThis = state?.pages?.includes(current);
  const pages = last?.pages || [];
  return (
    <>
      <div className="checkbar">
        <div className="seg">
          <button className={device === 'mobile' ? 'on' : ''} onClick={() => setDevice('mobile')} disabled={!!running}>
            <Smartphone size={13} /> Phone
          </button>
          <button className={device === 'desktop' ? 'on' : ''} onClick={() => setDevice('desktop')} disabled={!!running}>
            <Monitor size={13} /> Desktop
          </button>
        </div>
        <span className="sub" style={{ flex: 1 }}>
          {running ? (progress ? `Measuring ${progress.route} — page ${progress.done + 1} of ${progress.total}…` : 'Getting ready…') : last ? `Last run ${new Date(last.at).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} · ${last.device === 'desktop' ? 'desktop' : 'phone'}` : 'Measures the built site in a real browser: about 10–20 seconds a page.'}
        </span>
        {running ? (
          <button className="btn sm dark" onClick={() => api.post('/checks/lighthouse/stop')}>
            <Square size={11} fill="currentColor" /> Stop
          </button>
        ) : (
          <>
            {canThis && (
              <button className="btn sm" onClick={() => run([current])}>
                This page
              </button>
            )}
            <button className="btn sm" onClick={() => run()} title="Uses the site as it was last built">
              All pages
            </button>
            <button className="btn sm primary" onClick={rebuildAndRun}>
              Build, then all pages
            </button>
          </>
        )}
      </div>
      <div className="inv-list">
        {!last && !running && <div className="hint" style={{ padding: 30 }}>Lighthouse is Google’s page-quality test. It scores each page out of 100 for performance, accessibility, best practices and SEO, and lists what is costing points.</div>}
        {last && last.device !== device && !running && <div className="hint">These results are for {last.device === 'desktop' ? 'desktop' : 'phone'}. Run again to measure {device === 'desktop' ? 'desktop' : 'phone'}.</div>}
        {pages.map((p: any) => (
          <div key={p.route} className={'lhpage' + (open === p.route ? ' open' : '') + (p.stale ? ' stale' : '')}>
            <button className="lhrow" onClick={() => setOpen(open === p.route ? null : p.route)}>
              <span className="route">
                {p.route}
                {p.stale && <i>earlier run</i>}
              </span>
              {p.error ? <span className="sub" style={{ color: 'var(--err)' }}>{p.error}</span> : CATS.map(([id, label]) => <Score key={id} value={p.scores[id] ?? null} before={p.previous?.[id]} label={label} />)}
            </button>
            {open === p.route && !p.error && (
              <div className="lhbody">
                {p.metrics && (
                  <p className="sub" style={{ margin: '0 0 10px' }}>
                    First paint {p.metrics.fcp || '–'} · main content {p.metrics.lcp || '–'} · blocked {p.metrics.tbt || '–'} · layout shift {p.metrics.cls || '–'}
                  </p>
                )}
                {!p.findings.length && <p className="note" style={{ margin: 0 }}>Nothing is costing this page points.</p>}
                {p.findings.map((f: any) => (
                  <div className="lhfinding" key={f.id}>
                    <div>
                      <span className={'cat ' + f.category}>{f.categoryLabel}</span>
                      <b>{f.title}</b>
                      {f.value && <span className="sub"> · {f.value}</span>}
                    </div>
                    <span>{f.detail}</span>
                    {f.items.length > 0 && (
                      <div className="nodes">
                        {f.items.map((it: any, k: number) => (
                          <button key={k} title="Show this on the page" onClick={() => showNode(p.route, it)}>
                            <MousePointerClick size={11} /> {it.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="inv-legend" style={{ gridTemplateColumns: '1fr' }}>
        <span>Scores are for the built site served from this computer, on a simulated mid-range phone or a desktop. They move a few points between runs, and third-party embeds such as maps cost performance. Once the site is live, PageSpeed Insights runs the same test on the real address.</span>
      </div>
    </>
  );
}
