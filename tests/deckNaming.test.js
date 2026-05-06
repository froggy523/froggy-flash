'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { slugifyDeckStem } = require('../lib/deckNaming');

describe('slugifyDeckStem', () => {
  it('lowercases and replaces non-alphanumeric runs with hyphen', () => {
    assert.equal(slugifyDeckStem('Hello World!!'), 'hello-world');
  });

  it('trims length and drops edge hyphens', () => {
    const long = 'Aa'.repeat(40);
    const out = slugifyDeckStem(long);
    assert.ok(out.length <= 48);
  });

  it('falls back for empty-ish input', () => {
    assert.equal(slugifyDeckStem('   '), 'deck');
    assert.equal(slugifyDeckStem('!!!'), 'deck');
  });
});
