# Nemotron Multi-Agent Orchestration — Installation

## 1. Install dependencies

No new heavy dependencies are required. The orchestration layer uses native Node `fetch` and the existing Express server.

```bash
cd C:\ad\pulse-med-repo
npm install   # ensure existing deps are installed
```

## 2. Configure NVIDIA API key

Create `nemotron.config.local.json` from the example, or export env vars:

```powershell
# PowerShell
$env:NEMOTRON_API_KEY="nvapi-your-key-here"
$env:NEMOTRON_ENDPOINT="https://integrate.api.nvidia.com/v1"
```

Or in `.env` (dev):
```
NEMOTRON_API_KEY=nvapi-your-key-here
NEMOTRON_ENDPOINT=https://integrate.api.nvidia.com/v1
```

The key is read from the environment at runtime and never written to the repository.

## 3. Start the server

```bash
npm run dev     # dev mode with Vite HMR, port 3000
# or
npm start       # same as dev
```

The Nemotron routes mount automatically at `/api/nemotron/*`.

## 4. Select Nemotron Super in CC Switch

In Claude Code (CC Switch), select **Nemotron 3 Super 120B-A12B** as your primary model. The orchestration layer treats Super as the chief orchestrator; your chat goes through it.

## 5. Verify

```bash
# Health check
curl http://localhost:3000/api/nemotron/status

# List models
curl http://localhost:3000/api/nemotron/models

# Test orchestration
curl -X POST http://localhost:3000/api/nemotron/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"userRequest":"Summarize the key differences between HTTP/1.1 and HTTP/3."}'
```

## 6. Type check & tests

```bash
npm run lint        # tsc --noEmit
# run tests (see tests/nemotron/)
```

## Project structure (new files)

```
server/nemotron/
  config.ts          # centralized config (env-driven)
  registry.ts        # Nemotron-only model registry
  routing.ts         # classification + routing policy
  client.ts          # NVIDIA NIM specialist API client
  orchestrator.ts    # Super 8-phase pipeline
  parallel.ts        # parallel execution engine
  context.ts         # context manager + compression
  results.ts         # result aggregation
  verify.ts          # quality control + disagreement resolution
  retry.ts           # retry + failover
  logger.ts          # execution logging + monitoring
  routes.ts          # Express routes (/api/nemotron/*)
src/lib/nemotron.ts  # client library
docs/nemotron/       # CC_SWITCH_INTEGRATION.md, INSTALL.md, ARCHITECTURE.md
tests/nemotron/      # automated tests
nemotron.config.example.json
```

## Existing files modified (additive only)

- `server.ts` — added `import { nemotronRouter }` and `app.use('/api/nemotron', nemotronRouter)`. No existing routes touched.
