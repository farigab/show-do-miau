const QUESTIONS_URL = './questions.json';
const NUM_QUESTIONS = 10;
const HIGH_SCORE_KEY = 'showdo_miau_highscore'; // named constant — no magic strings
const FETCH_TIMEOUT_MS = 12_000;
const AUTO_ADVANCE_DELAY = 15_000;
const AUTO_ADVANCE_ENABLED = true;

const DEFAULT_LOCAL_SERVER = 'http://localhost:3000';
const SERVER_BASE =
  globalThis.SHOWDO_CONFIG?.serverBase ||
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? DEFAULT_LOCAL_SERVER
    : '');

// --- DOM refs ---
const intro = document.getElementById('intro');
const questionScreen = document.getElementById('questionScreen');
const finalScreen = document.getElementById('finalScreen');
const questionEl = document.getElementById('question');
const choicesEl = document.getElementById('choices');
const explanationEl = document.getElementById('explanation');
const scoreEl = document.getElementById('score');
const finalScoreEl = document.getElementById('finalScore');
const highScoreEl = document.getElementById('highScore');
const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const nextBtn = document.getElementById('nextBtn');
const restartBtn = document.getElementById('restartBtn');
const themeCards = Array.from(document.querySelectorAll('.theme-card'));
const diceBtn = document.getElementById('random-dice');
const themeTagEl = document.getElementById('themeTag');

// --- Consolidated state (no scattered module-level lets) ---
const state = {
  questions: [],
  selected: [],
  current: 0,
  score: 0,
  answered: false,
  timer: null,
  theme: null,
  gameStarting: false, // race-condition guard
};

// --- Event listeners ---
nextBtn.addEventListener('click', onNext);
restartBtn.addEventListener('click', resetToIntro);

themeCards.forEach(card => {
  if (!card.dataset.theme) return; // skip dice button
  card.addEventListener('click', () => {
    themeCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    startGame(card.dataset.theme);
  });
});

if (diceBtn) {
  diceBtn.addEventListener('click', () => {
    if (diceBtn.classList.contains('rolling')) return;
    diceBtn.classList.add('rolling');
    setTimeout(() => {
      diceBtn.classList.remove('rolling');
      const validThemes = themeCards.filter(c => c.dataset.theme);
      const chosen = validThemes[Math.floor(Math.random() * validThemes.length)];
      if (chosen) {
        themeCards.forEach(c => c.classList.remove('selected'));
        chosen.classList.add('selected');
        startGame(chosen.dataset.theme);
      }
    }, 700);
  });
}

// --- Pure utilities ---

/**
 * Cancels the auto-advance timer and removes the countdown DOM node.
 * Extracted from 5+ duplicated call-sites.
 */
function clearAutoAdvance() {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  explanationEl?.querySelector('.countdown')?.remove();
}

/**
 * fetch() wrapper with AbortController timeout.
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fisher-Yates shuffle — returns up to n random items from arr.
 * Renamed from pickRandom (misleading) to sampleN (descriptive).
 * @param {Array} arr
 * @param {number} n
 * @returns {Array}
 */
