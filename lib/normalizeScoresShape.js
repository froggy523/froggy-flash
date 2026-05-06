'use strict';

/**
 * Normalize persisted scores JSON into `{ bySet, byDeck }`.
 * @param {unknown} rawValue
 * @returns {{ bySet: Record<string, unknown>, byDeck: Record<string, unknown> }}
 */
function normalizeScoresShape(rawValue) {
  if (rawValue && typeof rawValue === 'object' && (rawValue.bySet || rawValue.byDeck)) {
    const bySet =
      rawValue.bySet && typeof rawValue.bySet === 'object' && rawValue.bySet !== null
        ? rawValue.bySet
        : {};
    const byDeck =
      rawValue.byDeck && typeof rawValue.byDeck === 'object' && rawValue.byDeck !== null
        ? rawValue.byDeck
        : {};
    return { bySet, byDeck };
  }

  if (rawValue && typeof rawValue === 'object') {
    return { bySet: rawValue, byDeck: {} };
  }

  return { bySet: {}, byDeck: {} };
}

module.exports = { normalizeScoresShape };
