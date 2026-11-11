// The "prompt an LLM to do it for me" part: a small agent loop over the Claude API
// whose only powers are reading and writing files inside the open Astro project.
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '@anthropic-ai/sdk/lib/credentials';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_DIR = path.join(here, '..', '.astrolabe');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Best balance — recommended' },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', note: 'Most capable, slower and pricier' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Fast and inexpensive' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Fastest, for small tweaks' },
];
const DEFAULT_MODEL = 'claude-opus-5-5';

export function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  for (const k of Object.keys(next)) if (next[k] === null || next[k] === '') delete next[k];
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
// A login profile created by `ant auth login` (OAuth, no static key). The SDK
// picks it up by itself when no key is given; this only reports that it exists.
async function loginProfile() {
  try {
    const config = await loadConfig();
    return config?.authentication?.type ? config : null;
  } catch {
    return null;
  }
}
export async function publicSettings() {
  const s = loadSettings();
  const envKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const login = !s.apiKey && !envKey && !!(await loginProfile());
  return {
    model: s.model || DEFAULT_MODEL,
    effort: s.effort || 'medium',
    hasKey: !!s.apiKey || envKey || login,
    keySource: s.apiKey ? 'saved' : envKey ? 'environment' : login ? 'login' : null,
    keyHint: s.apiKey ? '••••' + s.apiKey.slice(-4) : null,
    models: MODELS,
    mock: !!process.env.ASTROLABE_MOCK_AI,
  };
}

const TOOLS = [
  {
    name: 'list_files',
    description: 'List the files in the Astro project (src/ and public/ by default). Call this first if you are unsure what exists.',
    input_schema: { type: 'object', properties: { dir: { type: 'string', description: 'Folder relative to the project root, e.g. "src/components". Defaults to the whole project.' } }, additionalProperties: false },
  },
  {
    name: 'read_file',
    description: 'Read a text file from the project. Paths are relative to the project root, e.g. "src/pages/index.astro".',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  },
  {
    name: 'write_file',
    description: 'Create a new file, or completely replace an existing one, with the given content. Prefer edit_file for small changes to existing files.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string', description: 'The complete file content.' } }, required: ['path', 'content'], additionalProperties: false },
  },
  {
    name: 'edit_file',
    description: 'Replace an exact string in an existing file. old_string must match the file exactly (including whitespace) and be unique unless replace_all is true.',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' }, replace_all: { type: 'boolean' } }, required: ['path', 'old_string', 'new_string'], additionalProperties: false },
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the project.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  },
].map((t) => ({ ...t, eager_input_streaming: true }));

const REQUIRED = Object.fromEntries(TOOLS.map((t) => [t.name, t.input_schema.required || []]));

function validate(name, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
  const schema = TOOLS.find((t) => t.name === name)?.input_schema;
  if (!schema) return `unknown tool ${name}`;
  for (const k of REQUIRED[name]) if (typeof input[k] !== 'string') return `"${k}" is required and must be a string`;
  for (const k of Object.keys(input)) if (!(k in schema.properties)) return `unexpected property "${k}"`;
  return null;
}

