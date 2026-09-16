/** Load packaged Emscripten code as an ES module; module workers forbid importScripts. */
export async function loadPackagedLiteRt(base: URL): Promise<void> {
  const {LiteRtLm, hasGlobalLiteRtLmPromise, setGlobalLiteRtLm, setGlobalLiteRtLmPromise} =
    await import('@litert-lm/core');
  if (hasGlobalLiteRtLmPromise()) return;
  const file =
    'Suspending' in WebAssembly
      ? 'litertlm_wasm_compat_internal.js'
      : 'litertlm_wasm_compat_asyncify_internal.js';
  const url = new URL(file, base);
  type Factory = (config: {
    locateFile: (file: string) => string;
  }) => Promise<ConstructorParameters<typeof LiteRtLm>[0]>;
  const {default: factory} = (await import(/* @vite-ignore */ url.href)) as {default: Factory};
  const promise = factory({locateFile: (name) => new URL(name, url).href}).then((wasm) => {
    const runtime = new LiteRtLm(wasm);
    setGlobalLiteRtLm(runtime);
    return runtime;
  });
  setGlobalLiteRtLmPromise(promise);
  await promise;
}
