/**
 * Prints the absolute path to the Windows NSIS installer electron-builder would produce,
 * if it exists. Same naming as electron-builder.config.cjs.
 * Exits 1 if missing (stderr explains).
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const buildInfo = require(path.join(root, 'build-info.json'));

const buildNum =
  typeof buildInfo.build === 'number' && Number.isFinite(buildInfo.build) && buildInfo.build >= 0
    ? buildInfo.build
    : 0;

const productName = pkg.build && pkg.build.productName ? pkg.build.productName : pkg.name;
const version = String(pkg.version).trim();
const outDir =
  pkg.build && pkg.build.directories && pkg.build.directories.output
    ? pkg.build.directories.output
    : 'dist';

const fileName = `${productName} Setup ${version}-b${buildNum}.exe`;
const full = path.join(root, outDir, fileName);

if (!fs.existsSync(full)) {
  console.error(`Installer not found:\n  ${full}\nRun: npm run dist`);
  process.exit(1);
}

process.stdout.write(full);
