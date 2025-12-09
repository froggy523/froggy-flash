// Renderer-side logic for Froggy Flash

const api = window.froggyApi;

let scoresBySet = {};
let scoresByDeck = {};
let currentSet = null;
let currentFilePath = null;
let currentIndex = 0;
let currentCorrectCount = 0;
let hasAnsweredCurrent = false;
let activeCardIndices = null;
let sessionHistory = [];
let currentSessionTopic = null;
let currentSessionStartedAt = null;
let availableDecks = [];
let selectedDeckId = null;
let isResizingDeckPanel = false;
let deckResizeStartX = 0;
let deckResizeStartWidth = 0;

function $(id) {
  return document.getElementById(id);
}

function formatDateTime(date) {
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  } catch {
    return '';
  }
}

function calculatePercent(correct, total) {
  if (!total) return 0;
  return Math.round((correct / total) * 100);
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

function getActiveTotalCards() {
  if (Array.isArray(activeCardIndices) && activeCardIndices.length > 0) {
    return activeCardIndices.length;
  }
  if (currentSet && Array.isArray(currentSet.cards)) {
    return currentSet.cards.length;
  }
  return 0;
}

function getActiveCardAt(index) {
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

function getRecommendedDeckFromScores() {
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

  // Prefer decks that have been played fewer times; break ties by lower average percent.
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

function updateScoreSidebar() {
  const scoreSetName = $('score-set-name');
  const scorePercent = $('score-percent');
  const scoreDetailLine = $('score-detail-line');
  const scoreLastPlayed = $('score-last-played');
  const progressFill = $('progress-fill');
  const progressLabelRight = $('progress-label-right');
  const statLastSession = $('stat-last-session');
  const statBestScore = $('stat-best-score');
  const historySummary = $('history-summary');
  const scoreTag = $('score-tag');

  if (!currentSet) {
    scoreSetName.innerHTML =
      '<span class="set-name-placeholder">No set selected</span>';
    scorePercent.innerHTML = '0<span class="unit">%</span>';
    scoreDetailLine.textContent = '0 / 0 correct';
    scoreLastPlayed.textContent = '';
    progressFill.style.width = '0%';
    progressLabelRight.textContent = '0 / 0';
    statLastSession.textContent = '–';
    statBestScore.textContent = '–';

    const rec = getRecommendedDeckFromScores();
    if (rec) {
      const name = rec.setName || rec.deckKey || 'Unnamed deck';
      historySummary.textContent = `Suggested next deck: ${name} · ${rec.plays || 0} session${
        rec.plays === 1 ? '' : 's'
      } · avg score ${rec.avgPercent}%`;
      scoreTag.textContent = 'Recommendation ready';
    } else {
      historySummary.textContent =
        'Load a flashcard set to start tracking your performance. Scores are saved per set name on this machine.';
      scoreTag.textContent = 'Awaiting session';
    }
    return;
  }

  const setKey = currentSet.name;
  const existingSet = scoresBySet[setKey];
  const deckKey = currentFilePath || null;
  const existingDeck = deckKey && scoresByDeck ? scoresByDeck[deckKey] : null;
  const totalCards = getActiveTotalCards();
  const sessionPercent = calculatePercent(currentCorrectCount, totalCards);

  scoreSetName.textContent = currentSet.name;
  scorePercent.innerHTML = `${sessionPercent}<span class="unit">%</span>`;
  scoreDetailLine.textContent = `${currentCorrectCount} / ${totalCards} correct`;

  const progressRatio = totalCards
    ? (currentIndex + (hasAnsweredCurrent ? 1 : 0)) / totalCards
    : 0;
  const progressPercent = Math.min(100, Math.max(0, Math.round(progressRatio * 100)));
  progressFill.style.width = `${progressPercent}%`;
  progressLabelRight.textContent = `${Math.min(
    totalCards,
    currentIndex + (hasAnsweredCurrent ? 1 : 0)
  )} / ${totalCards}`;

  if (existingDeck || existingSet) {
    const deckStats = existingDeck || existingSet;
    const setStats = existingSet || existingDeck;

    const deckLastP = calculatePercent(deckStats.lastCorrect, deckStats.lastTotal || 0);
    const setBestP = calculatePercent(setStats.bestCorrect, setStats.bestTotal || 0);

    statLastSession.textContent = `${deckStats.lastCorrect} / ${
      deckStats.lastTotal
    } (${deckLastP}%)`;
    statBestScore.textContent = `${setStats.bestCorrect} / ${
      setStats.bestTotal
    } (${setBestP}%)`;

    const lastPlayedSource = deckStats.lastPlayed || setStats.lastPlayed || null;
    historySummary.textContent = `Deck last session: ${deckStats.lastCorrect} / ${
      deckStats.lastTotal
    } (${deckLastP}%). Best across all decks for this set: ${setStats.bestCorrect} / ${
      setStats.bestTotal
    } (${setBestP}%).`;
    scoreLastPlayed.textContent = lastPlayedSource
      ? `Last: ${formatDateTime(lastPlayedSource)}`
      : '';
    scoreTag.textContent = existingDeck && existingSet ? 'Deck + set history' : 'History loaded';
  } else {
    statLastSession.textContent = '–';
    statBestScore.textContent = '–';
    historySummary.textContent =
      'No previous sessions recorded for this set yet. Complete a run to store your score.';
    scoreLastPlayed.textContent = '';
    scoreTag.textContent = 'New set';
  }
}

function renderQuestion() {
  const container = $('question-container');
  const emptyState = $('empty-state');

  if (!currentSet) {
    emptyState.style.display = 'block';
    container.innerHTML = '';
    container.appendChild(emptyState);
    updateScoreSidebar();
    return;
  }

  const totalCards = getActiveTotalCards();

  if (!currentSet.cards || totalCards === 0) {
    container.innerHTML =
      '<div class="empty-state">This set has no cards defined.</div>';
    updateScoreSidebar();
    return;
  }

  const card = getActiveCardAt(currentIndex);
  hasAnsweredCurrent = false;

  const wrapper = document.createElement('div');
  wrapper.className = 'question-card';

  const headerRow = document.createElement('div');
  headerRow.className = 'question-header-row';

  const qIndex = document.createElement('div');
  qIndex.className = 'q-index-pill';
  qIndex.textContent = `Question ${currentIndex + 1} of ${totalCards}`;

  const qMeta = document.createElement('div');
  qMeta.className = 'pill-muted';
  qMeta.textContent = 'Click an option to check your answer';

  headerRow.appendChild(qIndex);
  headerRow.appendChild(qMeta);

  const qText = document.createElement('div');
  qText.className = 'question-text';
  qText.textContent = card.question || '(no question text)';

  const choicesContainer = document.createElement('div');
  choicesContainer.className = 'choices';

  const answerKey = card.answer;

  const choiceKeys = card.choices ? Object.keys(card.choices) : [];
  // Shuffle the possible answers so they appear in a random order each time.
  shuffleArray(choiceKeys);

  let answerSummaryBox = null;

  function onChoiceClick(key, choiceElem, choiceData) {
    if (hasAnsweredCurrent) return;
    hasAnsweredCurrent = true;

    const isCorrect = key === answerKey;
    if (isCorrect) {
      currentCorrectCount += 1;
    }

    // Decorate all choices with correctness state
    const choiceDivs = choicesContainer.querySelectorAll('.choice');
    choiceDivs.forEach((div) => {
      const k = div.getAttribute('data-key');
      if (k === answerKey) {
        div.classList.add('correct');
      } else if (k === key) {
        div.classList.add('incorrect', 'chosen');
      }
      div.classList.add('disabled');
    });

    // Show explanation
    if (!answerSummaryBox) {
      answerSummaryBox = document.createElement('div');
      answerSummaryBox.className = 'answer-summary';
      wrapper.appendChild(answerSummaryBox);
    }

    answerSummaryBox.classList.toggle('correct', isCorrect);
    answerSummaryBox.classList.toggle('incorrect', !isCorrect);

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = isCorrect ? 'Correct answer' : 'Correct answer';

    const body = document.createElement('div');
    const correctChoice = card.choices ? card.choices[answerKey] : null;
    const correctText = correctChoice && correctChoice.text ? correctChoice.text : '';
    const cardExplanation = card.explanation || '';

    let html = '';
    html += `<div><strong>${answerKey}.</strong> ${correctText}</div>`;

    if (cardExplanation) {
      html += `<div style="margin-top:6px;">${cardExplanation}</div>`;
    }

    if (!isCorrect) {
      const wrongExpl =
        (choiceData && choiceData.explanation) ||
        (choiceData && choiceData.reason) ||
        '';
      if (wrongExpl) {
        html += `<div style="margin-top:6px; font-size:12px; color:var(--text-muted);"><strong>Why your choice was wrong:</strong> ${wrongExpl}</div>`;
      }
    }

    body.innerHTML = html;

    answerSummaryBox.innerHTML = '';
    answerSummaryBox.appendChild(label);
    answerSummaryBox.appendChild(body);

    updateScoreSidebar();
    updateNextButtonState();
  }

  choiceKeys.forEach((key) => {
    const choiceData = card.choices[key];
    const choice = document.createElement('div');
    choice.className = 'choice';
    choice.setAttribute('data-key', key);

    const label = document.createElement('div');
    label.className = 'choice-label';
    label.textContent = key.toUpperCase();

    const body = document.createElement('div');
    body.className = 'choice-body';

    const text = document.createElement('div');
    text.className = 'choice-text';
    text.textContent = (choiceData && choiceData.text) || '(no text)';

    const expl = document.createElement('div');
    expl.className = 'choice-expl';
    if (choiceData && choiceData.explanation) {
      expl.textContent = choiceData.explanation;
    } else {
      expl.textContent = '';
    }

    body.appendChild(text);
    if (expl.textContent) {
      body.appendChild(expl);
    }

    choice.appendChild(label);
    choice.appendChild(body);

    choice.addEventListener('click', () => onChoiceClick(key, choice, choiceData));

    choicesContainer.appendChild(choice);
  });

  wrapper.appendChild(headerRow);
  wrapper.appendChild(qText);
  wrapper.appendChild(choicesContainer);

  const controls = document.createElement('div');
  controls.className = 'controls-row';

  const progressPill = document.createElement('div');
  progressPill.className = 'pill-text';
  progressPill.textContent = `Answered: ${currentCorrectCount} correct so far`;

  const nextBtn = document.createElement('button');
  nextBtn.id = 'next-btn';
  nextBtn.className = 'next-btn';
  nextBtn.disabled = true;

  const isLast = currentIndex === totalCards - 1;
  nextBtn.innerHTML = `<span>${isLast ? 'Finish Set' : 'Next Question'}</span><span class="icon">${
    isLast ? '✅' : '➡️'
  }</span>`;

  nextBtn.addEventListener('click', () => {
    if (!hasAnsweredCurrent) return;
    if (currentIndex < totalCards - 1) {
      currentIndex += 1;
      renderQuestion();
    } else {
      // Finished the set; persist score
      persistFinalScore();
      showSessionSummary();
    }
  });

  controls.appendChild(progressPill);
  controls.appendChild(nextBtn);

  wrapper.appendChild(controls);

  const containerEl = $('question-container');
  containerEl.innerHTML = '';
  // ensure empty state is hidden
  const empty = $('empty-state');
  if (empty) empty.style.display = 'none';
  containerEl.appendChild(wrapper);

  updateScoreSidebar();
}

function updateNextButtonState() {
  const btn = $('next-btn');
  if (!btn) return;
  btn.disabled = !hasAnsweredCurrent;
}

async function persistFinalScore() {
  if (!currentSet) return;
  const setKey = currentSet.name;
  const deckKey = currentFilePath || null;
  const total = getActiveTotalCards();
  const correct = currentCorrectCount;
  const now = new Date().toISOString();
  const sessionStartedAt = currentSessionStartedAt || null;
  const percent = calculatePercent(correct, total);

  const historyEntry = {
    startedAt: sessionStartedAt,
    finishedAt: now,
    correct,
    total,
    percent
  };

  // Update per-set (higher-level) stats, keyed by set name.
  const existingSet = scoresBySet[setKey];
  if (!existingSet) {
    let setHistory = [];
    setHistory.push(historyEntry);
    scoresBySet[setKey] = {
      lastCorrect: correct,
      lastTotal: total,
      lastPlayed: now,
      bestCorrect: correct,
      bestTotal: total,
      history: setHistory
    };
  } else {
    const bestPercent = calculatePercent(existingSet.bestCorrect, existingSet.bestTotal || 0);
    const better = percent > bestPercent;

    let setHistory = Array.isArray(existingSet.history) ? existingSet.history.slice() : [];
    setHistory.push(historyEntry);
    if (setHistory.length > 100) {
      setHistory = setHistory.slice(-100);
    }

    scoresBySet[setKey] = {
      lastCorrect: correct,
      lastTotal: total,
      lastPlayed: now,
      bestCorrect: better ? correct : existingSet.bestCorrect,
      bestTotal: better ? total : existingSet.bestTotal,
      history: setHistory
    };
  }

  // Update per-deck stats, keyed by actual file path where available.
  if (deckKey) {
    const existingDeck = scoresByDeck[deckKey];
    if (!existingDeck) {
      let deckHistory = [];
      deckHistory.push(historyEntry);
      scoresByDeck[deckKey] = {
        lastCorrect: correct,
        lastTotal: total,
        lastPlayed: now,
        bestCorrect: correct,
        bestTotal: total,
        setName: setKey || null,
        history: deckHistory
      };
    } else {
      const bestPercentDeck = calculatePercent(
        existingDeck.bestCorrect,
        existingDeck.bestTotal || 0
      );
      const betterDeck = percent > bestPercentDeck;

      let deckHistory = Array.isArray(existingDeck.history)
        ? existingDeck.history.slice()
        : [];
      deckHistory.push(historyEntry);
      if (deckHistory.length > 100) {
        deckHistory = deckHistory.slice(-100);
      }

      scoresByDeck[deckKey] = {
        lastCorrect: correct,
        lastTotal: total,
        lastPlayed: now,
        bestCorrect: betterDeck ? correct : existingDeck.bestCorrect,
        bestTotal: betterDeck ? total : existingDeck.bestTotal,
        setName: setKey || existingDeck.setName || null,
        history: deckHistory
      };
    }
  }

  try {
    await api.saveScores({
      bySet: scoresBySet,
      byDeck: scoresByDeck
    });
  } catch (e) {
    console.error('Failed to persist scores:', e);
  }

  // Record full session history entry; a cancelled test never reaches here.
  try {
    const entry = {
      topic: currentSessionTopic || setKey || 'Untitled topic',
      setName: setKey || null,
      totalQuestions: total,
      correct,
      finishedAt: now,
      startedAt: currentSessionStartedAt || null
    };
    const res = await api.appendSessionHistory(entry);
    if (!res || res.ok === false) {
      console.error('Failed to append session history entry:', res && res.error);
    } else {
      sessionHistory.push(entry);
      renderSessionHistory();
    }
  } catch (e) {
    console.error('Failed to record session history:', e);
  }

  updateScoreSidebar();
}

function showSessionSummary() {
  if (!currentSet) return;
  const container = $('question-container');
  const total = getActiveTotalCards();
  const correct = currentCorrectCount;
  const percent = calculatePercent(correct, total);

  const summary = document.createElement('div');
  summary.className = 'question-card';
  summary.innerHTML = `
    <div class="question-header-row">
      <div class="q-index-pill">Session Complete</div>
      <div class="pill-muted">You can reload this set to practice again</div>
    </div>
    <div class="question-text" style="margin-bottom:12px;">
      You answered <strong>${correct}</strong> out of <strong>${total}</strong> questions correctly.
    </div>
    <div class="answer-summary ${
      percent >= 80 ? 'correct' : percent >= 50 ? '' : 'incorrect'
    }">
      <div class="label">Overall score</div>
      <div style="font-size:20px;font-weight:600;margin-bottom:6px;">${percent}%</div>
      <div>
        ${
          percent === 100
            ? 'Perfect! Excellent recall.'
            : percent >= 80
            ? 'Great work — just a bit more practice to reach 100%.'
            : percent >= 50
            ? 'Solid attempt; another pass through the cards will help solidify things.'
            : 'Good start. Consider re-running the set and focusing on the explanations for missed questions.'
        }
      </div>
    </div>
  `;

  container.innerHTML = '';
  container.appendChild(summary);
}

async function loadScoresOnStartup() {
  try {
    const loaded = await api.loadScores();
    if (loaded && typeof loaded === 'object') {
      // New structured format: { bySet: { ... }, byDeck: { ... } }
      if (loaded.bySet || loaded.byDeck) {
        scoresBySet =
          loaded.bySet && typeof loaded.bySet === 'object' && loaded.bySet !== null
            ? loaded.bySet
            : {};
        scoresByDeck =
          loaded.byDeck && typeof loaded.byDeck === 'object' && loaded.byDeck !== null
            ? loaded.byDeck
            : {};
      } else {
        // Legacy flat object shape where everything was per set.
        scoresBySet = loaded;
        scoresByDeck = {};
      }
    } else {
      scoresBySet = {};
      scoresByDeck = {};
    }
  } catch (e) {
    console.error('Failed to load scores:', e);
    scoresBySet = {};
    scoresByDeck = {};
  }
  updateScoreSidebar();
}

async function loadSessionHistoryOnStartup() {
  try {
    const loaded = await api.loadSessionHistory();
    if (Array.isArray(loaded)) {
      sessionHistory = loaded;
    } else {
      sessionHistory = [];
    }
  } catch (e) {
    console.error('Failed to load session history:', e);
    sessionHistory = [];
  }
  renderSessionHistory();
}

function renderDeckList() {
  const listEl = $('deck-list');
  const emptyEl = $('deck-list-empty');
  const statusEl = $('deck-panel-status');

  if (!listEl) return;

  listEl.innerHTML = '';

  if (!availableDecks || availableDecks.length === 0) {
    if (statusEl) {
      statusEl.textContent = 'No decks';
    }
    if (emptyEl) {
      emptyEl.style.display = 'block';
      listEl.appendChild(emptyEl);
    }
    return;
  }

  if (emptyEl) {
    emptyEl.style.display = 'none';
  }
  if (statusEl) {
    statusEl.textContent = `${availableDecks.length} deck${
      availableDecks.length === 1 ? '' : 's'
    }`;
  }

  availableDecks.forEach((deck) => {
    const item = document.createElement('div');
    item.className = 'deck-item';
    item.setAttribute('data-id', deck.id);

    const nameEl = document.createElement('div');
    nameEl.className = 'deck-item-name';
    nameEl.textContent = deck.name || deck.fileName || 'Untitled deck';

    item.appendChild(nameEl);

    if (deck.id === selectedDeckId) {
      item.classList.add('selected');
    }

    item.addEventListener('click', () => {
      selectedDeckId = deck.id;
      // Re-render selection state without rebuilding score/sidebar.
      const siblings = listEl.querySelectorAll('.deck-item');
      siblings.forEach((el) => {
        if (el.getAttribute('data-id') === deck.id) {
          el.classList.add('selected');
        } else {
          el.classList.remove('selected');
        }
      });
    });

    listEl.appendChild(item);
  });
}

async function loadDeckListOnStartup() {
  const statusEl = $('deck-panel-status');
  if (statusEl) {
    statusEl.textContent = 'Loading…';
  }

  try {
    const decks = await api.listDecks();
    if (Array.isArray(decks)) {
      availableDecks = decks;
      if (availableDecks.length > 0) {
        selectedDeckId = availableDecks[0].id;
      }
    } else {
      availableDecks = [];
      selectedDeckId = null;
    }
  } catch (e) {
    console.error('Failed to load deck list:', e);
    availableDecks = [];
    selectedDeckId = null;
  }

  renderDeckList();
}

async function initDeckPanelResizer() {
  const handle = document.getElementById('deck-resize-handle');
  const deckPanel = document.getElementById('deck-panel');
  if (!handle || !deckPanel) return;

  const root = document.documentElement;
  const MIN_WIDTH = 180;
  const MAX_WIDTH_FRACTION = 0.5;

  // Restore persisted width if present.
  try {
    if (api && typeof api.loadUiConfig === 'function') {
      const loaded = await api.loadUiConfig();
      const stored =
        loaded && typeof loaded.deckPanelWidth === 'number'
          ? loaded.deckPanelWidth
          : null;
      if (stored != null) {
        const clamped = Math.max(
          MIN_WIDTH,
          Math.min(stored, Math.floor(window.innerWidth * MAX_WIDTH_FRACTION))
        );
        root.style.setProperty('--deck-panel-width', `${clamped}px`);
      }
    }
  } catch (e) {
    console.error('Failed to restore deck panel width from config:', e);
  }

  function onMouseMove(e) {
    if (!isResizingDeckPanel) return;
    const delta = e.clientX - deckResizeStartX;
    let newWidth = deckResizeStartWidth + delta;
    const maxWidth = Math.floor(window.innerWidth * MAX_WIDTH_FRACTION);
    newWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth));
    root.style.setProperty('--deck-panel-width', `${newWidth}px`);
  }

  function stopResize() {
    if (!isResizingDeckPanel) return;
    isResizingDeckPanel = false;
    handle.classList.remove('is-dragging');
    try {
      const style = getComputedStyle(document.documentElement);
      const value = style.getPropertyValue('--deck-panel-width');
      if (value) {
        const numeric = parseInt(value, 10);
        if (!Number.isNaN(numeric) && numeric > 0) {
          if (api && typeof api.saveUiConfig === 'function') {
            api
              .saveUiConfig({ deckPanelWidth: numeric })
              .catch((err) =>
                console.error('Failed to persist deck panel width to config:', err)
              );
          }
        }
      }
    } catch (e) {
      console.error('Failed to read deck panel width for persistence:', e);
    }
  }

  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const rect = deckPanel.getBoundingClientRect();
    isResizingDeckPanel = true;
    deckResizeStartX = e.clientX;
    deckResizeStartWidth = rect.width;
    handle.classList.add('is-dragging');
    e.preventDefault();
  });

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', stopResize);
}

