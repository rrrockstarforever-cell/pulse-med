import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { NEMOTRON_CONFIG } from '../../server/nemotron/config.ts';
import { runGatewayTurn } from '../../server/nemotron/anthropic.ts';

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
process.env.NEMOTRON_API_KEY = 'test-key';

after(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

test('retries temporary Super 503 responses', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: { message: 'temporarily unavailable' } }), {
        status: 503,
        headers: { 'retry-after': '0.001' },
      });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  };

  const result = await runGatewayTurn({ messages: [{ role: 'user', content: 'Hello' }] }, 'gateway-retry-test');

  assert.equal(attempts, 2);
  assert.equal(result.content[0].text, 'ok');
});

test('retries transient Super network failures', async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('fetch failed');
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok after reconnect' } }] }), { status: 200 });
  };

  const result = await runGatewayTurn({ messages: [{ role: 'user', content: 'Hello' }] }, 'gateway-network-retry-test');

  assert.equal(attempts, 2);
  assert.equal(result.content[0].text, 'ok after reconnect');
});

test('allows specialists their configured request timeout', async () => {
  let superCalls = 0;
  let nextTimeout = 0;
  const specialistTimeouts: number[] = [];
  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    if (timeout && timeout >= 25_000) nextTimeout = timeout;
    return originalSetTimeout(handler, timeout && timeout >= 25_000 ? 0 : timeout, ...args);
  }) as typeof setTimeout;
  globalThis.fetch = async (_input, init = {}) => {
    const body = JSON.parse(String(init.body));
    if (body.model === NEMOTRON_CONFIG.orchestrator.modelId) {
      superCalls += 1;
      const message = superCalls === 1
        ? { tool_calls: [{ id: 'delegate-1', type: 'function', function: { name: 'nemotron_delegate', arguments: JSON.stringify({ tasks: [{ objective: 'Summarize the rows', specialist: 'lightning', context: 'A sample table.' }] }) } }] }
        : { content: 'Summary complete' };
      return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
    }

    specialistTimeouts.push(nextTimeout);
    return new Promise((_resolve, reject) => {
      const abort = () => reject(new Error('This operation was aborted'));
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener('abort', abort, { once: true });
    });
  };

  await runGatewayTurn({
    messages: [{ role: 'user', content: 'Analyze this CSV dataset and summarize its rows.' }],
    max_tokens: 128,
  }, 'gateway-timeout-test');

  assert.deepEqual(specialistTimeouts, [NEMOTRON_CONFIG.specialists.lightning.timeoutMs, NEMOTRON_CONFIG.specialists.lightning.timeoutMs]);
});
