/**
 * Bumps semver in package.json only (no git tag/commit).
 * Uses npm's version command. Run from repo root via npm run version:bump:*.
 *
 * Usage: node scripts/bump-version.js <major|minor|patch|prerelease|...>
 */

const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const kind = process.argv[2];
const allowed = new Set([
  'major',
  'minor',
  'patch',
  'prerelease',
  'prepatch',
  'preminor',
  'premajor',
]);

if (!kind || !allowed.has(kind)) {
  console.error(
    'Usage: node scripts/bump-version.js <major|minor|patch|prerelease|prepatch|preminor|premajor>',
  );
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npm, ['version', kind, '--no-git-tag-version'], {
  cwd: root,
  stdio: 'inherit',
});
