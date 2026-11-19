import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: () => null,
  length: 0,
};

let sp;

before(async () => {
  sp = await import('../../src/lib/studyPlan.ts');
});

beforeEach(() => {
  store.clear();
});

function makeChunk(overrides = {}) {
  return {
    title: 'Basics',
    intro: 'alpha beta gamma',
    sections: [{ heading: 'H', points: ['p q'] }],
    traps: ['trap one'],
    recall: ['Q? - A'],
    questionIds: ['QX1', 'QX2'],
    ...overrides,
  };
}

function words(n) {
  return Array.from({ length: n }, (_, i) => `w${i + 1}`).join(' ');
}

function findObjectWithKey(value, key) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value;
  for (const child of Object.values(value)) {
    const found = findObjectWithKey(child, key);
    if (found) return found;
  }
  return null;
}

function locateDoneMap(returned, key) {
  if (returned && typeof returned === 'object') return returned;
  for (const raw of store.values()) {
    try {
      const parsed = JSON.parse(raw);
      const found = findObjectWithKey(parsed, key);
      if (found) return found;
    } catch {
      // Not JSON; ignore.
    }
  }
  return null;
}

test('chunkMinutes clamps to at least 2 and does not inflate on whitespace', () => {
  const fiveWordsOneRecall = makeChunk({
    title: '',
    intro: 'one two three four five',
    sections: [],
    traps: [],
    recall: ['Q? - A'],
    questionIds: [],
  });
  assert.ok(sp.chunkMinutes(fiveWordsOneRecall) >= 2);

  const fiveHundredWords = makeChunk({
    title: '',
    intro: words(500),
    sections: [],
    traps: [],
    recall: [],
    questionIds: [],
  });
  assert.ok(sp.chunkMinutes(fiveHundredWords) >= 3);

  const normal = makeChunk({
    title: '',
    intro: 'one two three four five',
    sections: [{ heading: 'H', points: ['p q'] }],
    traps: ['t1 t2'],
    recall: ['Q? - A'],
  });
  const messy = makeChunk({
    title: '',
    intro: '  one   two\nthree\tfour five  ',
    sections: [{ heading: ' H ', points: [' p   q '] }],
    traps: [' t1   t2 '],
    recall: ['Q?   -   A'],
  });
  assert.equal(sp.chunkMinutes(messy), sp.chunkMinutes(normal));
});

test('chunkMinutes has floor 2 and 340/341 word boundaries', () => {
  const chunk340 = makeChunk({
    title: '',
    intro: words(340),
    sections: [],
    traps: [],
    recall: [],
    questionIds: [],
  });
  const chunk341 = makeChunk({
    title: '',
    intro: words(341),
    sections: [],
    traps: [],
    recall: [],
    questionIds: [],
  });
  assert.equal(sp.chunkMinutes(chunk340), 2);
  assert.equal(sp.chunkMinutes(chunk341), 3);
});

test('chunkFingerprint is deterministic, title-sensitive, and order-insensitive for questionIds', () => {
  const base = makeChunk();
  assert.equal(sp.chunkFingerprint(base), sp.chunkFingerprint(makeChunk()));

  const reorderedIds = makeChunk({ questionIds: ['QX2', 'QX1'] });
  assert.equal(sp.chunkFingerprint(base), sp.chunkFingerprint(reorderedIds));

  const changedTitle = makeChunk({ title: 'Advanced' });
  assert.notEqual(sp.chunkFingerprint(base), sp.chunkFingerprint(changedTitle));
});

test('chunkFingerprint includes full intro, section point text, traps, and recall text', () => {
  const base = makeChunk();
  const changedIntroAndPoint = makeChunk({
    intro: 'alpha beta gamma delta',
    sections: [{ heading: 'H', points: ['p q changed'] }],
  });
  assert.notEqual(sp.chunkFingerprint(base), sp.chunkFingerprint(changedIntroAndPoint));

  const changedTrap = makeChunk({ traps: ['trap two'] });
  assert.notEqual(sp.chunkFingerprint(base), sp.chunkFingerprint(changedTrap));

  const changedRecall = makeChunk({ recall: ['Q? - B'] });
  assert.notEqual(sp.chunkFingerprint(base), sp.chunkFingerprint(changedRecall));
});

test('splitRecall handles four branches', () => {
  assert.deepEqual(sp.splitRecall('X? - Y'), { question: 'X?', answer: 'Y' });
  assert.deepEqual(sp.splitRecall('a-b - c'), { question: 'a-b', answer: 'c' });
  assert.deepEqual(sp.splitRecall('no dash'), { question: 'no dash', answer: '' });
  assert.deepEqual(sp.splitRecall(' - answer only'), { question: '- answer only', answer: '' });
});

test('setPlanPartDone/isPartDone key verbatim and a changed chunk is not done', () => {
  const bankId = 'TEST-BANK-1';
  const chunkA = makeChunk({ intro: 'alpha beta gamma' });
  const chunkB = makeChunk({ intro: 'alpha beta gamma delta' });
  const keyA = sp.chunkFingerprint(chunkA);
  const keyB = sp.chunkFingerprint(chunkB);
  assert.notEqual(keyA, keyB);

  const returned = sp.setPlanPartDone(bankId, keyA, true);
  const doneMap = locateDoneMap(returned, keyA);
  assert.ok(doneMap, 'expected a done map after marking a part done');
  assert.equal(sp.isPartDone(doneMap, keyA), true);
  assert.equal(sp.isPartDone(doneMap, keyB), false);

  const verbatim = { 'some old title key': true };
  assert.equal(sp.isPartDone(verbatim, 'some old title key'), true);
  assert.equal(sp.isPartDone(verbatim, 'some old title key '), false);
});

test('legacy arbitrary-key record does not mark a fresh fingerprint done', () => {
  const freshChunk = makeChunk({ intro: 'fresh intro with changed wording' });
  const freshKey = sp.chunkFingerprint(freshChunk);
  const legacyRecord = { 'some old title key': true };
  assert.equal(sp.isPartDone(legacyRecord, freshKey), false);
});
