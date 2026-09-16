/** Inspect retrieval on any saved .diff without loading a model. */
import {build} from 'esbuild';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
await mkdir('.output/ai-benchmark', {recursive: true});
await build({
  stdin: {
    contents:
      "export {indexPatch} from './lib/ai/index'; export {selectContext, fitContext} from './lib/ai/search';",
    resolveDir: process.cwd(),
  },
  outfile: '.output/ai-benchmark/retrieval.mjs',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
});
const {indexPatch, selectContext} = await import(
  pathToFileURL(resolve('.output/ai-benchmark/retrieval.mjs')).href
);
const index = await indexPatch(await readFile(process.argv[2], 'utf8'));
const questions = [
  'Where does SSO session expiration get checked and what happens when an identity provider session is revoked?',
  'How is a verified organization domain checked before granting SSO access?',
  'Which authorization checks prevent SCIM requests from modifying another organization?',
  'What tests cover expired SSO sessions and invalidated domain verification?',
];
const results = questions.map((question) => ({
  question,
  sources: selectContext(index, question, 'ask', {}),
}));
await writeFile(
  '.output/ai-benchmark/retrieval.json',
  JSON.stringify(
    {
      revision: index.revision,
      files: index.files.length,
      chunks: index.chunks.length,
      omitted: index.omittedChunks,
      results,
    },
    null,
    2,
  ),
);
for (const result of results)
  console.log(
    result.question,
    '\n',
    result.sources
      .slice(0, 6)
      .map((source) => `${source.id} ${source.path}:${source.newStart}`)
      .join('\n'),
  );
