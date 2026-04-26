const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { GoogleAuth } = require('google-auth-library');
require('dotenv').config();
const geminiUtils = require('./lib/gemini-utils.cjs');

const app = express();

// Trust proxy so rate-limiting is per-client when behind a reverse proxy
app.set('trust proxy', 1);

// CORS: set FRONTEND_ORIGIN in production to restrict origins
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
}));

// Rate limiting for /api/* endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas requisições. Tente novamente em 1 minuto.' },
});
app.use('/api/', apiLimiter);

// Minimal security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=()');
  next();
});

// Configuration
const PORT = process.env.PORT || 3000;
const GENERATIVE_API_URL =
  process.env.GENERATIVE_API_URL ||
  'https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash-lite:generateContent';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

// Client for the Generative API
async function callGenerativeAPI(prompt) {
  const headers = { 'Content-Type': 'application/json' };

  if (GOOGLE_API_KEY) {
    headers['x-goog-api-key'] = GOOGLE_API_KEY;
  } else {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token?.token) throw new Error('Falha ao obter token de acesso.');
    headers['Authorization'] = `Bearer ${token.token}`;
  }

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192
    },
  };

  const res = await fetch(GENERATIVE_API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.GENERATIVE_TIMEOUT_MS) || 45_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '(no body)');
    throw new Error(`Generative API retornou ${res.status}: ${text}`);
  }

  return res.json();
}

// Route: generation
app.post('/api/generate-questions', express.json({ limit: '16kb' }), async (req, res) => {
  const rawTheme = req.body?.theme;
  const rawCount = req.body?.count;

  const theme = geminiUtils.sanitizeTheme(rawTheme);
  if (!theme) return res.status(400).json({ ok: false, error: 'theme é obrigatório e deve ser string.' });

  const count = geminiUtils.sanitizeCount(rawCount);

  const prompt =
    `Gere ${count} perguntas de múltipla escolha em português sobre o tema "${theme}". ` +
    `Responda APENAS com um array JSON. Cada item deve ter: id (inteiro), theme (string), ` +
    `question (string), choices (array de exatas 4 strings), answerIndex (inteiro começando em 0), ` +
    `e explanation (string). ` +
    `Exemplo:\n[ { "id": 1, "theme": "${theme}", "question": "Pergunta?", ` +
    `"choices": ["A","B","C","D"], "answerIndex": 0, "explanation": "Motivo da resposta" } ]\n` +
    `Sem texto adicional, formatação markdown ou crases, apenas o JSON puro.`;

  try {
    const apiResp = await callGenerativeAPI(prompt);
    const text = geminiUtils.extractTextFromResponse(apiResp);
    const parsed = geminiUtils.extractJSONFromText(text);

    if (!parsed) {
      console.error('Falha ao extrair JSON da resposta:', text?.slice(0, 500));
      return res.status(200).json({
        ok: false,
        error: 'Não foi possível extrair JSON da resposta da IA.',
      });
    }

    const normalized = geminiUtils.normalizeQuestions(parsed, theme);

    return res.json({ ok: true, questions: normalized });

  } catch (err) {
    console.error('Erro na geração:', err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Start
app.listen(PORT, () =>
  console.log(`Servidor proxy generativo a correr em http://localhost:${PORT}`),
);