function systemPrompt(project) {
  return `You are the built-in assistant of Astrolabe, a visual editor for Astro websites. The person you are helping is often new to Astro and is looking at a live preview of their site next to this chat. They describe what they want; you make it happen by editing the project's files with your tools. The preview reloads by itself after every write, and each of your turns becomes a single undo step in the editor, so act directly rather than asking for permission.

## The project
- Astro site (static output) styled with Tailwind CSS v4. Project root: ${project.root}
- Pages live in src/pages (file-based routing: src/pages/about.astro -> /about). Layouts in src/layouts. Reusable blocks in src/components, grouped in folders by category. Images and other static files are in public/ and are referenced by absolute URL (public/media/a.png -> "/media/a.png").
- Content collections (Markdown with frontmatter) live in src/content/<collection>/ and are declared in src/content.config.ts.
- Design tokens are CSS variables in the stylesheet that contains "@theme" (usually src/styles/global.css). Semantic colour utilities built on them: bg-bg, bg-surface, text-fg, text-muted, border-line, and the brand scale brand-50 … brand-950 (bg-brand-600, text-brand-500 …). font-display is the heading typeface, font-sans the body typeface. Dark mode is the "dark" class on <html>; the semantic colours switch automatically, so prefer them over hard-coded greys.

## How to work
- Read a file before you change it. Use edit_file for targeted changes and write_file for new files or full rewrites.
- Match the conventions already in the project: Tailwind utility classes in the markup, no separate CSS files per component, the same spacing rhythm and tokens the neighbouring blocks use.
- Keep text content as literal text in the markup where you can (rather than hiding it in props or arrays) — the visual editor lets people double-click literal text to edit it. Repeated data-driven lists are fine when there are many items.
- To add a section to a page: create (or reuse) a component in src/components/<category>/, import it in the page's frontmatter, and place its tag where it belongs.
- Write real, specific copy that suits the site — never lorem ipsum. Make designs responsive (mobile first, then sm:/md:/lg:), accessible (alt text, labelled controls, sensible heading order), and good-looking in both light and dark mode.
- Do not add npm dependencies or client-side frameworks; plain Astro, HTML, Tailwind and small inline <script> tags only. Do not touch package.json, astro.config.*, or anything outside the project.
- If the person has an element selected, "this", "it" or "here" means that element.

## How to answer
Keep replies short and plain: one or two sentences saying what you changed and where, in everyday words, plus anything they should know (for example a placeholder they should replace). Explain an Astro concept briefly when it helps them understand what just happened. No code dumps unless they ask to see code. If a request is ambiguous in a way that matters, make the most reasonable choice and say what you chose.`;
}

function contextBlock(project, ctx) {
  const s = project.state();
  const lines = [];
  lines.push('<editor_state>');
  lines.push(`Pages: ${s.pages.map((p) => `${p.route} (${p.file})`).join(', ') || 'none'}`);
  lines.push(`Layouts: ${s.layouts.map((c) => c.file).join(', ') || 'none'}`);
  lines.push(`Components: ${s.components.map((c) => c.file.replace('src/components/', '')).join(', ') || 'none'}`);
  if (s.collections.length) lines.push(`Content collections: ${s.collections.map((c) => `${c.name} (${c.entries.length} entries in ${c.dir})`).join(', ')}`);
  if (s.media.length) lines.push(`Media: ${s.media.filter((m) => m.image).slice(0, 60).map((m) => m.url).join(', ')}`);
  if (s.theme.file) lines.push(`Theme tokens file: ${s.theme.file}`);
  if (ctx?.pageFile) lines.push(`The person is currently viewing: ${ctx.route || ''} (${ctx.pageFile})`);
  if (ctx?.selection) {
    lines.push(`Selected element: <${ctx.selection.name}> in ${ctx.selection.file}, line ${ctx.selection.line}`);
    if (ctx.selection.source) lines.push('Its source:\n```astro\n' + String(ctx.selection.source).slice(0, 4000) + '\n```');
  } else lines.push('Nothing is selected.');
  lines.push('</editor_state>');
  return lines.join('\n');
}

export class Assistant {
  constructor(project) {
    this.project = project;
    this.messages = [];
    this.running = null;
  }
  reset() {
    this.messages = [];
  }
  abort() {
    this.running?.abort();
  }

