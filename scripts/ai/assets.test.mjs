import {readFile} from 'node:fs/promises';
import {describe, expect, it, vi} from 'vitest';
import {liteRtModule} from './assets.mjs';

describe('packaged LiteRT runtime', () => {
  it.each(['compat', 'compat_asyncify'])(
    'keeps the %s logger working in strict modules',
    async (variant) => {
      const source = await readFile(
        new URL(
          `../../node_modules/@litert-lm/core/wasm/litertlm_wasm_${variant}_internal.js`,
          import.meta.url,
        ),
        'utf8',
      );
      const start = source.indexOf('function custom_emscripten_dbgn(');
      const end = source.indexOf('\n}', start) + 2;
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      // Exercise the installed runtime's actual logger without loading its WASM or model.
      const module = liteRtModule(`function ModuleFactory() {
      const UTF8ToString = () => 'runtime diagnostic';
      ${source.slice(start, end)}
      custom_emscripten_dbgn(0, 0);
    }`);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const runtime = await import(
          `data:text/javascript;base64,${Buffer.from(module).toString('base64')}`
        );
        runtime.default();
        expect(warn).toHaveBeenCalledWith('runtime diagnostic');
      } finally {
        warn.mockRestore();
      }
    },
  );
});
