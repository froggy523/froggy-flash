// Renderer-side logic for Froggy Flash

const api = window.froggyApi;

let scoresBySet = {};
let currentSet = null;
let currentFilePath = null;
let currentIndex = 0;
let currentCorrectCount = 0;
let hasAnsweredCurrent = false;

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
    historySummary.textContent =
      'Load a flashcard set to start tracking your performance. Scores are saved per set name on this machine.';
    scoreTag.textContent = 'Awaiting session';
    return;
  }

  const setKey = currentSet.name;
  const existing = scoresBySet[setKey];
  const totalCards = currentSet.cards.length;
  const sessionPercent = calculatePercent(currentCorrectCount, totalCards);

  scoreSetName.textContent = currentSet.name;
  scorePercent.innerHTML = `${sessionPercent}<span class="unit">%</span>`;
  scoreDetailLine.textContent = `${currentCorrectCount} / ${totalCards} correct`;

  const progressRatio = totalCards ? (currentIndex + (hasAnsweredCurrent ? 1 : 0)) / totalCards : 0;
  const progressPercent = Math.min(100, Math.max(0, Math.round(progressRatio * 100)));
  progressFill.style.width = `${progressPercent}%`;
  progressLabelRight.textContent = `${Math.min(
    totalCards,
    currentIndex + (hasAnsweredCurrent ? 1 : 0)
  )} / ${totalCards}`;

  if (existing) {
    const lastP = calculatePercent(existing.lastCorrect, existing.lastTotal || 0);
    const bestP = calculatePercent(existing.bestCorrect, existing.bestTotal || 0);
    statLastSession.textContent = `${existing.lastCorrect} / ${
      existing.lastTotal
    } (${lastP}%)`;
    statBestScore.textContent = `${existing.bestCorrect} / ${
      existing.bestTotal
    } (${bestP}%)`;
    historySummary.textContent = `Last played: ${formatDateTime(
      existing.lastPlayed
    )}. Total questions in last session: ${existing.lastTotal}.`;
    scoreLastPlayed.textContent = `Last: ${formatDateTime(existing.lastPlayed)}`;
    scoreTag.textContent = 'History loaded';
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

  if (!currentSet.cards || currentSet.cards.length === 0) {
    container.innerHTML =
      '<div class="empty-state">This set has no cards defined.</div>';
    updateScoreSidebar();
    return;
  }

  const card = currentSet.cards[currentIndex];
  hasAnsweredCurrent = false;

  const totalCards = currentSet.cards.length;

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
  choiceKeys.sort(); // a, b, c, ...

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
  const total = currentSet.cards.length;
  const correct = currentCorrectCount;
  const now = new Date().toISOString();

  const existing = scoresBySet[setKey];
  if (!existing) {
    scoresBySet[setKey] = {
      lastCorrect: correct,
      lastTotal: total,
      lastPlayed: now,
      bestCorrect: correct,
      bestTotal: total
    };
  } else {
    const bestPercent = calculatePercent(existing.bestCorrect, existing.bestTotal || 0);
    const thisPercent = calculatePercent(correct, total);
    const better = thisPercent > bestPercent;

    scoresBySet[setKey] = {
      lastCorrect: correct,
      lastTotal: total,
      lastPlayed: now,
      bestCorrect: better ? correct : existing.bestCorrect,
      bestTotal: better ? total : existing.bestTotal
    };
  }

  try {
    await api.saveScores(scoresBySet);
  } catch (e) {
    console.error('Failed to persist scores:', e);
  }

  updateScoreSidebar();
}

function showSessionSummary() {
  if (!currentSet) return;
  const container = $('question-container');
  const total = currentSet.cards.length;
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
      scoresBySet = loaded;
    } else {
      scoresBySet = {};
    }
  } catch (e) {
    console.error('Failed to load scores:', e);
    scoresBySet = {};
  }
  updateScoreSidebar();
}

async function handleLoadSetClicked() {
  try {
    const result = await api.openFlashcardFile();
    if (!result || result.canceled) {
      return;
    }

    const { set, filePath } = result;
    currentSet = set;
    currentFilePath = filePath || null;
    currentIndex = 0;
    currentCorrectCount = 0;
    hasAnsweredCurrent = false;

    const metaName = $('set-meta');
    const setFileLabel = $('set-file-label');

    const titleEl = metaName.querySelector('.set-meta-title');
    const descEl = metaName.querySelector('.set-meta-desc');

    if (titleEl) {
      titleEl.textContent = set.name || 'Unnamed set';
      titleEl.classList.remove('set-name-placeholder');
    }
    if (descEl) {
      descEl.textContent =
        set.description || 'No description provided for this flashcard set.';
    }
    if (setFileLabel) {
      setFileLabel.textContent = filePath ? `File: ${filePath}` : '';
    }

    renderQuestion();
  } catch (e) {
    console.error('Failed to load set:', e);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const loadBtn = $('load-set-btn');
  if (loadBtn) {
    loadBtn.addEventListener('click', handleLoadSetClicked);
  }
  loadScoresOnStartup();
});


