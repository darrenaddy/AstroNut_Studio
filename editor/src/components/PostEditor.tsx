// Visual editor for the body of a post. The file on disk stays plain Markdown: this is a view over it,
// built on the open-source MDXEditor.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  CodeMirrorEditor,
  UndoRedo,
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  StrikeThroughSupSubToggles,
  CodeToggle,
  ListsToggle,
  CreateLink,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  InsertCodeBlock,
  Separator,
  imageDialogState$,
  saveImage$,
  closeImageDialog$,
  openNewImageDialog$,
  activeEditor$,
  $createImageNode,
  useCellValue,
  usePublisher,
} from '@mdxeditor/editor';
import { $createParagraphNode } from 'lexical';
import { $insertNodeToNearestRoot } from '@lexical/utils';
import '@mdxeditor/editor/style.css';
import { act } from '../store';
import { api } from '../api';
import { Modal } from './ui';
import { Media } from './LeftPanel';
import { previewUrl, sameResult, srcForMedia, tidyMarkdown } from './postPaths';

// ---- image dialog -------------------------------------------------------------

type Ctx = { file: string; devUrl: string; pending: { src: string } | null; open: () => void };

function ImageModal({ ctx, initial, editing, onSave, onClose }: { ctx: Ctx; initial?: { src?: string; altText?: string }; editing: boolean; onSave: (v: { src: string; altText: string }) => void; onClose: () => void }) {
  const [src, setSrc] = useState(initial?.src || '');
  const [alt, setAlt] = useState(initial?.altText || '');
  const ok = !!src && !!alt.trim();
  const save = () => ok && onSave({ src, altText: alt.trim() });
  return (
    <Modal
      title={editing ? 'Edit image' : 'Add an image'}
      onClose={onClose}
      footer={
        src ? (
          <>
            <button className="btn ghost" onClick={() => setSrc('')}>
              Choose a different image
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={!ok} onClick={save}>
              {editing ? 'Save' : 'Add to post'}
            </button>
          </>
        ) : undefined
      }
    >
      {!src ? (
        <div style={{ overflowY: 'auto', paddingBottom: 10 }}>
          <Media onPick={(m) => setSrc(srcForMedia(ctx.file, m))} />
        </div>
      ) : (
        <div className="modal-body">
          <img src={previewUrl(ctx.file, src, ctx.devUrl)} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--hover)' }} />
          <div className="field">
            <label>Description</label>
            <div className="inp">
              <input
                autoFocus
                value={alt}
                placeholder="What the picture shows, in a few words"
                onChange={(e) => setAlt(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') save();
                  if (e.key === 'Escape') onClose();
                }}
              />
            </div>
            <p className="note" style={{ margin: 0 }}>
              Read aloud to people who can’t see the picture, and shown if it fails to load.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---- editor -------------------------------------------------------------------

const LANGUAGES = { '': 'Plain text', js: 'JavaScript', ts: 'TypeScript', jsx: 'JSX', tsx: 'TSX', html: 'HTML', css: 'CSS', json: 'JSON', astro: 'Astro', md: 'Markdown', bash: 'Shell', sh: 'Shell', python: 'Python', yaml: 'YAML' };

export default function PostEditor({ file, body, devUrl, onChange, onFallback }: { file: string; body: string; devUrl: string; onChange: (body: string) => void; onFallback: (reason: string) => void }) {
  const ref = useRef<MDXEditorMethods>(null);
  const ctx = useRef<Ctx>({ file, devUrl, pending: null, open: () => {} }).current;
  ctx.file = file;
  ctx.devUrl = devUrl;
  const failed = useRef(false);
  const fail = (reason: string) => {
    if (failed.current) return;
    failed.current = true;
    onFallback(reason);
  };

  // Opening a post must never change it. If the editor's own rendering of the Markdown would read
  // differently from the file, hand the post back to the Markdown view untouched.
  useEffect(() => {
    const t = setTimeout(() => {
      const md = ref.current?.getMarkdown();
      if (md != null && !sameResult(md, body)) fail('the visual editor would change how it reads');
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plugins = useMemo(() => {
    const ImageDialog = () => {
      const state = useCellValue(imageDialogState$);
      const save = usePublisher(saveImage$);
      const close = usePublisher(closeImageDialog$);
      const editor = useCellValue(activeEditor$);
      if (state.type === 'inactive') return <></>;
      const editing = state.type === 'editing';
      const initial = editing ? state.initialValues : ctx.pending || undefined;
      const done = () => {
        ctx.pending = null;
        close();
      };
      return (
        <ImageModal
          ctx={ctx}
          editing={editing}
          initial={initial}
          onClose={done}
          onSave={(v) => {
            if (editing) save({ ...state.initialValues, src: v.src, altText: v.altText, title: state.initialValues.title || '' });
            else
              // A new picture goes in as its own paragraph, not squeezed onto the end of the line the cursor was on.
              editor?.update(() => {
                const p = $createParagraphNode();
                p.append($createImageNode({ src: v.src, altText: v.altText, title: '' }));
                $insertNodeToNearestRoot(p);
              });
            done();
          }}
        />
      );
    };
    const Toolbar = () => {
      ctx.open = usePublisher(openNewImageDialog$);
      return (
        <>
          <UndoRedo />
          <Separator />
          <BlockTypeSelect />
          <Separator />
          <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
          <StrikeThroughSupSubToggles options={['Strikethrough']} />
          <CodeToggle />
          <Separator />
          <ListsToggle options={['bullet', 'number']} />
          <Separator />
          <CreateLink />
          <InsertImage />
          <InsertTable />
          <InsertThematicBreak />
          <InsertCodeBlock />
        </>
      );
    };
    return [
      headingsPlugin({ allowedHeadingLevels: [2, 3, 4] }),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      imagePlugin({
        ImageDialog,
        disableImageResize: true,
        imagePreviewHandler: async (src) => previewUrl(ctx.file, src, ctx.devUrl),
        imageUploadHandler: async (f) => srcForMedia(ctx.file, await api.upload(f)),
      }),
      codeBlockPlugin({ defaultCodeBlockLanguage: '', codeBlockEditorDescriptors: [{ priority: -10, match: () => true, Editor: CodeMirrorEditor }] }),
      codeMirrorPlugin({ codeBlockLanguages: LANGUAGES }),
      markdownShortcutPlugin(),
      toolbarPlugin({ toolbarContents: Toolbar }),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A pasted or dropped picture is uploaded, then described, like one added from the toolbar.
  const takeFiles = (e: React.ClipboardEvent | React.DragEvent, list: FileList | undefined | null) => {
    const img = Array.from(list || []).find((f) => f.type.startsWith('image/'));
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    api
      .upload(img)
      .then((m) => {
        act().load();
        ctx.pending = { src: srcForMedia(ctx.file, m) };
        ctx.open();
      })
      .catch(act().fail);
  };

  return (
    <div className="post-editor-wrap" onKeyDown={(e) => e.stopPropagation()} onPasteCapture={(e) => takeFiles(e, e.clipboardData?.files)} onDropCapture={(e) => takeFiles(e, e.dataTransfer?.files)}>
      <MDXEditor
        ref={ref}
        className="post-editor"
        contentEditableClassName="post-prose"
        markdown={body}
        plugins={plugins}
        toMarkdownOptions={{ bullet: '-', emphasis: '*', rule: '-', listItemIndent: 'one' }}
        onChange={(md, initial) => !initial && !failed.current && onChange(tidyMarkdown(md))}
        onError={() => fail('it contains something the visual editor can’t read')}
      />
    </div>
  );
}
