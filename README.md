# Astrolabe

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
| **Blocks** | The Assets tab holds 35 ready-made sections (heroes, features, pricing, FAQ, footers…). Click one to open it on its own, drag it onto the page, or press **+**. |
| **Elements** | The **+** button in the toolbar adds sections, headings, text, buttons, images, columns and cards. |
| **Pages** | Add, rename, duplicate and delete pages. Each page is one file in `src/pages`. |
| **Theme** | With nothing selected, the right panel sets the brand colour (a full 50–950 scale is generated for you), light/dark colours, fonts and corner radius for the whole site. |
| **Content** | The Content tab is a Markdown editor with a live preview and a form for each entry's fields. It reads the collections declared in `src/content.config.ts`. |
| **Media** | Drop images into the Media section; click one to use it on the selected image. |
| **Ask AI** | Press ⌘K (Ctrl+K), describe a change, and the assistant edits the files. Each answer is a single undo step. |
| **Undo anything** | ⌘Z / ⇧⌘Z covers every edit — visual, code, theme, content, and AI. |
| **Preview sizes** | Mobile → 2xl widths, light/dark mode, zoom. "Browse" mode (the hand) lets you use the site normally. |
| **Build** | The Build button runs `astro build` and puts the finished static site in `site/dist`. |

### Keyboard

`V` select · `B` browse · `A` add element · `Enter` edit text · `Esc` select parent · `⌫` delete · `⌘D` duplicate · `⌥↑/↓` move · `⌘E` code · `⌘K` AI · `⌘Z` undo

## Setting up the AI assistant

The assistant uses the Claude API. On your own machine the simplest way is to sign in with OAuth — no key to copy or store:

```bash
brew install anthropics/tap/ant
```

```bash
ant auth login
```

That opens a browser, signs you in to your Claude Console account, and saves a login profile in `~/.config/anthropic/`. Astrolabe picks it up by itself and refreshes it as needed. If the assistant later says you are not signed in, run `ant auth login` again.

Alternatively, open **Settings** (the gear in the toolbar) and paste an Anthropic API key, or start the editor with `ANTHROPIC_API_KEY` set in your environment. A saved key is stored only in `.astrolabe/settings.json` on your machine (git-ignored). A key, saved or in the environment, takes priority over the sign-in.

The assistant can read, create, edit and delete files inside the open project — nothing else. It is told which page you are looking at and which element you have selected, so "make this bigger" works.

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
  ai.mjs             the assistant: a tool-use loop over the Claude API
  preview/           the route that renders one component on its own
editor/              the UI (React + TypeScript)
site/                the starter Astro site you are editing
```

The trick that makes visual editing possible: in dev mode Astro stamps every rendered element with the file and line it came from. The bridge reads that when you click, the server finds the exact tag in the `.astro` file, and the edit is spliced into the source text without reformatting anything around it. Astro's hot reload then refreshes the preview.

## Good to know

- Elements produced by code — the body of a `.map()` loop, or something inside `{condition && …}` — can be restyled, but not moved, duplicated or deleted visually. Use the Source tab or the assistant for those.
- Editing an element that lives in a component changes that component everywhere it is used. The inspector tells you when that is the case.
- Deleting a media file is permanent; everything else can be undone. Undo history lasts until the editor is restarted.
