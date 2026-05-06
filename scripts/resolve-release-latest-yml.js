/**
 * Prints the absolute path to dist/latest.yml (electron-builder update metadata).
 * Exits 1 if missing.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const outDir =
  pkg.build && pkg.build.directories && pkg.build.directories.output
    ? pkg.build.directories.output
    : 'dist';

const full = path.join(root, outDir, 'latest.yml');

if (!fs.existsSync(full)) {
  console.error(`latest.yml not found:\n  ${full}\nRun: npm run dist`);
  process.exit(1);
}

process.stdout.write(full);
