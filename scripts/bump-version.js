/**
 * Bumps semver in package.json only (no git tag/commit).
 * Uses npm's version command. Run from repo root via npm run version:bump:*.
 *
 * Usage: node scripts/bump-version.js <major|minor|patch|prerelease|...>
 */

const { execSync } = require('child_process');
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

// Windows: execFileSync('npm.cmd', ...) can throw EINVAL with recent Node; shell avoids that.
execSync(`npm version ${kind} --no-git-tag-version`, {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