function startSessionFromSet(set, filePath) {
  // Derive topic automatically
  const topic = (set.name && String(set.name).trim()) || 'Untitled topic';

  const maxQuestions = Array.isArray(set.cards) ? set.cards.length : 0;
  if (!maxQuestions) {
    window.alert('This set has no cards defined.');
    return false;
  }

  const questionCount = Math.min(10, maxQuestions) || maxQuestions;

  currentSet = set;
  currentFilePath = filePath || null;
  currentIndex = 0;
  currentCorrectCount = 0;
  hasAnsweredCurrent = false;
  currentSessionTopic = topic;
  currentSessionStartedAt = new Date().toISOString();

  // Randomly shuffle and take N cards for this session.
  activeCardIndices = [];
  for (let i = 0; i < maxQuestions; i += 1) {
    activeCardIndices.push(i);
  }
  shuffleArray(activeCardIndices);
  activeCardIndices = activeCardIndices.slice(0, questionCount);

  const metaName = $('set-meta');
  const setFileLabel = $('set-file-label');

  const titleEl = metaName ? metaName.querySelector('.set-meta-title') : null;
  const descEl = metaName ? metaName.querySelector('.set-meta-desc') : null;

  if (titleEl) {
    titleEl.textContent = set.name || 'Unnamed set';
    titleEl.classList.remove('set-name-placeholder');
  }
  if (descEl) {
    descEl.textContent = set.description || 'No description provided for this flashcard set.';
  }
  if (setFileLabel) {
    setFileLabel.textContent = filePath ? `File: ${filePath}` : '';
  }

  renderQuestion();
  return true;
}