function sampleN(arr, n) {
  const clone = arr.slice();
  for (let i = clone.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone.slice(0, Math.min(n, clone.length));
}

async function loadLocalQuestions() {
  const res = await fetchWithTimeout(QUESTIONS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('Falha ao carregar perguntas locais.');
  return res.json();
}

// --- Game logic ---

async function startGame(theme) {
  // Guard: prevent concurrent calls (double-tap, fast theme switching)
  if (state.gameStarting) return;
  state.gameStarting = true;

  state.theme = theme;

  if (themeTagEl) {
    themeTagEl.textContent = `Tema: ${theme}`;
    themeTagEl.classList.remove('hidden');
  }

  intro.classList.add('hidden');
  questionScreen.classList.remove('hidden');
  finalScreen.classList.add('hidden');

  questionEl.textContent = `A IA está a criar perguntas sobre ${theme}… ⏳`;
  choicesEl.innerHTML = '';

  let questions = [];
  let fromAI = false;

  // Try generative backend first
  if (SERVER_BASE) {
    try {
      const resp = await fetchWithTimeout(
        `${SERVER_BASE}/api/generate-questions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ theme, count: NUM_QUESTIONS }),
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        if (data?.ok && Array.isArray(data.questions) && data.questions.length) {
          questions = data.questions;
          fromAI = true;
          console.log('Perguntas geradas via servidor generativo.');
        }
      }
    } catch (err) {
      console.warn('Falha ao chamar servidor generativo:', err.message ?? err);
    }
  }

  // Fallback: filter local bank.
  // "Misturado" skips filter and uses all questions (data-theme="Misturado" in HTML).
  if (!fromAI) {
    try {
      const allLocal = await loadLocalQuestions();
      questions =
        theme === 'Misturado'
          ? allLocal
          : allLocal.filter(
            q => String(q.theme ?? '').toLowerCase() === theme.toLowerCase()
          );
    } catch (err) {
      console.error('Erro ao carregar perguntas locais:', err);
    }
  }

  // Commit new game state atomically
  Object.assign(state, {
    questions,
    selected: sampleN(questions, NUM_QUESTIONS),
    current: 0,
    score: 0,
    answered: false,
    gameStarting: false,
  });

  updateScore();
  if (progressFill) progressFill.style.width = '0%';
  showQuestion();
}

function showQuestion() {
  if (!state.selected.length) {
    questionEl.textContent = 'Não foram encontradas perguntas suficientes para este tema.';
    choicesEl.innerHTML = '';
    return;
  }

  clearAutoAdvance();

  const q = state.selected[state.current];
  questionEl.textContent = q.question;
  choicesEl.innerHTML = '';

  if (explanationEl) {
    explanationEl.classList.add('hidden');
    explanationEl.textContent = '';
  }

  state.answered = false;
  nextBtn.disabled = true;
  progressText.textContent = `${state.current + 1}/${state.selected.length}`;
  if (progressFill)
    progressFill.style.width = `${(state.current / state.selected.length) * 100}%`;

  q.choices.forEach((text, idx) => {
    const btn = document.createElement('button');
    btn.className = 'btn choice';
    btn.type = 'button';
    btn.dataset.index = idx;

    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = String.fromCodePoint(65 + idx);

    const txt = document.createElement('span');
    txt.className = 'choice-text';
    txt.textContent = text;

    btn.append(label, txt);
    btn.addEventListener('click', onChoice);
    choicesEl.appendChild(btn);
  });
}

function onChoice(e) {
  if (state.answered) return;
  state.answered = true;

  const idx = Number(e.currentTarget.dataset.index);
  const correctIdx = state.selected[state.current].answerIndex;
  const buttons = Array.from(choicesEl.querySelectorAll('button'));

  if (idx === correctIdx) {
    e.currentTarget.classList.add('correct');
    state.score++;
    updateScore();
  } else {
    e.currentTarget.classList.add('wrong');
    buttons[correctIdx]?.classList.add('correct');
  }
  buttons.forEach(b => (b.disabled = true));

  if (explanationEl) {
    const provided = state.selected[state.current].explanation;
    explanationEl.textContent =
      provided ||
      (idx === correctIdx
        ? 'Certo!'
        : `A correta era: ${state.selected[state.current].choices[correctIdx]}`);
    explanationEl.classList.remove('hidden');
  }

  nextBtn.disabled = false;
  nextBtn.textContent =
    state.current === state.selected.length - 1 ? 'Finalizar' : 'Próxima';

  if (AUTO_ADVANCE_ENABLED && explanationEl) {
    const cd = document.createElement('div');
    cd.className = 'countdown';
    const fill = document.createElement('div');
    fill.className = 'countdown-fill';
    fill.style.width = '100%';
    cd.appendChild(fill);
    explanationEl.appendChild(cd);

    void fill.offsetWidth; // force reflow to enable CSS transition
    fill.style.transition = `width ${AUTO_ADVANCE_DELAY}ms linear`;
    setTimeout(() => { fill.style.width = '0%'; }, 20);

    state.timer = setTimeout(() => {
      state.timer = null;
      onNext();
    }, AUTO_ADVANCE_DELAY);
  }

  if (progressFill)
    progressFill.style.width = `${((state.current + 1) / state.selected.length) * 100}%`;
}

function onNext() {
  clearAutoAdvance();
  if (state.current < state.selected.length - 1) {
    state.current++;
    showQuestion();
  } else {
    showFinal();
  }
}

function updateScore() {
  scoreEl.textContent = state.score;
}

function showFinal() {
  clearAutoAdvance();
  questionScreen.classList.add('hidden');
  finalScreen.classList.remove('hidden');
  finalScoreEl.textContent = state.score;

  const prev = Number(localStorage.getItem(HIGH_SCORE_KEY) || 0);
  if (state.score > prev) {
    localStorage.setItem(HIGH_SCORE_KEY, String(state.score));
    highScoreEl.textContent = `${state.score} (novo recorde!)`;
  } else {
    highScoreEl.textContent = prev;
  }
}

function resetToIntro() {
  clearAutoAdvance();
  finalScreen.classList.add('hidden');
  intro.classList.remove('hidden');
  themeCards.forEach(c => c.classList.remove('selected'));
  if (themeTagEl) {
    themeTagEl.classList.add('hidden');
    themeTagEl.textContent = '';
  }
}

// Keyboard shortcut: 1–4 selects an answer choice
document.addEventListener('keydown', e => {
  if (questionScreen.classList.contains('hidden')) return;
  if (e.key >= '1' && e.key <= '9') {
    choicesEl.querySelector(`button[data-index="${Number(e.key) - 1}"]`)?.click();
  }
});

// --- Service Worker ---
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => { });

  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type === 'SW_UPDATED') {
      const url = new URL(location.href);
      url.searchParams.set('_sw', Date.now());
      try {
        location.replace(url.toString());
      } catch {
        location.reload();
      }
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!window.__swReloading) {
      window.__swReloading = true;
      location.reload();
    }
  });
}
