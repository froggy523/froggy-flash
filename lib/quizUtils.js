'use strict';

function calculatePercent(correct, total) {
  if (!total) return 0;
  return Math.round((correct / total) * 100);
}

/** Fisher–Yates shuffle; mutates `array` in place. */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

function getActiveTotalCards(currentSet, activeCardIndices) {
  if (Array.isArray(activeCardIndices) && activeCardIndices.length > 0) {
    return activeCardIndices.length;
  }
  if (currentSet && Array.isArray(currentSet.cards)) {
    return currentSet.cards.length;
  }
  return 0;
}

function getActiveCardAt(currentSet, activeCardIndices, index) {
  if (!currentSet || !Array.isArray(currentSet.cards)) {
    return null;
  }
  if (Array.isArray(activeCardIndices) && activeCardIndices.length > 0) {
    const realIndex = activeCardIndices[index] ?? null;
    if (realIndex == null) return null;
    return currentSet.cards[realIndex] || null;
  }
  return currentSet.cards[index] || null;
}

function getRecommendedDeckFromScores(scoresByDeck) {
  if (!scoresByDeck || typeof scoresByDeck !== 'object') {
    return null;
  }

  const entries = Object.entries(scoresByDeck);
  if (!entries.length) return null;

  const deckMetrics = entries
    .map(([deckKey, stats]) => {
      if (!stats || typeof stats !== 'object') return null;
      const history = Array.isArray(stats.history) ? stats.history : [];
      const plays = history.length;

      let avgPercent = 0;
      if (plays > 0) {
        let sum = 0;
        history.forEach((h) => {
          const p =
            h && typeof h.percent === 'number'
              ? h.percent
              : calculatePercent(h.correct || 0, h.total || 0);
          sum += p;
        });
        avgPercent = Math.round(sum / plays);
      } else {
        avgPercent = calculatePercent(stats.lastCorrect || 0, stats.lastTotal || 0);
      }

      return {
        deckKey,
        setName: stats.setName || null,
        plays,
        avgPercent
      };
    })
    .filter(Boolean);

  if (!deckMetrics.length) return null;

  let best = null;
  deckMetrics.forEach((m) => {
    if (!best) {
      best = m;
      return;
    }
    if (m.plays < best.plays) {
      best = m;
      return;
    }
    if (m.plays === best.plays && m.avgPercent < best.avgPercent) {
      best = m;
    }
  });

  return best;
}

function getDefaultSelectedSetPath(decks) {
  if (!Array.isArray(decks)) return null;
  for (let i = 0; i < decks.length; i += 1) {
    const d = decks[i];
    if (Array.isArray(d.sets) && d.sets.length > 0) {
      return d.sets[0].id;
    }
    if (d.sets == null) {
      return d.id;
    }
  }
  return null;
}

module.exports = {
  calculatePercent,
  shuffleArray,
  getActiveTotalCards,
  getActiveCardAt,
  getRecommendedDeckFromScores,
  getDefaultSelectedSetPath
};
