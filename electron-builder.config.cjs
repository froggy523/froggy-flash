/**
 * Electron-builder config: spreads package.json "build" and names the installer from semver only.
 */
const pkg = require('./package.json');

const updateUrl =
  typeof process.env.FROGGY_UPDATE_URL === 'string' && process.env.FROGGY_UPDATE_URL.trim()
    ? process.env.FROGGY_UPDATE_URL.trim().replace(/\/+$/, '')
    : '';

module.exports = {
  ...pkg.build,
  artifactName: '${productName} Setup ${version}.${ext}',
  // Host `latest.yml` + installer at this URL when set (e.g. static site or release bucket).
  ...(updateUrl ? { publish: [{ provider: 'generic', url: updateUrl }] } : {})
};
