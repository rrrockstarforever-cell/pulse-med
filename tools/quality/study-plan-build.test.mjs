import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: () => null,
  length: 0,
};

const sp = await import('../../src/lib/studyPlan.ts');

const validWrite = {
  intro: 'Intro',
  connects: '',
  sections: [{ heading: 'Heading', points: ['Point'] }],
  traps: ['Trap'],
  recall: ['Question? - Answer'],
};

let writeResponse = validWrite;
let researchCalls = [];
let writerPrompt = '';

function makeMiss(n, overrides = {}) {
  return {
    n,
    id: `Q${n}`,
    reason: 'wrong',
    subject: 'S',
    topic: `T${n}`,
    text: `Question ${n}`,
    chosen: 'A',
    correct: 'B',
    chosenLetter: 'A',
    correctLetter: 'B',
    citations: [],
    boardPearl: '',
    fact: `Fact ${n}`,
    explanation: '',
    ...overrides,
  };
}

function jsonResponse(text) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ text }),
  };
}

function parseMissNumbers(content) {
  return [...new Set([...String(content).matchAll(/#(\d+)/g)].map((m) => Number(m[1])))];
}

function installFetch(response = validWrite) {
  writeResponse = response;
  writerPrompt = '';
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body ?? '{}'));
    const system = String(body.system ?? '');
    const user = String(body.messages?.[0]?.content ?? '');
    if (system.includes('Find the CONCEPTS')) {
      return jsonResponse(JSON.stringify({
        concepts: [{ title: 'Concept', gap: 'Gap', misses: parseMissNumbers(user) }],
      }));
    }
    if (system.includes('You plan a study note')) {
      const nums = [...String(user).matchAll(/^(\d+)\./gm)].map((m) => Number(m[1]));
      return jsonResponse(JSON.stringify({
        overview: 'Overview',
        chunks: [{ title: 'Chunk', why: 'Why', concepts: nums, connects: '' }],
      }));
    }
    if (system.includes('You write one chunk')) {
      writerPrompt = user;
      return jsonResponse(JSON.stringify(writeResponse));
    }
    throw new Error('unexpected AI call');
  };
}

beforeEach(() => {
  store.clear();
  researchCalls = [];
  installFetch(validWrite);
});

test('buildStudyPlan stores and prompts with the same bounded source excerpt', async () => {
  const long = 'x'.repeat(6500);
  const plan = await sp.buildStudyPlan({
    bankId: 'B1',
    misses: [makeMiss(1)],
    provider: 'deepseek',
    model: 'test',
    sourceMode: 'web',
    research: async (q) => {
      researchCalls.push(q);
      return {
        sources: [{ n: 0, title: 'Web', url: 'https://example.test/x', text: long, kind: 'web' }],
        search: 'found',
        coversQuestion: true,
        retrievedAt: '2024-01-01T00:00:00Z',
      };
    },
  });

  const chunk = plan.chunks[0];
  assert.equal(chunk.sources[0].text.length, 6000);
  assert.equal(chunk.sources[0].truncated, true);
  assert.ok(writerPrompt.includes(chunk.sources[0].text));
  assert.ok(writerPrompt.includes('(truncated)'));
  assert.equal(plan.retrievedAt, '2024-01-01T00:00:00Z');
});

test('buildStudyPlan marks web found without coversQuestion as no-direct-source and does not invent retrievedAt', async () => {
  const plan = await sp.buildStudyPlan({
    bankId: 'B2',
    misses: [makeMiss(1)],
    provider: 'deepseek',
    model: 'test',
    sourceMode: 'web',
    research: async () => ({
      sources: [{ n: 0, title: 'Web', url: 'https://example.test/x', text: 'Page text', kind: 'web' }],
      search: 'found',
      coversQuestion: false,
    }),
  });

  assert.equal(plan.evidence.status, 'no-direct-source');
  assert.match(plan.chunks[0].evidenceNote, /do not directly/);
  assert.equal(plan.retrievedAt, undefined);
});

test('books-only plan keeps books-only status and reports web failure', async () => {
  const plan = await sp.buildStudyPlan({
    bankId: 'B3',
    misses: [makeMiss(1)],
    provider: 'deepseek',
    model: 'test',
    sourceMode: 'both',
    research: async () => ({
      sources: [{ n: 0, title: 'Book', url: '', text: 'Book text', kind: 'book' }],
      search: 'unavailable',
    }),
  });

  assert.equal(plan.evidence.status, 'books-only');
  assert.match(plan.chunks[0].evidenceNote, /Web unavailable/);
  assert.equal(plan.chunks[0].sources[0].kind, 'book');
});

test('buildStudyPlan uses bounded distinct-topic research queries', async () => {
  const misses = [1, 2, 3, 4].map((n) => makeMiss(n, { topic: `Topic ${n}` }));
  const plan = await sp.buildStudyPlan({
    bankId: 'B4',
    misses,
    provider: 'deepseek',
    model: 'test',
    sourceMode: 'both',
    research: async (q) => {
      researchCalls.push(q);
      return { sources: [], search: 'empty' };
    },
  });

  assert.equal(researchCalls.length, 3);
  assert.equal(new Set(researchCalls.map((q) => q.topic)).size, 3);
  assert.ok(researchCalls.every((q) => q.question.length > 0));
  assert.equal(plan.chunks.length, 1);
});

test('coveredQuestions keeps all questions and includes number and text', async () => {
  const misses = Array.from({ length: 65 }, (_, i) => makeMiss(i + 1, { topic: `Topic ${i + 1}` }));
  const plan = await sp.buildStudyPlan({
    bankId: 'B5',
    misses,
    provider: 'deepseek',
    model: 'test',
    sourceMode: 'books',
  });

  const covered = plan.chunks.flatMap((c) => c.coveredQuestions ?? []);
  assert.equal(covered.length, 65);
  assert.ok(covered.every((q) => typeof q.questionNumber === 'number'));
  assert.ok(covered.every((q) => typeof q.questionText === 'string'));
});

test('empty writer sections fall back to question facts with fallback true', async () => {
  installFetch({
    intro: 'Intro',
    connects: '',
    sections: [{ heading: '', points: [''] }],
    traps: [],
    recall: [],
  });

  const plan = await sp.buildStudyPlan({
    bankId: 'B6',
    misses: [makeMiss(7, { fact: 'Real fact' })],
    provider: 'deepseek',
    model: 'test',
  });

  const chunk = plan.chunks[0];
  assert.equal(chunk.fallback, true);
  assert.equal(chunk.sections[0].heading, 'Facts from your questions');
  assert.ok(chunk.sections[0].points.includes('Real fact'));
});

test('describeMiss keeps citations inside the 4000-char cap', () => {
  const text = sp.describeMiss(makeMiss(1, {
    explanation: 'e'.repeat(5000),
    citations: ['CITATION-ONE', 'CITATION-TWO'],
    truncated: { explanation: true, citations: false },
  }));
  assert.ok(text.length <= 4000);
  assert.ok(text.includes('Citations: CITATION-ONE; CITATION-TWO'));
});

test('loadStudyPlan preserves an existing empty evidenceNote and fills only missing legacy fields', () => {
  const base = {
    bankId: 'B7',
    at: '2024-01-01T00:00:00Z',
    wrong: 0,
    flagged: 0,
    overview: '',
    sourceMode: 'books',
    chunks: [{
      title: 'T',
      why: '',
      connects: '',
      intro: '',
      sections: [],
      traps: [],
      recall: [],
      questionIds: [],
      sourceMode: 'books',
      sources: [],
      coveredQuestions: [],
      evidenceNote: '',
    }],
  };

  localStorage.setItem('pulse.studyplan.v1.B7', JSON.stringify(base));
  const loaded = sp.loadStudyPlan('B7');
  assert.equal(loaded.chunks[0].evidenceNote, '');

  const legacy = JSON.parse(JSON.stringify(base));
  delete legacy.chunks[0].evidenceNote;
  delete legacy.chunks[0].chunkId;
  localStorage.setItem('pulse.studyplan.v1.B7', JSON.stringify(legacy));
  const loadedLegacy = sp.loadStudyPlan('B7');
  assert.equal(loadedLegacy.chunks[0].evidenceNote, 'No source search was run for this part.');
  assert.ok(loadedLegacy.chunks[0].chunkId);
});
