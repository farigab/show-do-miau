'use strict';

const { GoogleAuth } = require('google-auth-library');
const config = require('../../../config');

const MAX_THEME_LEN = 80;
// Strip chars that could break out of the JSON string in the prompt
const UNSAFE_CHARS_RE = /["\\<>]/g;

/**
 * Sanitizes user-supplied theme to prevent prompt injection.
 * Limits length and removes characters that alter prompt structure.
 * @param {string} raw
 * @returns {string}
 */
function sanitizeTheme(raw) {
  return String(raw).trim().slice(0, MAX_THEME_LEN).replaceAll(UNSAFE_CHARS_RE, '');
}

/**
 * Extracts the plain-text content from a Gemini API response envelope.
 * @param {unknown} data
 * @returns {string}
 */
function extractTextFromResponse(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? JSON.stringify(data);
}

/**
 * Extracts a JSON array from text that may be wrapped in markdown fences.
 * @param {string} text
 * @returns {Array|null}
 */
function extractJSONFromText(text) {
  if (!text) return null;
  const cleaned = text.replaceAll('```json', '').replaceAll('```', '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Calls the Gemini generative API.
 * API key is sent via request header only — never appended to the URL
 * (URLs appear in proxy logs, nginx access logs, and CDN traces).
 * Falls back to Application Default Credentials when no key is configured.
 *
 * @param {string} prompt
 * @returns {Promise<unknown>} Raw Gemini API response
 */
async function callGenerativeAPI(prompt) {
  const headers = { 'Content-Type': 'application/json' };

  if (config.googleApiKey) {
    // Header-only auth — keeps the key out of server/proxy access logs
    headers['x-goog-api-key'] = config.googleApiKey;
  } else {
    // Service-account / workload-identity fallback
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    if (!token) throw new Error('Falha ao obter token de acesso via ADC.');
    headers['Authorization'] = `Bearer ${token.token ?? token}`;
  }

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2_000 },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    // geminiApiUrl has NO query-string key — auth is header-only (see above)
    const resp = await fetch(config.geminiApiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '(sem corpo)');
      throw new Error(`Gemini API retornou ${resp.status}: ${text}`);
    }

    return resp.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * High-level function: sanitizes input, builds prompt, calls API, normalises output.
 * @param {string} rawTheme  Unsanitized theme from client request body
 * @param {number|string} rawCount
 * @returns {Promise<Array>} Normalised question objects
 */
async function generateQuestions(rawTheme, rawCount) {
  const theme = sanitizeTheme(rawTheme);
  // Clamp count: minimum 1, maximum 20
  const count = Math.min(Math.max(Number.parseInt(rawCount, 10) || 10, 1), 20);

  const prompt =
    `Gere ${count} perguntas de múltipla escolha em português sobre o tema "${theme}". ` +
    `Responda APENAS com um array JSON. Cada item deve ter: ` +
    `id (inteiro), theme (string), question (string), ` +
    `choices (array de exatas 4 strings), answerIndex (inteiro começando em 0), ` +
    `e explanation (string). ` +
    `Sem texto adicional, formatação markdown ou crases, apenas o JSON puro.`;

  const apiResponse = await callGenerativeAPI(prompt);
  const text = extractTextFromResponse(apiResponse);
  const parsed = extractJSONFromText(text);

  if (!parsed) {
    throw new Error('Não foi possível extrair JSON da resposta da IA.');
  }

  return parsed.map((item, idx) => ({
    id: item.id ?? idx + 1,
    theme: item.theme ?? theme,
    question: item.question ?? '',
    choices: Array.isArray(item.choices) ? item.choices : [],
    answerIndex: Number(item.answerIndex ?? 0),
    explanation: item.explanation ?? null,
  }));
}

module.exports = { generateQuestions, sanitizeTheme };
