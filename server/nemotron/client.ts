// Nemotron specialist API client.
// Calls NVIDIA NIM endpoints (OpenAI-compatible chat/completions) for each specialist model.
// All requests go through env-configured API keys; keys are never logged or returned.

import { NemotronModelConfig, nemotronApiKey } from './config.ts';

export interface NemotronMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface NemotronChatOptions {
  model: NemotronModelConfig;
  messages: NemotronMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  json?: boolean;
}

export interface NemotronChatResult {
  text: string;
  model: string;
  durationMs: number;
  tokens?: { input?: number; output?: number; total?: number };
}

const RATE_LIMIT_RETRIES = Number(process.env.NEMOTRON_RATE_LIMIT_RETRIES ?? 4);

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Delay before retrying a 429: Retry-After header if present, else 2s, 4s, 8s, 16s (+ jitter).
export function retryDelayMs(res: { headers: { get(name: string): string | null } }, attempt: number): number {
  const ra = Number(res.headers.get('retry-after'));
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 60_000);
  return Math.min(2000 * 2 ** attempt, 30_000) + Math.floor(Math.random() * 500);
}

export class NemotronClientError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'NemotronClientError';
    this.status = status;
  }
}

export class NemotronClient {
  private async fetchWithTimeout(url: string, body: unknown, timeoutMs: number, apiKey: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(options: NemotronChatOptions): Promise<NemotronChatResult> {
    const { model, messages, temperature, maxOutputTokens, json } = options;
    const apiKey = nemotronApiKey(model);
    if (!apiKey) {
      throw new NemotronClientError(
        `No API key configured for ${model.role} (env var ${model.apiKeyEnv}).`,
        401,
      );
    }

    const system = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: model.modelId,
      messages: [
        ...(system ? [{ role: 'system', content: system.content }] : []),
        ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: temperature ?? model.temperature ?? 0.7,
      max_tokens: maxOutputTokens ?? model.maxOutputTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      stream: false,
    };

    // Add reasoning config if supported by the model.
    if (model.reasoning?.enabled) {
      body['reasoning'] = { effort: model.reasoning.effort ?? 'medium' };
    }

    const startedAt = Date.now();
    let res: Response;
    // Rate limits (429) are common on NVIDIA's hosted API when Super is called
    // several times in a row: wait and retry (honouring Retry-After) before failing.
    for (let attempt = 0; ; attempt++) {
      try {
        res = await this.fetchWithTimeout(`${model.endpoint}/chat/completions`, body, model.timeoutMs, apiKey);
      } catch (err: any) {
        throw new NemotronClientError(
          `Network error calling ${model.role} (${model.modelId}): ${err?.message || 'request failed'}`,
          502,
        );
      }
      // 429 is a rate limit. 502/503/504 is a transient NVIDIA overload (Ultra often
      // returns 503 "Service temporarily overloaded") — wait and try again.
      if (![429, 502, 503, 504].includes(res.status) || attempt >= RATE_LIMIT_RETRIES) break;
      await sleep(retryDelayMs(res, attempt));
    }

    const durationMs = Date.now() - startedAt;

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const b = await res.json();
        msg = b?.error?.message || b?.error || JSON.stringify(b).slice(0, 300);
      } catch { /* non-JSON error body */ }
      throw new NemotronClientError(`${model.role} (${model.modelId}) request failed: ${msg}`, res.status);
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      throw new NemotronClientError(`${model.role} (${model.modelId}) returned invalid JSON.`, 502);
    }

    const text = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.message?.reasoning_content ?? '';
    if (!text || !text.trim()) {
      throw new NemotronClientError(`${model.role} (${model.modelId}) returned an empty response.`, 502);
    }

    const usage = data?.usage;
    return {
      text: text.trim(),
      model: model.modelId,
      durationMs,
      tokens: usage
        ? {
            input: usage.prompt_tokens ?? null,
            output: usage.completion_tokens ?? null,
            total: usage.total_tokens ?? null,
          }
        : undefined,
    };
  }
}

export const nemotronClient = new NemotronClient();