function renderSessionHistory() {
  const listEl = $('session-history-list');
  const emptyEl = $('session-history-empty');
  if (!listEl) return;

  listEl.innerHTML = '';

  if (!sessionHistory || sessionHistory.length === 0) {
    if (emptyEl) {
      emptyEl.style.display = 'block';
      listEl.appendChild(emptyEl);
    }
    return;
  }

  if (emptyEl) {
    emptyEl.style.display = 'none';
  }

  // Most recent first
  const sessions = [...sessionHistory].sort((a, b) => {
    const tA = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
    const tB = b.finishedAt ? new Date(b.finishedAt).getTime() : 0;
    return tB - tA;
  });

  sessions.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'session-row';

    const left = document.createElement('div');
    const topic = document.createElement('div');
    topic.className = 'session-topic';
    topic.textContent = s.topic || s.setName || 'Untitled topic';

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    const dt = s.finishedAt ? formatDateTime(s.finishedAt) : '';
    const count = s.totalQuestions != null ? s.totalQuestions : s.total || 0;
    meta.textContent = `${dt}${dt && count ? ' · ' : ''}${
      count ? `${count} questions` : ''
    }`;

    left.appendChild(topic);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.className = 'session-score';
    const total = s.totalQuestions != null ? s.totalQuestions : s.total || 0;
    const correct = s.correct != null ? s.correct : s.lastCorrect || 0;
    const percent = calculatePercent(correct, total);
    right.textContent = `${percent}%`;

    row.appendChild(left);
    row.appendChild(right);

    listEl.appendChild(row);
  });
}

