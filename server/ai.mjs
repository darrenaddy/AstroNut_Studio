// The "prompt an LLM to do it for me" part: a small agent loop over the Claude API
// whose only powers are reading and writing files inside the open Astro project.
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '@anthropic-ai/sdk/lib/credentials';
import fs from 'node:fs';
import { ChatGPTAuth, AuthError, API_BASE as OPENAI_API_BASE } from './chatgpt.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_DIR = process.env.ASTRONUT_HOME || path.join(here, '..', '.astronut');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');
// The app has been renamed twice (Astrolabe, then Astrophile Studio): carry saved settings and sign-ins over once.
if (!process.env.ASTRONUT_HOME && !fs.existsSync(SETTINGS_DIR)) {
  for (const old of ['.astro' + 'phile', '.astro' + 'labe']) {
    const dir = path.join(here, '..', old);
    if (!fs.existsSync(dir)) continue;
    try {
      fs.renameSync(dir, SETTINGS_DIR);
    } catch {}
    break;
  }
}
export const chatgpt = new ChatGPTAuth(SETTINGS_DIR);

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
// ---- providers ---------------------------------------------------------------
// Claude is built in. Everything else is reached through the OpenAI-compatible
// "chat completions" protocol, which local runtimes (Ollama, LM Studio) and most
// hosted services speak — so one adapter covers them all.
export const PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic)', kind: 'anthropic' },
  { id: 'chatgpt', label: 'ChatGPT plan (sign in)', kind: 'responses' },
  { id: 'ollama', label: 'Ollama (this Mac)', kind: 'openai', local: true, baseUrl: 'http://localhost:11434/v1' },
  { id: 'lmstudio', label: 'LM Studio (this Mac)', kind: 'openai', local: true, baseUrl: 'http://localhost:1234/v1' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', env: 'OPENROUTER_API_KEY' },
  { id: 'custom', label: 'Custom endpoint', kind: 'openai', baseUrl: '' },
];

/** A provider preset merged with what the user saved for it. */
function providerConfig(id, settings = loadSettings()) {
  const preset = PROVIDERS.find((p) => p.id === id);
  if (!preset) return null;
  const saved = settings.providers?.[id] || {};
  const baseUrl = String(saved.baseUrl || preset.baseUrl || '').replace(/\/+$/, '');
  const apiKey = saved.apiKey || (preset.env && process.env[preset.env]) || '';
  if (preset.kind === 'responses') return { ...preset, baseUrl: OPENAI_API_BASE, apiKey: '', enabled: chatgpt.status().sharing };
  return { ...preset, baseUrl, apiKey, enabled: preset.kind === 'anthropic' || (!!baseUrl && (preset.local || !!apiKey || id === 'custom')) };
}

/** The model in use: { provider, id }. Older settings stored a bare Claude model name. */
function currentModel(settings = loadSettings()) {
  const m = settings.model;
  if (m && typeof m === 'object' && m.provider && m.id && PROVIDERS.some((p) => p.id === m.provider)) return { provider: m.provider, id: m.id };
  return { provider: 'anthropic', id: typeof m === 'string' && m ? m : DEFAULT_MODEL };
}

