'use strict';

const path = require('path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolvePathUnderDecksDir, assertPathInsideDirectory } = require('../lib/deckPaths');

describe('resolvePathUnderDecksDir', () => {
  const decks = path.join('C:', 'home', 'decks');

  it('resolves a safe relative path', () => {
    const r = resolvePathUnderDecksDir(decks, 'sub/topic.json');
    assert.equal(r, path.resolve(decks, 'sub/topic.json'));
  });

  it('returns null for traversal', () => {
    assert.equal(resolvePathUnderDecksDir(decks, '..\\secret'), null);
    assert.equal(resolvePathUnderDecksDir(decks, 'ok/../../../etc'), null);
  });

  it('returns null for absolute paths', () => {
    assert.equal(resolvePathUnderDecksDir(decks, '/tmp/x.json'), null);
  });
});

describe('assertPathInsideDirectory', () => {
  const root = path.join('C:', 'froggy', 'decks');

  it('returns resolved path when inside root', () => {
    const inner = path.join(root, 'cat', 'file.json');
    assert.equal(assertPathInsideDirectory(inner, root), path.resolve(inner));
  });

  it('throws when path escapes root', () => {
    const outside = path.join(root, '..', 'outside.json');
    assert.throws(() => assertPathInsideDirectory(outside, root), /decks directory/);
  });
});
