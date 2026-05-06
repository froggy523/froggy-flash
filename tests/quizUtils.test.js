'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  calculatePercent,
  shuffleArray,
  getActiveTotalCards,
  getActiveCardAt,
  getRecommendedDeckFromScores,
  getDefaultSelectedSetPath
} = require('../lib/quizUtils');

describe('calculatePercent', () => {
  it('returns 0 when total is 0', () => {
    assert.equal(calculatePercent(3, 0), 0);
  });

  it('rounds to nearest integer percent', () => {
    assert.equal(calculatePercent(1, 3), 33);
    assert.equal(calculatePercent(2, 3), 67);
    assert.equal(calculatePercent(3, 4), 75);
  });
});

describe('shuffleArray', () => {
  it('mutates in place and preserves multiset of elements', () => {
    const arr = [1, 2, 2, 3];
    const before = [...arr].sort().join(',');
    shuffleArray(arr);
    assert.equal(arr.length, 4);
    assert.equal([...arr].sort().join(','), before);
  });
});

describe('getActiveTotalCards / getActiveCardAt', () => {
  const set = {
    name: 'S',
    cards: [{ id: 0 }, { id: 1 }, { id: 2 }]
  };

  it('uses active indices when present', () => {
    const idx = [2, 0];
    assert.equal(getActiveTotalCards(set, idx), 2);
    assert.deepEqual(getActiveCardAt(set, idx, 0), { id: 2 });
    assert.deepEqual(getActiveCardAt(set, idx, 1), { id: 0 });
  });

  it('falls back to full deck order', () => {
    assert.equal(getActiveTotalCards(set, null), 3);
    assert.deepEqual(getActiveCardAt(set, null, 1), { id: 1 });
  });

  it('returns 0 / null when set missing', () => {
    assert.equal(getActiveTotalCards(null, []), 0);
    assert.equal(getActiveCardAt(null, [0], 0), null);
  });
});

describe('getRecommendedDeckFromScores', () => {
  it('returns null for empty or invalid input', () => {
    assert.equal(getRecommendedDeckFromScores(null), null);
    assert.equal(getRecommendedDeckFromScores({}), null);
  });

  it('prefers fewer plays, then lower avg percent', () => {
    const scores = {
      '/often': {
        setName: 'Often',
        history: [{ percent: 100 }, { percent: 100 }]
      },
      '/rare-bad': {
        setName: 'Rare',
        history: [{ percent: 20 }]
      },
      '/rare-worse': {
        setName: 'Rare2',
        history: [{ percent: 10 }]
      }
    };
    const rec = getRecommendedDeckFromScores(scores);
    assert.equal(rec.deckKey, '/rare-worse');
    assert.equal(rec.plays, 1);
  });
});

describe('getDefaultSelectedSetPath', () => {
  it('returns null for non-array', () => {
    assert.equal(getDefaultSelectedSetPath(null), null);
  });

  it('picks first topic in first category', () => {
    const decks = [
      { id: 'm.deck.json', sets: [{ id: '/a.json' }, { id: '/b.json' }] },
      { id: '/flat.json', sets: null }
    ];
    assert.equal(getDefaultSelectedSetPath(decks), '/a.json');
  });

  it('picks flat deck when no nested sets', () => {
    const decks = [{ id: '/only.json', sets: null }];
    assert.equal(getDefaultSelectedSetPath(decks), '/only.json');
  });
});
