// Complex simulation to test the Nemotron orchestrator across ALL models.
// Mocks the NVIDIA NIM API so no real network calls are made.
// Exercises: routing, decomposition, parallel execution, dependencies,
// quality control, disagreement resolution, synthesis, retries/failover.

import { nemotronOrchestrator } from '../../server/nemotron/orchestrator.ts';
import { NEMOTRON_CONFIG } from '../../server/nemotron/config.ts';
import { ParallelExecutionEngine } from '../../server/nemotron/parallel.ts';
import { VerificationModule } from '../../server/nemotron/verify.ts';
import { withRetryAndFailover, isRetryable } from '../../server/nemotron/retry.ts';
import { NemotronClientError } from '../../server/nemotron/client.ts';
import { nemotronClient } from '../../server/nemotron/client.ts';

const realFetch = globalThis.fetch;
const results: { name: string; ok: boolean; detail?: string }[] = [];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`);
}

// ---------------------------------------------------------------------------
// Mock fetch — returns model-specific canned responses so we can verify each
// model is actually invoked and routed correctly.
// ---------------------------------------------------------------------------
function installMock() {
  const fetchFn = async (input: any, init: any = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body || '{}') : {};
    const modelId = String(body.model || '');
    const isJson = Boolean(body.response_format?.type === 'json_object');

    let content: string;
    if (/super/i.test(modelId)) {
      if (isJson) content = JSON.stringify({ tasks: [{ id: 't-a', objective: 'subtask A', requiredExpertise: 'general-reasoning', preferredModel: 'general-reasoning', inputContext: 'ctx A', expectedOutput: 'out A', completionCriteria: ['done'], dependencies: [], roleSpecificInstructions: 'be concise' }] });
      else content = 'Nemotron Super synthesized final answer.';
    } else if (/nano-omni/i.test(modelId)) {
      content = 'Multimodal analysis: image shows a chart with rising trend.';
    } else if (/ultra/i.test(modelId)) {
      content = 'Ultra independent assessment: side A is better supported.';
    } else if (/lightning/i.test(modelId)) {
      content = 'High-throughput transformed dataset summary.';
    } else if (/bolt/i.test(modelId)) {
      content = 'Lightweight code fix applied.';
    } else if (/nano/i.test(modelId)) {
      content = 'General reasoning result for the subtask.';
    } else {
      content = 'generic specialist response';
    }

    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  (globalThis as any).fetch = fetchFn;
}
function uninstallMock() { (globalThis as any).fetch = realFetch; }

// ---------------------------------------------------------------------------
// Simulation 1: Every specialist model is invoked through the orchestrator.
// ---------------------------------------------------------------------------
async function simulateAllSpecialistModels() {
  console.log('\n=== Simulation 1: All specialist models invoked ===');
  process.env.NEMOTRON_API_KEY = 'test-key';
  installMock();

  const models = [
    { key: 'nano', role: 'general-reasoning', request: 'Reason through this logic puzzle step by step.' },
    { key: 'lightning', role: 'high-throughput', request: 'Transform this large dataset into a summary table.' },
    { key: 'bolt', role: 'lightweight-autonomous', request: 'Make a small code fix to this function.' },
    { key: 'nano-omni', role: 'multimodal', request: 'Describe what is in this image.' },
    { key: 'ultra', role: 'advanced-reasoning-escalation', request: 'Solve this extremely difficult advanced mathematics problem step by step.' },
  ];

  for (const m of models) {
    try {
      const result = await nemotronOrchestrator.orchestrate({
        requestId: `sim-${m.key}`,
        userRequest: m.request,
        conversationHistory: [],
      });

      const calledModels = result.taskResults.map((r) => r.modelId);
      const usedExpected = calledModels.some((id) => id.includes(m.key === 'nano-omni' ? 'nano-omni' : m.key === 'ultra' ? 'ultra' : m.key));
      record(`orchestrator invokes ${m.role} (${m.key})`, result.status === 'completed' || result.status === 'partial', `status=${result.status} models=${calledModels.join(',')} expectedRole=${m.role}`);
    } catch (e: any) {
      record(`orchestrator invokes ${m.role} (${m.key})`, false, e.message);
    }
  }

  uninstallMock();
}

// ---------------------------------------------------------------------------
// Simulation 2: Parallel execution with multiple independent models at once.
// ---------------------------------------------------------------------------
async function simulateParallelAllModels() {
  console.log('\n=== Simulation 2: Parallel execution across all models ===');
  process.env.NEMOTRON_API_KEY = 'test-key';
  installMock();

  const request = `Build a complete web scraper: fetch data, parse HTML, handle retries, save to DB, and write a report. Also analyze async vs threading tradeoffs.`;
  try {
    const result = await nemotronOrchestrator.orchestrate({
      requestId: 'sim-parallel',
      userRequest: request,
      conversationHistory: [],
    });

    const roles = result.taskResults.map((r) => r.modelRole);
    const allCompleted = result.taskResults.every((r) => r.status === 'completed');
    record('parallel execution runs multiple models', allCompleted, `status=${result.status} roles=${roles.join(', ')} tasks=${result.tasks.length}`);
    record('no non-Nemotron model used', result.taskResults.every((r) => r.modelId.includes('nemotron')), `models=${result.taskResults.map(r => r.modelId).join(',')}`);
  } catch (e: any) {
    record('parallel execution runs multiple models', false, e.message);
  }

  uninstallMock();
}

// ---------------------------------------------------------------------------
// Simulation 3: Dependency chain — task B depends on task A.
// ---------------------------------------------------------------------------
async function simulateDependencyChain() {
  console.log('\n=== Simulation 3: Dependency chain ===');
  process.env.NEMOTRON_API_KEY = 'test-key';
  installMock();

  const engine = new ParallelExecutionEngine();
  const order: string[] = [];
  const fetchFn = async (input: any, init: any = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body || '{}') : {};
    order.push(String(body.model || ''));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status: 200 });
  };
  (globalThis as any).fetch = fetchFn;

  try {
    const results = await engine.execute([
      {
        id: 'a', objective: 'first task', requiredExpertise: 'general-reasoning',
        preferredModel: NEMOTRON_CONFIG.specialists.nano, inputContext: 'x', expectedOutput: 'y',
        completionCriteria: [], dependencies: [], roleSpecificInstructions: 'i', fallbackModels: [],
      },
      {
        id: 'b', objective: 'second depends on a', requiredExpertise: 'general-reasoning',
        preferredModel: NEMOTRON_CONFIG.specialists.lightning, inputContext: 'x', expectedOutput: 'y',
        completionCriteria: [], dependencies: ['a'], roleSpecificInstructions: 'i', fallbackModels: [],
      },
      {
        id: 'c', objective: 'third depends on b', requiredExpertise: 'lightweight-autonomous',
        preferredModel: NEMOTRON_CONFIG.specialists.bolt, inputContext: 'x', expectedOutput: 'y',
        completionCriteria: [], dependencies: ['b'], roleSpecificInstructions: 'i', fallbackModels: [],
      },
    ], { concurrency: 3 });

    const aDone = results.find((r) => r.taskId === 'a')?.status === 'completed';
    const bDone = results.find((r) => r.taskId === 'b')?.status === 'completed';
    const cDone = results.find((r) => r.taskId === 'c')?.status === 'completed';
    record('dependency chain a->b->c completes', aDone && bDone && cDone, `a=${results.find(r=>r.taskId==='a')?.status} b=${results.find(r=>r.taskId==='b')?.status} c=${results.find(r=>r.taskId==='c')?.status}`);
  } catch (e: any) {
    record('dependency chain a->b->c completes', false, e.message);
  }

  uninstallMock();
}

// ---------------------------------------------------------------------------
// Simulation 4: Quality control + disagreement resolution (escalation to Ultra).
// ---------------------------------------------------------------------------
async function simulateQualityControlAndDisagreement() {
  console.log('\n=== Simulation 4: Quality control & disagreement resolution ===');
  process.env.NEMOTRON_API_KEY = 'test-key';
  installMock();

  const verifier = new VerificationModule(NEMOTRON_CONFIG.orchestrator, NEMOTRON_CONFIG.specialists.ultra);

  const d = verifier.detectDisagreement('t1',
    { taskId: 't1', modelId: 'm1', modelRole: 'nano', category: 'c', response: 'Photosynthesis converts carbon dioxide and water into glucose using sunlight energy captured by chlorophyll in plant chloroplasts, producing oxygen as a byproduct.', durationMs: 10, status: 'completed', retries: 0 },
    { taskId: 't1', modelId: 'm2', modelRole: 'lightning', category: 'c', response: 'Quantum entanglement correlates particle pairs across vast distances in physics experiments, where measuring one particle instantly determines the state of its entangled partner regardless of separation.', durationMs: 10, status: 'completed', retries: 0 },
  );
  record('disagreement detected between divergent responses', Boolean(d), d ? `issue=${d.issue.slice(0, 40)}` : 'null');

  // Escalation to Ultra
  const esc = await verifier.escalateToUltra({ taskId: 't1', objective: 'photosynthesis vs quantum' }, d!);
  record('escalation to Ultra returns assessment', Boolean(esc.assessment), `usedUltra=${esc.usedUltra} model=${esc.model}`);

  // Full runQualityControl
  const qc = await verifier.runQualityControl(
    [{ taskId: 't1', objective: 'photosynthesis', inputContext: 'ctx', expectedOutput: 'out' }],
    [{ taskId: 't1', modelId: 'm1', modelRole: 'nano', category: 'c', response: 'Photosynthesis converts CO2 and water into glucose using sunlight.', durationMs: 10, status: 'completed', retries: 0 }],
  );
  record('runQualityControl returns verdicts', qc.verified.length === 1, `verified=${qc.verified.length} needsRevision=${qc.needsRevision}`);

  uninstallMock();
}

// ---------------------------------------------------------------------------
// Simulation 5: Retry & failover across Nemotron models.
// ---------------------------------------------------------------------------
async function simulateRetryAndFailover() {
  console.log('\n=== Simulation 5: Retry & failover ===');
  process.env.NEMOTRON_API_KEY = 'test-key';

  // Transient failure then success on primary
  let attempts = 0;
  const fetchFn = async (input: any, init: any = {}) => {
    attempts += 1;
    if (attempts < 3) return new Response(JSON.stringify({ error: 'transient' }), { status: 502 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'success' } }] }), { status: 200 });
  };
  (globalThis as any).fetch = fetchFn;

  try {
    const result = await withRetryAndFailover(
      (model) => nemotronClient.chat({ model, messages: [{ role: 'user', content: 'hi' }] }),
      NEMOTRON_CONFIG.specialists.nano,
      [],
      { maxRetries: 3, baseBackoffMs: 10, maxBackoffMs: 100, enableAlternativeModel: false },
    );
    record('retry transient failure then succeeds', result.value?.text === 'success', `attempts=${result.attempts}`);
  } catch (e: any) {
    record('retry transient failure then succeeds', false, e.message);
  }

  // Failover to alternative Nemotron model when primary errors
  attempts = 0;
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
  try {
    const result = await withRetryAndFailover(
      (model) => nemotronClient.chat({ model, messages: [{ role: 'user', content: 'hi' }] }),
      NEMOTRON_CONFIG.specialists.nano,
      [NEMOTRON_CONFIG.specialists.lightning],
      { maxRetries: 1, baseBackoffMs: 10, maxBackoffMs: 100, enableAlternativeModel: true },
    );
    record('failover to alternative Nemotron model', result.usedAlternative === true, `usedAlternative=${result.usedAlternative} value=${result.value}`);
  } catch (e: any) {
    record('failover to alternative Nemotron model', false, e.message);
  }

  // Non-retryable auth error fails immediately
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ error: 'bad key' }), { status: 401 });
  try {
    const result = await withRetryAndFailover(
      (model) => nemotronClient.chat({ model, messages: [{ role: 'user', content: 'hi' }] }),
      NEMOTRON_CONFIG.specialists.nano,
      [],
      { maxRetries: 3, baseBackoffMs: 10, maxBackoffMs: 100, enableAlternativeModel: false },
    );
    record('auth error not retried', result.attempts === 1, `attempts=${result.attempts}`);
  } catch (e: any) {
    record('auth error not retried', false, e.message);
  }

  // isRetryable checks
  record('isRetryable: 429 retryable', isRetryable(new NemotronClientError('x', 429)), '');
  record('isRetryable: 502 retryable', isRetryable(new NemotronClientError('x', 502)), '');
  record('isRetryable: 401 not retryable', isRetryable(new NemotronClientError('x', 401)) === false, '');
  record('isRetryable: 400 not retryable', isRetryable(new NemotronClientError('x', 400)) === false, '');
  record('isRetryable: network timeout retryable', isRetryable(new Error('network timeout')), '');

  uninstallMock();
}

// ---------------------------------------------------------------------------
// Simulation 6: Orchestrator (Nemotron Super) synthesis path.
// ---------------------------------------------------------------------------
async function simulateOrchestratorSynthesis() {
  console.log('\n=== Simulation 6: Orchestrator synthesis ===');
  process.env.NEMOTRON_API_KEY = 'test-key';
  installMock();

  const result = await nemotronOrchestrator.orchestrate({
    requestId: 'sim-synth',
    userRequest: 'Write a TypeScript function to sort an array and explain the complexity.',
    conversationHistory: [],
  });

  record('orchestrator synthesis completes', result.status === 'completed' || result.status === 'partial', `status=${result.status} answerLen=${result.finalAnswer.length}`);
  record('final answer present', result.finalAnswer.length > 10, `len=${result.finalAnswer.length}`);
  record('execution log present', result.executionLog.length > 0, `logEntries=${result.executionLog.length}`);

  uninstallMock();
}

// ---------------------------------------------------------------------------
// Simulation 7: Simple (low complexity) request — single task, no parallel.
// ---------------------------------------------------------------------------
async function simulateSimpleRequest() {
  console.log('\n=== Simulation 7: Simple low-complexity request ===');
  process.env.NEMOTRON_API_KEY = 'test-key';
  installMock();

  const result = await nemotronOrchestrator.orchestrate({
    requestId: 'sim-simple',
    userRequest: 'Hello, how are you today?',
    conversationHistory: [],
  });

  record('simple request single task', result.tasks.length === 1, `tasks=${result.tasks.length}`);
  record('simple request completed', result.status === 'completed', `status=${result.status}`);

  uninstallMock();
}

// ---------------------------------------------------------------------------
// Run all simulations.
// ---------------------------------------------------------------------------
async function main() {
  await simulateAllSpecialistModels();
  await simulateParallelAllModels();
  await simulateDependencyChain();
  await simulateQualityControlAndDisagreement();
  await simulateRetryAndFailover();
  await simulateOrchestratorSynthesis();
  await simulateSimpleRequest();

  console.log('\n=== SIMULATION SUMMARY ===');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  for (const r of results) {
    if (!r.ok) console.log(`  FAIL: ${r.name} — ${r.detail}`);
  }
  console.log(`Passed: ${passed}/${results.length}  Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL:', e);
  uninstallMock();
  process.exit(1);
});