  runTool(name, input, changed) {
    const p = this.project;
    const bad = validate(name, input);
    if (bad) return { error: JSON.stringify({ INVALID_JSON: JSON.stringify(input), problem: bad }) };
    try {
      switch (name) {
        case 'list_files': {
          const dirs = input.dir ? [input.dir.replace(/\/+$/, '')] : ['src', 'public'];
          const files = dirs.flatMap((d) => {
            p.abs(d);
            return p.walk(d);
          });
          const extra = input.dir ? [] : ['astro.config.mjs', 'package.json', 'tsconfig.json'].filter((f) => p.exists(f));
          return { text: [...extra, ...files].join('\n') || '(no files)', summary: `${files.length} files` };
        }
        case 'read_file': {
          if (!p.exists(input.path)) return { error: `File not found: ${input.path}` };
          if (/\.(png|jpe?g|gif|webp|avif|ico|woff2?|mp4|webm|pdf)$/i.test(input.path)) return { error: 'That is a binary file; it cannot be read as text.' };
          const text = p.read(input.path);
          return { text, summary: `${text.split('\n').length} lines` };
        }
        case 'write_file': {
          const existed = p.exists(input.path);
          p.write(input.path, input.content);
          changed.add(input.path);
          return { text: `${existed ? 'Replaced' : 'Created'} ${input.path}`, summary: existed ? 'replaced' : 'created' };
        }
        case 'edit_file': {
          if (!p.exists(input.path)) return { error: `File not found: ${input.path}` };
          const src = p.read(input.path);
          const count = src.split(input.old_string).length - 1;
          if (!input.old_string) return { error: 'old_string must not be empty.' };
          if (count === 0) return { error: 'old_string was not found in the file. Read the file again and match it exactly.' };
          if (count > 1 && !input.replace_all) return { error: `old_string appears ${count} times. Include more surrounding context to make it unique, or set replace_all.` };
          p.write(input.path, input.replace_all ? src.split(input.old_string).join(input.new_string) : src.replace(input.old_string, () => input.new_string));
          changed.add(input.path);
          return { text: `Edited ${input.path}`, summary: 'edited' };
        }
        case 'delete_file': {
          if (!p.exists(input.path)) return { error: `File not found: ${input.path}` };
          p.remove(input.path);
          changed.add(input.path);
          return { text: `Deleted ${input.path}`, summary: 'deleted' };
        }
      }
    } catch (e) {
      return { error: e.message };
    }
    return { error: `Unknown tool ${name}` };
  }

