// Live check: does the orchestrator actually call every Nemotron model?
// Uses the real NVIDIA API. Prints one line per model. Does not print the API key.

import 'dotenv/config';
import { NEMOTRON_CONFIG } from '../../server/nemotron/config.ts';
import { ParallelExecutionEngine, SubTask } from '../../server/nemotron/parallel.ts';
import { nemotronOrchestrator } from '../../server/nemotron/orchestrator.ts';

const models = [
  ['orchestrator', NEMOTRON_CONFIG.orchestrator],
  ...Object.entries(NEMOTRON_CONFIG.specialists),
] as const;

function taskFor(id: string, model: (typeof models)[number][1]): SubTask {
  return {
    id,
    objective: 'Reply with the single word OK and your role name.',
    requiredExpertise: model.role,
    preferredModel: { ...model, timeoutMs: Math.min(model.timeoutMs, 45_000), maxOutputTokens: 64 },
    fallbackModels: [],
    inputContext: 'Reply with the single word OK and your role name. Do not explain.',
    expectedOutput: 'OK plus the role name.',
    completionCriteria: ['Contains OK'],
    dependencies: [],
    roleSpecificInstructions: 'Answer in one short line.',
  };
}

async function pingEachModel() {
  console.log('\n=== Each model, called the way the orchestrator calls specialists ===');
  const engine = new ParallelExecutionEngine();
  const tasks = models.map(([key, model]) => taskFor(key, model));
  const results = await engine.execute(tasks, { concurrency: 2, timeoutMs: 45_000, maxRetries: 0 });
  for (const [key, model] of models) {
    const r = results.find((x) => x.taskId === key);
    const preview = (r?.response || r?.error || '').replace(/\s+/g, ' ').slice(0, 120);
    const used = r?.modelId === model.modelId;
    console.log(
      `${r?.status === 'completed' && used ? 'PASS' : 'FAIL'}  ${key.padEnd(12)} enabled=${model.enabled}  asked=${model.modelId}  got=${r?.modelId || '-'}  ${r?.status}  ${r?.durationMs ?? 0}ms  ${preview}`,
    );
  }
  return results;
}

async function complexOrchestration() {
  console.log('\n=== Complex request through the full 8-phase orchestrator ===');
  const request = [
    'This is a complex interdisciplinary task. Do all of the following, as separate pieces of work:',
    '1. Write a small Python function that retries an HTTP call with exponential backoff.',
    '2. Transform this data row into a one-line summary: sku=A12, price=19.5, stock=0, region=EU.',
    '3. Describe what a rising line on a sales chart usually means.',
    '4. Solve this extremely difficult advanced mathematics problem step by step: find the derivative of x^2 * sin(x).',
  ].join('\n');

  const result = await nemotronOrchestrator.orchestrate({
    requestId: 'live-all-models',
    userRequest: request,
    conversationHistory: [],
  });

  console.log('status:', result.status, 'category:', result.category, 'complexity:', result.complexity, 'needsUltra:', result.routingDecision.needsUltra);
  console.log('tasks:');
  for (const t of result.tasks) {
    console.log(`  ${t.id}  role=${t.preferredModel.role}  model=${t.preferredModel.modelId}`);
  }
  console.log('results:');
  for (const r of result.taskResults) {
    console.log(`  ${r.taskId}  ${r.modelRole}  ${r.modelId}  ${r.status}  ${r.durationMs}ms  ${(r.error || r.response || '').replace(/\s+/g, ' ').slice(0, 100)}`);
  }
  const used = new Set(result.taskResults.filter((r) => r.status === 'completed').map((r) => r.modelId));
  console.log('distinct models that answered:', [...used].join(', ') || '(none)');
  const ultra = NEMOTRON_CONFIG.specialists.ultra;
  const ultraAssigned = result.tasks.some((t) => t.preferredModel.modelId === ultra.modelId);
  console.log('ultra assigned a task:', ultraAssigned, 'ultra enabled:', ultra.enabled);
  console.log('final answer:', (result.finalAnswer || '').replace(/\s+/g, ' ').slice(0, 400));
}

const results = await pingEachModel();
await complexOrchestration();
const failed = results.filter((r) => r.status !== 'completed');
console.log(`\nDirect model calls: ${results.length - failed.length}/${results.length} answered.`);
process.exit(failed.length ? 1 : 0);
