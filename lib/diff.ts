import {CommentScanner} from './comments';

export interface DiffFile {
  path: string;
  added: number;
  removed: number;
  commentAdded: number;
  commentRemoved: number;
  binary: boolean;
}
export interface DiffInventory {
  files: DiffFile[];
  complete: boolean;
}

/** Git's quoted paths use C escapes and octal UTF-8 bytes, not URL escaping. */
export function decodeGitPath(raw: string): string {
  if (!raw.startsWith('"')) return raw;
  const bytes: number[] = [];
  const text = raw.slice(1, -1);
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\\') {
      bytes.push(...new TextEncoder().encode(text[i]));
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(text.slice(i + 1));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += octal[0].length;
    } else {
      i++;
      const escape: Record<string, string> = {
        t: '\t',
        n: '\n',
        r: '\r',
        b: '\b',
        f: '\f',
        v: '\v',
        a: '\x07',
      };
      bytes.push(...new TextEncoder().encode(escape[text[i]] ?? text[i]));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Validate hunks and file metadata before using a downloaded diff as an inventory. */
export function parseDiff(text: string): DiffInventory {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let oldScanner: CommentScanner;
  let newScanner: CommentScanner;
  let remainingOld = 0;
  let remainingNew = 0;
  let inHunk = false;
  let complete = true;
  let validHeader = false;
  let fileEvidence = false;
  let oldMode = false;
  let unchanged = false;
  let renameFrom = false;
  const finishHunk = (): void => {
    if (inHunk && (remainingOld !== 0 || remainingNew !== 0)) complete = false;
    inHunk = false;
  };
  const finishFile = (): void => {
    finishHunk();
    if (file && !fileEvidence) complete = false;
    fileEvidence = false;
    oldMode = false;
    unchanged = false;
    renameFrom = false;
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      finishFile();
      // Unquoted names can contain spaces; the b/ boundary distinguishes them.
      const paths = /^("(?:[^"\\]|\\.)*"|a\/.*?) ("(?:[^"\\]|\\.)*"|b\/.*)$/.exec(line.slice(11));
      if (!paths) {
        complete = false;
        file = null;
        continue;
      }
      const path = decodeGitPath(paths[2]).replace(/^b\//, '');
      file = {path, added: 0, removed: 0, commentAdded: 0, commentRemoved: 0, binary: false};
      files.push(file);
      validHeader = true;
      continue;
    }
    if (!file) {
      if (line.trim()) complete = false;
      continue;
    }
    if (!inHunk) {
      if (line === 'similarity index 100%') unchanged = true;
      if (line.startsWith('rename from ') || line.startsWith('copy from ')) renameFrom = true;
      if (line.startsWith('old mode ')) oldMode = true;
      if (oldMode && line.startsWith('new mode ')) fileEvidence = true;
      // Empty files can be added/deleted with metadata only (Git's empty blob hash).
      if (/^index (?:0+\.\.e69de29[0-9a-f]*|e69de29[0-9a-f]*\.\.0+)(?: |$)/.test(line))
        fileEvidence = true;
      if (unchanged && renameFrom && (line.startsWith('rename to ') || line.startsWith('copy to ')))
        fileEvidence = true;
    }
    if (!inHunk && line.startsWith('+++ ') && line.slice(4) !== '/dev/null') {
      file.path = decodeGitPath(line.slice(4)).replace(/^b\//, '');
    } else if (!inHunk && (line.startsWith('rename to ') || line.startsWith('copy to '))) {
      file.path = decodeGitPath(line.slice(line.startsWith('copy') ? 8 : 10));
    } else if (!inHunk && line.startsWith('Binary files ')) {
      file.binary = true;
      fileEvidence = true;
    } else if (line.startsWith('@@ ')) {
      finishHunk();
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!hunk) {
        complete = false;
        continue;
      }
      remainingOld = Number(hunk[2] ?? 1);
      remainingNew = Number(hunk[4] ?? 1);
      oldScanner = new CommentScanner(file.path);
      newScanner = new CommentScanner(file.path);
      inHunk = true;
      fileEvidence = true;
    } else if (inHunk && remainingOld + remainingNew > 0) {
      const body = line.slice(1);
      if (line.startsWith('+')) {
        file.added++;
        remainingNew--;
        if (newScanner!.scan(body)) file.commentAdded++;
      } else if (line.startsWith('-')) {
        file.removed++;
        remainingOld--;
        if (oldScanner!.scan(body)) file.commentRemoved++;
      } else if (line.startsWith(' ')) {
        remainingOld--;
        remainingNew--;
        oldScanner!.scan(body);
        newScanner!.scan(body);
      } else if (!line.startsWith('\\')) complete = false;
      if (remainingOld < 0 || remainingNew < 0) complete = false;
    } else if (line.startsWith('@@@')) complete = false;
  }
  finishFile();
  if (new Set(files.map((file) => file.path)).size !== files.length) complete = false;
  return {files, complete: complete && validHeader};
}

/** Same repository only; scope full-PR inventory to the selected commit range. */
export function diffPathForPage(url: URL): string | null {
  const match =
    /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:files|changes)(?:\/([a-f\d]{7,40}\.{2,3}[a-f\d]{7,40}))?\/?$/i.exec(
      url.pathname,
    );
  if (!match || ['since', 'base', 'head', 'sha', 'commit'].some((key) => url.searchParams.has(key)))
    return null;
  const [, owner, repo, pr, range] = match;
  return range ? `/${owner}/${repo}/compare/${range}.diff` : `/${owner}/${repo}/pull/${pr}.diff`;
}
