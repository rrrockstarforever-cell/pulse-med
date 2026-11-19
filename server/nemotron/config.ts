// Centralized Nemotron model configuration.
// All credentials come from environment variables — never hardcoded.
// Copy nemotron.config.example.json to nemotron.config.local.json (or set env vars)
// to fill in real values. Models are enabled/disabled via config without source changes.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = (name: string, fallback?: string): string => {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v.trim() : fallback ?? '';
};

const ENV_NUM = (name: string, fallback: number): number => {
  const v = ENV(name);
  if (v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const ENV_BOOL = (name: string, fallback: boolean): boolean => {
  const v = ENV(name);
  if (v === '') return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

export interface NemotronModelConfig {
  // Provider (always 'nvidia' for this orchestrator).
  provider: string;
  // NVIDIA model identifier, e.g. 'nvidia/nemotron-3-super-120b-a12b'.
  modelId: string;
  // API endpoint (OpenAI-compatible chat/completions by default).
  endpoint: string;
  // Env var name holding the API key (the key itself is never stored here).
  apiKeyEnv: string;
  // Context window in tokens.
  contextWindow: number;
  // Maximum output tokens per request.
  maxOutputTokens: number;
  // Temperature (0-2). null = provider default.
  temperature: number | null;
  // Reasoning configuration, if the model/endpoint supports it.
  reasoning: { enabled: boolean; effort?: 'low' | 'medium' | 'high' } | null;
  // Request timeout in milliseconds.
  timeoutMs: number;
  // Number of retries on transient failure.
  retryLimit: number;
  // Max concurrent requests to this model.
  concurrencyLimit: number;
  // Whether this model is enabled for use.
  enabled: boolean;
  // Human-readable role label.
  role: string;
}

export interface NemotronOrchestratorConfig {
  // The chief orchestrator model (must be Nemotron 3 Super 120B-A12B).
  orchestrator: NemotronModelConfig;
  // All specialist models keyed by role.
  specialists: Record<string, NemotronModelConfig>;
  // Default timeout for orchestration-level operations (ms).
  defaultTimeoutMs: number;
  // Maximum total execution time for a single user request (ms).
  maxExecutionMs: number;
  // Whether to log full execution traces to disk.
  enableExecutionLog: boolean;
  // Directory for execution log files.
  logDir: string;
}

// ---------------------------------------------------------------------------
// Default model identifiers (placeholders — replace with real NVIDIA NIM ids).
// NVIDIA NIM endpoint: https://integrate.api.nvidia.com/v1
// ---------------------------------------------------------------------------

const NVIDIA_ENDPOINT = ENV('NEMOTRON_ENDPOINT', 'https://integrate.api.nvidia.com/v1');

function model(
  overrides: Partial<NemotronModelConfig> & { role: string; modelId: string },
): NemotronModelConfig {
  return {
    provider: 'nvidia',
    endpoint: NVIDIA_ENDPOINT,
    apiKeyEnv: 'NEMOTRON_API_KEY',
    contextWindow: 32768,
    maxOutputTokens: 4096,
    temperature: 0.7,
    reasoning: null,
    timeoutMs: 60_000,
    retryLimit: 3,
    concurrencyLimit: 5,
    enabled: true,
    ...overrides,
  };
}

// Level 1 — Chief Orchestrator (Nemotron 3 Super 120B-A12B).
const ORCHESTRATOR: NemotronModelConfig = model({
  role: 'orchestrator',
  modelId: ENV('NEMOTRON_SUPER_MODEL', 'nvidia/nemotron-3.5-super-vl-120b-a12b'),
  contextWindow: ENV_NUM('NEMOTRON_SUPER_CONTEXT_WINDOW', 131072),
  maxOutputTokens: ENV_NUM('NEMOTRON_SUPER_MAX_OUTPUT', 8192),
  temperature: ENV('NEMOTRON_SUPER_TEMPERATURE') ? Number(ENV('NEMOTRON_SUPER_TEMPERATURE')) || 0.2 : 0.2,
  timeoutMs: ENV_NUM('NEMOTRON_SUPER_TIMEOUT_MS', 120_000),
  retryLimit: ENV_NUM('NEMOTRON_SUPER_RETRY_LIMIT', 3),
  concurrencyLimit: ENV_NUM('NEMOTRON_SUPER_CONCURRENCY', 1),
  enabled: ENV_BOOL('NEMOTRON_SUPER_ENABLED', true),
});

// Level 2 — Specialists (all Nemotron-only).
const SPECIALISTS: Record<string, NemotronModelConfig> = {
  nano: model({
    role: 'general-reasoning',
    modelId: ENV('NEMOTRON_NANO_MODEL', 'nvidia/nemotron-3.5-lightning-30b-a3b'),
    contextWindow: ENV_NUM('NEMOTRON_NANO_CONTEXT_WINDOW', 131072),
    maxOutputTokens: ENV_NUM('NEMOTRON_NANO_MAX_OUTPUT', 4096),
    temperature: 0.7,
    concurrencyLimit: ENV_NUM('NEMOTRON_NANO_CONCURRENCY', 5),
    enabled: ENV_BOOL('NEMOTRON_NANO_ENABLED', true),
  }),

  lightning: model({
    role: 'high-throughput',
    modelId: ENV('NEMOTRON_LIGHTNING_MODEL', 'nvidia/nemotron-3.5-lightning-30b-a3b'),
    contextWindow: ENV_NUM('NEMOTRON_LIGHTNING_CONTEXT_WINDOW', 32768),
    maxOutputTokens: ENV_NUM('NEMOTRON_LIGHTNING_MAX_OUTPUT', 4096),
    temperature: 0.5,
    concurrencyLimit: ENV_NUM('NEMOTRON_LIGHTNING_CONCURRENCY', 10),
    enabled: ENV_BOOL('NEMOTRON_LIGHTNING_ENABLED', true),
  }),

  bolt: model({
    role: 'lightweight-autonomous',
    modelId: ENV('NEMOTRON_BOLT_MODEL', 'nvidia/nemotron-3.5-bolt-e4b'),
    contextWindow: ENV_NUM('NEMOTRON_BOLT_CONTEXT_WINDOW', 32768),
    maxOutputTokens: ENV_NUM('NEMOTRON_BOLT_MAX_OUTPUT', 2048),
    temperature: 0.5,
    concurrencyLimit: ENV_NUM('NEMOTRON_BOLT_CONCURRENCY', 8),
    enabled: ENV_BOOL('NEMOTRON_BOLT_ENABLED', true),
  }),

  'nano-omni': model({
    role: 'multimodal',
    modelId: ENV('NEMOTRON_NANO_OMNI_MODEL', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'),
    contextWindow: ENV_NUM('NEMOTRON_NANO_OMNI_CONTEXT_WINDOW', 32768),
    maxOutputTokens: ENV_NUM('NEMOTRON_NANO_OMNI_MAX_OUTPUT', 4096),
    temperature: 0.6,
    concurrencyLimit: ENV_NUM('NEMOTRON_NANO_OMNI_CONCURRENCY', 3),
    enabled: ENV_BOOL('NEMOTRON_NANO_OMNI_ENABLED', true),
  }),

  ultra: model({
    role: 'advanced-reasoning-escalation',
    modelId: ENV('NEMOTRON_ULTRA_MODEL', 'nvidia/nemotron-3-ultra-550b-a55b'),
    contextWindow: ENV_NUM('NEMOTRON_ULTRA_CONTEXT_WINDOW', 131072),
    maxOutputTokens: ENV_NUM('NEMOTRON_ULTRA_MAX_OUTPUT', 8192),
    temperature: 0.2,
    timeoutMs: ENV_NUM('NEMOTRON_ULTRA_TIMEOUT_MS', 300_000),
    retryLimit: ENV_NUM('NEMOTRON_ULTRA_RETRY_LIMIT', 2),
    concurrencyLimit: ENV_NUM('NEMOTRON_ULTRA_CONCURRENCY', 1),
    // Ultra is the hard-problem specialist. On unless NEMOTRON_ULTRA_ENABLED=false.
    enabled: ENV_BOOL('NEMOTRON_ULTRA_ENABLED', true),
  }),
};

export const NEMOTRON_CONFIG: NemotronOrchestratorConfig = {
  orchestrator: ORCHESTRATOR,
  specialists: SPECIALISTS,
  defaultTimeoutMs: ENV_NUM('NEMOTRON_DEFAULT_TIMEOUT_MS', 60_000),
  maxExecutionMs: ENV_NUM('NEMOTRON_MAX_EXECUTION_MS', 600_000),
  enableExecutionLog: ENV_BOOL('NEMOTRON_ENABLE_EXECUTION_LOG', true),
  logDir: ENV('NEMOTRON_LOG_DIR', path.join(__dirname, '..', '..', 'debug-center-data', 'nemotron')),
};

// Per-request API key override (used by the Anthropic-compatible gateway, which
// receives the NVIDIA key from the client's Authorization / x-api-key header).
const requestKeyStore = new AsyncLocalStorage<string>();

export function runWithNemotronApiKey<T>(apiKey: string | undefined, fn: () => T): T {
  return apiKey ? requestKeyStore.run(apiKey, fn) : fn();
}

// Resolve the API key for a model: per-request override first, then its env var.
export function nemotronApiKey(modelConfig: NemotronModelConfig): string | undefined {
  return requestKeyStore.getStore() || ENV(modelConfig.apiKeyEnv) || undefined;
}

// Return only enabled models.
export function enabledModels(): NemotronModelConfig[] {
  const out: NemotronModelConfig[] = [];
  if (ORCHESTRATOR.enabled) out.push(ORCHESTRATOR);
  for (const spec of Object.values(SPECIALISTS)) {
    if (spec.enabled) out.push(spec);
  }
  return out;
}

// Find a model config by role.
export function modelByRole(role: string): NemotronModelConfig | undefined {
  if (ORCHESTRATOR.role === role) return ORCHESTRATOR;
  return Object.values(SPECIALISTS).find((s) => s.role === role);
}