let modelCache = { at: 0, value: null };
/** Every model that can be picked right now, across all providers. */
export async function listModels(force = false) {
  if (!force && modelCache.value && Date.now() - modelCache.at < 8000) return modelCache.value;
  const settings = loadSettings();
  const auth = await anthropicAuth(settings);
  const models = MODELS.map((m) => ({ provider: 'anthropic', id: m.id, label: m.label, note: m.note }));
  const providers = [{ id: 'anthropic', label: 'Claude (Anthropic)', status: auth.source ? 'ready' : 'needs sign-in', count: MODELS.length }];
  const gpt = chatgpt.status();
  const gptRow = { id: 'chatgpt', label: 'ChatGPT plan (sign in)', signIn: true, ...gpt, status: !gpt.signedIn ? 'not signed in' : !gpt.sharing ? 'plan usage not granted' : 'ready', count: 0 };
  providers.push(gptRow);
  await Promise.all([
    (async () => {
      if (!gpt.sharing) return;
      try {
        const list = await chatgpt.models();
        for (const m of list) models.push({ provider: 'chatgpt', id: m.id, label: m.label, note: 'ChatGPT plan' });
        gptRow.count = list.length;
        if (!list.length) gptRow.status = 'no models available';
      } catch (e) {
        gptRow.status = e instanceof AuthError ? 'sign in again' : 'unreachable';
      }
    })(),
    ...PROVIDERS.filter((p) => p.kind === 'openai').map(async (preset) => {
      const cfg = providerConfig(preset.id, settings);
      const row = { id: cfg.id, label: cfg.label, local: !!cfg.local, baseUrl: cfg.baseUrl, hasKey: !!cfg.apiKey, keyHint: settings.providers?.[cfg.id]?.apiKey ? '••••' + cfg.apiKey.slice(-4) : cfg.apiKey ? 'from environment' : null, status: 'not set up', count: 0 };
      providers.push(row);
      if (!cfg.enabled) return;
      try {
        const res = await fetch(cfg.baseUrl + '/models', { headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}, signal: AbortSignal.timeout(cfg.local ? 1200 : 6000) });
        if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'key rejected' : `error ${res.status}`);
        const data = await res.json();
        const ids = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
        for (const id of ids) models.push({ provider: cfg.id, id, label: id, note: cfg.label });
        row.status = ids.length ? 'ready' : 'no models installed';
        row.count = ids.length;
      } catch (e) {
        row.status = cfg.local ? 'not running' : /key rejected|error \d+/.test(e.message) ? e.message : 'unreachable';
      }
    }),
  ]);
  providers.sort((x, y) => PROVIDERS.findIndex((p) => p.id === x.id) - PROVIDERS.findIndex((p) => p.id === y.id));
  modelCache = { at: Date.now(), value: { models, providers, current: currentModel(settings) } };
  return modelCache.value;
}

/** Merge provider connection details ({ id: { baseUrl, apiKey } }) into the saved settings. */
export function saveProviders(patch) {
  const settings = loadSettings();
  const providers = { ...(settings.providers || {}) };
  for (const [id, cfg] of Object.entries(patch || {})) {
    if (!PROVIDERS.some((p) => p.id === id && p.kind === 'openai')) continue;
    const next = { ...(providers[id] || {}) };
    for (const k of ['baseUrl', 'apiKey']) {
      if (!(k in cfg)) continue;
      const v = typeof cfg[k] === 'string' ? cfg[k].trim() : '';
      if (v) next[k] = v;
      else delete next[k];
    }
    if (Object.keys(next).length) providers[id] = next;
    else delete providers[id];
  }
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...settings, providers }, null, 2), { mode: 0o600 });
  modelCache.at = 0;
}

/** Switch model. Accepts { provider, id }. */
export const invalidateModels = () => {
  modelCache.at = 0;
};

