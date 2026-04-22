# Quiz IA (PWA)

Pequeno jogo de perguntas e respostas, mobile-first, roda como PWA.

Uso rápido:

- Iniciar servidor local:

```bash
npm run start
# ou
npx http-server -p 8080
```

- Gerar perguntas (opcional, usa OPENAI_API_KEY se disponível):

```bash
node generate_questions.js --count 10
```

Abra `http://localhost:8080` no navegador (emulador móvel ou dispositivo) para testar.

Arquivos principais:

- index.html — entrada da app
- styles.css — estilos
- app.js — lógica do jogo
- questions.json — banco de perguntas
- manifest.json / service-worker.js — PWA

Se quiser empacotar como app nativo, use Capacitor/PWABuilder (passo não coberto aqui).
