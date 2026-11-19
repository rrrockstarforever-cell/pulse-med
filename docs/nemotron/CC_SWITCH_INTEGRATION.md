# Nemotron Multi-Agent Orchestration — CC Switch Integration Guide

## Overview

CC Switch remains responsible for **primary model selection** in Claude Code. You select **Nemotron 3 Super 120B-A12B** as your main chat model via CC Switch. The Nemotron specialist orchestration layer runs separately in the background: Super interprets your request, delegates subtasks to specialist Nemotron models, verifies results, resolves disagreements, and synthesizes the final answer you see.

This is an **additive** integration — your existing provider setup (Gemini, ChatGPT, Claude, Grok) is preserved untouched.

## Prerequisites

- NVIDIA NIM API key (set via `NEMOTRON_API_KEY` env var — never hardcoded)
- Node 22+ (native `fetch` is used)
- Nemotron model endpoints reachable (default: `https://integrate.api.nvidia.com/v1`)

## Configuration

1. Copy `nemotron.config.example.json` → `nemotron.config.local.json` (or export the env vars directly).
2. Fill in `NEMOTRON_API_KEY` with your NVIDIA NIM key.
3. Verify/adjust model IDs for each Nemotron model. The defaults are placeholders:
   - `nvidia/nemotron-3-super-120b-a12b` — Chief Orchestrator (Super)
   - `nvidia/nemotron-3-nano-30b-a3b` — General Reasoning
   - `nvidia/nemotron-3.5-lightning-30b-a3b` — High-Throughput
   - `nvidia/nemotron-3.5-bolt` — Lightweight Autonomous
   - `nvidia/nemotron-3-nano-omni` — Multimodal
   - `nvidia/nemotron-3-ultra-550b-a55b` — Advanced Reasoning / Escalation (optional, disabled by default)

4. Enable/disable individual models via the `*_ENABLED` flags without changing source code.

## CC Switch setup

1. Keep Nemotron 3 Super 120B-A12B selected as your primary model in CC Switch.
2. The orchestration server runs on the same local Express instance as Pulse Med (`server.ts`, port 3000 dev / 3217 Electron).
3. Nemotron routes are mounted at `/api/nemotron/*` — additive to existing `/api/oauth/*` and `/api/ai/*` routes.

## How a chat flows

1. You send a chat message with Nemotron Super selected via CC Switch.
2. The frontend (or your chat client) calls `POST /api/nemotron/orchestrate` with the user request.
3. **Super** (Phase 1-2): understands the request, classifies its category, decomposes into subtasks.
4. **Specialists** (Phase 3-4): Super selects the right Nemotron models and executes independent subtasks in parallel.
5. **Verification** (Phase 6): Super checks each result for accuracy, completeness, consistency, relevance.
6. **Disagreement resolution** (Phase 7): if specialists disagree, Super asks one to reconsider, gets an independent assessment (Ultra if available), and decides.
7. **Final synthesis** (Phase 8): Super produces the single answer you receive.

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/nemotron/orchestrate` | POST | Run full multi-agent orchestration on a user request |
| `/api/nemotron/models` | GET | List configured Nemotron models + availability |
| `/api/nemotron/status` | GET | Orchestrator health and config |
| `/api/nemotron/logs` | GET | Recent request summaries |
| `/api/nemotron/logs/:requestId` | GET | Full execution log for a request |

## Example request

```bash
curl -X POST http://localhost:3000/api/nemotron/orchestrate \
  -H "Content-Type: application/json" \
  -d '{"userRequest": "Explain quantum entanglement and write a Python simulation of Bell\'s theorem."}'
```

## What is preserved (not changed)

- All existing `/api/oauth/*`, `/api/ai/*`, `/api/models/*`, `/api/providers/*` routes.
- `server/oauth.mjs`, `server/web.mjs`, `src/lib/ai.ts`, `SettingsAIView.tsx`.
- Your CC Switch provider selection and stored tokens.

## Verifying it works

1. Start the server: `npm run dev` (or `npm start`).
2. Call `GET http://localhost:3000/api/nemotron/status` — should return orchestrator + specialist status.
3. Call `POST /api/nemotron/orchestrate` with a test request — should return a `finalAnswer` plus `taskResults`.
4. Check `GET /api/nemotron/logs` for the execution trail.

## Non-Nemotron restriction

No non-Nemotron model (DeepSeek, Claude, GPT, Qwen, GLM, …) may be used as a background AI worker or fallback. If no Nemotron model is available, the orchestration reports that the task cannot be delegated rather than silently switching providers.
