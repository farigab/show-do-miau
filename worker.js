// Cloudflare Worker: proxy /api/generate-questions to the Generative API
// Expects `GOOGLE_API_KEY` as a secret (set with `wrangler secret put`) and
// `GENERATIVE_API_URL` / `FRONTEND_ORIGIN` in `wrangler.toml` [vars].

const extractTextFromResponse = (data) => {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }
  return JSON.stringify(data);
};

const extractJSONFromText = (text) => {
  if (!text) return null;
  const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const start = cleanedText.indexOf('[');
  const end = cleanedText.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = cleanedText.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (e) { }
  }
  return null;
};

export default {
  async fetch(request, env) {
    const originHeader = request.headers.get('origin') || '';
    const allowedOrigin = env.FRONTEND_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin === '*' ? '*' : allowedOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/generate-questions')) {
      return new Response('Not found', { status: 404 });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    try {
      const body = await request.json().catch(() => ({}));
      const theme = body?.theme;
      const count = Number(body?.count ?? 10);
      if (!theme) return new Response(JSON.stringify({ ok: false, error: 'theme is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const prompt = `Gere ${count} perguntas de múltipla escolha em português sobre o tema "${theme}". Responda APENAS com um array JSON. Cada item deve ter: id (inteiro), theme (string), question (string), choices (array de exatas 4 strings), answerIndex (inteiro começando em 0), e explanation (string). Exemplo:\n[ { "id": 1, "theme": "${theme}", "question": "Pergunta?", "choices": ["A","B","C","D"], "answerIndex": 0, "explanation": "Motivo da resposta" } ]\nSem texto adicional, formatação markdown ou crases, apenas o JSON puro.`;

      let apiUrl = env.GENERATIVE_API_URL || 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
      apiUrl = apiUrl.replace(/\"/g, '');
      if (env.GOOGLE_API_KEY) apiUrl += apiUrl.includes('?') ? `&key=${env.GOOGLE_API_KEY}` : `?key=${env.GOOGLE_API_KEY}`;

      const headers = { 'Content-Type': 'application/json' };
      if (env.GOOGLE_API_KEY) headers['x-goog-api-key'] = env.GOOGLE_API_KEY;

      const geminiBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 2000 }
      };

      const apiResp = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(geminiBody) });
      if (!apiResp.ok) {
        const text = await apiResp.text().catch(() => '(no body)');
        return new Response(JSON.stringify({ ok: false, error: `Generative API returned ${apiResp.status}: ${text}` }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const data = await apiResp.json();
      const text = extractTextFromResponse(data);
      const parsed = extractJSONFromText(text);
      if (!parsed) {
        return new Response(JSON.stringify({ ok: false, error: 'Não foi possível extrair JSON da resposta', raw: text }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const normalized = parsed.map((it, idx) => ({
        id: it.id ?? (idx + 1),
        theme: it.theme ?? theme,
        question: it.question ?? '',
        choices: it.choices ?? [],
        answerIndex: Number(it.answerIndex ?? 0),
        explanation: it.explanation ?? null
      }));

      return new Response(JSON.stringify({ ok: true, questions: normalized }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }
};