export function setModel(model) {
  if (!model?.provider || !model?.id || !PROVIDERS.some((p) => p.id === model.provider)) throw new Error('Unknown model.');
  saveSettings({ model: { provider: model.provider, id: String(model.id) } });
  modelCache.at = 0;
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
async function anthropicAuth(s = loadSettings()) {
  const envKey = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const login = !s.apiKey && !envKey && !!(await loginProfile());
  return { source: s.apiKey ? 'saved' : envKey ? 'environment' : login ? 'login' : null };
}
export async function publicSettings() {
  const s = loadSettings();
  const auth = await anthropicAuth(s);
  const cur = currentModel(s);
  const cfg = providerConfig(cur.provider, s);
  const known = MODELS.find((m) => cur.provider === 'anthropic' && m.id === cur.id);
  return {
    provider: cur.provider,
    providerLabel: cfg.label,
    model: cur.id,
    modelLabel: known ? known.label : cur.id,
    local: !!cfg.local,
    effort: s.effort || 'medium',
    // "hasKey" = the selected provider has what it needs to be called
    hasKey: cur.provider === 'anthropic' ? !!auth.source : cfg.enabled,
    keySource: auth.source,
    keyHint: s.apiKey ? '••••' + s.apiKey.slice(-4) : null,
    models: MODELS,
    mock: !!process.env.ASTRONUT_MOCK_AI,
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
  return `You are the built-in assistant of AstroNut Studio, a visual editor for Astro websites. The person you are helping is often new to Astro and is looking at a live preview of their site next to this chat. They describe what they want; you make it happen by editing the project's files with your tools. The preview reloads by itself after every write, and each of your turns becomes a single undo step in the editor, so act directly rather than asking for permission.

## The project
- Astro site (static output) styled with Tailwind CSS v4. Project root: ${project.root}
- Pages live in src/pages (file-based routing: src/pages/about.astro -> /about). Layouts in src/layouts. Reusable blocks in src/components, grouped in folders by category. Images and other static files are in public/ and are referenced by absolute URL (public/media/a.png -> "/media/a.png").
- Content collections (Markdown with frontmatter) live in src/content/<collection>/ and are declared in src/content.config.ts.
- Design tokens are CSS variables in the stylesheet that contains "@theme" (usually src/styles/global.css). Semantic colour utilities built on them: bg-bg, bg-surface, text-fg, text-muted, border-line, and the brand scale brand-50 … brand-950 (bg-brand-600, text-brand-500 …). font-display is the heading typeface, font-sans the body typeface; the fonts themselves are declared under "fonts" in astro.config.mjs with the CSS variables --font-heading, --font-body and --font-code (Astro downloads and self-hosts them) — changing a font there is the one reason to edit astro.config. Dark mode is the "dark" class on <html>; the semantic colours switch automatically, so prefer them over hard-coded greys.

## How to work
- Read a file before you change it. Use edit_file for targeted changes and write_file for new files or full rewrites.
- Match the conventions already in the project: Tailwind utility classes in the markup, no separate CSS files per component, the same spacing rhythm and tokens the neighbouring blocks use.
- Keep text content as literal text in the markup where you can (rather than hiding it in props or arrays) — the visual editor lets people double-click literal text to edit it. Repeated data-driven lists are fine when there are many items.
- Some components are "widgets": they take their content from props with defaults, declared as 'const { title = "…", image = "/media/x.svg" } = Astro.props;' and shown as '{title}'. A page sets its own values as attributes ('<Hero title="Simple pricing" />'); omitted ones fall back to the default. To change what one page shows, edit that page's attributes, not the widget's defaults. When one design needs different content on different pages, make it a widget this way rather than duplicating the file. Repeating items are a list field: an array of plain objects as the default (features = [{ title: \"…\", text: \"…\" }]) rendered with features.map((item) => …); a page overrides it with features={[…]}.
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
    // The conversation is kept as plain text turns so it carries over when the
    // model or provider changes mid-conversation.
    this.history = [];
    this.running = null;
  }
  reset() {
    this.history = [];
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
    const cur = currentModel(settings);
    const provider = providerConfig(cur.provider, settings);
    const userText = `${contextBlock(this.project, context)}\n\n${prompt}`;
    const label = 'AI: ' + (prompt.length > 48 ? prompt.slice(0, 48) + '…' : prompt);
    let reply = '';
    const emit = (ev) => {
      if (ev.type === 'text') reply += ev.delta;
      send(ev);
    };
    const remember = (suffix = '') => {
      const note = changed.size ? `\n[Files changed in this turn: ${[...changed].join(', ')}]` : '';
      this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: (reply.trim() || '(no reply)') + note + suffix });
      if (this.history.length > 40) this.history.splice(0, this.history.length - 40);
    };

    try {
      await this.project.transaction(label, async () => {
        const run = { settings, model: cur.id, provider, userText, emit, changed, signal: controller.signal };
        if (process.env.ASTRONUT_MOCK_AI) return this.mock(prompt, context, emit, changed);
        if (provider.kind === 'anthropic') return this.runAnthropic(run);
        if (provider.kind === 'responses') return this.runResponses(run);
        return this.runOpenAI(run);
      });
      remember();
      send({ type: 'done', changed: [...changed] });
    } catch (err) {
      if (controller.signal.aborted) {
        remember('\n(stopped by the user)');
        send({ type: 'done', changed: [...changed], stopped: true });
      } else {
        const { code, message } = describeError(err, provider);
        send({ type: 'error', code, message, changed: [...changed] });
      }
    } finally {
      this.running = null;
    }
  }

  // ---- Claude ------------------------------------------------------------------
  async runAnthropic({ settings, model, userText, emit, changed, signal }) {
    // Without a saved key the SDK resolves credentials itself: ANTHROPIC_API_KEY,
    // ANTHROPIC_AUTH_TOKEN, then the `ant auth login` OAuth profile.
    const client = new Anthropic(settings.apiKey ? { apiKey: settings.apiKey } : {});
    const messages = [...this.history, { role: 'user', content: userText }];
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
        messages,
      };
      // Server-side refusal fallbacks are on by default; if this account or
      // model rejects the beta, quietly continue without it.
      const stream = useFallbacks ? client.beta.messages.stream({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal }) : client.messages.stream(base, { signal });

      let message;
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') emit({ type: 'tool', id: event.content_block.id, name: event.content_block.name, status: 'writing' });
          else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') emit({ type: 'text', delta: event.delta.text });
            else if (event.delta.type === 'thinking_delta') emit({ type: 'thinking', delta: event.delta.thinking });
          }
        }
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (useFallbacks && err instanceof Anthropic.BadRequestError && turn === 0 && !/credit balance/i.test(err.message)) {
          useFallbacks = false;
          turn--;
          continue;
        }
        if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
        continue; // a tool input was not parseable JSON — re-issue the turn
      }

      if (message.stop_reason === 'refusal') {
        emit({ type: 'text', delta: "\n\nI can't help with that request." });
        break;
      }
      messages.push({ role: 'assistant', content: message.content });
      if (message.stop_reason === 'pause_turn') continue;

      const calls = message.content.filter((b) => b.type === 'tool_use');
      if (!calls.length) break;
      if (message.stop_reason === 'max_tokens') {
        messages.push({ role: 'user', content: calls.map((c) => ({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: 'Your output was cut off before this tool call was complete, so it was not run. Split the work into smaller writes.' })) });
        continue;
      }

      const results = [];
      for (const call of calls) {
        const r = this.runTool(call.name, call.input, changed);
        emit({ type: 'tool', id: call.id, name: call.name, path: call.input?.path || call.input?.dir || '', status: r.error ? 'error' : 'done', summary: r.error || r.summary });
        results.push({ type: 'tool_result', tool_use_id: call.id, content: r.error || r.text, ...(r.error ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
    }
  }

  // ---- ChatGPT plan, through OpenAI's Responses API ------------------------------
  async runResponses({ model, provider, userText, emit, changed, signal }) {
    const tools = TOOLS.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema, strict: false }));
    const input = [...this.history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: userText }];

    for (let turn = 0; turn < 40; turn++) {
      const token = await chatgpt.accessToken();
      let res;
      try {
        // This flow requires store:false and stream:true on every request.
        res = await fetch(provider.baseUrl + '/responses', { method: 'POST', signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, instructions: systemPrompt(this.project), input, tools, store: false, stream: true }) });
      } catch (e) {
        if (signal.aborted) throw e;
        throw new ProviderError('connect', "Couldn't reach OpenAI. Check your internet connection.");
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        let err = {};
        try {
          const j = JSON.parse(body);
          err = j.error && typeof j.error === 'object' ? j.error : { message: j.detail || j.message || body };
        } catch {}
        throw chatgptError(err.code, err.message || body.slice(0, 300), res.status, err.param);
      }

      let text = '';
      let completed = false;
      const calls = [];
      const handle = (payload) => {
        let ev;
        try {
          ev = JSON.parse(payload);
        } catch {
          return;
        }
        switch (ev.type) {
          case 'response.output_text.delta':
            text += ev.delta || '';
            emit({ type: 'text', delta: ev.delta || '' });
            break;
          case 'response.reasoning_summary_text.delta':
            emit({ type: 'thinking', delta: ev.delta || '' });
            break;
          case 'response.output_item.added':
            if (ev.item?.type === 'function_call') emit({ type: 'tool', id: ev.item.call_id || ev.item.id, name: ev.item.name, status: 'writing' });
            break;
          case 'response.output_item.done':
            if (ev.item?.type === 'function_call') calls.push({ id: ev.item.call_id || ev.item.id, name: ev.item.name, args: ev.item.arguments || '{}' });
            break;
          case 'response.completed':
            completed = true;
            break;
          case 'response.incomplete':
            completed = true;
            if (!calls.length) emit({ type: 'text', delta: '\n\n(The reply was cut off before it finished.)' });
            break;
          case 'response.failed':
            throw chatgptError(ev.response?.error?.code, ev.response?.error?.message, 0);
          case 'error':
            throw chatgptError(ev.code || ev.error?.code, ev.message || ev.error?.message, 0);
        }
      };
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line.startsWith('data:')) handle(line.slice(5).trim());
        }
      }
      if (buf.trim().startsWith('data:')) handle(buf.trim().slice(5).trim());
      if (!completed) throw new ProviderError('connect', 'The connection to OpenAI dropped before the reply finished. Try again.');

      if (!calls.length) break;
      if (text) input.push({ role: 'assistant', content: text });
      for (const call of calls) input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.args });
      for (const call of calls) {
        let parsed = null;
        let r;
        try {
          parsed = JSON.parse(call.args || '{}');
          r = this.runTool(call.name, parsed, changed);
        } catch {
          r = { error: 'The tool arguments were not valid JSON. Send the call again with a complete JSON object.' };
        }
        emit({ type: 'tool', id: call.id, name: call.name, path: parsed?.path || parsed?.dir || '', status: r.error ? 'error' : 'done', summary: r.error || r.summary });
        input.push({ type: 'function_call_output', call_id: call.id, output: r.error ? `Error: ${r.error}` : r.text });
      }
    }
  }

  // ---- any OpenAI-compatible endpoint (Ollama, LM Studio, OpenAI, OpenRouter, …) ----
  async runOpenAI({ model, provider, userText, emit, changed, signal }) {
    if (!provider.baseUrl) throw new ProviderError('setup', `${provider.label} has no address yet. Add one in Settings.`);
    const tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
    const messages = [{ role: 'system', content: systemPrompt(this.project) }, ...this.history, { role: 'user', content: userText }];
    const headers = { 'Content-Type': 'application/json', ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}) };

    for (let turn = 0; turn < 40; turn++) {
      let res;
      try {
        res = await fetch(provider.baseUrl + '/chat/completions', { method: 'POST', headers, signal, body: JSON.stringify({ model, messages, tools, stream: true }) });
      } catch (e) {
        if (signal.aborted) throw e;
        throw new ProviderError('connect', provider.local ? `Couldn't reach ${provider.label} at ${provider.baseUrl}. Is it running?` : `Couldn't reach ${provider.label}. Check your internet connection.`);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        let detail = body;
        try {
          const j = JSON.parse(body);
          detail = j.error?.message || j.error || j.message || body;
        } catch {}
        detail = String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 300);
        if (res.status === 401 || res.status === 403) throw new ProviderError('auth', `${provider.label} rejected the API key. Check it in Settings.`);
        if (/does not support tools|tool.*not supported|tools.*not supported/i.test(detail)) throw new ProviderError('tools', `The model “${model}” can't use tools, which the assistant needs to edit files. Pick a tool-capable model with /model (for local use: qwen3, qwen2.5-coder, llama3.3 or similar).`);
        if (res.status === 404) throw new ProviderError('model', `${provider.label} doesn't have a model called “${model}”. Type /model to see what is available.`);
        throw new ProviderError('error', `${provider.label} error ${res.status}: ${detail}`);
      }

      // Read the event stream, collecting text and (possibly fragmented) tool calls.
      let text = '';
      const calls = [];
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const handle = (line) => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          return;
        }
        if (chunk.error) throw new ProviderError('error', `${provider.label}: ${chunk.error.message || JSON.stringify(chunk.error)}`);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;
        const thinking = delta.reasoning_content || delta.reasoning;
        if (typeof thinking === 'string' && thinking) emit({ type: 'thinking', delta: thinking });
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          emit({ type: 'text', delta: delta.content });
        }
        for (const [k, tc] of (delta.tool_calls || []).entries()) {
          // Most servers number fragments with `index`; a few send whole calls without one.
          const i = typeof tc.index === 'number' ? tc.index : tc.id && calls.some((c) => c && c.id !== tc.id) && !calls.some((c) => c && c.id === tc.id) ? calls.length : tc.id ? Math.max(0, calls.findIndex((c) => c && c.id === tc.id)) : Math.max(0, calls.length - 1);
          if (!calls[i]) {
            calls[i] = { id: tc.id || `call_${turn}_${i}`, name: '', args: '' };
          }
          if (tc.id) calls[i].id = tc.id;
          if (tc.function?.name && !calls[i].name) {
            calls[i].name = tc.function.name;
            emit({ type: 'tool', id: calls[i].id, name: calls[i].name, status: 'writing' });
          }
          const a = tc.function?.arguments;
          if (typeof a === 'string') calls[i].args += a;
          else if (a && typeof a === 'object') calls[i].args = JSON.stringify(a);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          handle(buf.slice(0, nl).trim());
          buf = buf.slice(nl + 1);
        }
      }
      if (buf.trim()) handle(buf.trim());

      const made = calls.filter((c) => c && c.name);
      if (!made.length) break;
      messages.push({ role: 'assistant', content: text || null, tool_calls: made.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })) });
      for (const call of made) {
        let input = null;
        let r;
        try {
          input = JSON.parse(call.args || '{}');
          r = this.runTool(call.name, input, changed);
        } catch {
          r = { error: 'The tool arguments were not valid JSON. Send the call again with a complete JSON object.' };
        }
        emit({ type: 'tool', id: call.id, name: call.name, path: input?.path || input?.dir || '', status: r.error ? 'error' : 'done', summary: r.error || r.summary });
        messages.push({ role: 'tool', tool_call_id: call.id, content: r.error ? `Error: ${r.error}` : r.text });
      }
    }
  }

  // Offline stand-in used for UI development (ASTRONUT_MOCK_AI=1). Exercises the same tools.
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
  }
}

