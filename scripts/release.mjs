import {execFileSync} from 'node:child_process';
import {releaseVersion} from './version.mjs';

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
try {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const versions = args.filter((arg) => arg !== '--dry-run');
  if (versions.length !== 1) throw new Error('Usage: npm run release -- 0.2.0 [--dry-run]');
  const tag = `v${releaseVersion(versions[0])}`;
  if (git('branch', '--show-current') !== 'main')
    throw new Error('Switch to main before releasing.');
  if (git('status', '--porcelain'))
    throw new Error('Commit or stash your changes before releasing.');
  const head = git('rev-parse', 'HEAD');
  const remoteMain = git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0];
  if (head !== remoteMain)
    throw new Error('Local main must match origin/main. Pull or merge your changes first.');
  if (git('tag', '--list', tag) || git('ls-remote', 'origin', `refs/tags/${tag}`))
    throw new Error(`${tag} already exists. Choose a new version.`);
  if (dryRun) {
    console.log(
      `Would tag ${head.slice(0, 7)} as ${tag} and push that tag to origin. No changes made.`,
    );
  } else {
    git('tag', '-a', tag, '-m', `Release ${tag}`);
    try {
      git('push', 'origin', `refs/tags/${tag}`);
    } catch (error) {
      throw new Error(
        `Created ${tag} locally, but pushing failed. Retry with: git push origin ${tag}`,
        {cause: error},
      );
    }
    console.log(`Pushed ${tag}. GitHub Actions will test, package, and publish the release.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
