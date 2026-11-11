# Astrophile Studio

A visual, AI-assisted editor for [Astro](https://astro.build) sites that runs in your browser.

Point, click, drag and type — or describe what you want and let an LLM do it. Everything you do is written straight into a normal Astro project's source files, so there is nothing to export and no lock-in.

```bash
npm install
npm start
```

Then open **http://localhost:4600**.

The first `npm install` also installs the bundled starter site in `site/`.

## What you can do

| | |
|---|---|
| **Click to select** | Click anything in the live preview. The right panel shows its design controls; the Layers tree on the left shows where it sits in the page. |
| **Double-click to type** | Rewrite any text in place. Press Enter to save, Esc to cancel. |
| **Design panel** | Layout, spacing, typography, colours, borders, shadows — each control writes Tailwind classes for you. "Apply changes to" lets you target one screen size (`sm` `md` `lg` `xl`) or a state (hover, dark). |
| **Classes / Source tabs** | See and edit the exact Tailwind classes, or the element's raw code. |
| **Blocks** | The Assets tab holds 35 ready-made sections (heroes, features, pricing, FAQ, location, footers…). Click one to open it on its own, drag it onto the page, or press **+**. |
| **Elements** | The **+** button in the toolbar adds sections, headings, text, buttons, images, columns and cards. |
| **Pages** | Add, rename, duplicate and delete pages. Each page is one file in `src/pages`. |
| **Theme** | With nothing selected, the right panel sets the brand colour (a full 50–950 scale is generated for you), light/dark colours, fonts and corner radius for the whole site. |
| **Content** | The Content tab is a Markdown editor with a live preview and a form for each entry's fields. It reads the collections declared in `src/content.config.ts`. |
| **Media** | Drop images into the Media section; click one to use it on the selected image. |
| **Ask AI** | Press ⌘K (Ctrl+K), describe a change, and the assistant edits the files. Each answer is a single undo step. |
| **Undo anything** | ⌘Z / ⇧⌘Z covers every edit — visual, code, theme, content, and AI. |
| **Preview sizes** | Mobile → 2xl widths, light/dark mode, zoom. "Browse" mode (the hand) lets you use the site normally. |
| **Build** | The Build button runs `astro build` and puts the finished static site in `site/dist`. |

### Blocks, widgets and the inventory

Everything in the Assets panel is tagged by where its content comes from:

- **Block** — the text lives in the block itself. Type on the page to change it; the change shows wherever the block is used.
- **Widget** — has named fields. Every placement can have its own text, links and images while sharing one design. Select a placement to fill in its fields in the right panel (or the floating widget editor), or just double-click field text on the page — it is saved for that page only.
- **Data** — fills itself from a content collection. The blog list is one: each placement chooses how many posts to show, their order, and an optional tag to filter by.
- **Page-aware** — works out what to show from the page it sits on, so there is nothing to fill in: breadcrumbs (built on the `astro-breadcrumbs` package), a table of contents, and share links. They have a few settings only.

The **Location** widget shows a business's address, contact details, opening hours and a map. The map is an embedded Google Map drawn from the address field, so changing the address moves the map. It loads from Google when a visitor opens the page.

Fields can also be **lists** — repeating items such as FAQ questions, feature cards or team members. In a placement's fields you can add, remove, duplicate and reorder items and edit each one; double-clicking an item's text on the page edits just that item.

To make a block into a widget, open it, select a piece of text, an image or a link, and choose **Make it a field**. To make a list, select the element that directly contains the repeating items (the row of cards) and choose **Turn into a list**: the first item becomes the pattern and whatever differs between items becomes the list. Items have to share the same structure and styling; if they don't, Astrophile Studio says where they differ. Today's content becomes the default, so existing pages don't change. Under the hood a field is an ordinary Astro prop with a default, and a placement's values are ordinary attributes, so nothing depends on Astrophile Studio.

When you add something that other pages already use, you choose **Linked** (shared) or **Copy for this page**. A shared placement can later be made independent from the right panel.

The **Inventory** (the list icon next to Components) shows every block, widget and layout, what kind it is, its fields, and which pages use it — including ones nothing uses.

### Keyboard

`V` select · `B` browse · `A` add element · `Enter` edit text · `Esc` select parent · `⌫` delete · `⌘D` duplicate · `⌥↑/↓` move · `⌘E` code · `⌘K` AI · `⌘Z` undo

## Setting up the AI assistant

The assistant is provider-agnostic. Type **`/model`** in the chat (or click the model name under the chat box) to see every model available right now and switch between them; `/model qwen` or `/model sonnet` switches straight to the model that matches. The conversation carries over when you switch.

| Provider | How to enable it |
|---|---|
| **Claude** (Anthropic) | Sign in with `ant auth login` (OAuth, no key to store), or paste an API key in Settings, or set `ANTHROPIC_API_KEY`. A key takes priority over the sign-in. Usage is billed from your Claude Console credit balance, which is separate from a Claude app subscription. |
| **ChatGPT plan** | In Settings, choose **Sign in with ChatGPT**. A browser tab opens, you approve Astrophile Studio using your plan, and that's it — no API key. Uses OpenAI's official sign-in for locally run apps; usage comes out of your ChatGPT Plus or Pro allowance (see chatgpt.com/settings/usage). The first sign-in needs port 1455 free. |
| **Ollama** (local) | Install Ollama and pull a model. It is detected automatically at `http://localhost:11434`. |
| **LM Studio** (local) | Start its local server. It is detected automatically at `http://localhost:1234`. |
| **OpenAI**, **OpenRouter** | Paste an API key in Settings (or set `OPENAI_API_KEY` / `OPENROUTER_API_KEY`). |
| **Custom endpoint** | Any service that speaks the OpenAI-compatible chat API — enter its address (ending in `/v1`) and, if needed, a key. Use this for a model running on another Mac on your network. |

Local models must support **tool use** (function calling), because the assistant works by reading and editing files — `qwen3`, `qwen2.5-coder` and `llama3.3` are common choices. Small local models are noticeably less reliable at multi-step edits than the hosted ones.

Keys and addresses are stored only in `.astrophile/settings.json` on your machine (git-ignored). Whatever the provider, the assistant can read, create, edit and delete files inside the open project — nothing else. It is told which page you are looking at and which element you have selected, so "make this bigger" works.

## Editing a different Astro project

```bash
npm start -- /path/to/another/astro-site
```

The project needs its own `node_modules` (run `npm install` in it first). Nothing is added to it: the editor injects its preview bridge only into the dev server it starts. The Design panel assumes Tailwind CSS; the Theme panel looks for an `@theme { … }` block in the project's CSS. Selecting, text editing, layers, source editing, pages, content and the assistant work with any Astro project.

Other settings: `PORT=4700 npm start` changes the editor's port.

## How it works

```
server/
  index.mjs          HTTP API + serves the editor UI (through Vite, no build step)
  dev.mjs            runs the site's own `astro dev` / `astro build` as a child process
  astro-runner.mjs   starts Astro with one extra dev-only integration (the bridge)
  bridge.js          runs inside the preview: selection overlays, in-place text editing, drag targets
  astro-source.mjs   a tolerant scanner for .astro templates + surgical text edits
  project.mjs        pages, components, media, theme tokens, content, undo history
  ai.mjs             the assistant: a tool-use loop over Claude, ChatGPT or any OpenAI-compatible model
  chatgpt.mjs        "Sign in with ChatGPT" (OAuth + PKCE on a loopback callback)
  preview/           the route that renders one component on its own
editor/              the UI (React + TypeScript)
site/                the starter Astro site you are editing
```

The trick that makes visual editing possible: in dev mode Astro stamps every rendered element with the file and line it came from. The bridge reads that when you click, the server finds the exact tag in the `.astro` file, and the edit is spliced into the source text without reformatting anything around it. Astro's hot reload then refreshes the preview.

## Good to know

- Elements produced by code — the body of a `.map()` loop, or something inside `{condition && …}` — can be restyled, but not moved, duplicated or deleted visually. Use the Source tab or the assistant for those.
- Editing an element that lives in a component changes that component everywhere it is used. The inspector tells you when that is the case.
- Deleting a media file is permanent; everything else can be undone. Undo history lasts until the editor is restarted.
