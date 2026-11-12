// Small shared controls.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, X } from 'lucide-react';

/** A floating panel anchored to an element; closes on outside click / Escape. */
export function Popover({ anchor, onClose, children, align = 'left', className = '' }: { anchor: HTMLElement | { x: number; y: number } | null; onClose: () => void; children: ReactNode; align?: 'left' | 'right'; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const el = ref.current;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect();
      left = align === 'right' ? r.right - w : r.left;
      top = r.bottom + 6;
      if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 6);
    } else {
      left = anchor.x;
      top = anchor.y;
      if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
    }
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    setPos({ left, top });
  }, [anchor, align]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const blur = () => onClose();
    setTimeout(() => window.addEventListener('mousedown', down), 0);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', blur);
    };
  }, [onClose]);
  if (!anchor) return null;
  return createPortal(
    <div ref={ref} className={'popover fixed ' + className} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

export function Menu({ anchor, onClose, items, align }: { anchor: any; onClose: () => void; align?: 'left' | 'right'; items: (null | { label: string; icon?: ReactNode; k?: string; danger?: boolean; onClick: () => void; hidden?: boolean } | { heading: string })[] }) {
  return (
    <Popover anchor={anchor} onClose={onClose} align={align}>
      {items.map((it, i) =>
        it === null ? (
          <div key={i} className="menu-sep" />
        ) : 'heading' in it ? (
          <div key={i} className="menu-label">{it.heading}</div>
        ) : it.hidden ? null : (
          <button
            key={i}
            className={'menu-item' + (it.danger ? ' danger' : '')}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            {it.icon}
            <span>{it.label}</span>
            {it.k && <span className="k">{it.k}</span>}
          </button>
        ),
      )}
    </Popover>
  );
}

export function Dropdown({ label, small, options, value, onChange, tip }: { label?: ReactNode; small?: ReactNode; tip?: string; value: any; options: { value: any; label: string; hint?: string }[]; onChange: (v: any) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const cur = options.find((o) => o.value === value);
  return (
    <>
      <button className={'pill' + (tip ? ' tip down' : '')} data-tip={tip} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        {label ?? cur?.label} {small ?? (cur?.hint && <small>{cur.hint}</small>)}
        <ChevronRight size={13} style={{ transform: 'rotate(90deg)' }} />
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)}>
          {options.map((o) => (
            <button
              key={String(o.value)}
              className="menu-item"
              onClick={() => {
                setAnchor(null);
                onChange(o.value);
              }}
            >
              <span style={{ fontWeight: o.value === value ? 650 : 400 }}>{o.label}</span>
              {o.hint && <span className="k">{o.hint}</span>}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}

export function Group({ title, children, defaultOpen = true, action, id }: { title: string; children: ReactNode; defaultOpen?: boolean; action?: ReactNode; id?: string }) {
  const key = 'astronut:group:' + (id || title);
  const [open, setOpen] = useState(() => {
    const v = localStorage.getItem(key);
    return v == null ? defaultOpen : v === '1';
  });
  return (
    <div className={'group' + (open ? ' open' : '')}>
      <button
        className="group-head"
        onClick={() => {
          localStorage.setItem(key, open ? '0' : '1');
          setOpen(!open);
        }}
      >
        <span>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {action}
          <ChevronRight size={15} />
        </span>
      </button>
      {open && <div className="group-body">{children}</div>}
    </div>
  );
}

/** Text input that commits on Enter / blur and resets when the outside value changes. */
export function TextField({ value, onCommit, placeholder, pre, suf, set, mono, title, list }: { value: string; onCommit: (v: string) => void; placeholder?: string; pre?: ReactNode; suf?: ReactNode; set?: boolean; mono?: boolean; title?: string; list?: string }) {
  const [v, setV] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  return (
    <div className={'inp' + (set ?? !!value ? ' set' : '')} title={title}>
      {pre != null && <span className="pre">{pre}</span>}
      <input
        ref={ref}
        list={list}
        value={v}
        placeholder={placeholder}
        spellCheck={false}
        style={mono ? { fontFamily: 'var(--mono)', fontSize: 11.5 } : undefined}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).select();
          } else if (e.key === 'Escape') {
            setV(value);
            ref.current?.blur();
          } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && /^-?[\d.]+$/.test(v.trim())) {
            e.preventDefault();
            const step = (e.shiftKey ? 8 : e.altKey ? 1 : 4) * (e.key === 'ArrowUp' ? 1 : -1);
            const nv = String(Math.round((parseFloat(v) + step) * 100) / 100);
            setV(nv);
            onCommit(nv);
          }
          e.stopPropagation();
        }}
      />
      {suf != null && <span className="suf">{suf}</span>}
    </div>
  );
}

export function SelectField({ value, options, onChange, pre, placeholder }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; pre?: ReactNode; placeholder?: string }) {
  return (
    <div className={'inp' + (value ? ' set' : '')}>
      {pre != null && <span className="pre">{pre}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder ?? '—'}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronRight size={12} style={{ transform: 'rotate(90deg)', color: 'var(--muted)', flex: 'none' }} />
    </div>
  );
}

export function Seg({ value, options, onChange, full = true }: { value: string; options: { value: string; label?: string; icon?: ReactNode; tip?: string }[]; onChange: (v: string) => void; full?: boolean }) {
  return (
    <div className={'seg' + (full ? ' full' : '')}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} title={o.tip || o.label} onClick={() => onChange(o.value === value ? '' : o.value)}>
          {o.icon}
          {o.label && !o.icon ? o.label : null}
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide, className = '' }: { title?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; className?: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal ' + (wide ? 'wide ' : '') + className}>
        {title && (
          <div className="modal-head">
            <span className="grow" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{title}</span>
            <button className="icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        )}
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <span className={'switch' + (on ? ' on' : '')} onClick={() => onChange(!on)}>
      <i />
      {label}
    </span>
  );
}
