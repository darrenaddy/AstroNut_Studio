// Helpers shared by the Markdown and visual views of a post.
import { marked } from 'marked';

// ---- paths ------------------------------------------------------------------

/** How a post refers to a media file. Photos in src/ are written relative to the post, which is what lets Astro optimise them. */
export function srcForMedia(postFile: string, m: { file: string; url: string }) {
  if (!m.file.startsWith('src/')) return m.url.replace(/ /g, '%20');
  const from = postFile.split('/').slice(0, -1);
  const to = m.file.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.length - i;
  return (up ? '../'.repeat(up) : './') + to.slice(i).join('/');
}

/** Where the editor can load an image a post refers to. */
export function previewUrl(postFile: string, src: string, devUrl: string) {
  if (!src || /^(https?:|data:|blob:)/.test(src)) return src;
  if (src.startsWith('/')) return devUrl + src;
  const parts = postFile.split('/').slice(0, -1);
  for (const seg of src.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return devUrl + '/' + parts.join('/');
}

// ---- safety -----------------------------------------------------------------

/** A reason this post should stay in Markdown view, or null if the visual editor can show it faithfully. */
export function visualBlocker(file: string, body: string): string | null {
  const text = body.replace(/^(`{3,}|~{3,})[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
  if (file.endsWith('.mdx') && /^(import|export)\s/m.test(text)) return 'it uses components';
  if (/<\/?[A-Za-z][^>\n]*>|<!--/.test(text)) return 'it contains HTML or components';
  if (/[{}]/.test(text)) return 'it contains code in curly braces';
  if (/\[\^[^\]\n]+\]/.test(text)) return 'it has footnotes';
  return null;
}

const rendered = (md: string) => (marked.parse(md || '', { async: false }) as string).replace(/\s+/g, ' ').trim();
/** True when two pieces of Markdown produce the same page. */
export const sameResult = (a: string, b: string) => rendered(a) === rendered(b);

/** Empty paragraphs in the editor (pressing Enter twice) would pile up blank lines in the file; keep one between blocks. */
export function tidyMarkdown(md: string) {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of md.split('\n')) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f && !fence) fence = f[1];
    else if (f && fence && f[1].startsWith(fence)) fence = null;
    else if (!fence && !line.trim() && (!out.length || !out[out.length - 1].trim())) continue;
    out.push(line);
  }
  return out.join('\n');
}
