// End-to-end smoke test for Nemotron orchestration with mocked NVIDIA API.

import { nemotronOrchestrator } from '../../server/nemotron/orchestrator.ts';

const realFetch = globalThis.fetch;
const callLog: string[] = [];

function installMock() {
  const fetchFn = async (input: any, init: any = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body || '{}') : {};
    callLog.push(String(body.model || ''));
    const modelId = String(body.model || '');
    let content = 'specialist result';
    if (/ultra/i.test(modelId)) content = 'Ultra independent assessment: resolved.';
    if (/super/i.test(modelId)) content = '{"final_answer": "synthesized answer"}';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  (globalThis as any).fetch = fetchFn;
}
function uninstallMock() { (globalThis as any).fetch = realFetch; }

async function main() {
  process.env.NEMOTRON_API_KEY = 'test-key';
  installMock();

  const complexRequest = `I need to build a web scraper in Python that:
1. Fetches product data from multiple e-commerce sites concurrently
2. Parses HTML and extracts price, title, and availability
3. Handles rate limiting and retries with exponential backoff
4. Saves results to a SQLite database
5. Generates a summary report

Also analyze the performance implications of async vs threading for this task, and explain the key tradeoffs. Provide complete working code plus a short architectural explanation.`;

  const result = await nemotronOrchestrator.orchestrate({
    requestId: 'e2e-smoke-1',
    userRequest: complexRequest,
    conversationHistory: [],
  });

  console.log('=== ORCHESTRATION RESULT ===');
  console.log('Request ID:', result.requestId);
  console.log('Category:', result.category);
  console.log('Complexity:', result.complexity);
  console.log('Status:', result.status);
  console.log('Duration ms:', result.durationMs);
  console.log('Routing rationale:', result.routingDecision.rationale);
  console.log('Needs parallel:', result.routingDecision.needsParallel);
  console.log('Needs ultra:', result.routingDecision.needsUltra);
  console.log('');
  console.log('=== TASKS (' + result.tasks.length + ') ===');
  for (const t of result.tasks) {
    console.log(`- ${t.id} [${t.preferredModel.role}] deps=[${t.dependencies.join(',') || 'none'}] ${t.objective.slice(0, 60)}`);
  }
  console.log('');
  console.log('=== TASK RESULTS ===');
  for (const r of result.taskResults) {
    console.log(`- ${r.taskId} [${r.modelRole}] ${r.status} in ${r.durationMs}ms retries=${r.retries} ${r.error ? 'ERR: ' + r.error : ''}`);
  }
  console.log('');
  console.log('=== QUALITY CONTROL ===');
  console.log(result.qualityControl.finalAssessment);
  console.log('Disagreements:', result.qualityControl.disagreements.length);
  console.log('');
  console.log('=== FINAL ANSWER ===');
  console.log(result.finalAnswer.slice(0, 800));
  console.log('');
  console.log('=== EXECUTION LOG (tail) ===');
  for (const e of result.executionLog.slice(-8)) {
    console.log(`[${e.event}] ${e.message}`);
  }
  console.log('');
  console.log('=== MODELS CALLED ===');
  for (const c of callLog) console.log(c);

  uninstallMock();

  let ok = true;
  if (result.status !== 'completed' && result.status !== 'partial') { console.error('FAIL: unexpected status'); ok = false; }
  if (result.taskResults.length === 0) { console.error('FAIL: no task results'); ok = false; }
  if (!result.finalAnswer || result.finalAnswer.length < 10) { console.error('FAIL: no final answer'); ok = false; }
  const nonNemotron = callLog.filter((c) => !c.includes('nemotron'));
  if (nonNemotron.length) { console.error('FAIL: non-Nemotron model called:', nonNemotron); ok = false; }

  console.log(ok ? '=== E2E SMOKE TEST PASSED ===' : '=== E2E SMOKE TEST FAILED ===');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); uninstallMock(); process.exit(1); });
