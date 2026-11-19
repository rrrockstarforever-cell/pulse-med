// Nemotron orchestration tests.
// Runs offline with a mocked fetch — no real NVIDIA API calls required.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NEMOTRON_CONFIG } from '../../server/nemotron/config.ts';
import { listNemotronModels, isNemotronModelId, nemotronRoleForModel } from '../../server/nemotron/registry.ts';
import { routeRequest, categoryForText } from '../../server/nemotron/routing.ts';
import { NemotronClientError } from '../../server/nemotron/client.ts';
import { ParallelExecutionEngine } from '../../server/nemotron/parallel.ts';
import { compressContext, estimateTokens, buildTaskContext } from '../../server/nemotron/context.ts';
import { resultAggregator } from '../../server/nemotron/results.ts';
import { VerificationModule } from '../../server/nemotron/verify.ts';
import { withRetryAndFailover, isRetryable, DEFAULT_POLICY } from '../../server/nemotron/retry.ts';

// ---------------------------------------------------------------------------
// Mock fetch for NVIDIA NIM calls
// ---------------------------------------------------------------------------
const realFetch = globalThis.fetch;
let mockHandler: ((url: string, body: any) => { status: number; body: any }) | null = null;

function installMock(handler: ((url: string, body: any) => { status: number; body: any }) | null) {
  mockHandler = handler;
  globalThis.fetch = async (input: any, init: any = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? JSON.parse(init.body || '{}') : {};
    const result = mockHandler ? mockHandler(url, body) : null;
    if (!result) {
      return new Response(JSON.stringify({ error: 'no mock handler' }), { status: 502 });
    }
    return new Response(JSON.stringify(result.body), { status: result.status });
  };
}

function uninstallMock() {
  globalThis.fetch = realFetch;
  mockHandler = null;
}

beforeEach(() => {
  resultAggregator.clear();
  process.env.NEMOTRON_API_KEY = 'test-key';
  installMock(null);
});

afterEach(() => {
  uninstallMock();
});

