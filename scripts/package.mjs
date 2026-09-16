import {execFileSync} from 'node:child_process';
import {copyFile, mkdir, readFile} from 'node:fs/promises';
import {versionForBuild} from './version.mjs';

const browser = process.argv[2] ?? 'chrome';
if (!['chrome', 'firefox'].includes(browser)) throw new Error('Choose chrome or firefox.');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = versionForBuild() ?? pkg.version;
execFileSync(process.execPath, ['node_modules/wxt/bin/wxt.mjs', 'zip', '-b', browser], {
  stdio: 'inherit',
});
await mkdir('dist', {recursive: true});
const artifact = `dist/pr-impact-${browser}-${browser === 'chrome' ? 'mv3' : 'mv2'}.zip`;
await copyFile(`.output/${pkg.name}-${version}-${browser}.zip`, artifact);
console.log(`Ready: ${artifact}`);
