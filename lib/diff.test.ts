import {describe, expect, it} from 'vitest';
import {decodeGitPath, diffPathForPage, parseDiff} from './diff';

describe('full diff inventory', () => {
  it('counts every file, including binary files and pure renames', () => {
    const result = parseDiff(`diff --git a/src/a.ts b/src/a.ts
index abc1234..def5678 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const first = 1;
-// old note
-old();
+// new note
+/* more context */
+next(); // inline code
diff --git a/icon.png b/icon.png
Binary files a/icon.png and b/icon.png differ
diff --git a/old name.md b/new name.md
similarity index 100%
rename from old name.md
rename to new name.md
`);
    expect(result.complete).toBe(true);
    expect(result.files).toEqual([
      {path: 'src/a.ts', added: 3, removed: 2, commentAdded: 2, commentRemoved: 1, binary: false},
      {path: 'icon.png', added: 0, removed: 0, commentAdded: 0, commentRemoved: 0, binary: true},
      {
        path: 'new name.md',
        added: 0,
        removed: 0,
        commentAdded: 0,
        commentRemoved: 0,
        binary: false,
      },
    ]);
  });
  it('maintains independent comment state for removed and added lines', () => {
    const result = parseDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,3 +1,1 @@
-/* old comment
-context
-*/
+actualCode();
`);
    expect(result.files[0]).toMatchObject({
      commentRemoved: 3,
      commentAdded: 0,
      added: 1,
      removed: 3,
    });
    expect(result.complete).toBe(true);
  });
  it('rejects truncated hunks and HTML error responses', () => {
    expect(
      parseDiff('diff --git a/a.ts b/a.ts\n@@ -1,2 +1,2 @@\n-old();\n+next();\n').complete,
    ).toBe(false);
    expect(parseDiff('<html>Sign in to GitHub</html>').complete).toBe(false);
  });
  it('decodes quoted UTF-8 and escaped paths', () => {
    expect(decodeGitPath('"b/caf\\303\\251.ts"')).toBe('b/café.ts');
    expect(decodeGitPath('"b/a\\tfile.ts"')).toBe('b/a\tfile.ts');
    expect(decodeGitPath('b/a file.ts')).toBe('b/a file.ts');
  });
  it('rejects a response cut off between a file header and its body', () => {
    expect(parseDiff('diff --git a/a.ts b/a.ts\nindex abc1234..def5678 100644\n').complete).toBe(
      false,
    );
    expect(parseDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n').complete).toBe(false);
  });
  it('accepts empty files and permission-only changes', () => {
    expect(
      parseDiff('diff --git a/empty b/empty\nnew file mode 100644\nindex 0000000..e69de29\n')
        .complete,
    ).toBe(true);
    expect(
      parseDiff('diff --git a/script.sh b/script.sh\nold mode 100644\nnew mode 100755\n').complete,
    ).toBe(true);
  });
  it('scopes downloads to the current PR or commit range', () => {
    const url = (path: string): URL => new URL(path, 'https://github.com');
    expect(diffPathForPage(url('/acme/project/pull/42'))).toBe('/acme/project/pull/42.diff');
    expect(diffPathForPage(url('/acme/project/pull/42/'))).toBe('/acme/project/pull/42.diff');
    expect(diffPathForPage(url('/acme/project/pull/42/checks'))).toBeNull();
    expect(diffPathForPage(url('/acme/project/pull/42/files'))).toBe('/acme/project/pull/42.diff');
    expect(diffPathForPage(url('/acme/project/pull/42/changes/abcdef0..1234567'))).toBe(
      '/acme/project/compare/abcdef0..1234567.diff',
    );
    expect(diffPathForPage(url('/acme/project/pull/42/files?since=abcdef0'))).toBeNull();
    expect(diffPathForPage(url('/acme/project/pull/42/changes/anything'))).toBeNull();
  });
});