// ---------------------------------------------------------------------------
// Config / registry
// ---------------------------------------------------------------------------
describe('Nemotron config & registry', () => {
  it('orchestrator is Nemotron Super', () => {
    assert.strictEqual(NEMOTRON_CONFIG.orchestrator.role, 'orchestrator');
    assert.ok(NEMOTRON_CONFIG.orchestrator.modelId.includes('nemotron-3.5-super'));
  });

  it('all models are Nemotron-only (no non-Nemotron ids)', () => {
    const models = listNemotronModels();
    for (const m of models) {
      assert.ok(m.config.modelId.includes('nemotron'), `${m.config.modelId} is not a Nemotron model`);
    }
    assert.strictEqual(isNemotronModelId('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'), true);
    assert.strictEqual(isNemotronModelId('gpt-6.1-sol'), false);
    assert.strictEqual(isNemotronModelId('claude-sonnet-5-5'), false);
    assert.strictEqual(isNemotronModelId('deepseek-chat'), false);
  });

  it('role lookup works', () => {
    assert.strictEqual(nemotronRoleForModel(NEMOTRON_CONFIG.specialists.nano.modelId), 'general-reasoning');
    assert.strictEqual(nemotronRoleForModel('not-a-nemotron-model'), undefined);
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
describe('Routing engine', () => {
  it('classifies general conversation', () => {
    assert.strictEqual(categoryForText('Hello, how are you today?'), 'general-conversation');
  });

  it('classifies coding tasks', () => {
    assert.strictEqual(categoryForText('Write a TypeScript function to sort an array.'), 'coding');
  });

  it('classifies mathematics', () => {
    assert.strictEqual(categoryForText('Solve this calculus problem: derivative of x^2.'), 'mathematics');
  });

  it('classifies image analysis', () => {
    assert.strictEqual(categoryForText('What is in this image? Describe the photo.'), 'image-analysis');
  });

  it('classifies complex interdisciplinary tasks', () => {
    assert.strictEqual(categoryForText('A complex interdisciplinary research and code task on climate modeling.'), 'complex-interdisciplinary');
  });

  it('routes simple requests without parallel/ultra', async () => {
    const decision = await routeRequest('Hello there');
    assert.strictEqual(decision.needsParallel, false);
    assert.strictEqual(decision.needsUltra, false);
    assert.strictEqual(decision.preferredModel.enabled, true);
  });

  it('routes math to orchestrator with ultra flag for extreme', async () => {
    const decision = await routeRequest('Solve this extremely difficult advanced mathematics problem step by step.');
    assert.strictEqual(decision.preferredModel.role, 'orchestrator');
    assert.strictEqual(decision.needsUltra, true);
  });

  it('routes coding with parallel execution', async () => {
    const decision = await routeRequest('Write and debug a Python web scraper with multiple steps.');
    assert.strictEqual(decision.needsParallel, true);
  });
});

// ---------------------------------------------------------------------------
// Parallel execution
// ---------------------------------------------------------------------------
describe('Parallel execution engine', () => {
  it('executes independent tasks in parallel', async () => {
    const engine = new ParallelExecutionEngine();
    const calls: string[] = [];
    installMock((url, body) => {
      calls.push(body.model);
      return { status: 200, body: { choices: [{ message: { content: `answer for ${body.model}` } }] } };
    });

    const results = await engine.execute([
      {
        id: 't1', objective: 'task one', requiredExpertise: 'general-reasoning',
        preferredModel: NEMOTRON_CONFIG.specialists.nano,
        inputContext: 'ctx1', expectedOutput: 'out1', completionCriteria: [], dependencies: [],
        roleSpecificInstructions: 'instr', fallbackModels: [],
      },
      {
        id: 't2', objective: 'task two', requiredExpertise: 'high-throughput',
        preferredModel: NEMOTRON_CONFIG.specialists.lightning,
        inputContext: 'ctx2', expectedOutput: 'out2', completionCriteria: [], dependencies: [],
        roleSpecificInstructions: 'instr', fallbackModels: [],
      },
    ], { concurrency: 5 });

    assert.strictEqual(results.length, 2);
    assert.ok(results.every((r) => r.status === 'completed'));
    assert.strictEqual(calls.length, 2);
  });

  it('respects dependencies — dependent task runs after its dependency', async () => {
    const engine = new ParallelExecutionEngine();
    installMock((url, body) => {
      return { status: 200, body: { choices: [{ message: { content: 'done' } }] } };
    });

    const results = await engine.execute([
      {
        id: 'a', objective: 'first', requiredExpertise: 'general-reasoning',
        preferredModel: NEMOTRON_CONFIG.specialists.nano,
        inputContext: 'x', expectedOutput: 'y', completionCriteria: [], dependencies: [],
        roleSpecificInstructions: 'i', fallbackModels: [],
      },
      {
        id: 'b', objective: 'second depends on a', requiredExpertise: 'general-reasoning',
        preferredModel: NEMOTRON_CONFIG.specialists.nano,
        inputContext: 'x', expectedOutput: 'y', completionCriteria: [], dependencies: ['a'],
        roleSpecificInstructions: 'i', fallbackModels: [],
      },
    ], { concurrency: 2 });

    assert.strictEqual(results.length, 2);
    const b = results.find((r) => r.taskId === 'b');
    assert.ok(b);
    assert.strictEqual(b.status, 'completed');
  });

  it('marks failed task when model errors', async () => {
    const engine = new ParallelExecutionEngine();
    installMock(() => ({ status: 500, body: { error: 'server error' } }));

    const results = await engine.execute([
      {
        id: 't1', objective: 'fail', requiredExpertise: 'general-reasoning',
        preferredModel: NEMOTRON_CONFIG.specialists.nano,
        inputContext: 'x', expectedOutput: 'y', completionCriteria: [], dependencies: [],
        roleSpecificInstructions: 'i', fallbackModels: [],
      },
    ], { maxRetries: 0 });

    assert.strictEqual(results[0].status, 'failed');
    assert.ok(results[0].error);
  });
});

// ---------------------------------------------------------------------------
// Context manager
// ---------------------------------------------------------------------------
describe('Context manager', () => {
  it('compresses long context to fit token budget', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i}: some content here about topic ${i}`);
    const long = lines.join('\n'); // ~5000 chars, ~1250 tokens
    const compressed = compressContext(long, { maxTokens: 300 });
    assert.ok(estimateTokens(compressed) <= 400);
    assert.ok(compressed.includes('line 0:'));
    assert.ok(compressed.includes('line 199:'));
  });

  it('buildTaskContext produces required fields', () => {
    const ctx = buildTaskContext(
      't1', 'summarize this', 'read the doc', 'doc content here',
      NEMOTRON_CONFIG.specialists.nano, 'Be concise.',
    );
    assert.strictEqual(ctx.taskId, 't1');
    assert.strictEqual(ctx.objective, 'summarize this');
    assert.ok(ctx.inputContext.includes('doc content here'));
    assert.deepStrictEqual(ctx.dependencies, []);
  });
});

// ---------------------------------------------------------------------------
// Result aggregation
// ---------------------------------------------------------------------------
describe('Result aggregation', () => {
  it('tracks completed and failed tasks', () => {
    resultAggregator.add({ taskId: 'a', modelId: 'm1', modelRole: 'nano', category: 'coding', response: 'ok', durationMs: 10, status: 'completed', retries: 0 });
    resultAggregator.add({ taskId: 'b', modelId: 'm2', modelRole: 'bolt', category: 'coding', response: '', durationMs: 5, status: 'failed', error: 'boom', retries: 0 });

    const totals = resultAggregator.totals();
    assert.strictEqual(totals.tasks, 2);
    assert.strictEqual(totals.completed, 1);
    assert.strictEqual(totals.failed, 1);
    const agg = resultAggregator.buildAggregatedResult({
      requestId: 'r1', originalRequest: 'hi', category: 'coding', complexity: 'low',
      finalAnswer: 'done', totalDurationMs: 15,
    });
    assert.strictEqual(agg.status, 'partial');
    assert.strictEqual(agg.finalAnswer, 'done');
  });
});

// ---------------------------------------------------------------------------
// Verification / disagreement
// ---------------------------------------------------------------------------
describe('Verification module', () => {
  it('detects divergence between two specialist results', () => {
    const verifier = new VerificationModule(NEMOTRON_CONFIG.orchestrator);
    const d = verifier.detectDisagreement('t1',
      { taskId: 't1', modelId: 'm1', modelRole: 'nano', category: 'c', response: 'Photosynthesis converts carbon dioxide and water into glucose using sunlight energy captured by chlorophyll in plant chloroplasts, producing oxygen as a byproduct.', durationMs: 10, status: 'completed', retries: 0 },
      { taskId: 't1', modelId: 'm2', modelRole: 'lightning', category: 'c', response: 'Quantum entanglement correlates particle pairs across vast distances in physics experiments, where measuring one particle instantly determines the state of its entangled partner regardless of separation.', durationMs: 10, status: 'completed', retries: 0 },
    );
    assert.ok(d);
    assert.ok(d!.issue.includes('diverge'));
  });

  it('returns null when responses agree', () => {
    const verifier = new VerificationModule(NEMOTRON_CONFIG.orchestrator);
    const d = verifier.detectDisagreement('t1',
      { taskId: 't1', modelId: 'm1', modelRole: 'nano', category: 'c', response: 'Photosynthesis converts carbon dioxide and water into glucose using sunlight energy captured by chlorophyll.', durationMs: 10, status: 'completed', retries: 0 },
      { taskId: 't1', modelId: 'm2', modelRole: 'lightning', category: 'c', response: 'Photosynthesis converts carbon dioxide and water into glucose using sunlight energy captured by chlorophyll.', durationMs: 10, status: 'completed', retries: 0 },
    );
    assert.strictEqual(d, null);
  });
});

// ---------------------------------------------------------------------------
// Retry / failover
// ---------------------------------------------------------------------------
describe('Retry & failover', () => {
  it('retries transient failures then succeeds', async () => {
    let attempts = 0;
    installMock((url, body) => {
      attempts += 1;
      if (attempts < 3) return { status: 502, body: { error: 'transient' } };
      return { status: 200, body: { choices: [{ message: { content: 'success' } }] } };
    });

    const result = await withRetryAndFailover(
      (model) => nemotronCall(model),
      NEMOTRON_CONFIG.specialists.nano,
      [],
      DEFAULT_POLICY,
    );
    assert.strictEqual(result.value, 'success');
    assert.strictEqual(result.attempts, 3);
  });

  it('fails over to alternative Nemotron model when primary errors', async () => {
    installMock(() => ({ status: 500, body: { error: 'boom' } }));
    const result = await withRetryAndFailover(
      (model) => nemotronCall(model),
      NEMOTRON_CONFIG.specialists.nano,
      [NEMOTRON_CONFIG.specialists.lightning],
      DEFAULT_POLICY,
    );
    assert.strictEqual(result.value, null);
    assert.strictEqual(result.usedAlternative, true);
  });

  it('rejects non-retryable auth errors immediately', async () => {
    installMock(() => ({ status: 401, body: { error: 'bad key' } }));
    const result = await withRetryAndFailover(
      (model) => nemotronCall(model),
      NEMOTRON_CONFIG.specialists.nano,
      [],
      { ...DEFAULT_POLICY, maxRetries: 3 },
    );
    assert.strictEqual(result.value, null);
    assert.strictEqual(result.attempts, 1); // not retried
  });

  it('isRetryable marks 429/502 as retryable, 401/400 as not', () => {
    assert.strictEqual(isRetryable(new NemotronClientError('x', 429)), true);
    assert.strictEqual(isRetryable(new NemotronClientError('x', 502)), true);
    assert.strictEqual(isRetryable(new NemotronClientError('x', 401)), false);
    assert.strictEqual(isRetryable(new NemotronClientError('x', 400)), false);
    assert.strictEqual(isRetryable(new Error('network timeout')), true);
  });
});

async function nemotronCall(model: any): Promise<string> {
  const res = await (globalThis.fetch as any)(`${model.endpoint}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model: model.modelId }),
  });
  const data = await res.json();
  if (!res.ok) throw new NemotronClientError(data.error || 'failed', res.status);
  return data.choices[0].message.content;
}
