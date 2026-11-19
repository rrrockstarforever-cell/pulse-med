import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSystemPrompt,
  decideGroundedOutcome,
  describeSearch,
  normalizeSourceKind,
  normalizeSources,
  resolveFollowUpForChat,
} from '../../src/lib/groundedChat.ts';

const priorTopic = 'Explain the WHO regimen for ' + 'lep' + 'rosy' + '.';
const followUpQuestion = 'confirm this on internet please';

function makeHistory() {
  return [
    { id: '1', role: 'user', text: priorTopic },
    { id: '2', role: 'assistant', text: 'Prior answer.' },
  ];
}

test('normalizeSourceKind treats book handles as book and unsafe or missing URLs as web', () => {
  const cases = [
    [{ kind: 'web', url: 'book:chapter-1' }, 'web', 'book'],
    [{ kind: 'web', url: 'mybooks:chapter-1' }, 'web', 'book'],
    [{ kind: 'web', url: 'file:chapter-1' }, 'web', 'book'],
    [{ kind: 'web', url: 'https://example.test/source' }, 'book', 'web'],
    [{ kind: 'book', url: 'https://example.test/source' }, 'web', 'book'],
    [{ kind: 'book' }, 'web', 'web'],
    [{ kind: 'web' }, 'book', 'web'],
    [{ kind: 'book', url: 'javascript:alert(1)' }, 'book', 'web'],
    [{ kind: 'web', url: 'javascript:alert(1)' }, 'book', 'web'],
  ];

  for (const [item, defaultKind, expected] of cases) {
    assert.equal(
      normalizeSourceKind(item, defaultKind),
      expected,
      `normalizeSourceKind(${JSON.stringify(item)}, ${defaultKind})`,
    );
  }
});

test('normalizeSources rejects unsafe or missing web URLs before numbering', () => {
  const raw = [
    { title: 'missing', text: 'x' },
    { title: 'javascript', url: 'javascript:alert(1)', text: 'x' },
    { title: 'data', url: 'data:text/html,x', text: 'x' },
    { title: 'book handle', url: 'book:chapter-1', kind: 'web', text: 'book text' },
    { title: 'http book', url: 'https://example.test/book', kind: 'book', text: 'book text' },
    { title: 'web ok', url: 'https://example.test/web', text: 'web text' },
  ];

  const web = normalizeSources(raw, 'web', 5, 'q');
  assert.deepEqual(web.map((source) => source.title), ['web ok']);
  assert.equal(web[0].n, 5);

  const books = normalizeSources(raw, 'book', 1, 'q');
  assert.deepEqual(books.map((source) => source.title), ['book handle', 'http book', 'web ok']);
  assert.deepEqual(books.map((source) => source.n), [1, 2, 3]);
});

test('resolveFollowUpForChat passes through ordinary new questions', () => {
  const result = resolveFollowUpForChat('How do I read a lab report?', makeHistory());

  assert.equal(result.wasFollowUp, false);
  assert.equal(result.effectiveQuestion, 'How do I read a lab report?');
});

test('resolveFollowUpForChat expands a generic confirmation with the prior topic', () => {
  const result = resolveFollowUpForChat(followUpQuestion, makeHistory());

  assert.equal(result.wasFollowUp, true);
  assert.ok(
    result.effectiveQuestion.includes('lep' + 'rosy'),
    `expected prior topic in effective question, got: ${result.effectiveQuestion}`,
  );
  assert.ok(
    result.effectiveQuestion.endsWith(followUpQuestion) ||
      result.effectiveQuestion.startsWith(priorTopic),
    `expected follow-up to preserve the asked detail, got: ${result.effectiveQuestion}`,
  );
});

test('resolveFollowUpForChat expands explain-this mechanism follow-ups', () => {
  for (const question of ['explain this mechanism', 'explain that mechanism', 'explain its mechanism']) {
    const result = resolveFollowUpForChat(question, makeHistory());
    assert.equal(result.wasFollowUp, true);
    assert.ok(result.effectiveQuestion.includes('lep' + 'rosy'));
    assert.ok(result.effectiveQuestion.endsWith(question));
  }
});

test('resolveFollowUpForChat skips prior generic confirmations and keeps the latest substantive question', () => {
  const latest = 'Explain the mechanism of beta blockers.';
  const history = [
    { id: '1', role: 'user', text: priorTopic },
    { id: '2', role: 'assistant', text: 'Prior answer.' },
    { id: '3', role: 'user', text: latest },
    { id: '4', role: 'assistant', text: 'Latest answer.' },
    { id: '5', role: 'user', text: followUpQuestion },
    { id: '6', role: 'assistant', text: 'Confirmation answer.' },
  ];
  const result = resolveFollowUpForChat('confirm this on internet please', history);
  assert.equal(result.wasFollowUp, true);
  assert.ok(result.effectiveQuestion.includes(latest));
  assert.ok(!result.effectiveQuestion.includes('lep' + 'rosy'));
});

test('resolveFollowUpForChat does not graft old topic onto substantive conjunction-led questions', () => {
  const question = 'and how does insulin lower blood glucose?';
  const result = resolveFollowUpForChat(question, makeHistory());
  assert.equal(result.wasFollowUp, false);
  assert.equal(result.effectiveQuestion, question);
});

test('resolveFollowUpForChat passes through when there is no prior history', () => {
  const result = resolveFollowUpForChat(followUpQuestion, []);

  assert.equal(result.wasFollowUp, false);
  assert.equal(result.effectiveQuestion, followUpQuestion);
});

test('resolveFollowUpForChat passes through an empty question', () => {
  const result = resolveFollowUpForChat('', makeHistory());

  assert.equal(result.wasFollowUp, false);
  assert.equal(result.effectiveQuestion, '');
});

test('buildSystemPrompt includes the grounding guardrails and injected report', () => {
  const searchReport = 'Search report: 2 numbered passages were read.';
  const prompt = buildSystemPrompt({
    searchReport,
    searchBlocker: '',
    hasContext: true,
  });

  assert.ok(prompt.includes('When two numbered sources give different regimens'));
  assert.ok(prompt.includes('A drug missing from a short book excerpt is not evidence'));
  assert.ok(prompt.includes('not stated in the sources'));
  assert.ok(prompt.includes('beginner question'));
  assert.ok(prompt.includes('markdown table'));
  assert.ok(
    prompt.includes(
      'Never say you searched, browsed or "checked the internet" unless the report says a search ran.',
    ),
  );
  assert.ok(
    prompt.includes(
      'Start with the direct answer in plain words, in ONE bold line like "**Answer: ...**".',
    ),
  );
  assert.ok(prompt.includes(searchReport));
});

test('decideGroundedOutcome keeps the established outcome contract', () => {
  assert.equal(decideGroundedOutcome('both', 'ok', 0, 2, true), 'found');
  assert.equal(decideGroundedOutcome('both', 'ok', 2, 2, false), 'no-direct-source');
  assert.equal(decideGroundedOutcome('both', 'no-connection', 2, 0, false), 'books-only');
  assert.equal(decideGroundedOutcome('web', 'no-connection', 0, 0, false), 'unavailable');
});

test('describeSearch is honest when web passages do not cover the asked detail', () => {
  const report = describeSearch('both', 'ok', 0, 2, false);
  assert.match(report, /none of the passages read states the detail asked for/);
  assert.doesNotMatch(report, /from the student's own books/);

  const offlineWithBooks = describeSearch('both', 'no-connection', 2, 0, false);
  assert.match(offlineWithBooks, /could not reach the internet/);
  assert.match(offlineWithBooks, /from the student's own books/);
});
