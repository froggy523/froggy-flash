'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  validateFlashcardSetShape,
  stripCodeFences,
  extractJsonObjectString,
  parseFlashcardSetFromLlmOutput
} = require('../lib/flashcardSchema');

const minimalValidSet = {
  name: 'Test',
  description: 'd',
  cards: [
    {
      question: 'Q?',
      choices: {
        a: { text: 'A' },
        b: { text: 'B' }
      },
      answer: 'a',
      explanation: 'Because.'
    }
  ]
};

describe('validateFlashcardSetShape', () => {
  it('accepts a minimal valid set', () => {
    assert.equal(validateFlashcardSetShape(structuredClone(minimalValidSet)), true);
  });

  it('rejects missing name', () => {
    const bad = { ...minimalValidSet, name: undefined };
    assert.throws(() => validateFlashcardSetShape(bad), /"name"/);
  });

  it('rejects answer key not in choices', () => {
    const bad = structuredClone(minimalValidSet);
    bad.cards[0].answer = 'z';
    assert.throws(() => validateFlashcardSetShape(bad), /choices/);
  });

  it('rejects non-string explanation', () => {
    const bad = structuredClone(minimalValidSet);
    bad.cards[0].explanation = null;
    assert.throws(() => validateFlashcardSetShape(bad), /explanation/);
  });
});

describe('stripCodeFences', () => {
  it('strips a json markdown fence', () => {
    const inner = '{"a":1}';
    const wrapped = '```json\n' + inner + '\n```';
    assert.equal(stripCodeFences(wrapped), inner);
  });

  it('returns trimmed plain text when no fence', () => {
    assert.equal(stripCodeFences('  hello  '), 'hello');
  });
});

describe('extractJsonObjectString', () => {
  it('extracts first object from noisy text', () => {
    const s = 'prefix\n{"x":1}\ntrailing';
    assert.equal(extractJsonObjectString(s), '{"x":1}');
  });

  it('throws when no braces', () => {
    assert.throws(() => extractJsonObjectString('no json here'), /No JSON object/);
  });
});

describe('parseFlashcardSetFromLlmOutput', () => {
  it('parses fenced model output', () => {
    const json = JSON.stringify(minimalValidSet);
    const llm = 'Here you go:\n```json\n' + json + '\n```\n';
    const parsed = parseFlashcardSetFromLlmOutput(llm);
    assert.equal(parsed.name, 'Test');
    assert.equal(parsed.cards.length, 1);
  });
});
