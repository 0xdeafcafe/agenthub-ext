import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it} from 'vitest';
import {releaseVersion, versionForBuild} from './version.mjs';

const script = fileURLToPath(new URL('./release.mjs', import.meta.url));
const directories = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, {recursive: true, force: true});
});
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'pr-impact-release-test-'));
  directories.push(root);
  const remote = join(root, 'remote.git');
  const cwd = join(root, 'checkout');
  const git = (...args) =>
    execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], {stdio: 'ignore'});
  execFileSync('git', ['clone', remote, cwd], {stdio: 'ignore'});
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  git('commit', '--allow-empty', '-m', 'Initial commit');
  git('push', 'origin', 'main');
  const run = (...args) =>
    execFileSync(process.execPath, [script, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  return {cwd, git, run};
}

describe('release command', () => {
  it('dry-runs without creating a tag, then pushes only the requested annotated tag', () => {
    const {git, run} = repository();
    const before = git('rev-parse', 'HEAD');
    expect(run('0.2.0', '--dry-run')).toContain('No changes made');
    expect(git('tag', '--list')).toBe('');
    expect(git('ls-remote', '--tags', 'origin')).toBe('');
    expect(run('0.2.0')).toContain('Pushed v0.2.0');
    expect(git('cat-file', '-t', 'v0.2.0')).toBe('tag');
    expect(git('ls-remote', 'origin', 'refs/tags/v0.2.0^{}')).toContain(before);
    expect(git('rev-parse', 'HEAD')).toBe(before);
    expect(() => run('0.2.0')).toThrow(/already exists/);
  });
  it('refuses dirty checkouts, feature branches, and unpushed commits', () => {
    const {cwd, git, run} = repository();
    writeFileSync(join(cwd, 'untracked.txt'), 'not released');
    expect(() => run('0.2.0')).toThrow(/Commit or stash/);
    rmSync(join(cwd, 'untracked.txt'));
    git('switch', '-c', 'feature');
    expect(() => run('0.2.0')).toThrow(/Switch to main/);
    git('switch', 'main');
    git('commit', '--allow-empty', '-m', 'Unpushed');
    expect(() => run('0.2.0')).toThrow(/Local main must match/);
    expect(git('tag', '--list')).toBe('');
    expect(git('ls-remote', '--tags', 'origin')).toBe('');
  });
  it('uses the release tag for the extension version and rejects invalid browser versions', () => {
    expect(versionForBuild({GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.3'})).toBe('1.2.3');
    expect(versionForBuild({GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main'})).toBeUndefined();
    for (const version of ['1.2', '01.2.3', '1.2.3-beta.1', '1.2.65536', '0.0.0', '$(oops)'])
      expect(() => releaseVersion(version)).toThrow(/Use a version/);
  });
});
