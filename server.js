const express = require('express');
const cors = require('cors');
const { GoogleAuth } = require('google-auth-library');
require('dotenv').config();
const util = require('node:util');
const path = require('path');

function safeStringify(obj, max = 10000) {
  try {
    let s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    if (s.length > max) s = s.slice(0, max) + '... [truncated]';
    return s;
  } catch (e) {
    return String(obj);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Content Security Policy: allow app assets, Google Fonts and connections to local proxy and Google generative API
const CSP = process.env.CONTENT_SECURITY_POLICY || "default-src 'self'; connect-src 'self' http://localhost:3000 https://generativelanguage.googleapis.com https://fonts.googleapis.com https://fonts.gstatic.com; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:;";
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  next();
});

// Serve static files (the game) and provide SPA fallback for non-API routes
app.use(express.static(path.join(__dirname)));
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
const GENERATIVE_API_URL = process.env.GENERATIVE_API_URL || 'https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generateText';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY; // optional

async function callGenerativeAPI(prompt) {
  const url = GOOGLE_API_KEY ? `${GENERATIVE_API_URL}?key=${GOOGLE_API_KEY}` : GENERATIVE_API_URL;
  const headers = { 'Content-Type': 'application/json' };

  if (!GOOGLE_API_KEY) {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    if (!accessToken) {
      throw new Error('Falha ao obter token de acesso. Verifique as credenciais.');
    }
    headers['Authorization'] = `Bearer ${accessToken.token || accessToken}`;
  }

  // Candidate request bodies: start with the legacy `prompt` shape (text-bison),
  // then try several alternate formats used by newer Gemini/Models endpoints.
  const defaultBody = {
    prompt: { text: prompt },
    temperature: Number(process.env.TEMPERATURE || 0.2),
    maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS || 800)
  };

  const altBodies = [
    { input: prompt },
    { input: { text: prompt } },
    { text: prompt },
    { instances: [{ input: prompt }] },
    { messages: [{ author: 'user', content: [{ type: 'text', text: prompt }] }], temperature: Number(process.env.TEMPERATURE || 0.2) }
  ];

  const tryBodies = [defaultBody, ...altBodies];

  // If an API key is provided, include it in a header as well (query param is primary for Google APIs).
  if (GOOGLE_API_KEY) {
    headers['x-api-key'] = GOOGLE_API_KEY;
    const masked = GOOGLE_API_KEY.length > 8 ? GOOGLE_API_KEY.slice(0, 4) + '...' + GOOGLE_API_KEY.slice(-4) : '***';
    console.log(`[generative] POST ${GENERATIVE_API_URL} using API key ${masked}`);
  } else {
    console.log(`[generative] POST ${GENERATIVE_API_URL} using OAuth2 access token`);
  }

  let lastErr = null;
  for (const body of tryBodies) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '(no body)');
        // If API rejects unknown top-level fields (invalid JSON payload), try next candidate.
        if (res.status === 400 && /Unknown name|Invalid JSON payload received/.test(text)) {
          console.warn('[generative] payload rejected, trying alternate schema. reason:', text.substring(0, 300));
          lastErr = new Error(`Generative API retornou ${res.status}: ${text}`);
          continue; // try next body
        }
        const err = new Error(`Generative API retornou ${res.status}: ${text}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      return data;
    } catch (e) {
      // network or other unexpected errors: record and continue only for the bad-payload case
      lastErr = e;
      // if it's a non-400 fetch/network error, rethrow
      if (!(e && e.message && /Generative API retornou 400/.test(e.message))) {
        throw e;
      }
    }
  }

  throw new Error(`Todas as tentativas de payload falharam. Último erro: ${lastErr && lastErr.message ? lastErr.message : String(lastErr)}`);
}

function extractTextFromResponse(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data?.candidates?.[0]?.output) return data.candidates[0].output;
  if (data?.candidates?.[0]?.content) return data.candidates[0].content;
  if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
  if (data?.generations?.[0]?.text) return data.generations[0].text;
  if (data?.predictions?.[0]?.content) return data.predictions[0].content;
  if (data?.output?.[0]?.content) return data.output[0].content;
  if (data?.answer) return data.answer;
  return JSON.stringify(data);
}

function extractJSONFromText(text) {
  if (!text) return null;
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = text.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (e) { /* fallthrough */ }
  }
  const s2 = text.indexOf('{');
  const e2 = text.lastIndexOf('}');
  if (s2 !== -1 && e2 !== -1 && e2 > s2) {
    const candidate = text.slice(s2, e2 + 1);
    try {
      const parsed = JSON.parse(candidate);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) { }
  }
  return null;
}

app.post('/api/generate-questions', async (req, res) => {
  const { theme, count = 10 } = req.body || {};
  if (!theme) {
    return res.status(400).json({ ok: false, error: 'theme is required' });
  }
  const prompt = `Gere ${count} perguntas de múltipla escolha em português sobre o tema "${theme}". Responda APENAS com um array JSON. Cada item deve ter: id (inteiro), theme (string), question (string), choices (array de 3 ou 4 strings), answerIndex (inteiro começando em 0), e opcionalmente explanation (string). Exemplo:\n[ { "id": 1, "theme": "${theme}", "question": "Pergunta?", "choices": ["A","B","C","D"], "answerIndex": 0 } ]\nSem texto adicional, apenas JSON.`;

  try {
    const apiResp = await callGenerativeAPI(prompt);
    const text = extractTextFromResponse(apiResp);
    const parsed = extractJSONFromText(text);
    if (!parsed) {
      console.error('Falha ao extrair JSON da resposta generativa. rawText:\n', text);
      try { console.error('raw API response:\n', safeStringify(apiResp)); } catch (e) { console.error('raw API response (stringify failed)'); }
      return res.status(200).json({ ok: false, error: 'Não foi possível extrair JSON da resposta', rawText: text, raw: apiResp });
    }
    const normalized = parsed.map((it, idx) => ({
      id: it.id ?? (idx + 1),
      theme: it.theme ?? theme,
      question: it.question ?? it.prompt ?? '',
      choices: it.choices ?? (it.options || []),
      answerIndex: Number(it.answerIndex ?? 0),
      explanation: it.explanation ?? null
    }));
    return res.json({ ok: true, questions: normalized });
  } catch (err) {
    console.error('Erro na geração:');
    try {
      if (err && err.stack) console.error(err.stack);
      else console.error(safeStringify(err));
    } catch (e) {
      console.error('Erro ao logar o erro:', e);
    }
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.listen(PORT, () => console.log(`Generative proxy server running on http://localhost:${PORT}`));
