import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectMisses,
  describeMiss,
  applyConcepts,
  applyLayout,
} from '../../src/lib/studyPlan.ts';

// Minimal, non-clinical record fixture. Explanation is > 700 chars so the
// collectMisses truncation contract is exercised.
const record = {
  id: 'Q1',
  subject: 'S',
  subtopic: 'T',
  stem: '',
  questionText: 'q?',
  options: [
    { id: 'A', text: 'a' },
    { id: 'B', text: 'b' },
  ],
  correctOption: 'B',
  boardPearl: 'pearl',
  keyFact: 'fact',
  explanation: 'long explanation '.repeat(60),
  citations: ['src1', 'src2'],
  // ClinicalQuestion.optionReasons is an object keyed by letter.
  optionReasons: { A: 'why A wrong', B: 'why B right' },
};

// Hedge common input shapes for black-box invocation:
// - answers as Map-like and plain-object-like
// - flags as array-like, Set-like, and object-like
function answersInput() {
  const answers = new Map([['Q1', 'B']]);
  answers.Q1 = 'B';
  return answers;
}

function flagsInput() {
  const flags = ['Q1'];
  flags.Q1 = true;
  flags.has = (id) => flags.includes(id);
  return flags;
}

function buildMiss() {
  const misses = collectMisses([record], answersInput(), flagsInput(), []);
  assert.ok(Array.isArray(misses), 'collectMisses must return an array');
  const miss = misses.find((m) => m && m.id === 'Q1');
  assert.ok(miss, 'expected a collected miss for Q1');
  return miss;
}

test('collectMisses preserves letters, citations, pearl, optionReasons, and truncates long explanation', () => {
  const miss = buildMiss();

  assert.equal(miss.chosenLetter, 'B');
  assert.equal(miss.correctLetter, 'B');
  assert.equal(miss.boardPearl, 'pearl');
  assert.deepEqual(miss.citations, ['src1', 'src2']);

  const reasons = miss.optionReasons || [];
  assert.ok(Array.isArray(reasons), 'optionReasons must be converted to an array');
  assert.equal(
    reasons.find((r) => r && r.letter === 'A')?.reason,
    'why A wrong',
  );
  assert.equal(
    reasons.find((r) => r && r.letter === 'B')?.reason,
    'why B right',
  );

  assert.equal(miss.truncated?.explanation, true);
  assert.equal(typeof miss.explanation, 'string');
  assert.ok(
    miss.explanation.length <= 700,
    `explanation must be capped at 700 chars, got ${miss.explanation.length}`,
  );
});

test('describeMiss includes required sections and stays within 4000 chars', () => {
  const text = describeMiss(buildMiss());

  for (const needle of [
    'Question:',
    'Student chose (B):',
    'Correct (B):',
    'Option reasoning:',
    'A) because',
    'Citations:',
    'Key fact:',
  ]) {
    assert.ok(text.includes(needle), `expected describeMiss output to include ${JSON.stringify(needle)}`);
  }

  assert.ok(text.length <= 4000, `describeMiss must cap at 4000 chars, got ${text.length}`);
});

test('describeMiss prints Board pearl once and includes Explanation when present', () => {
  const text = describeMiss(buildMiss());

  const pearlCount = (text.match(/Board pearl:/g) || []).length;
  assert.equal(pearlCount, 1, 'Board pearl: must appear exactly once');
  assert.ok(text.includes('Explanation:'), 'expected Explanation: section');
});

test('applyConcepts validates title before consuming ids (blank-title recovery)', () => {
  const entries = [
    { title: '', misses: [1] },
    { title: 'Good', misses: [2] },
  ];

  const group = [
    { n: 1 },
    { n: 2 },
  ];

  const concepts = applyConcepts({ concepts: entries }, group);

  assert.ok(Array.isArray(concepts), 'applyConcepts must return an array');
  assert.equal(concepts.length, 1, 'blank-title concept must be discarded');

  const [accepted] = concepts;
  assert.equal(accepted.title, 'Good');
  assert.deepEqual(accepted.misses, [2]);

  // Blank-title ids must not be consumed; the union is a subset not containing
  // both {1,2}, and the caller-visible leftover is [1].
  const usedIds = concepts.flatMap((c) => c.misses || []);
  assert.deepEqual(usedIds, [2]);
  assert.ok(!(usedIds.includes(1) && usedIds.includes(2)));

  const leftover = [1, 2].filter((id) => !usedIds.includes(id));
  assert.deepEqual(leftover, [1]);
});

test('applyConcepts deduplicates within-entry ids and ignores fractional ids', () => {
  const entries = [{ title: 'Dedupe', misses: [2, 2, 2.5, '3', '2'] }];
  const group = [{ n: 1 }, { n: 2 }, { n: 3 }];

  const concepts = applyConcepts({ concepts: entries }, group);

  assert.equal(concepts.length, 1);
  assert.deepEqual(concepts[0].misses, [2, 3]);
});

test('applyLayout discards a blank-title chunk (recovery)', () => {
  const planned = {
    chunks: [
      { title: '', concepts: [1] },
      { title: 'Good', concepts: [2, 2, 2.5] },
    ],
  };

  const layout = applyLayout(planned, 2);

  assert.ok(Array.isArray(layout), 'applyLayout must return an array');
  assert.equal(layout.length, 1, 'blank-title chunk must be discarded');
  assert.equal(layout[0].title, 'Good');
  assert.deepEqual(
    layout[0].concepts,
    [2],
    'valid chunk keeps deduplicated, integer concept indices',
  );
});

test('applyConcepts returns [] for an empty group', () => {
  const concepts = applyConcepts({ concepts: [] }, []);
  assert.ok(Array.isArray(concepts));
  assert.equal(concepts.length, 0);
});
