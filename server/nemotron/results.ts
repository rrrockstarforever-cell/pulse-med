// Result aggregation system.
// Maintains per-task records: model id, task id, response, duration, token usage,
// cost, completion status, error details.

export interface TaskRecord {
  taskId: string;
  modelId: string;
  modelRole: string;
  category: string;
  response: string;
  durationMs: number;
  tokens?: { input?: number; output?: number; total?: number };
  costUsd?: number;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
  retries: number;
}

export interface AggregatedResult {
  requestId: string;
  originalRequest: string;
  category: string;
  complexity: string;
  tasks: TaskRecord[];
  finalAnswer: string;
  totalDurationMs: number;
  totalTokens?: { input?: number; output?: number; total?: number };
  totalCostUsd?: number;
  status: 'completed' | 'partial' | 'failed';
}

export class ResultAggregator {
  private tasks = new Map<string, TaskRecord>();

  add(record: TaskRecord): void {
    this.tasks.set(record.taskId, record);
  }

  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  all(): TaskRecord[] {
    return [...this.tasks.values()];
  }

  completed(): TaskRecord[] {
    return this.all().filter((t) => t.status === 'completed');
  }

  failed(): TaskRecord[] {
    return this.all().filter((t) => t.status === 'failed');
  }

  clear(): void {
    this.tasks.clear();
  }

  totals(): { tasks: number; completed: number; failed: number; skipped: number; durationMs: number; tokens: { input: number; output: number; total: number } } {
    const list = this.all();
    const tokens = { input: 0, output: 0, total: 0 };
    let durationMs = 0;
    for (const t of list) {
      durationMs += t.durationMs;
      if (t.tokens) {
        tokens.input += t.tokens.input ?? 0;
        tokens.output += t.tokens.output ?? 0;
        tokens.total += t.tokens.total ?? 0;
      }
    }
    return {
      tasks: list.length,
      completed: list.filter((t) => t.status === 'completed').length,
      failed: list.filter((t) => t.status === 'failed').length,
      skipped: list.filter((t) => t.status === 'skipped').length,
      durationMs,
      tokens,
    };
  }

  buildAggregatedResult(opts: {
    requestId: string;
    originalRequest: string;
    category: string;
    complexity: string;
    finalAnswer: string;
    totalDurationMs: number;
  }): AggregatedResult {
    const list = this.all();
    const totals = this.totals();
    return {
      requestId: opts.requestId,
      originalRequest: opts.originalRequest,
      category: opts.category,
      complexity: opts.complexity,
      tasks: list,
      finalAnswer: opts.finalAnswer,
      totalDurationMs: opts.totalDurationMs,
      totalTokens: totals.tokens,
      totalCostUsd: undefined,
      status: totals.failed === list.length ? 'failed' : totals.failed > 0 ? 'partial' : 'completed',
    };
  }
}

export const resultAggregator = new ResultAggregator();
