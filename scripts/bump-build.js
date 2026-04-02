/**
 * Increments the release build number in build-info.json (separate from package.json semver).
 *
 * Usage: node scripts/bump-build.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const infoPath = path.join(root, 'build-info.json');
const dryRun = process.argv.includes('--dry-run');

let data = { build: 0 };
if (fs.existsSync(infoPath)) {
  try {
    data = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  } catch {
    console.error('Invalid JSON in build-info.json');
    process.exit(1);
  }
}

let n = data.build;
if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
  n = 0;
}

const next = n + 1;

if (dryRun) {
  console.log(`Build would go from ${n} to ${next} (dry run)`);
  process.exit(0);
}

data.build = next;
fs.writeFileSync(infoPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`Build number: ${n} -> ${next}`);
