'use strict';

function validateFlashcardSetShape(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('JSON must be an object.');
  }
  if (!data.name || typeof data.name !== 'string') {
    throw new Error('Set must include a string "name".');
  }
  if (data.description != null && typeof data.description !== 'string') {
    throw new Error('"description" must be a string if present.');
  }
  if (!Array.isArray(data.cards)) {
    throw new Error('Set must include a "cards" array.');
  }
  data.cards.forEach((card, i) => {
    if (!card || typeof card !== 'object') {
      throw new Error(`Card ${i + 1} is invalid.`);
    }
    if (!card.question || typeof card.question !== 'string') {
      throw new Error(`Card ${i + 1} needs a string "question".`);
    }
    if (!card.choices || typeof card.choices !== 'object') {
      throw new Error(`Card ${i + 1} needs a "choices" object.`);
    }
    const keys = Object.keys(card.choices);
    if (!keys.length) {
      throw new Error(`Card ${i + 1} has empty choices.`);
    }
    if (!card.answer || typeof card.answer !== 'string' || !card.choices[card.answer]) {
      throw new Error(`Card ${i + 1}: "answer" must match a key in choices.`);
    }
    if (typeof card.explanation !== 'string') {
      throw new Error(`Card ${i + 1} needs a string "explanation".`);
    }
    keys.forEach((k) => {
      const ch = card.choices[k];
      if (!ch || typeof ch !== 'object' || typeof ch.text !== 'string') {
        throw new Error(`Card ${i + 1} choice "${k}" needs a "text" string.`);
      }
    });
  });
  return true;
}

function stripCodeFences(text) {
  if (!text || typeof text !== 'string') return text;
  let t = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/im;
  const m = t.match(fence);
  if (m) {
    return m[1].trim();
  }
  return t;
}

function extractJsonObjectString(text) {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model output.');
  }
  return cleaned.slice(start, end + 1);
}

function parseFlashcardSetFromLlmOutput(text) {
  const jsonStr = extractJsonObjectString(text);
  const data = JSON.parse(jsonStr);
  validateFlashcardSetShape(data);
  return data;
}

module.exports = {
  validateFlashcardSetShape,
  stripCodeFences,
  extractJsonObjectString,
  parseFlashcardSetFromLlmOutput
};
