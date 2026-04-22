const fs = require('node:fs');
const argv = process.argv.slice(2);
let count = 10;
let theme = null;
let serverUrl = process.env.GENERATIVE_SERVER_URL || null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--count' && argv[i + 1]) { count = Number(argv[i + 1]); }
  if (argv[i] === '--theme' && argv[i + 1]) { theme = argv[i + 1]; }
  if (argv[i] === '--server' && argv[i + 1]) { serverUrl = argv[i + 1]; }
}

const SAMPLE_POOL = [
  { question: 'Qual é a capital do Brasil?', choices: ['Brasília', 'Rio de Janeiro', 'São Paulo', 'Salvador'], answerIndex: 0 },
  { question: 'Qual é o maior planeta do Sistema Solar?', choices: ['Júpiter', 'Saturno', 'Terra', 'Marte'], answerIndex: 0 },
  { question: 'Em que continente fica o Egito?', choices: ['África', 'Ásia', 'Europa', 'América do Sul'], answerIndex: 0 },
  { question: 'Qual elemento químico tem símbolo O?', choices: ['Oxigênio', 'Ouro', 'Prata', 'Hélio'], answerIndex: 0 },
  { question: 'Qual a cor resultante da mistura de azul e amarelo?', choices: ['Verde', 'Roxo', 'Laranja', 'Marrom'], answerIndex: 0 },
  { question: 'Quanto é 7 × 8?', choices: ['54', '56', '58', '64'], answerIndex: 1 }
];

async function generate() {
  if (typeof fetch === 'undefined') {
    console.error('Aviso: fetch não disponível nesta versão do Node. Instale Node 18+ ou adicione node-fetch. Usando fallback.');
  }

  // If a local generative server is provided, try it first
  if (serverUrl) {
    try {
      const endpoint = `${serverUrl.replace(/\/$/, '')}/api/generate-questions`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, count })
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '(no body)');
        console.error(`Servidor gerador retornou status ${resp.status}:`, text);
      } else {
        const data = await resp.json().catch(() => null);
        if (data && data.ok && Array.isArray(data.questions)) {
          fs.writeFileSync('questions.json', JSON.stringify(data.questions, null, 2), 'utf8');
          console.log('questions.json criado via servidor generativo');
          return;
        }
        console.error('Servidor de geração respondeu com formato inesperado ou erro:', JSON.stringify(data, null, 2));
      }
    } catch (err) {
      console.error('Falha ao chamar servidor de geração:', err && err.stack ? err.stack : err);
    }
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY_OPENAI;
  if (apiKey) {
    try {
      const prompt = `Gere ${count} perguntas de múltipla escolha em português no formato JSON array. Cada item: {id, theme, question, choices, answerIndex}. Apenas JSON, sem explicações. Tema: ${theme || 'variado'}.`;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 800 })
      });
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      const parsed = JSON.parse(text);
      fs.writeFileSync('questions.json', JSON.stringify(parsed, null, 2), 'utf8');
      console.log('questions.json criado via API de IA (OpenAI)');
      return;
    } catch (err) {
      console.error('Falha ao gerar via API OpenAI, usando fallback:', err.message || err);
    }
  }

  // fallback simples
  const out = [];
  for (let i = 0; i < count; i++) {
    const item = SAMPLE_POOL[i % SAMPLE_POOL.length];
    out.push({ id: i + 1, theme: theme || 'Misturado', question: item.question, choices: item.choices, answerIndex: item.answerIndex });
  }
  fs.writeFileSync('questions.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('questions.json criado (fallback local)');
}

generate();
