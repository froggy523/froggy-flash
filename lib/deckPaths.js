'use strict';

const path = require('path');

/** Resolve a path under decksDir; rejects ".." segments and absolute paths. */
function resolvePathUnderDecksDir(decksDir, relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    return null;
  }
  const trimmed = relativePath.trim();
  if (!trimmed || trimmed.includes('..')) {
    return null;
  }
  if (path.isAbsolute(trimmed)) {
    return null;
  }
  const resolved = path.resolve(decksDir, trimmed);
  const baseResolved = path.resolve(decksDir);
  const rel = path.relative(baseResolved, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

/**
 * Ensures fullPath is inside rootDir (after resolve). Returns resolved fullPath.
 * @param {string} fullPath
 * @param {string} rootDir
 */
function assertPathInsideDirectory(fullPath, rootDir) {
  if (!fullPath || typeof fullPath !== 'string') {
    throw new Error('Invalid path.');
  }
  const resolvedRoot = path.resolve(rootDir);
  const resolved = path.resolve(fullPath);
  const rel = path.relative(resolvedRoot, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path must stay inside the decks directory.');
  }
  return resolved;
}

module.exports = {
  resolvePathUnderDecksDir,
  assertPathInsideDirectory
};
