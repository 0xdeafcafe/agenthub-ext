import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const QWEN_SHA = 'b0f951d411e4fd59fe2af76be9328905ae30549e570a192a841c958b293ecd53';
const QWEN_URL =
  'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3.5-2B-q4f16_1_cs1k-webgpu.wasm';
export async function prepareAiAssets() {
  const destination = resolve(root, 'public/ai');
  await mkdir(resolve(destination, 'litert'), {recursive: true});
  await copyFile(
    resolve(root, 'node_modules/@mlc-ai/web-llm/LICENSE'),
    resolve(destination, 'LICENSE-APACHE-2.0.txt'),
  );
  const path = resolve(destination, 'qwen-2b.wasm');
  const cached = await readFile(path).catch(() => null);
  if (!cached || digest(cached) !== QWEN_SHA) {
    const response = await fetch(QWEN_URL, {signal: AbortSignal.timeout(60000)});
    if (!response.ok) throw new Error(`Qwen runtime download failed (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== QWEN_SHA)
      throw new Error('Qwen WASM checksum differs from the reviewed runtime.');
    await writeFile(path, bytes);
  }
  // The tokenizer package labels a UMD bundle as ESM. Give its exports an explicit module wrapper.
  const tokenizers = await readFile(
    resolve(root, 'node_modules/@mlc-ai/web-tokenizers/lib/index.js'),
    'utf8',
  );
  await writeFile(
    resolve(destination, 'tokenizers.js'),
    'const exports = {}; const module = {exports};\n' +
      tokenizers +
      '\nexport const Tokenizer = exports.Tokenizer;\n',
  );
  const source = resolve(root, 'node_modules/@litert-lm/core/wasm');
  for (const name of await readdir(source)) {
    if (!name.includes('_compat_')) {
      await rm(resolve(destination, 'litert', name), {force: true});
      continue;
    }
    if (name.endsWith('.js'))
      await writeFile(
        resolve(destination, 'litert', name),
        (await readFile(resolve(source, name), 'utf8')) + '\nexport default ModuleFactory;\n',
      );
    else if (name.endsWith('.wasm'))
      await copyFile(resolve(source, name), resolve(destination, 'litert', name));
  }
  await writeFile(
    resolve(destination, 'NOTICE.txt'),
    'Qwen model library: MLC AI, Apache-2.0. Runtime SHA-256: ' +
      QWEN_SHA +
      '\nLiteRT-LM runtime: Google, Apache-2.0, @litert-lm/core 0.17.0.\nModel weights download separately from pinned Hugging Face revisions after installation is requested.\n',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await prepareAiAssets();
