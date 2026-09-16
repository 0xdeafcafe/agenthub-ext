import {execFileSync} from 'node:child_process';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {prepareAiAssets} from './ai/assets.mjs';

await prepareAiAssets();
execFileSync(process.execPath, ['node_modules/wxt/bin/wxt.mjs', 'build', '-b', 'chrome'], {
  stdio: 'inherit',
});
const destination = resolve('dist/pr-impact-unpacked');
await mkdir('dist', {recursive: true});
await rm(destination, {recursive: true, force: true});
await cp('.output/chrome-mv3', destination, {recursive: true});
const manifest = JSON.parse(await readFile(resolve(destination, 'manifest.json'), 'utf8'));
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {encoding: 'utf8'}).trim();
await writeFile(
  resolve(destination, 'INSTALL.txt'),
  `PR Impact ${manifest.version}\nBuilt ${new Date().toISOString()} from ${commit} (including working-tree changes).\n\nChrome or Arc:\n1. Open chrome://extensions and enable Developer mode.\n2. Click Load unpacked and select this folder.\n3. Reload an open GitHub PR, open Files changed, and click Ask this PR.\n4. Search immediately, or expand Models and install Qwen or Gemma.\n\nKeep this folder in place. For an update, rebuild it and click Reload on the extension card, then refresh GitHub. If you already have PR Impact installed from another folder, disable that copy first.\n\nModels download only when you click Install (~1.1 GB or ~2.0 GB). Runtime code is included here. PR source stays in the browser. Models can be wrong; inspect their sources.\n`,
);
console.log(`\nLoad unpacked: ${destination}`);
