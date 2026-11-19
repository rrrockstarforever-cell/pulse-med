// Proves a Claude Desktop turn still calls specialist models when Super does not.
import { runGatewayTurn } from '../../server/nemotron/anthropic.ts';

const realFetch = globalThis.fetch;
const called: string[] = [];

(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const body = typeof init.body === 'string' ? JSON.parse(init.body || '{}') : {};
  const model = String(body.model || '');
  called.push(model);
  const isSuper = /super/i.test(model);
  const forced = body.tool_choice?.function?.name === 'nemotron_delegate';
  // Super ignores the delegate tool, which is the bug we are guarding against.
  const content = isSuper
    ? (forced || called.filter((m) => /super/i.test(m)).length === 1
      ? 'I will answer this myself.'
      : 'Final answer after specialists.')
    : `specialist ${model} done`;
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
};

process.env.NEMOTRON_API_KEY = 'test-key';

const result = await runGatewayTurn({
  messages: [{ role: 'user', content: 'Compare quicksort and mergesort and write a short Python example of each. Also note the data-structure tradeoff.' }],
  max_tokens: 256,
}, 'gw-test-delegate');

const specialists = called.filter((m) => !/super/i.test(m));
console.log('models called:', called.join('\n'));
console.log('delegations:', result.delegations);
console.log('specialist calls:', specialists.length);
const distinct = [...new Set(specialists)];
console.log('distinct specialists:', distinct.join(', ') || '(none)');
(globalThis as any).fetch = realFetch;

if (result.delegations < 1 || distinct.length < 2) {
  console.error('FAIL: Super turn did not call multiple specialist models');
  process.exit(1);
}
console.log('PASS');
