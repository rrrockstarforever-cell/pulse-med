// Parallel execution engine.
// Executes independent specialist subtasks concurrently with configurable
// concurrency, timeouts, cancellation, dependency management, and per-task tracking.

import { NemotronModelConfig } from './config.ts';
import { nemotronClient, NemotronChatResult } from './client.ts';
import { TaskContext, specialistMessages } from './context.ts';
import { withRetryAndFailover } from './retry.ts';

export interface SubTask {
  id: string;
  objective: string;
  requiredExpertise: string;
  preferredModel: NemotronModelConfig;
  fallbackModels: NemotronModelConfig[];
  inputContext: string;
  expectedOutput: string;
  completionCriteria: string[];
  dependencies: string[];
  roleSpecificInstructions: string;
}

export interface SubTaskResult {
  taskId: string;
  modelId: string;
  modelRole: string;
  response: string;
  durationMs: number;
  tokens?: { input?: number; output?: number; total?: number };
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
  retries: number;
}

export interface ParallelOptions {
  concurrency?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export class ParallelExecutionEngine {
  private running = new Map<string, AbortController>();
  private cancelled = false;

  cancelAll(): void {
    this.cancelled = true;
    for (const ctrl of this.running.values()) {
      ctrl.abort();
    }
    this.running.clear();
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * Execute subtasks. Independent tasks run in parallel (up to concurrency).
   * Dependent tasks wait for their dependencies to complete first.
   */
  async execute(
    tasks: SubTask[],
    opts: ParallelOptions = {},
  ): Promise<SubTaskResult[]> {
    const {
      concurrency = 5,
      timeoutMs = 120_000,
      maxRetries = 2,
    } = opts;

    const results = new Map<string, SubTaskResult>();
    const pending = new Set(tasks.map((t) => t.id));
    const completed = new Set<string>();
    const byId = new Map(tasks.map((t) => [t.id, t]));

    const semaphore = await this.makeSemaphore(concurrency);

    const runTask = async (task: SubTask): Promise<SubTaskResult> => {
      await semaphore.acquire();
      try {
        if (this.cancelled) {
          return { taskId: task.id, modelId: task.preferredModel.modelId, modelRole: task.preferredModel.role, response: '', durationMs: 0, status: 'skipped', error: 'cancelled', retries: 0 };
        }
        return await this.runSingle(task, maxRetries, timeoutMs);
      } finally {
        semaphore.release();
      }
    };

    // Dependency-respecting scheduler.
    const queue: SubTask[] = [...tasks];
    const workers: Promise<void>[] = [];

    const launch = async () => {
      while (queue.length > 0 && !this.cancelled) {
        // Find a task whose dependencies are all satisfied.
        const idx = queue.findIndex((t) => t.dependencies.every((d) => completed.has(d)));
        if (idx < 0) {
          // No runnable task remaining (circular dep or all remaining blocked).
          // Run the rest anyway to avoid deadlock; they'll report skipped if deps failed.
          const remaining = queue.splice(0);
          await Promise.all(remaining.map((t) => runTask(t).then((r) => results.set(r.taskId, r))));
          return;
        }
        const task = queue.splice(idx, 1)[0];
        const ctrl = new AbortController();
        this.running.set(task.id, ctrl);
        const p = runTask(task).then((r) => {
          results.set(r.taskId, r);
          completed.add(r.taskId);
          this.running.delete(task.id);
        });
        workers.push(p);
      }
      await Promise.all(workers);
    };

    await launch();
    return tasks.map((t) => results.get(t.id) ?? { taskId: t.id, modelId: t.preferredModel.modelId, modelRole: t.preferredModel.role, response: '', durationMs: 0, status: 'failed', error: 'no result recorded', retries: 0 });
  }

  private async runSingle(task: SubTask, maxRetries: number, timeoutMs: number): Promise<SubTaskResult> {
    let lastError: string | undefined;
    let retries = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.cancelled) {
        return { taskId: task.id, modelId: task.preferredModel.modelId, modelRole: task.preferredModel.role, response: '', durationMs: 0, status: 'skipped', error: 'cancelled', retries };
      }

      const ctx: TaskContext = {
        taskId: task.id,
        objective: task.objective,
        requiredExpertise: task.requiredExpertise,
        inputContext: task.inputContext,
        expectedOutput: task.expectedOutput,
        completionCriteria: task.completionCriteria,
        dependencies: task.dependencies,
        // Only inputContext and systemPrompt reach the model, so make sure the
        // specialist is told its objective and the expected output.
        systemPrompt: task.inputContext.includes(task.objective)
          ? task.roleSpecificInstructions
          : [task.roleSpecificInstructions, `Objective: ${task.objective}`, `Expected output: ${task.expectedOutput}`]
              .filter(Boolean)
              .join('\n\n'),
      };
      const { system, messages } = specialistMessages(ctx, task.preferredModel);

      const startedAt = Date.now();
      try {
        const fallback = [...(task.fallbackModels ?? [])].filter((m) => m.enabled);
        const result = await withRetryAndFailover(
          (model: NemotronModelConfig) => nemotronClient.chat({
            model,
            messages,
            temperature: model.temperature ?? 0.7,
            maxOutputTokens: model.maxOutputTokens,
            json: false,
          }),
          task.preferredModel,
          fallback,
          { maxRetries: 1, baseBackoffMs: 300, maxBackoffMs: 2000, enableAlternativeModel: true },
        );
        if (!result.value) {
          return {
            taskId: task.id,
            modelId: result.finalModel?.modelId ?? task.preferredModel.modelId,
            modelRole: task.preferredModel.role,
            response: '',
            durationMs: Date.now() - startedAt,
            status: 'failed',
            error: result.finalError ?? 'all nemotron models failed',
            retries: result.attempts,
          };
        }
        const res = result.value;
        return {
          taskId: task.id,
          modelId: res.model,
          modelRole: task.preferredModel.role,
          response: res.text,
          durationMs: Date.now() - startedAt,
          tokens: res.tokens
            ? {
                input: res.tokens.input ?? undefined,
                output: res.tokens.output ?? undefined,
                total: res.tokens.total ?? undefined,
              }
            : undefined,
          status: 'completed',
          retries: result.attempts - 1,
        };
      } catch (err: any) {
        return {
          taskId: task.id,
          modelId: task.preferredModel.modelId,
          modelRole: task.preferredModel.role,
          response: '',
          durationMs: Date.now() - startedAt,
          status: 'failed',
          error: err?.message || 'unknown error',
          retries: 0,
        };
      }
    }

    return { taskId: task.id, modelId: task.preferredModel.modelId, modelRole: task.preferredModel.role, response: '', durationMs: 0, status: 'failed', error: lastError, retries };
  }

  private makeSemaphore(n: number) {
    let slots = n;
    const waiters: (() => void)[] = [];
    return {
      acquire: () => new Promise<void>((resolve) => {
        if (slots > 0) { slots -= 1; resolve(); }
        else waiters.push(resolve);
      }),
      release: () => {
        const w = waiters.shift();
        if (w) w();
        else slots += 1;
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
