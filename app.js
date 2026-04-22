const QUESTIONS_URL = './questions.json';
const NUM_QUESTIONS = 10;
const SERVER_BASE = 'http://localhost:3000';

// Auto-advance behaviour: fixed 15 seconds, not configurable
const AUTO_ADVANCE_DELAY = 15000; // ms
const AUTO_ADVANCE_ENABLED = true;

// DOM
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

// State
let questions = [];
let selected = [];
let current = 0;
let score = 0;
let answered = false;
let autoAdvanceTimer = null;
let currentTheme = null;

nextBtn.addEventListener('click', onNext);
restartBtn.addEventListener('click', resetToIntro);

// Theme card: start immediately when clicked
themeCards.forEach(card => {
  card.addEventListener('click', () => {
    const theme = card.dataset.theme;
    // highlight selected card
    themeCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    startGame(theme);
  });
});

async function startGame(theme) {
  currentTheme = theme;
  intro.classList.add('hidden');
  questionScreen.classList.remove('hidden');
  finalScreen.classList.add('hidden');
  let loaded = false;
  // Try generating via server proxy first when a theme is provided
  if (theme) {
    try {
      const resp = await fetch(`${SERVER_BASE}/api/generate-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, count: 100 })
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.ok && Array.isArray(data.questions) && data.questions.length) {
          questions = data.questions;
          loaded = true;
          console.log('Perguntas geradas via servidor generativo');
        } else {
          console.warn('Geração remota retornou formato inesperado, carregando perguntas locais');
        }
      } else {
        console.warn('Geração remota falhou com status', resp.status);
      }
    } catch (err) {
      console.warn('Falha ao chamar servidor generativo:', err);
    }
  }

  if (!loaded) {
    questions = await loadQuestions();
  }

  // filter by theme unless 'Misturado' or not provided
  let pool = questions;
  if (theme && theme !== 'Misturado') {
    pool = questions.filter(q => String(q.theme || '').toLowerCase() === String(theme).toLowerCase());
  }

  selected = pickRandom(pool, NUM_QUESTIONS);
  current = 0;
  score = 0;
  answered = false;
  updateScore();
  // reset progress bar
  if (progressFill) progressFill.style.width = '0%';
  showQuestion();
}

async function loadQuestions() {
  const res = await fetch(QUESTIONS_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('Falha ao carregar perguntas: ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Formato inválido de perguntas');
  return data;
}

function pickRandom(arr, n) {
  const clone = arr.slice();
  for (let i = clone.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clone[i], clone[j]] = [clone[j], clone[i]];
  }
  return clone.slice(0, Math.min(n, clone.length));
}

function showQuestion() {
  if (!selected || selected.length === 0) {
    // nothing to show
    questionEl.textContent = 'Sem perguntas para este tema.';
    choicesEl.innerHTML = '';
    return;
  }

  const q = selected[current];
  questionEl.textContent = q.question;
  choicesEl.innerHTML = '';
  if (explanationEl) { explanationEl.classList.add('hidden'); explanationEl.textContent = ''; }
  answered = false;
  nextBtn.disabled = true;
  progressText.textContent = `${current + 1}/${selected.length}`;
  if (progressFill) progressFill.style.width = `${(current / selected.length) * 100}%`;

  // clear any pending timer
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  // remove any existing countdown
  if (explanationEl) { const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove(); }

  q.choices.forEach((text, idx) => {
    const btn = document.createElement('button');
    btn.className = 'btn choice';
    btn.type = 'button';
    btn.dataset.index = idx;

    const label = document.createElement('span');
    label.className = 'choice-label';
    label.textContent = String.fromCharCode(65 + idx); // A,B,C...

    const txt = document.createElement('span');
    txt.className = 'choice-text';
    txt.textContent = text;

    btn.appendChild(label);
    btn.appendChild(txt);
    btn.addEventListener('click', onChoice);
    choicesEl.appendChild(btn);
  });
}

function onChoice(e) {
  if (answered) return;
  answered = true;
  const idx = Number(e.currentTarget.dataset.index);
  const correctIdx = selected[current].answerIndex;
  const buttons = Array.from(choicesEl.querySelectorAll('button'));
  if (idx === correctIdx) {
    e.currentTarget.classList.add('correct');
    score++;
    updateScore();
  } else {
    e.currentTarget.classList.add('wrong');
    if (buttons[correctIdx]) buttons[correctIdx].classList.add('correct');
  }
  buttons.forEach(b => b.disabled = true);

  // show explanation (if available) or a short feedback
  if (explanationEl) {
    const provided = selected[current].explanation;
    const expText = provided || (idx === correctIdx ? 'Você acertou!' : `Resposta correta: ${selected[current].choices[correctIdx]}`);
    explanationEl.textContent = expText;
    explanationEl.classList.remove('hidden');
  }
  nextBtn.disabled = false;
  nextBtn.textContent = (current === selected.length - 1) ? 'Finalizar' : 'Próxima';

  // auto-advance: start countdown only when enabled
  if (AUTO_ADVANCE_ENABLED && explanationEl) {
    // remove previous countdown if any
    const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove();
    const cd = document.createElement('div'); cd.className = 'countdown';
    const fill = document.createElement('div'); fill.className = 'countdown-fill';
    fill.style.width = '100%'; cd.appendChild(fill); explanationEl.appendChild(cd);
    // force layout then animate
    void fill.offsetWidth;
    fill.style.transition = `width ${AUTO_ADVANCE_DELAY}ms linear`;
    // start animation
    setTimeout(() => { fill.style.width = '0%'; }, 20);

    if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
    autoAdvanceTimer = setTimeout(() => {
      autoAdvanceTimer = null;
      onNext();
    }, AUTO_ADVANCE_DELAY);
  }
  // update progress to reflect answered question (visual)
  if (progressFill) progressFill.style.width = `${((current + 1) / selected.length) * 100}%`;
}

function onNext() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (explanationEl) { const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove(); }
  if (current < selected.length - 1) {
    current++; showQuestion();
  } else {
    showFinal();
  }
}

function updateScore() {
  scoreEl.textContent = score;
}

function showFinal() {
  questionScreen.classList.add('hidden');
  finalScreen.classList.remove('hidden');
  finalScoreEl.textContent = score;
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (explanationEl) { const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove(); }
  const key = 'showdo_miau_highscore';
  const prev = Number(localStorage.getItem(key) || 0);
  if (score > prev) {
    localStorage.setItem(key, String(score));
    highScoreEl.textContent = score + ' (novo!)';
  } else {
    highScoreEl.textContent = prev;
  }
}

function resetToIntro() {
  if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  if (explanationEl) { const prev = explanationEl.querySelector('.countdown'); if (prev) prev.remove(); }
  finalScreen.classList.add('hidden');
  intro.classList.remove('hidden');
  // clear selected card highlight
  themeCards.forEach(c => c.classList.remove('selected'));
}

// keyboard shortcuts: 1..9 to choose
document.addEventListener('keydown', (e) => {
  if (questionScreen.classList.contains('hidden')) return;
  if (e.key >= '1' && e.key <= '9') {
    const idx = Number(e.key) - 1;
    const btn = choicesEl.querySelector(`button[data-index="${idx}"]`);
    if (btn) btn.click();
  }
});

// register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(err => console.warn('SW registro falhou', err));
}
