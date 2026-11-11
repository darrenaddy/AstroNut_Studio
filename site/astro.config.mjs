// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },

  // Fonts — Astro downloads these and serves them from your own site.
  // Each one fills a role: headings, body text and code. Pick different fonts
  // in the editor's Theme panel, or change the names here.
  fonts: [
    { provider: fontProviders.fontsource(), name: "Bricolage Grotesque", cssVariable: "--font-heading", weights: ["200 800"], styles: ["normal"], fallbacks: ["sans-serif"] },
    { provider: fontProviders.fontsource(), name: "Inter", cssVariable: "--font-body", weights: ["100 900"], styles: ["normal", "italic"], fallbacks: ["sans-serif"] },
    { provider: fontProviders.fontsource(), name: "JetBrains Mono", cssVariable: "--font-code", weights: ["100 800"], styles: ["normal", "italic"], fallbacks: ["monospace"] },
  ],
});
