// Renderer-side logic for Froggy Flash

const api = window.froggyApi;
const quiz = window.froggyQuiz;

if (typeof marked !== 'undefined' && typeof marked.setOptions === 'function') {
  marked.setOptions({ gfm: true, breaks: true });
}

/**
 * Renders card question text as GitHub-flavored Markdown into `el` (sanitized).
 * Falls back to plain text if libraries are missing.
 */
function setQuestionMarkdown(el, source) {
  const md = source != null ? String(source) : '';
  el.classList.add('markdown-body');
  if (!md.trim()) {
    el.innerHTML = '';
    el.textContent = '(no question text)';
    return;
  }
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    try {
      const html = marked.parse(md);
      el.innerHTML = DOMPurify.sanitize(html);
      return;
    } catch (err) {
      console.warn('Question markdown render failed:', err);
    }
  }
  el.innerHTML = '';
  el.textContent = md;
}

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
/** Category manifest paths (`*.deck.json`) with expanded topic children in the sidebar tree. */
let expandedDeckIds = new Set();
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
      '<span class="set-name-placeholder">No topic selected</span>';
    scorePercent.innerHTML = '0<span class="unit">%</span>';
    scoreDetailLine.textContent = '0 / 0 correct';
    scoreLastPlayed.textContent = '';
    progressFill.style.width = '0%';
    progressLabelRight.textContent = '0 / 0';
    statLastSession.textContent = '–';
    statBestScore.textContent = '–';

    const rec = quiz.getRecommendedDeckFromScores(scoresByDeck);
    if (rec) {
      const name = rec.setName || rec.deckKey || 'Unnamed category';
      historySummary.textContent = `Suggested next category: ${name} · ${rec.plays || 0} session${
        rec.plays === 1 ? '' : 's'
      } · avg score ${rec.avgPercent}%`;
      scoreTag.textContent = 'Recommendation ready';
    } else {
      historySummary.textContent =
        'Load a topic to start tracking your performance. Scores are saved per topic name on this machine.';
      scoreTag.textContent = 'Awaiting session';
    }
    return;
  }

  const setKey = currentSet.name;
  const existingSet = scoresBySet[setKey];
  const deckKey = currentFilePath || null;
  const existingDeck = deckKey && scoresByDeck ? scoresByDeck[deckKey] : null;
  const totalCards = quiz.getActiveTotalCards(currentSet, activeCardIndices);
  const sessionPercent = quiz.calculatePercent(currentCorrectCount, totalCards);

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

    const deckLastP = quiz.calculatePercent(deckStats.lastCorrect, deckStats.lastTotal || 0);
    const setBestP = quiz.calculatePercent(setStats.bestCorrect, setStats.bestTotal || 0);

    statLastSession.textContent = `${deckStats.lastCorrect} / ${
      deckStats.lastTotal
    } (${deckLastP}%)`;
    statBestScore.textContent = `${setStats.bestCorrect} / ${
      setStats.bestTotal
    } (${setBestP}%)`;

    const lastPlayedSource = deckStats.lastPlayed || setStats.lastPlayed || null;
    historySummary.textContent = `Category last session: ${deckStats.lastCorrect} / ${
      deckStats.lastTotal
    } (${deckLastP}%). Best for this topic across categories: ${setStats.bestCorrect} / ${
      setStats.bestTotal
    } (${setBestP}%).`;
    scoreLastPlayed.textContent = lastPlayedSource
      ? `Last: ${formatDateTime(lastPlayedSource)}`
      : '';
    scoreTag.textContent =
      existingDeck && existingSet ? 'Category + topic history' : 'History loaded';
  } else {
    statLastSession.textContent = '–';
    statBestScore.textContent = '–';
    historySummary.textContent =
      'No previous sessions recorded for this topic yet. Complete a run to store your score.';
    scoreLastPlayed.textContent = '';
    scoreTag.textContent = 'New topic';
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

  const totalCards = quiz.getActiveTotalCards(currentSet, activeCardIndices);

  if (!currentSet.cards || totalCards === 0) {
    container.innerHTML =
      '<div class="empty-state">This topic has no cards defined.</div>';
    updateScoreSidebar();
    return;
  }

  const card = quiz.getActiveCardAt(currentSet, activeCardIndices, currentIndex);
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
  setQuestionMarkdown(qText, card.question);

  const choicesContainer = document.createElement('div');
  choicesContainer.className = 'choices';

  const answerKey = card.answer;

  const choiceKeys = card.choices ? Object.keys(card.choices) : [];
  // Shuffle the possible answers so they appear in a random order each time.
  quiz.shuffleArray(choiceKeys);

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

    choicesContainer.querySelectorAll('.choice-expl').forEach((el) => {
      el.hidden = false;
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
    const choiceWrongHint =
      (choiceData && choiceData.explanation) || (choiceData && choiceData.reason) || '';
    expl.textContent = choiceWrongHint;
    expl.hidden = true;

    body.appendChild(text);
    if (choiceWrongHint) {
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
  const total = quiz.getActiveTotalCards(currentSet, activeCardIndices);
  const correct = currentCorrectCount;
  const now = new Date().toISOString();
  const sessionStartedAt = currentSessionStartedAt || null;
  const percent = quiz.calculatePercent(correct, total);

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
    const bestPercent = quiz.calculatePercent(existingSet.bestCorrect, existingSet.bestTotal || 0);
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
      const bestPercentDeck = quiz.calculatePercent(
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
  const total = quiz.getActiveTotalCards(currentSet, activeCardIndices);
  const correct = currentCorrectCount;
  const percent = quiz.calculatePercent(correct, total);

  const summary = document.createElement('div');
  summary.className = 'question-card';
  summary.innerHTML = `
    <div class="question-header-row">
      <div class="q-index-pill">Session Complete</div>
      <div class="pill-muted">You can start another session on this topic to practice again</div>
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
            : 'Good start. Consider another pass and focusing on the explanations for missed questions.'
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

function toggleDeckExpanded(deckManifestPath) {
  if (expandedDeckIds.has(deckManifestPath)) {
    expandedDeckIds.delete(deckManifestPath);
  } else {
    expandedDeckIds.add(deckManifestPath);
  }
}

async function startDynamicQuizForTopic(category, setInfo) {
  if (!category || !Array.isArray(category.sets)) {
    window.alert('Dynamic quizzes are only available for topics inside a category (library folder).');
    return;
  }
  if (!setInfo || !setInfo.id) {
    window.alert('Select a topic row with a Dynamic button.');
    return;
  }
  const topicLabel =
    (setInfo.name && String(setInfo.name).trim()) ||
    (setInfo.fileName && String(setInfo.fileName).replace(/\.json$/i, '').trim()) ||
    'Untitled topic';
  try {
    const res = await withLlmGenerationWaitModal(
      {
        title: 'Generating question pool',
        message: `Creating 50 questions about “${topicLabel}”. Slower models can take a minute or more.`
      },
      () =>
        api.generateDynamicQuizViaLlm({
          deckManifestPath: category.id,
          topicLabel,
          topicSetPath: setInfo.id
        })
    );
    if (!res || !res.ok) {
      if (res && res.cancelled) {
        renderDeckList();
        return;
      }
      window.alert(res && res.error ? res.error : 'Generation failed.');
      renderDeckList();
      return;
    }
    const sessionSet = {
      ...res.set,
      name: `${topicLabel} · dynamic quiz`,
      description:
        res.set && res.set.description
          ? `${res.set.description} Each session randomly picks 10 questions from a ~50-card LLM pool.`
          : 'Each session randomly picks 10 questions from a ~50-card LLM pool.'
    };
    startSessionFromSet(sessionSet, setInfo.id);
    renderDeckList();
  } catch (e) {
    console.error(e);
    window.alert(e && e.message ? e.message : 'Dynamic quiz failed.');
    renderDeckList();
  }
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
      statusEl.textContent = 'Empty library';
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

  let topicCount = 0;
  let categoryCount = 0;
  availableDecks.forEach((d) => {
    if (Array.isArray(d.sets)) {
      categoryCount += 1;
      topicCount += d.sets.length;
    } else if (d.sets == null) {
      topicCount += 1;
    }
  });

  if (statusEl) {
    if (categoryCount > 0) {
      const catLabel = `${categoryCount} categor${categoryCount === 1 ? 'y' : 'ies'}`;
      const topLabel = `${topicCount} topic${topicCount === 1 ? '' : 's'}`;
      statusEl.textContent = `${catLabel} · ${topLabel}`;
    } else {
      statusEl.textContent = `${topicCount} topic file${topicCount === 1 ? '' : 's'}`;
    }
  }

  function applySelectionHighlight() {
    listEl.querySelectorAll('[data-set-path]').forEach((el) => {
      const p = el.getAttribute('data-set-path');
      if (p === selectedDeckId) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
  }

  availableDecks.forEach((deck) => {
    const isStructured = Array.isArray(deck.sets);
    if (!isStructured) {
      const item = document.createElement('div');
      item.className = 'deck-item deck-tree-flat';
      item.setAttribute('data-set-path', deck.id);

      const nameEl = document.createElement('div');
      nameEl.className = 'deck-item-name';
      nameEl.textContent = deck.name || deck.fileName || 'Untitled topic';

      item.appendChild(nameEl);

      if (deck.id === selectedDeckId) {
        item.classList.add('selected');
      }

      item.addEventListener('click', () => {
        selectedDeckId = deck.id;
        applySelectionHighlight();
      });

      listEl.appendChild(item);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'deck-tree-deck';

    const expanded = expandedDeckIds.has(deck.id);
    const setRows = deck.sets;

    const header = document.createElement('div');
    header.className = 'deck-tree-deck-header';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'deck-tree-toggle';
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.textContent = expanded ? '▼' : '▶';

    const title = document.createElement('div');
    title.className = 'deck-tree-deck-title';
    title.textContent = deck.name || deck.fileName || 'Untitled category';

    const editCategoryBtn = document.createElement('button');
    editCategoryBtn.type = 'button';
    editCategoryBtn.className = 'deck-tree-category-settings-btn';
    editCategoryBtn.textContent = '...';
    editCategoryBtn.title =
      'Edit this category: rename, import topics, generate with LLM, or delete the category';
    editCategoryBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openManageCategoryModal(deck.id).catch((err) => console.error('Edit category:', err));
    });

    header.appendChild(toggle);
    header.appendChild(title);
    header.appendChild(editCategoryBtn);

    header.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleDeckExpanded(deck.id);
      renderDeckList();
    });

    const children = document.createElement('div');
    children.className = 'deck-tree-children';
    children.hidden = !expanded;

    if (!setRows.length) {
      const emptySet = document.createElement('div');
      emptySet.className = 'deck-tree-empty-sets';
      emptySet.textContent =
        'No topic JSON files in this category’s folder yet. Add .json files (name + cards) there.';
      children.appendChild(emptySet);
    } else {
      setRows.forEach((setInfo) => {
        const row = document.createElement('div');
        row.className = 'deck-item deck-tree-set deck-tree-topic-row';
        row.setAttribute('data-set-path', setInfo.id);

        const nameEl = document.createElement('div');
        nameEl.className = 'deck-item-name';
        nameEl.textContent = setInfo.name || setInfo.fileName || 'Untitled topic';

        const dynBtn = document.createElement('button');
        dynBtn.type = 'button';
        dynBtn.className = 'deck-tree-dynamic-inline-btn';
        dynBtn.textContent = 'Dynamic';
        dynBtn.title =
          'LLM generates 50 transient cards about this topic (plus optional JSON description and category manifest as context); each session quizzes 10 at random. Configure Settings → LLM first.';

        row.appendChild(nameEl);
        row.appendChild(dynBtn);

        if (setInfo.id === selectedDeckId) {
          row.classList.add('selected');
        }

        dynBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          void startDynamicQuizForTopic(deck, setInfo);
        });

        row.addEventListener('click', (e) => {
          e.stopPropagation();
          selectedDeckId = setInfo.id;
          applySelectionHighlight();
        });

        children.appendChild(row);
      });
    }

    wrap.appendChild(header);
    wrap.appendChild(children);
    listEl.appendChild(wrap);
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
      expandedDeckIds = new Set();
      availableDecks.forEach((d) => {
        if (Array.isArray(d.sets) && d.sets.length > 0) {
          expandedDeckIds.add(d.id);
        }
      });
      selectedDeckId = quiz.getDefaultSelectedSetPath(availableDecks);
    } else {
      availableDecks = [];
      expandedDeckIds = new Set();
      selectedDeckId = null;
    }
  } catch (e) {
    console.error('Failed to load deck list:', e);
    availableDecks = [];
    expandedDeckIds = new Set();
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
    window.alert('This topic has no cards defined.');
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
  quiz.shuffleArray(activeCardIndices);
  activeCardIndices = activeCardIndices.slice(0, questionCount);

  const metaName = $('set-meta');
  const setFileLabel = $('set-file-label');

  const titleEl = metaName ? metaName.querySelector('.set-meta-title') : null;
  const descEl = metaName ? metaName.querySelector('.set-meta-desc') : null;

  if (titleEl) {
    titleEl.textContent = set.name || 'Unnamed topic';
    titleEl.classList.remove('set-name-placeholder');
  }
  if (descEl) {
    descEl.textContent = set.description || 'No description provided for this topic.';
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
    const percent = quiz.calculatePercent(correct, total);
    right.textContent = `${percent}%`;

    row.appendChild(left);
    row.appendChild(right);

    listEl.appendChild(row);
  });
}

async function handleLoadSetClicked() {
  try {
    if (!selectedDeckId) {
      window.alert(
        'Please expand a category and select a topic on the left before starting a new session.'
      );
      return;
    }

    const result = await api.loadDeckByPath(selectedDeckId);
    if (!result || result.canceled) {
      if (result && result.error) {
        window.alert(`Could not load this topic:\n\n${result.error}`);
      }
      return;
    }

    const { set, filePath } = result;
    startSessionFromSet(set, filePath);
  } catch (e) {
    console.error('Failed to load set:', e);
  }
}

function getModalRoot() {
  return document.getElementById('modal-root');
}

function closeAllModals() {
  window.removeEventListener('keydown', onModalEscapeKey);
  const root = getModalRoot();
  if (root) {
    Array.from(root.querySelectorAll('.modal-overlay')).forEach((open) => {
      if (open && typeof open._froggyUpdateUnsub === 'function') {
        try {
          open._froggyUpdateUnsub();
        } catch (_) {
          /* ignore */
        }
      }
      if (open && typeof open._froggyWaitTeardown === 'function') {
        try {
          open._froggyWaitTeardown();
        } catch (_) {
          /* ignore */
        }
      }
    });
    root.innerHTML = '';
  }
  document.body.style.overflow = '';
}

/**
 * Modal wait while the main process calls the LLM. Stacks above any open modal.
 * Escape or Cancel aborts the in-flight HTTP request.
 */
async function withLlmGenerationWaitModal({ title, message }, invokeGeneration) {
  if (typeof invokeGeneration !== 'function') {
    throw new Error('invokeGeneration is required.');
  }
  const root = getModalRoot();
  if (!root) {
    return invokeGeneration();
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay llm-wait-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';
  dialog.style.maxWidth = '440px';
  dialog.addEventListener('click', (e) => e.stopPropagation());

  const header = document.createElement('div');
  header.className = 'modal-header';
  const titleEl = document.createElement('div');
  titleEl.className = 'modal-title';
  titleEl.textContent = title || 'Generating…';
  header.appendChild(titleEl);

  const body = document.createElement('div');
  body.className = 'modal-body';
  const msg = document.createElement('p');
  msg.style.margin = '0 0 14px';
  msg.style.fontSize = '13px';
  msg.style.lineHeight = '1.45';
  msg.style.color = 'var(--text)';
  msg.textContent =
    message ||
    'Talking to your LLM provider. This may take a while depending on model size and card count.';

  const spinnerRow = document.createElement('div');
  spinnerRow.className = 'llm-wait-spinner-row';
  const spinner = document.createElement('div');
  spinner.className = 'llm-wait-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  spinnerRow.appendChild(spinner);

  const hint = document.createElement('div');
  hint.className = 'modal-hint';
  hint.style.marginTop = '10px';
  hint.textContent = 'Press Escape or use Cancel to stop the request.';

  body.appendChild(msg);
  body.appendChild(spinnerRow);
  body.appendChild(hint);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'modal-btn';
  cancelBtn.textContent = 'Cancel';

  footer.appendChild(cancelBtn);
  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);

  let cleaned = false;
  const teardown = () => {
    if (cleaned) return;
    cleaned = true;
    if (overlay._froggyWaitEsc) {
      window.removeEventListener('keydown', overlay._froggyWaitEsc, true);
      overlay._froggyWaitEsc = null;
    }
    overlay.remove();
    const still = root.querySelector('.modal-overlay');
    if (!still) {
      document.body.style.overflow = '';
    }
  };
  overlay._froggyWaitTeardown = teardown;

  const onEscapeCapture = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!cancelBtn.disabled) {
      cancelBtn.click();
    }
  };

  cancelBtn.addEventListener('click', () => {
    if (cancelBtn.disabled) return;
    cancelBtn.disabled = true;
    if (typeof api.cancelLlmGeneration === 'function') {
      api.cancelLlmGeneration().catch((err) => console.error(err));
    }
  });

  root.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  overlay.classList.add('is-open');
  overlay._froggyWaitEsc = onEscapeCapture;
  window.addEventListener('keydown', onEscapeCapture, true);

  try {
    return await invokeGeneration();
  } finally {
    teardown();
    delete overlay._froggyWaitTeardown;
  }
}

function onModalEscapeKey(e) {
  if (e.key !== 'Escape') return;
  const root = getModalRoot();
  let reopenCategoryPath = null;
  if (root) {
    const overlays = root.querySelectorAll('.modal-overlay');
    for (let i = overlays.length - 1; i >= 0; i--) {
      const el = overlays[i];
      const p = el && el._froggyReopenCategoryOnDismiss;
      if (typeof p === 'string' && p.length) {
        reopenCategoryPath = p;
        break;
      }
    }
  }
  closeAllModals();
  if (reopenCategoryPath) {
    void openManageCategoryModal(reopenCategoryPath);
  }
}

function mountModalOverlay(overlay) {
  const root = getModalRoot();
  if (!root) return;
  closeAllModals();
  root.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  overlay.classList.add('is-open');
  window.addEventListener('keydown', onModalEscapeKey);
}

function isStructuredDeck(deck) {
  return deck && Array.isArray(deck.sets);
}

async function openCardSetEditorModal(filePath, onAfterSave) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog modal-wide';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = 'Edit topic JSON';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => {
    closeAllModals();
  });
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';

  const ta = document.createElement('textarea');
  ta.className = 'modal-textarea';
  ta.spellcheck = false;
  body.appendChild(ta);

  const hint = document.createElement('div');
  hint.className = 'modal-hint';
  hint.textContent =
    'Must match Froggy Flash topic JSON: name, description (optional), cards with question, choices, answer, explanation per card.';
  body.appendChild(hint);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'modal-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => closeAllModals());
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'modal-btn modal-btn-primary';
  save.textContent = 'Save';
  save.addEventListener('click', async () => {
    try {
      const res = await api.writeCardSetFile({ filePath, content: ta.value });
      if (!res || !res.ok) {
        window.alert(res && res.error ? res.error : 'Save failed.');
        return;
      }
      closeAllModals();
      if (typeof onAfterSave === 'function') {
        await onAfterSave();
      }
    } catch (err) {
      console.error(err);
      window.alert('Save failed.');
    }
  });
  footer.appendChild(cancel);
  footer.appendChild(save);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);

  mountModalOverlay(overlay);

  try {
    const res = await api.readCardSetFile(filePath);
    if (!res || !res.ok) {
      window.alert(res && res.error ? res.error : 'Could not read file.');
      closeAllModals();
      return;
    }
    ta.value = res.content;
  } catch (e) {
    console.error(e);
    window.alert('Could not read file.');
    closeAllModals();
  }
}

async function openGenerateSetModal(deckManifestPath, onDone, options) {
  const reopenCategoryEditor = !!(options && options.reopenCategoryEditor);
  const settings = await api.loadLlmSettings();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay._froggyReopenCategoryOnDismiss = reopenCategoryEditor ? deckManifestPath : null;

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog modal-wide';

  function leaveToCategoryEditor() {
    closeAllModals();
    if (reopenCategoryEditor) {
      void openManageCategoryModal(deckManifestPath);
    }
  }

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = 'Generate topic with LLM';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', leaveToCategoryEditor);
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';

  const topicWrap = document.createElement('div');
  topicWrap.className = 'modal-field';
  const topicLabel = document.createElement('label');
  topicLabel.textContent = 'Scope for the new topic (be as detailed as possible)';
  const topicTa = document.createElement('textarea');
  topicTa.className = 'modal-textarea';
  topicTa.style.minHeight = '160px';
  topicTa.placeholder =
    'Example: "Intermediate TypeScript: generics with constraints, conditional types, and inference with array/object examples; common pitfalls."';
  topicWrap.appendChild(topicLabel);
  topicWrap.appendChild(topicTa);

  const numWrap = document.createElement('div');
  numWrap.className = 'modal-field';
  const numLabel = document.createElement('label');
  numLabel.textContent = 'Number of cards (1–50)';
  const numInput = document.createElement('input');
  numInput.type = 'number';
  numInput.className = 'modal-input';
  numInput.min = '1';
  numInput.max = '50';
  numInput.value = String(
    settings && Number.isFinite(settings.defaultNumCards) ? settings.defaultNumCards : 10
  );
  numWrap.appendChild(numLabel);
  numWrap.appendChild(numInput);

  const status = document.createElement('div');
  status.className = 'modal-hint';
  status.textContent = `Provider: ${settings.provider === 'openai' ? 'OpenAI' : 'Ollama'}. Adjust in Settings (top right).`;

  body.appendChild(topicWrap);
  body.appendChild(numWrap);
  body.appendChild(status);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'modal-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', leaveToCategoryEditor);
  const run = document.createElement('button');
  run.type = 'button';
  run.className = 'modal-btn modal-btn-primary';
  run.textContent = 'Generate';
  run.addEventListener('click', async () => {
    const topic = topicTa.value.trim();
    if (!topic) {
      window.alert('Please enter a topic.');
      return;
    }
    const n = parseInt(numInput.value, 10);
    try {
      const res = await withLlmGenerationWaitModal(
        {
          title: 'Generating cards',
          message:
            'The LLM is writing your topic JSON. Larger card counts and slower models can take several minutes.'
        },
        () =>
          api.generateCardSetViaLlm({
            deckManifestPath,
            topic,
            numCards: n
          })
      );
      if (!res || !res.ok) {
        if (res && res.cancelled) {
          return;
        }
        window.alert(res && res.error ? res.error : 'Generation failed.');
        return;
      }
      if (typeof onDone === 'function') {
        await onDone();
      }
      closeAllModals();
      if (reopenCategoryEditor) {
        await openManageCategoryModal(deckManifestPath);
      }
      window.alert(`Saved new topic file:\n\n${res.filePath || ''}`);
    } catch (e) {
      console.error(e);
      window.alert('Generation failed.');
    }
  });
  footer.appendChild(cancel);
  footer.appendChild(run);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);

  mountModalOverlay(overlay);
}

async function openLlmSettingsModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = 'Settings';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'modal-close';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => closeAllModals());
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'modal-body';

  const tabBar = document.createElement('div');
  tabBar.className = 'settings-tab-bar';
  tabBar.setAttribute('role', 'tablist');

  const tabLlm = document.createElement('button');
  tabLlm.type = 'button';
  tabLlm.className = 'settings-tab is-active';
  tabLlm.setAttribute('role', 'tab');
  tabLlm.setAttribute('aria-selected', 'true');
  tabLlm.setAttribute('id', 'settings-tab-llm');
  tabLlm.textContent = 'LLM';

  const tabUpdates = document.createElement('button');
  tabUpdates.type = 'button';
  tabUpdates.className = 'settings-tab';
  tabUpdates.setAttribute('role', 'tab');
  tabUpdates.setAttribute('aria-selected', 'false');
  tabUpdates.setAttribute('id', 'settings-tab-updates');
  tabUpdates.textContent = 'Updates';

  tabBar.appendChild(tabLlm);
  tabBar.appendChild(tabUpdates);

  const llmPanel = document.createElement('div');
  llmPanel.className = 'settings-tab-panel is-active';
  llmPanel.setAttribute('role', 'tabpanel');
  llmPanel.setAttribute('aria-labelledby', 'settings-tab-llm');

  const providerWrap = document.createElement('div');
  providerWrap.className = 'modal-field';
  const providerLabel = document.createElement('label');
  providerLabel.textContent = 'Provider';
  const providerSel = document.createElement('select');
  providerSel.className = 'modal-select';
  [['ollama', 'Ollama (local)'], ['openai', 'OpenAI']].forEach(([v, label]) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = label;
    providerSel.appendChild(opt);
  });
  providerWrap.appendChild(providerLabel);
  providerWrap.appendChild(providerSel);

  const ollamaUrlWrap = document.createElement('div');
  ollamaUrlWrap.className = 'modal-field';
  const ollamaUrlLabel = document.createElement('label');
  ollamaUrlLabel.textContent = 'Ollama base URL';
  const ollamaUrl = document.createElement('input');
  ollamaUrl.className = 'modal-input';
  ollamaUrl.type = 'text';
  ollamaUrlWrap.appendChild(ollamaUrlLabel);
  ollamaUrlWrap.appendChild(ollamaUrl);

  const ollamaModelWrap = document.createElement('div');
  ollamaModelWrap.className = 'modal-field';
  const ollamaModelLabel = document.createElement('label');
  ollamaModelLabel.textContent = 'Ollama model';
  const ollamaModel = document.createElement('input');
  ollamaModel.className = 'modal-input';
  ollamaModel.type = 'text';
  ollamaModelWrap.appendChild(ollamaModelLabel);
  ollamaModelWrap.appendChild(ollamaModel);

  const openaiUrlWrap = document.createElement('div');
  openaiUrlWrap.className = 'modal-field';
  const openaiUrlLabel = document.createElement('label');
  openaiUrlLabel.textContent = 'OpenAI-compatible API base URL';
  const openaiUrl = document.createElement('input');
  openaiUrl.className = 'modal-input';
  openaiUrl.type = 'text';
  openaiUrlWrap.appendChild(openaiUrlLabel);
  openaiUrlWrap.appendChild(openaiUrl);

  const openaiModelWrap = document.createElement('div');
  openaiModelWrap.className = 'modal-field';
  const openaiModelLabel = document.createElement('label');
  openaiModelLabel.textContent = 'OpenAI model';
  const openaiModel = document.createElement('input');
  openaiModel.className = 'modal-input';
  openaiModel.type = 'text';
  openaiModelWrap.appendChild(openaiModelLabel);
  openaiModelWrap.appendChild(openaiModel);

  const apiKeyWrap = document.createElement('div');
  apiKeyWrap.className = 'modal-field';
  const apiKeyLabel = document.createElement('label');
  apiKeyLabel.textContent = 'OpenAI API key (stored locally on this machine)';
  const apiKey = document.createElement('input');
  apiKey.className = 'modal-input';
  apiKey.type = 'password';
  apiKey.autocomplete = 'off';
  apiKeyWrap.appendChild(apiKeyLabel);
  apiKeyWrap.appendChild(apiKey);

  const defaultNumWrap = document.createElement('div');
  defaultNumWrap.className = 'modal-field';
  const defaultNumLabel = document.createElement('label');
  defaultNumLabel.textContent = 'Default number of cards when generating';
  const defaultNum = document.createElement('input');
  defaultNum.className = 'modal-input';
  defaultNum.type = 'number';
  defaultNum.min = '1';
  defaultNum.max = '50';
  defaultNumWrap.appendChild(defaultNumLabel);
  defaultNumWrap.appendChild(defaultNum);

  llmPanel.appendChild(providerWrap);
  llmPanel.appendChild(ollamaUrlWrap);
  llmPanel.appendChild(ollamaModelWrap);
  llmPanel.appendChild(openaiUrlWrap);
  llmPanel.appendChild(openaiModelWrap);
  llmPanel.appendChild(apiKeyWrap);
  llmPanel.appendChild(defaultNumWrap);

  const updatesPanel = document.createElement('div');
  updatesPanel.className = 'settings-tab-panel';
  updatesPanel.setAttribute('role', 'tabpanel');
  updatesPanel.setAttribute('aria-labelledby', 'settings-tab-updates');

  const versionRow = document.createElement('div');
  versionRow.className = 'modal-field';
  const versionLabel = document.createElement('div');
  versionLabel.className = 'modal-hint';
  versionLabel.style.fontSize = '13px';
  versionLabel.style.color = 'var(--text)';
  versionLabel.textContent = '…';
  versionRow.appendChild(versionLabel);

  const updateHint = document.createElement('div');
  updateHint.className = 'modal-hint';
  updateHint.style.marginTop = '10px';
  updateHint.textContent =
    'The installed app checks for updates shortly after you open it. Your release host must serve latest.yml next to the installer.';

  const updateStatus = document.createElement('div');
  updateStatus.className = 'modal-hint';
  updateStatus.style.marginTop = '12px';
  updateStatus.style.minHeight = '2.5em';
  updateStatus.textContent = '';

  const updateActions = document.createElement('div');
  updateActions.className = 'modal-field';
  updateActions.style.display = 'flex';
  updateActions.style.flexWrap = 'wrap';
  updateActions.style.gap = '10px';
  updateActions.style.alignItems = 'center';
  const checkUpdatesBtn = document.createElement('button');
  checkUpdatesBtn.type = 'button';
  checkUpdatesBtn.className = 'modal-btn';
  checkUpdatesBtn.textContent = 'Check for updates';
  const restartInstallBtn = document.createElement('button');
  restartInstallBtn.type = 'button';
  restartInstallBtn.className = 'modal-btn modal-btn-primary';
  restartInstallBtn.textContent = 'Restart to install';
  restartInstallBtn.style.display = 'none';
  updateActions.appendChild(checkUpdatesBtn);
  updateActions.appendChild(restartInstallBtn);

  updatesPanel.appendChild(versionRow);
  updatesPanel.appendChild(updateHint);
  updatesPanel.appendChild(updateStatus);
  updatesPanel.appendChild(updateActions);

  function setSettingsActiveTab(which) {
    const llm = which === 'llm';
    tabLlm.classList.toggle('is-active', llm);
    tabLlm.setAttribute('aria-selected', llm ? 'true' : 'false');
    tabUpdates.classList.toggle('is-active', !llm);
    tabUpdates.setAttribute('aria-selected', !llm ? 'true' : 'false');
    llmPanel.classList.toggle('is-active', llm);
    updatesPanel.classList.toggle('is-active', !llm);
  }

  tabLlm.addEventListener('click', () => setSettingsActiveTab('llm'));
  tabUpdates.addEventListener('click', () => setSettingsActiveTab('updates'));

  body.appendChild(tabBar);
  body.appendChild(llmPanel);
  body.appendChild(updatesPanel);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'modal-btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => closeAllModals());
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'modal-btn modal-btn-primary';
  save.textContent = 'Save';
  save.addEventListener('click', async () => {
    let dn = parseInt(defaultNum.value, 10);
    if (!Number.isFinite(dn) || dn < 1) dn = 10;
    if (dn > 50) dn = 50;
    const payload = {
      provider: providerSel.value === 'openai' ? 'openai' : 'ollama',
      ollamaBaseUrl: ollamaUrl.value.trim(),
      ollamaModel: ollamaModel.value.trim(),
      openaiBaseUrl: openaiUrl.value.trim(),
      openaiModel: openaiModel.value.trim(),
      apiKey: apiKey.value,
      defaultNumCards: dn
    };
    const res = await api.saveLlmSettings(payload);
    if (!res || !res.ok) {
      window.alert(res && res.error ? res.error : 'Could not save settings.');
      return;
    }
    closeAllModals();
  });
  footer.appendChild(cancel);
  footer.appendChild(save);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);

  mountModalOverlay(overlay);

  const applyUpdateStatus = (detail) => {
    if (!detail || !detail.phase) return;
    if (detail.phase !== 'downloaded') {
      restartInstallBtn.style.display = 'none';
    }
    switch (detail.phase) {
      case 'checking':
        updateStatus.textContent = 'Checking for updates…';
        checkUpdatesBtn.disabled = true;
        break;
      case 'available':
        updateStatus.textContent = detail.version
          ? `Update available: ${detail.version}. Downloading…`
          : 'Update available. Downloading…';
        break;
      case 'downloading':
        if (typeof detail.percent === 'number' && Number.isFinite(detail.percent)) {
          updateStatus.textContent = `Downloading… ${Math.round(detail.percent)}%`;
        } else {
          updateStatus.textContent = 'Downloading update…';
        }
        checkUpdatesBtn.disabled = true;
        break;
      case 'not-available':
        updateStatus.textContent = 'You are on the latest version.';
        checkUpdatesBtn.disabled = false;
        break;
      case 'downloaded':
        updateStatus.textContent = detail.version
          ? `Update ${detail.version} is ready to install.`
          : 'Update is ready to install.';
        checkUpdatesBtn.disabled = false;
        restartInstallBtn.style.display = '';
        break;
      case 'error':
        updateStatus.textContent = detail.message
          ? `Update: ${detail.message}`
          : 'Update check failed.';
        checkUpdatesBtn.disabled = false;
        break;
      default:
        break;
    }
  };

  checkUpdatesBtn.addEventListener('click', async () => {
    try {
      const info = await api.getAppUpdateInfo();
      if (!info || !info.isPackaged) {
        window.alert('Automatic updates apply to the installed Windows build, not dev mode.');
        return;
      }
      restartInstallBtn.style.display = 'none';
      updateStatus.textContent = 'Checking for updates…';
      checkUpdatesBtn.disabled = true;
      const res = await api.checkForAppUpdates();
      if (!res.ok && !res.skipped) {
        updateStatus.textContent = res.error ? `Update: ${res.error}` : 'Update check failed.';
        checkUpdatesBtn.disabled = false;
        window.alert(res.error || 'Update check failed.');
      }
    } catch (e) {
      console.error(e);
      checkUpdatesBtn.disabled = false;
      window.alert(e && e.message ? e.message : 'Update check failed.');
    }
  });

  restartInstallBtn.addEventListener('click', () => {
    if (typeof api.quitAndInstallUpdate === 'function') {
      api.quitAndInstallUpdate();
    }
  });

  try {
    const s = await api.loadLlmSettings();
    providerSel.value = s.provider === 'openai' ? 'openai' : 'ollama';
    ollamaUrl.value = s.ollamaBaseUrl || 'http://127.0.0.1:11434';
    ollamaModel.value = s.ollamaModel || 'llama3.2';
    openaiUrl.value = s.openaiBaseUrl || 'https://api.openai.com';
    openaiModel.value = s.openaiModel || 'gpt-4o-mini';
    apiKey.value = s.apiKey || '';
    defaultNum.value = String(
      Number.isFinite(s.defaultNumCards) && s.defaultNumCards > 0 ? s.defaultNumCards : 10
    );
  } catch (e) {
    console.error(e);
  }

  try {
    if (typeof api.getAppUpdateInfo === 'function') {
      const u = await api.getAppUpdateInfo();
      versionLabel.textContent =
        u && u.version ? `${u.name || 'Froggy Flash'} ${u.version}` : 'Version unknown';
      if (!u || !u.isPackaged) {
        updateHint.textContent =
          'Development mode: packaged installs check for updates after launch and from this tab.';
        checkUpdatesBtn.disabled = false;
      }
    }
  } catch (e) {
    console.error(e);
    versionLabel.textContent = 'Could not read app version.';
  }

  if (typeof api.onAutoUpdateEvent === 'function') {
    const unsub = api.onAutoUpdateEvent(applyUpdateStatus);
    overlay._froggyUpdateUnsub = unsub;
  }
}

/**
 * @param {string | null} initialManifestPath Category `.deck.json` path, or `null` to open the add-category flow only.
 */
async function openManageCategoryModal(initialManifestPath) {
  await loadDeckListOnStartup();

  if (initialManifestPath) {
    const probe = availableDecks.find((x) => x.id === initialManifestPath);
    if (!probe) {
      window.alert('That category is no longer available.');
      return;
    }
    if (!isStructuredDeck(probe)) {
      window.alert(
        'This library entry is a standalone topic JSON file, not a category folder. Select it in the list to study.'
      );
      return;
    }
  }

  const categoryManifestPath = initialManifestPath;
  /** When set, the modal shows a rename form for that deck manifest path. */
  let renameDeckId = null;
  /** When true, the modal shows only the “new category + generate” form. */
  let showAddDeckForm = !initialManifestPath;
  /** Default for “number of cards” when opening the add-deck form (from LLM settings). */
  let addDeckDefaultNumCards = 10;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  const dialog = document.createElement('div');
  dialog.className = 'modal-dialog modal-wide';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = showAddDeckForm ? 'Add category' : 'Edit category';
  const headerActions = document.createElement('div');
  headerActions.className = 'modal-header-actions';
  header.appendChild(title);
  header.appendChild(headerActions);

  const body = document.createElement('div');
  body.className = 'modal-body';

  const contentHost = document.createElement('div');
  contentHost.className = 'manage-category-body';

  async function refreshAndRedraw() {
    await loadDeckListOnStartup();
    if (categoryManifestPath) {
      const still = availableDecks.find((d) => d.id === categoryManifestPath);
      if (!still || !isStructuredDeck(still)) {
        closeAllModals();
        renderDeckList();
        return;
      }
    }
    renderAll();
  }

  /** Header row (right side): rename and delete category. */
  function attachCategoryPrimaryActions(container, d) {
    container.className = 'modal-header-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'modal-btn';
    renameBtn.textContent = 'Rename category';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!isStructuredDeck(d)) {
        window.alert('Rename this file from Explorer, or import it into a category folder.');
        return;
      }
      renameDeckId = d.id;
      renderAll();
    });

    const delDeckBtn = document.createElement('button');
    delDeckBtn.type = 'button';
    delDeckBtn.className = 'modal-btn modal-btn-danger';
    delDeckBtn.textContent = 'Delete category';
    delDeckBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const label = d.name || d.fileName || 'this category';
      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) {
        return;
      }
      const res = await api.deleteDeck({ deckManifestPath: d.id });
      if (!res || !res.ok) {
        window.alert(res && res.error ? res.error : 'Delete failed.');
        return;
      }
      closeAllModals();
      await loadDeckListOnStartup();
      renderDeckList();
    });

    container.appendChild(renameBtn);
    container.appendChild(delDeckBtn);
  }

  /** After topic list: import / LLM actions for this category. */
  function attachCategoryTopicsToolbarActions(container, d) {
    container.className = 'manage-actions manage-category-topics-toolbar';

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'modal-btn';
    importBtn.textContent = 'Import JSON…';
    importBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!isStructuredDeck(d)) {
        window.alert('Import is for categories. Add a category, then import topic JSON into it.');
        return;
      }
      const pick = await api.pickJsonFiles();
      if (pick.canceled || !pick.filePaths || !pick.filePaths.length) {
        return;
      }
      const replace = window.confirm(
        'Replace all existing topic (.json) files in this category before importing?\n\n' +
          'OK = delete current files in the category folder, then copy the selected files.\n' +
          'Cancel = keep existing files and add copies (renamed if filenames clash).'
      );
      const res = await api.importDeckSets({
        deckManifestPath: d.id,
        filePaths: pick.filePaths,
        replaceExisting: replace
      });
      if (!res || !res.ok) {
        window.alert(res && res.error ? res.error : 'Import failed.');
        return;
      }
      await refreshAndRedraw();
    });

    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'modal-btn';
    genBtn.textContent = 'Generate with LLM…';
    genBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!isStructuredDeck(d)) {
        window.alert('LLM generation saves into a category folder. Create a category first, then generate.');
        return;
      }
      closeAllModals();
      await openGenerateSetModal(
        d.id,
        async () => {
          await loadDeckListOnStartup();
        },
        { reopenCategoryEditor: true }
      );
    });

    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = 'modal-btn';
    settingsBtn.textContent = 'LLM settings…';
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAllModals();
      openLlmSettingsModal();
    });

    container.appendChild(importBtn);
    container.appendChild(genBtn);
    container.appendChild(settingsBtn);
  }

  function renderAll() {
    contentHost.innerHTML = '';
    headerActions.replaceChildren();

    if (showAddDeckForm) {
      title.textContent = 'Add category';
      const panel = document.createElement('div');
      panel.className = 'add-deck-panel';

      const intro = document.createElement('div');
      intro.className = 'modal-hint';
      intro.style.marginBottom = '12px';
      intro.textContent =
        'Creates a category folder and generates an initial topic JSON file with your LLM (Settings → LLM).';
      panel.appendChild(intro);

      const nameWrap = document.createElement('div');
      nameWrap.className = 'modal-field';
      const nameLabel = document.createElement('label');
      nameLabel.setAttribute('for', 'add-deck-name-input');
      nameLabel.textContent = 'Category name';
      const nameInput = document.createElement('input');
      nameInput.id = 'add-deck-name-input';
      nameInput.type = 'text';
      nameInput.className = 'modal-input';
      nameInput.placeholder = 'e.g. Rust ownership basics';
      nameWrap.appendChild(nameLabel);
      nameWrap.appendChild(nameInput);
      panel.appendChild(nameWrap);

      const descWrap = document.createElement('div');
      descWrap.className = 'modal-field';
      const descLabel = document.createElement('label');
      descLabel.setAttribute('for', 'add-deck-desc-input');
      descLabel.textContent = 'What should topics in this category cover?';
      const descTa = document.createElement('textarea');
      descTa.id = 'add-deck-desc-input';
      descTa.className = 'modal-textarea';
      descTa.style.minHeight = '120px';
      descTa.placeholder =
        'Describe scope, difficulty, and focus. This text is sent to the model as the topic for every card.';
      descWrap.appendChild(descLabel);
      descWrap.appendChild(descTa);
      panel.appendChild(descWrap);

      const numWrap = document.createElement('div');
      numWrap.className = 'modal-field';
      const numLabel = document.createElement('label');
      numLabel.setAttribute('for', 'add-deck-num-input');
      numLabel.textContent = 'Number of cards to generate (1–50)';
      const numInput = document.createElement('input');
      numInput.id = 'add-deck-num-input';
      numInput.type = 'number';
      numInput.className = 'modal-input';
      numInput.min = '1';
      numInput.max = '50';
      numInput.value = String(addDeckDefaultNumCards);
      numWrap.appendChild(numLabel);
      numWrap.appendChild(numInput);
      panel.appendChild(numWrap);

      contentHost.appendChild(panel);

      const formActions = document.createElement('div');
      formActions.className = 'manage-actions';
      formActions.style.marginTop = '14px';

      const cancelForm = document.createElement('button');
      cancelForm.type = 'button';
      cancelForm.className = 'modal-btn';
      cancelForm.textContent = 'Cancel';
      cancelForm.addEventListener('click', () => {
        closeAllModals();
      });

      const submitForm = document.createElement('button');
      submitForm.type = 'button';
      submitForm.className = 'modal-btn modal-btn-primary';
      submitForm.textContent = 'Create category & generate topic';
      submitForm.addEventListener('click', async () => {
        const deckName = String(nameInput.value || '').trim();
        const topic = String(descTa.value || '').trim();
        const n = parseInt(numInput.value, 10);
        if (!deckName) {
          window.alert('Please enter a category name.');
          return;
        }
        if (!topic) {
          window.alert('Please describe what questions in this category should cover.');
          return;
        }
        if (!Number.isFinite(n) || n < 1 || n > 50) {
          window.alert('Number of cards must be between 1 and 50.');
          return;
        }
        submitForm.disabled = true;
        cancelForm.disabled = true;
        submitForm.textContent = 'Creating category…';
        let createdPath = null;
        try {
          const resCreate = await api.createDeck({ name: deckName, description: topic });
          if (!resCreate || !resCreate.ok) {
            window.alert(resCreate && resCreate.error ? resCreate.error : 'Could not create category.');
            return;
          }
          createdPath = resCreate.deckManifestPath;
          submitForm.textContent = 'Generating cards…';
          const resGen = await withLlmGenerationWaitModal(
            {
              title: 'Generating cards',
              message:
                'Creating flashcards for your new category. You can cancel to stop the LLM request (the empty category folder will remain).'
            },
            () =>
              api.generateCardSetViaLlm({
                deckManifestPath: createdPath,
                topic,
                numCards: n
              })
          );
          if (!resGen || !resGen.ok) {
            if (!(resGen && resGen.cancelled)) {
              window.alert(
                (resGen && resGen.error ? resGen.error : 'Generation failed.') +
                  '\n\nThe category was created; you can use “Generate with LLM…” on it later.'
              );
            }
          } else if (resGen.filePath) {
            window.alert(`Category created and topic saved:\n\n${resGen.filePath}`);
          }
          closeAllModals();
          await loadDeckListOnStartup();
          renderDeckList();
        } catch (err) {
          console.error(err);
          window.alert('Something went wrong. Check the console for details.');
          if (createdPath) {
            await loadDeckListOnStartup();
            renderDeckList();
          }
        } finally {
          submitForm.disabled = false;
          cancelForm.disabled = false;
          submitForm.textContent = 'Create category & generate topic';
        }
      });

      formActions.appendChild(cancelForm);
      formActions.appendChild(submitForm);
      panel.appendChild(formActions);
      return;
    }

    if (!categoryManifestPath) {
      title.textContent = 'Edit category';
      const err = document.createElement('div');
      err.className = 'modal-hint';
      err.textContent = 'Nothing to edit.';
      contentHost.appendChild(err);
      return;
    }

    const category = availableDecks.find((d) => d.id === categoryManifestPath);
    if (!category || !isStructuredDeck(category)) {
      title.textContent = 'Edit category';
      const err = document.createElement('div');
      err.className = 'modal-hint';
      err.textContent = 'Category not found.';
      contentHost.appendChild(err);
      return;
    }

    if (renameDeckId && renameDeckId !== categoryManifestPath) {
      renameDeckId = null;
    }

    if (renameDeckId === categoryManifestPath) {
      const displayName = category.name || category.fileName || 'Untitled';
      title.textContent = `Rename category: ${displayName}`;
      const renameHeading = document.createElement('div');
      renameHeading.className = 'manage-deck-title';
      renameHeading.style.marginBottom = '6px';
      renameHeading.textContent = 'Rename category';
      contentHost.appendChild(renameHeading);
      const nameWrap = document.createElement('div');
      nameWrap.className = 'modal-field';
      const nameLabel = document.createElement('label');
      nameLabel.textContent = 'Display name';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'modal-input';
      nameInput.value = category.name || '';
      nameWrap.appendChild(nameLabel);
      nameWrap.appendChild(nameInput);
      contentHost.appendChild(nameWrap);
      const renameActions = document.createElement('div');
      renameActions.className = 'manage-actions';
      const cancelRename = document.createElement('button');
      cancelRename.type = 'button';
      cancelRename.className = 'modal-btn';
      cancelRename.textContent = 'Cancel';
      cancelRename.addEventListener('click', () => {
        renameDeckId = null;
        renderAll();
      });
      const saveRename = document.createElement('button');
      saveRename.type = 'button';
      saveRename.className = 'modal-btn modal-btn-primary';
      saveRename.textContent = 'Save';
      saveRename.addEventListener('click', async () => {
        const next = String(nameInput.value || '').trim();
        if (!next) {
          window.alert('Please enter a name.');
          return;
        }
        saveRename.disabled = true;
        cancelRename.disabled = true;
        try {
          const res = await api.renameDeck({
            deckManifestPath: category.id,
            newName: next
          });
          if (!res || !res.ok) {
            window.alert(res && res.error ? res.error : 'Rename failed.');
            saveRename.disabled = false;
            cancelRename.disabled = false;
            return;
          }
          renameDeckId = null;
          await refreshAndRedraw();
        } catch (err) {
          console.error(err);
          window.alert('Rename failed.');
          saveRename.disabled = false;
          cancelRename.disabled = false;
        }
      });
      renameActions.appendChild(cancelRename);
      renameActions.appendChild(saveRename);
      contentHost.appendChild(renameActions);
      setTimeout(() => {
        nameInput.focus();
        nameInput.select();
      }, 0);
      return;
    }

    const displayName = category.name || category.fileName || 'Untitled';
    title.textContent = `Edit category: ${displayName}`;
    attachCategoryPrimaryActions(headerActions, category);

    const setsTitle = document.createElement('div');
    setsTitle.className = 'manage-category-topics-heading';
    setsTitle.textContent = 'Topics (JSON files in this category):';
    contentHost.appendChild(setsTitle);

    if (!category.sets.length) {
      const none = document.createElement('div');
      none.className = 'modal-hint';
      none.textContent = 'No topics yet — import or generate JSON files.';
      contentHost.appendChild(none);
    } else {
      category.sets.forEach((setInfo) => {
        const row = document.createElement('div');
        row.className = 'manage-set-row';
        const left = document.createElement('div');
        left.textContent = setInfo.name || setInfo.fileName || 'Untitled set';
        const btns = document.createElement('div');
        btns.style.display = 'flex';
        btns.style.gap = '6px';

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'modal-btn';
        edit.textContent = 'Edit';
        edit.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          closeAllModals();
          await openCardSetEditorModal(setInfo.id, async () => {
            await loadDeckListOnStartup();
          });
        });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'modal-btn modal-btn-danger';
        del.textContent = 'Delete';
        del.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (!window.confirm(`Delete topic "${setInfo.name || setInfo.fileName}"?`)) {
            return;
          }
          const res = await api.deleteCardSetFile(setInfo.id);
          if (!res || !res.ok) {
            window.alert(res && res.error ? res.error : 'Delete failed.');
            return;
          }
          await refreshAndRedraw();
        });

        btns.appendChild(edit);
        btns.appendChild(del);
        row.appendChild(left);
        row.appendChild(btns);
        contentHost.appendChild(row);
      });
    }

    const topicsToolbar = document.createElement('div');
    attachCategoryTopicsToolbarActions(topicsToolbar, category);
    contentHost.appendChild(topicsToolbar);
  }

  body.appendChild(contentHost);

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'modal-btn modal-btn-primary';
  done.textContent = 'Done';
  done.addEventListener('click', () => closeAllModals());
  footer.appendChild(done);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);
  overlay.appendChild(dialog);

  mountModalOverlay(overlay);
  renderAll();
}

window.addEventListener('DOMContentLoaded', () => {
  const loadBtn = $('load-set-btn');
  if (loadBtn) {
    loadBtn.addEventListener('click', handleLoadSetClicked);
  }

  const addCategoryBtn = $('deck-add-category-btn');
  if (addCategoryBtn) {
    addCategoryBtn.addEventListener('click', () => {
      openManageCategoryModal(null).catch((err) => console.error('Add category:', err));
    });
  }

  const settingsBtn = $('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      openLlmSettingsModal();
    });
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


