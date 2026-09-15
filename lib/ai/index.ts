import {parseDiff} from '../diff';
import {classify, compileRules} from '../classifier';
import {DEFAULT_CATEGORIES} from '../config';

export interface SourceChunk {
  id: string;
  path: string;
  category: string;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  added: number;
  removed: number;
  text: string;
}
export interface SourceIndex {
  revision: string;
  files: Array<{path: string; category: string; binary: boolean}>;
  chunks: SourceChunk[];
  omittedChunks: number;
  truncatedLines: number;
}
const rules = compileRules(DEFAULT_CATEGORIES);
const MAX_CHARS = 2_000_000;
const MAX_FILE_CHARS = 48_000;
const CHUNK_LINES = 65;

/** Preserve old/new line identities; never retain more than a bounded slice of a PR. */
export async function indexPatch(text: string): Promise<SourceIndex> {
  const inventory = parseDiff(text);
  if (!inventory.complete)
    throw new Error('GitHub did not return a complete diff. Try reloading the changes.');
  const revision = [
    ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
  ]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const files = inventory.files.map((file) => ({
    path: file.path,
    binary: file.binary,
    category: classify(file.path, rules),
  }));
  const candidates: SourceChunk[] = [];
  let current: SourceChunk | null = null;
  let fileIndex = -1;
  let oldLine = 0;
  let newLine = 0;
  let remainingOld = 0;
  let remainingNew = 0;
  let rowCount = 0;
  let fileChars = 0;
  let omittedChunks = 0;
  let truncatedLines = 0;
  const finish = (): void => {
    if (current?.text && current.added + current.removed > 0) {
      if (fileChars + current.text.length <= MAX_FILE_CHARS) {
        candidates.push(current);
        fileChars += current.text.length;
      } else omittedChunks++;
    }
    current = null;
    rowCount = 0;
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      finish();
      fileIndex++;
      fileChars = 0;
      remainingOld = remainingNew = 0;
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      finish();
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      remainingOld = Number(hunk[2] ?? 1);
      remainingNew = Number(hunk[4] ?? 1);
      continue;
    }
    if (fileIndex < 0 || remainingOld + remainingNew === 0 || !/^[ +-]/.test(line)) continue;
    current ??= {
      id: '',
      path: files[fileIndex].path,
      category: files[fileIndex].category,
      oldStart: oldLine,
      oldEnd: oldLine,
      newStart: newLine,
      newEnd: newLine,
      added: 0,
      removed: 0,
      text: '',
    };
    const kind = line[0];
    const source = line.slice(1, 801);
    if (line.length > 801) truncatedLines++;
    if (kind === '+') {
      current.text += `+R${newLine} ${source}\n`;
      current.added++;
      current.newEnd = newLine++;
      remainingNew--;
    } else if (kind === '-') {
      current.text += `-L${oldLine} ${source}\n`;
      current.removed++;
      current.oldEnd = oldLine++;
      remainingOld--;
    } else {
      current.text += ` R${newLine} ${source}\n`;
      current.oldEnd = oldLine++;
      current.newEnd = newLine++;
      remainingOld--;
      remainingNew--;
    }
    if (++rowCount >= CHUNK_LINES) finish();
  }
  finish();
  // Generated output should not consume the budget before application code.
  candidates.sort(
    (a, b) => Number(a.category === 'generated') - Number(b.category === 'generated'),
  );
  const chunks: SourceChunk[] = [];
  let size = 0;
  for (const chunk of candidates) {
    if (size + chunk.text.length > MAX_CHARS) {
      omittedChunks++;
      continue;
    }
    size += chunk.text.length;
    chunk.id = `S${chunks.length + 1}`;
    chunks.push(chunk);
  }
  return {revision, files, chunks, omittedChunks, truncatedLines};
}