/** Plain-language versions of the errors OpenAI documents for ChatGPT plan usage. */
function chatgptError(code, message, status, param) {
  const usage = ' You can check it at chatgpt.com/settings/usage.';
  switch (code) {
    case 'subscription_sharing_usage_limit_exceeded':
      return new ProviderError('limit', 'You have reached your ChatGPT plan’s usage limit for now.' + usage + ' Type /model to switch to another provider in the meantime.');
    case 'subscription_sharing_user_not_eligible':
      return new ProviderError('eligible', 'This ChatGPT account can’t use its plan in other apps (it needs an eligible Plus or Pro plan, and a workspace may restrict it). Type /model to use another provider.');
    case 'subscription_sharing_usage_unavailable':
    case 'subscription_sharing_user_unavailable':
      return new ProviderError('connect', 'ChatGPT couldn’t check your plan usage just now. Try again in a moment.');
    case 'subscription_sharing_unsupported_capability':
      return new ProviderError('error', `ChatGPT plan usage doesn’t support something in this request${param ? ` (${param})` : ''}. Try a different model with /model.`);
    case 'subscription_sharing_invalid_user':
    case 'chatpass_v2_scope_not_authorized':
    case 'chatpass_v2_invalid_authorization_context':
      return new ProviderError('auth', 'ChatGPT didn’t accept this sign-in. Sign out and sign in again from Settings, and allow plan usage when asked.');
  }
  if (status === 401) return new ProviderError('auth', 'ChatGPT didn’t accept this sign-in. Sign in again from Settings.');
  if (status === 404) return new ProviderError('model', 'That model isn’t available on your ChatGPT plan. Type /model to pick another.');
  return new ProviderError('error', `ChatGPT error${status ? ' ' + status : ''}: ${String(message || code || 'unknown').slice(0, 300)}`);
}

