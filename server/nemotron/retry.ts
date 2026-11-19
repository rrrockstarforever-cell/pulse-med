// Retry and failover system.
// Retries per configured policy, tries alternative Nemotron specialists, informs
// Super, continues independent tasks, preserves completed results, records failures.
// Never falls back to a non-Nemotron model.

import { NemotronModelConfig } from './config.ts';
import { NemotronClientError } from './client.ts';

export interface FailoverPolicy {
  maxRetries: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  enableAlternativeModel: boolean;
}

export interface FailoverResult<T> {
  value: T | null;
  attempts: number;
  errors: string[];
  usedAlternative: boolean;
  finalModel?: NemotronModelConfig;
  finalError?: string;
}

export const DEFAULT_POLICY: FailoverPolicy = {
  maxRetries: 3,
  baseBackoffMs: 500,
  maxBackoffMs: 8000,
  enableAlternativeModel: true,
};

export function isRetryable(err: any): boolean {
  if (err instanceof NemotronClientError) {
    // 401 (auth) and 400 (bad request) are not retryable.
    if (err.status === 401 || err.status === 400) return false;
    // 429 rate limit, 502/503/504 transient are retryable.
    if (err.status === 429 || err.status >= 500) return true;
  }
  const msg = String(err?.message || '').toLowerCase();
  if (/network|timeout|fetch failed|abort|ECONNREFUSED|ETIMEDOUT/.test(msg)) return true;
  return false;
}

export async function withRetryAndFailover<T>(
  call: (model: NemotronModelConfig) => Promise<T>,
  primary: NemotronModelConfig,
  alternatives: NemotronModelConfig[],
  policy: FailoverPolicy = DEFAULT_POLICY,
): Promise<FailoverResult<T>> {
  const errors: string[] = [];
  let attempts = 0;
  let usedAlternative = false;
  let finalModel: NemotronModelConfig | undefined;

  const candidates = [primary, ...alternatives].filter((m) => m.enabled);

  for (const model of candidates) {
    if (model !== primary) usedAlternative = true;
    finalModel = model;
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      attempts += 1;
      try {
        const value = await call(model);
        return { value, attempts, errors, usedAlternative, finalModel: model };
      } catch (err: any) {
        lastError = err?.message || 'unknown error';
        errors.push(`${model.role} attempt ${attempt + 1}: ${lastError}`);
        if (!isRetryable(err) || attempt === policy.maxRetries) break;
        await sleep(policy.baseBackoffMs * Math.pow(2, attempt));
      }
    }
  }

  return { value: null, attempts, errors, usedAlternative, finalModel, finalError: errors[errors.length - 1] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