async function handleLoadSetClicked() {
  try {
    if (!selectedDeckId) {
      window.alert('Please select a deck from the list on the left before starting a new session.');
      return;
    }

    const result = await api.loadDeckByPath(selectedDeckId);
    if (!result || result.canceled) {
      if (result && result.error) {
        window.alert(`Could not load this deck:\n\n${result.error}`);
      }
      return;
    }

    const { set, filePath } = result;
    startSessionFromSet(set, filePath);
  } catch (e) {
    console.error('Failed to load set:', e);
  }
}

async function handleBrowseDeckClicked() {
  try {
    const result = await api.openFlashcardFile();
    if (!result) {
      window.alert(
        'Something went wrong while opening the deck (no response from main process). Please try again.'
      );
      return;
    }

    if (result.canceled) {
      if (result.error) {
        window.alert(`Could not load this deck:\n\n${result.error}`);
      }
      return;
    }

    const { set, filePath } = result;

    // Add or update a temporary deck entry for this path so it can be reselected.
    if (filePath) {
      const existingIndex = availableDecks.findIndex((d) => d.id === filePath);
      const displayName = (set.name && String(set.name)) || 'Untitled deck';
      const fileName = filePath.split(/[\\/]/).pop() || filePath;

      const deckEntry = {
        id: filePath,
        name: displayName,
        fileName
      };

      if (existingIndex >= 0) {
        availableDecks[existingIndex] = deckEntry;
      } else {
        availableDecks.push(deckEntry);
      }
      selectedDeckId = filePath;
      renderDeckList();
    }

    startSessionFromSet(set, filePath);
  } catch (e) {
    console.error('Failed to browse and load deck:', e);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const loadBtn = $('load-set-btn');
  if (loadBtn) {
    loadBtn.addEventListener('click', handleLoadSetClicked);
  }

  const browseBtn = $('deck-browse-btn');
  if (browseBtn) {
    browseBtn.addEventListener('click', handleBrowseDeckClicked);
  }

  const exportBtn = $('export-data-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        const result = await api.exportGraphData();
        if (!result) {
          window.alert('Export failed: no response from main process.');
          return;
        }
        if (result.canceled) {
          return;
        }
        if (result.ok) {
          window.alert(`Exported data to:\n\n${result.filePath}`);
        } else {
          window.alert(`Export failed:\n\n${result.error || 'Unknown error'}`);
        }
      } catch (e) {
        console.error('Failed to export graph data:', e);
        window.alert('Export failed due to an unexpected error. Check the console for details.');
      }
    });
  }

  loadScoresOnStartup();
  loadSessionHistoryOnStartup();
  loadDeckListOnStartup();
  initDeckPanelResizer();
});


