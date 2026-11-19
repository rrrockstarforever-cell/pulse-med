import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import express from 'express';
import { NEMOTRON_CONFIG } from '../../server/nemotron/config.ts';
import { createAnthropicRouter, runGatewayTurn } from '../../server/nemotron/anthropic.ts';
import { eventBus } from '../../server/nemotron/events.ts';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.NEMOTRON_API_KEY;
const nativeFetch = globalThis.fetch;
process.env.NEMOTRON_API_KEY = 'test-key';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.NEMOTRON_API_KEY;
  else process.env.NEMOTRON_API_KEY = originalApiKey;
});

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function messageText(body: any): string {
  return (body.messages || []).map((message: any) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
}

test('explicit three-pass requests keep delegating and pass prior results to fallback specialists', async () => {
  let superCalls = 0;
  let specialistCalls = 0;
  let forcedDelegations = 0;
  let priorResultsSeen = false;
  globalThis.fetch = (async (_input, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    if (body.model === NEMOTRON_CONFIG.orchestrator.modelId) {
      superCalls++;
      if (body.tool_choice?.function?.name === 'nemotron_delegate') forcedDelegations++;
      const content = superCalls === 4 ? 'Final synthesis after all passes.' : 'Super is considering a final response.';
      return jsonResponse({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }

    specialistCalls++;
    if (messageText(body).includes('Prior specialist results:')) priorResultsSeen = true;
    return jsonResponse({ choices: [{ message: { content: `specialist-result-${specialistCalls}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  }) as typeof fetch;

  const result = await runGatewayTurn({
    messages: [{ role: 'user', content: 'MUST complete three successive Nemotron delegation passes for this complex interdisciplinary research and code task: reconcile a CSV dataset, design an event architecture, and simulate it in Python.' }],
    max_tokens: 512,
  }, 'gateway-three-pass-test');

  assert.equal(result.delegations, 3);
  assert.equal(superCalls, 4);
  assert.equal(forcedDelegations, 3);
  assert.ok(specialistCalls >= 3);
  assert.equal(priorResultsSeen, true);
  assert.match(result.content.map((block) => block.text || '').join('\n'), /Final synthesis after all passes/);
  assert.equal(result.specialistFailures, 0);
});

test('ordinary requests retain one forced specialist pass', async () => {
  let superCalls = 0;
  globalThis.fetch = (async (_input, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    if (body.model === NEMOTRON_CONFIG.orchestrator.modelId) {
      superCalls++;
      return jsonResponse({ choices: [{ message: { content: 'A short comparison.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }
    return jsonResponse({ choices: [{ message: { content: 'Specialist note.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  }) as typeof fetch;

  const result = await runGatewayTurn({
    messages: [{ role: 'user', content: 'Compare two sorting algorithms and explain their data-structure tradeoffs.' }],
    max_tokens: 256,
  }, 'gateway-one-pass-test');

  assert.equal(result.delegations, 1);
  assert.equal(superCalls, 2);
});

test('specialist failures produce a partial HTTP completion and an explicit response warning', async () => {
  let superCalls = 0;
  globalThis.fetch = (async (_input, init = {}) => {
    const body = JSON.parse(String(init.body || '{}'));
    if (body.model === NEMOTRON_CONFIG.orchestrator.modelId) {
      superCalls++;
      if (superCalls === 1) {
        return jsonResponse({ choices: [{ message: { tool_calls: [{
          id: 'delegate-test',
          type: 'function',
          function: {
            name: 'nemotron_delegate',
            arguments: JSON.stringify({ tasks: [
              { objective: 'Summarize the stock table.', specialist: 'lightning', context: 'CSV: SKU A has 4 units.' },
              { objective: 'Cross-check the inventory rule.', specialist: 'nano', context: 'CSV: SKU A has 4 units.' },
            ] }),
          },
        }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
      return jsonResponse({ choices: [{ message: { content: 'The available specialist findings are synthesized.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }

    if (messageText(body).includes('high-throughput')) {
      return jsonResponse({ error: { message: 'specialist unavailable' } }, 500);
    }
    return jsonResponse({ choices: [{ message: { content: 'Inventory rule cross-check completed.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
  }) as typeof fetch;

  const app = express();
  app.use('/v1', createAnthropicRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const priorEventIds = new Set(eventBus.recent(1000).map((event) => event.eventId));

  try {
    const response = await nativeFetch(`http://127.0.0.1:${address.port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'nemotron-orchestrator',
        messages: [{ role: 'user', content: 'Analyze this CSV dataset and explain the inventory event architecture.' }],
      }),
    });
    const body = await response.json();
    const text = (body.content || []).map((block: any) => block.text || '').join('\n');
    const completed = eventBus.recent(1000).filter((event) => !priorEventIds.has(event.eventId) && event.type === 'execution_completed').pop();

    assert.equal(response.status, 200);
    assert.match(text, /1 of 2 specialist tasks failed/i);
    assert.equal(completed?.status, 'partial');
    assert.equal(completed?.metrics?.failedTasks, 1);
    assert.equal(completed?.metrics?.totalTasks, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
