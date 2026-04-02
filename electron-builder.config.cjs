/**
 * Electron-builder config: spreads package.json "build" and appends build number to installer name.
 * Requires build-info.json at repo root (see scripts/bump-build.js).
 */
const pkg = require('./package.json');
const buildInfo = require('./build-info.json');

const buildNum =
  typeof buildInfo.build === 'number' && Number.isFinite(buildInfo.build) && buildInfo.build >= 0
    ? buildInfo.build
    : 0;

module.exports = {
  ...pkg.build,
  artifactName: `\${productName} Setup \${version}-b${buildNum}.\${ext}`,
};
