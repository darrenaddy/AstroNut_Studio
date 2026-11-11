// CodeMirror wrapper used for the source tab, the file editor and Markdown.
import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

const langFor = (name: string) => {
  if (/\.(md|mdx)$/.test(name)) return markdown();
  if (/\.css$/.test(name)) return css();
  if (/\.(m?[jt]sx?|json)$/.test(name)) return javascript({ typescript: /\.tsx?$/.test(name), jsx: /x$/.test(name) });
  return html({ selfClosingTags: true });
};

const lightTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--raised)', color: 'var(--fg)' },
  '.cm-gutters': { backgroundColor: 'var(--raised)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--fg) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg)' },
});

export function Code({ value, onChange, filename = 'x.astro', onSave, minimal, dark, wrap = true, autoFocus }: { value: string; onChange: (v: string) => void; filename?: string; onSave?: () => void; minimal?: boolean; dark: boolean; wrap?: boolean; autoFocus?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };
  const themeC = useRef(new Compartment());

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          minimal ? [] : basicSetup,
          minimal ? [EditorView.lineWrapping, basicSetup] : [],
          langFor(filename),
          wrap ? EditorView.lineWrapping : [],
          keymap.of([
            indentWithTab,
            {
              key: 'Mod-s',
              run: () => {
                cb.current.onSave?.();
                return true;
              },
            },
          ]),
          themeC.current.of(dark ? oneDark : lightTheme),
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange(u.state.doc.toString())),
          EditorView.domEventHandlers({ keydown: (e) => void e.stopPropagation() }),
        ],
      }),
    });
    view.current = v;
    if (autoFocus) v.focus();
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename, minimal]);

  useEffect(() => {
    const v = view.current;
    if (v && value !== v.state.doc.toString()) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({ effects: themeC.current.reconfigure(dark ? oneDark : lightTheme) });
  }, [dark]);

  return <div ref={host} style={{ height: '100%' }} />;
}
