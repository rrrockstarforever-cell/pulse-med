// Execution logging and monitoring.
// Tracks each user request end-to-end: classification, decomposition, agents
// selected, rationale, parallel execution status, durations, tokens, retries,
// errors, verification status, final completion status. Writes human-readable
// log lines to disk (optional) and keeps an in-memory tail for the dashboard.

export interface ExecutionLogEntry {
  id: string;
  requestId: string;
  timestamp: string;
  event: 'request' | 'classify' | 'decompose' | 'delegate' | 'execute' | 'result' | 'verify' | 'resolve' | 'synthesize' | 'error' | 'complete';
  message: string;
  data?: Record<string, any>;
}

export interface RequestSummary {
  requestId: string;
  originalRequest: string;
  category: string;
  complexity: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  modelsUsed: string[];
  totalTokens?: { input: number; output: number; total: number };
}

export class ExecutionLogger {
  private logs = new Map<string, ExecutionLogEntry[]>();
  private summaries = new Map<string, RequestSummary>();
  private maxPerRequest = 500;
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  log(entry: Omit<ExecutionLogEntry, 'id' | 'timestamp'>): void {
    if (!this.enabled) return;
    const full: ExecutionLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    const list = this.logs.get(full.requestId) ?? [];
    list.push(full);
    if (list.length > this.maxPerRequest) list.shift();
    this.logs.set(full.requestId, list);
  }

  getRequestLogs(requestId: string): ExecutionLogEntry[] {
    return this.logs.get(requestId) ?? [];
  }

  allRequestIds(): string[] {
    return [...this.summaries.keys()].reverse();
  }

  setSummary(summary: RequestSummary): void {
    this.summaries.set(summary.requestId, summary);
  }

  getSummary(requestId: string): RequestSummary | undefined {
    return this.summaries.get(requestId);
  }

  allSummaries(): RequestSummary[] {
    return [...this.summaries.values()].reverse();
  }

  clear(requestId?: string): void {
    if (requestId) {
      this.logs.delete(requestId);
      this.summaries.delete(requestId);
    } else {
      this.logs.clear();
      this.summaries.clear();
    }
  }
}

export const executionLogger = new ExecutionLogger(true);
