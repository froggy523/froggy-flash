/**
 * Prints the absolute path to the Windows NSIS installer electron-builder would produce,
 * if it exists. Same naming as electron-builder.config.cjs.
 * Exits 1 if missing (stderr explains).
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

const productName = pkg.build && pkg.build.productName ? pkg.build.productName : pkg.name;
const version = String(pkg.version).trim();
const outDir =
  pkg.build && pkg.build.directories && pkg.build.directories.output
    ? pkg.build.directories.output
    : 'dist';

const fileName = `${productName} Setup ${version}.exe`;
const full = path.join(root, outDir, fileName);

if (!fs.existsSync(full)) {
  console.error(`Installer not found:\n  ${full}\nRun: npm run dist`);
  process.exit(1);
}

process.stdout.write(full);
