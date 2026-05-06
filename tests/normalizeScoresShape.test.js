'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeScoresShape } = require('../lib/normalizeScoresShape');

describe('normalizeScoresShape', () => {
  it('returns empty buckets for null', () => {
    assert.deepEqual(normalizeScoresShape(null), { bySet: {}, byDeck: {} });
  });

  it('normalizes structured payload', () => {
    const a = { x: 1 };
    const b = { y: 2 };
    assert.deepEqual(normalizeScoresShape({ bySet: a, byDeck: b }), {
      bySet: a,
      byDeck: b
    });
  });

  it('fills missing bySet or byDeck with empty objects', () => {
    assert.deepEqual(normalizeScoresShape({ bySet: { n: 1 } }), {
      bySet: { n: 1 },
      byDeck: {}
    });
    assert.deepEqual(normalizeScoresShape({ byDeck: { p: '/x' } }), {
      bySet: {},
      byDeck: { p: '/x' }
    });
  });

  it('treats legacy flat object as bySet only', () => {
    const legacy = { TopicA: { lastCorrect: 1, lastTotal: 2 } };
    assert.deepEqual(normalizeScoresShape(legacy), {
      bySet: legacy,
      byDeck: {}
    });
  });
});
