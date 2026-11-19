// Standalone Anthropic-compatible gateway for the Nemotron orchestrator.
//
//   npm run nemotron:gateway            (listens on http://127.0.0.1:8093)
//
// In CC Switch add a Claude Desktop provider with
//   ANTHROPIC_BASE_URL   = http://127.0.0.1:8093
//   ANTHROPIC_AUTH_TOKEN = your NVIDIA key (nvapi-...), or any placeholder to
//                          use NEMOTRON_API_KEY from .env instead
// The orchestrator's live dashboard / logs are served from the same port:
//   http://127.0.0.1:8093/nemotron-dashboard.html  and  /api/nemotron/*

import 'dotenv/config'; // loads NEMOTRON_API_KEY etc. from the repo's .env
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnthropicRouter, GATEWAY_MODEL_ID } from './anthropic.ts';
import { nemotronRouter } from './routes.ts';
import { NEMOTRON_CONFIG } from './config.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.NEMOTRON_GATEWAY_PORT || 8093);
const HOST = process.env.NEMOTRON_GATEWAY_HOST || '127.0.0.1';

const app = express();
const anthropic = createAnthropicRouter();

// Accept base URLs with or without a trailing /v1.
app.use('/v1/v1', anthropic);
app.use('/v1', anthropic);
// The Control Center may be opened straight from disk (Origin: null) or from
// another local port; allow those origins to read the monitoring API.
app.use('/api/nemotron', (req, res, next) => {
  const origin = String(req.headers.origin || '');
  res.setHeader('Access-Control-Allow-Origin', origin && origin !== 'null' ? origin : '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Request-Private-Network');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}, nemotronRouter);
app.use(express.static(path.join(__dirname, '..', '..', 'public'), { index: false }));

app.get('/', (_req, res) => {
  res.json({
    name: 'Nemotron orchestrator gateway',
    model: GATEWAY_MODEL_ID,
    orchestrator: NEMOTRON_CONFIG.orchestrator.modelId,
    specialists: Object.entries(NEMOTRON_CONFIG.specialists)
      .filter(([, c]) => c.enabled)
      .map(([k, c]) => `${k}: ${c.modelId}`),
    endpoints: ['POST /v1/messages', 'POST /v1/messages/count_tokens', 'GET /v1/models', '/api/nemotron/*'],
  });
});

app.listen(PORT, HOST, () => {
  console.log(`[nemotron-gateway] listening on http://${HOST}:${PORT} (orchestrator ${NEMOTRON_CONFIG.orchestrator.modelId})`);
});
