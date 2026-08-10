import {defineConfig} from 'wxt';

export default defineConfig({
  manifest: {
    name: 'PR Impact',
    description:
      'Categorize and filter files on GitHub PR "Files changed" pages — collapse tests, hide generated code and lockfiles, focus on the code that matters.',
    permissions: ['storage'],
    host_permissions: ['https://github.com/*'],
  },
  vite: () => ({
    esbuild: {
      // dom-chef JSX factory — no runtime, TSX compiles to real DOM nodes
      jsxFactory: 'h',
      jsxFragment: 'Fragment',
    },
  }),
});