  /** Runs one user turn. `send` receives UI events. */
  async chat({ prompt, context }, send) {
    if (this.running) throw new Error('The assistant is already working on something.');
    const settings = loadSettings();
    const controller = new AbortController();
    this.running = controller;
    const changed = new Set();
    const userText = `${contextBlock(this.project, context)}\n\n${prompt}`;
    const startLen = this.messages.length;
    this.messages.push({ role: 'user', content: userText });
    const label = 'AI: ' + (prompt.length > 48 ? prompt.slice(0, 48) + '…' : prompt);

    try {
      await this.project.transaction(label, async () => {
        if (process.env.ASTROLABE_MOCK_AI) return this.mock(prompt, context, send, changed);
        // Without a saved key the SDK resolves credentials itself: ANTHROPIC_API_KEY,
        // ANTHROPIC_AUTH_TOKEN, then the `ant auth login` OAuth profile.
        const client = new Anthropic(settings.apiKey ? { apiKey: settings.apiKey } : {});
        const model = settings.model || DEFAULT_MODEL;
        let useFallbacks = !/haiku/.test(model);
        let jsonRetries = 0;

        for (let turn = 0; turn < 40; turn++) {
          const base = {
            model,
            max_tokens: 64000,
            system: systemPrompt(this.project),
            cache_control: { type: 'ephemeral' },
            thinking: { type: 'adaptive', display: 'summarized' },
            output_config: { effort: settings.effort || 'medium' },
            tools: TOOLS,
            messages: this.messages,
          };
          // Server-side refusal fallbacks are on by default; if this account or
          // model rejects the beta, quietly continue without it.
          const stream = useFallbacks
            ? client.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: controller.signal })
            : client.messages.stream(base, { signal: controller.signal });

          let message;
          try {
            for await (const event of stream) {
              if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') send({ type: 'tool', id: event.content_block.id, name: event.content_block.name, status: 'writing' });
              else if (event.type === 'content_block_delta') {
                if (event.delta.type === 'text_delta') send({ type: 'text', delta: event.delta.text });
                else if (event.delta.type === 'thinking_delta') send({ type: 'thinking', delta: event.delta.thinking });
              }
            }
            message = await stream.finalMessage();
            jsonRetries = 0;
          } catch (err) {
            if (useFallbacks && err instanceof Anthropic.BadRequestError && turn === 0) {
              useFallbacks = false;
              turn--;
              continue;
            }
            if (err instanceof Anthropic.APIError || controller.signal.aborted || jsonRetries++ >= 2) throw err;
            continue; // a tool input was not parseable JSON — re-issue the turn
          }

          if (message.stop_reason === 'refusal') {
            send({ type: 'text', delta: "\n\nI can't help with that request." });
            break;
          }
          this.messages.push({ role: 'assistant', content: message.content });
          if (message.stop_reason === 'pause_turn') continue;

          const calls = message.content.filter((b) => b.type === 'tool_use');
          if (!calls.length) break;
          if (message.stop_reason === 'max_tokens') {
            this.messages.push({ role: 'user', content: calls.map((c) => ({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: 'Your output was cut off before this tool call was complete, so it was not run. Split the work into smaller writes.' })) });
            continue;
          }

          const results = [];
          for (const call of calls) {
            const r = this.runTool(call.name, call.input, changed);
            send({ type: 'tool', id: call.id, name: call.name, path: call.input?.path || call.input?.dir || '', status: r.error ? 'error' : 'done', summary: r.error || r.summary });
            results.push({ type: 'tool_result', tool_use_id: call.id, content: r.error || r.text, ...(r.error ? { is_error: true } : {}) });
          }
          this.messages.push({ role: 'user', content: results });
        }
      });
      send({ type: 'done', changed: [...changed] });
    } catch (err) {
      // Drop the unfinished turn so the conversation stays valid for the next prompt.
      const last = this.messages.at(-1);
      if (controller.signal.aborted) {
        if (last?.role === 'assistant' && Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_use')) this.messages.pop();
        if (this.messages.at(-1)?.role === 'user') this.messages.push({ role: 'assistant', content: '(stopped by the user)' });
        send({ type: 'done', changed: [...changed], stopped: true });
      } else {
        this.messages.length = startLen;
        let message = err?.message || String(err);
        let code = 'error';
        if (err instanceof Anthropic.AuthenticationError || /api[_ ]key|authentication|credentials/i.test(message)) {
          code = 'auth';
          message = 'Not signed in to the Claude API. Run `ant auth login` in a terminal (again, if your login has expired), or add an API key in Settings.';
        } else if (err instanceof Anthropic.PermissionDeniedError) message = `Your account isn't allowed to use this model. Pick another model in Settings. (${err.message})`;
        else if (err instanceof Anthropic.NotFoundError) message = `That model isn't available to your account. Pick another model in Settings.`;
        else if (err instanceof Anthropic.RateLimitError) message = 'Rate limited by the Claude API — wait a moment and try again.';
        else if (err instanceof Anthropic.APIConnectionError) message = "Couldn't reach the Claude API. Check your internet connection.";
        else if (err instanceof Anthropic.APIError) message = `Claude API error ${err.status ?? ''}: ${err.message}`;
        send({ type: 'error', code, message, changed: [...changed] });
      }
    } finally {
      this.running = null;
    }
  }

  // Offline stand-in used for UI development (ASTROLABE_MOCK_AI=1). Exercises the same tools.
  async mock(prompt, context, send, changed) {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const say = async (text) => {
      for (const w of text.split(/(?<= )/)) {
        send({ type: 'text', delta: w });
        await wait(18);
      }
    };
    send({ type: 'thinking', delta: 'Looking at the page the user has open…' });
    await wait(300);
    const file = context?.pageFile || 'src/pages/index.astro';
    send({ type: 'tool', id: 'm1', name: 'read_file', status: 'writing' });
    const r = this.runTool('read_file', { path: file }, changed);
    await wait(250);
    send({ type: 'tool', id: 'm1', name: 'read_file', path: file, status: r.error ? 'error' : 'done', summary: r.error || r.summary });
    const m = /<h1([^>]*)>([^<{]+)<\/h1>/.exec(r.text || '');
    if (m) {
      send({ type: 'tool', id: 'm2', name: 'edit_file', status: 'writing' });
      await wait(300);
      const e = this.runTool('edit_file', { path: file, old_string: m[0], new_string: `<h1${m[1]}>${m[2].trim()} ✦</h1>` }, changed);
      send({ type: 'tool', id: 'm2', name: 'edit_file', path: file, status: e.error ? 'error' : 'done', summary: e.error || e.summary });
    }
    await say(`(Mock assistant — no API key is being used.) You asked: “${prompt}”. I read ${file}${m ? ' and added a ✦ to its main heading so you can see an edit land. Use undo to revert it.' : '.'}`);
    this.messages.push({ role: 'assistant', content: 'mock reply' });
  }
}
