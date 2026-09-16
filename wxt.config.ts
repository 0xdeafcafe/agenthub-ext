import {defineConfig} from 'wxt';
import {versionForBuild} from './scripts/version.mjs';

export default defineConfig({
  manifest: {
    name: 'PR Impact',
    version: versionForBuild(),
    description:
      'Categorise and filter files on GitHub PR "Files changed" pages - collapse tests, hide generated code and lockfiles, focus on the code that matters.',
    permissions: ['storage'],
    host_permissions: ['https://github.com/*', 'https://patch-diff.githubusercontent.com/*'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    web_accessible_resources: [{resources: ['assistant.html'], matches: ['https://github.com/*']}],
  },
  vite: () => ({
    worker: {format: 'es'},
    esbuild: {
      // dom-chef JSX factory - no runtime, TSX compiles to real DOM nodes
      jsxFactory: 'h',
      jsxFragment: 'Fragment',
    },
  }),
});