class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Turn whatever went wrong into one plain sentence for the chat panel. */
function describeError(err, provider) {
  if (err instanceof ProviderError || err instanceof AuthError) return { code: err.code, message: err.message };
  let message = err?.message || String(err);
  let code = 'error';
  if (provider.kind !== 'anthropic') return { code, message: `${provider.label}: ${message}` };
  if (err instanceof Anthropic.AuthenticationError || /api[_ ]key|authentication|credentials/i.test(message)) {
    code = 'auth';
    message = 'Not signed in to the Claude API. Run `ant auth login` in a terminal (again, if your login has expired), or add an API key in Settings. Or type /model to use a different provider.';
  } else if (err instanceof Anthropic.PermissionDeniedError) message = `Your account isn't allowed to use this model. Pick another with /model. (${err.message})`;
  else if (err instanceof Anthropic.NotFoundError) message = `That model isn't available to your account. Pick another with /model.`;
  else if (err instanceof Anthropic.RateLimitError) message = 'Rate limited by the Claude API — wait a moment and try again.';
  else if (err instanceof Anthropic.APIConnectionError) message = "Couldn't reach the Claude API. Check your internet connection.";
  else if (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message)) {
    code = 'billing';
    message = 'You are signed in, but your Claude Console account has no API credits. Add credits at console.anthropic.com → Plans & Billing, then ask again — or type /model to switch to another provider or a local model. (API credits are separate from a Claude app subscription.)';
  } else if (err instanceof Anthropic.APIError) message = `Claude API error ${err.status ?? ''}: ${err.message}`;
  return { code, message };
}
