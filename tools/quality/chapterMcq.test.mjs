// MCQs from a book chapter's pages (src/lib/chapterMcq.ts), without a model: the helpers, then one mocked end-to-end run.
// Run: node --import tsx tools/quality/chapterMcq.test.mjs
import { quoteInText, chunkPages, dedupeFacts, checkDraft, placeCorrect, generateChapterMcqs } from '../../src/lib/chapterMcq.ts';

globalThis.localStorage = { getItem: (k) => (k === 'ai.activeProvider' ? 'claude' : null), setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = globalThis.localStorage;

let failed = 0;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

// ---- helpers
const text = 'Isoniazid causes peripheral neuropathy, which is prevented by pyridoxine. Ethambutol causes optic neuritis with loss of red-green colour vision.';
expect('quote: exact', quoteInText('Ethambutol causes optic neuritis', text), true);
expect('quote: spacing and case ignored', quoteInText('ethambutol   CAUSES optic neuritis', text), true);
expect('quote: made-up quote rejected', quoteInText('Rifampicin colours the urine orange and tears red', text), false);
expect('quote: mostly present words accepted', quoteInText('Isoniazid causes the peripheral neuropathy prevented by pyridoxine', text), true);
expect('quote: empty', quoteInText('', text), false);

const pages = [{ page: 1, text: 'a'.repeat(6000) }, { page: 2, text: 'b'.repeat(6000) }, { page: 3, text: 'c'.repeat(3000) }];
expect('chunk: pages grouped under the limit', chunkPages(pages, 11000).map((c) => c.map((p) => p.page)), [[1], [2, 3]]);
expect('chunk: one chunk when small', chunkPages([{ page: 5, text: 'x' }], 100).length, 1);

const facts = [
  { fact: 'Ethambutol causes optic neuritis with red-green colour blindness', quote: 'q1', page: 3, importance: 5 },
  { fact: 'Ethambutol causes optic neuritis and red-green colour blindness', quote: 'q2', page: 3, importance: 3 },
  { fact: 'Pyridoxine prevents isoniazid neuropathy', quote: 'q3', page: 4, importance: 4 },
];
const deduped = dedupeFacts(facts);
expect('dedupe: the repeat is dropped, the more important one kept', deduped.map((f) => f.importance), [5, 4]);

const draft = (over = {}) => ({
  factIndex: 0, stem: 'A man on antitubercular treatment develops blurred vision and red-green colour confusion.', questionText: 'Which drug is responsible?',
  options: { A: 'Isoniazid', B: 'Ethambutol', C: 'Rifampicin', D: 'Pyrazinamide' }, correctOption: 'B', explanation: 'Ethambutol causes optic neuritis. [p. 3]',
  optionReasons: { A: 'Neuropathy', B: 'Optic neuritis', C: 'Orange urine', D: 'Gout' }, keyFact: 'Ethambutol causes optic neuritis.', boardPearl: 'Check colour vision.', cognitiveTier: 'Clinical 2-Step', ...over,
});
expect('check: a good draft passes', checkDraft(draft()), null);
expect('check: answer written in the stem', /answer-in-stem/.test(checkDraft(draft({ stem: 'A man on ethambutol develops blurred vision. He has optic neuritis from ethambutol.' }))), true);
expect('check: refers to the passage', /source-leak/.test(checkDraft(draft({ questionText: 'According to the passage, which drug is responsible?' }))), true);
expect('check: two options the same', /options/.test(checkDraft(draft({ options: { A: 'Isoniazid', B: 'Ethambutol', C: 'isoniazid', D: 'Pyrazinamide' } }))), true);
expect('check: an empty option', /shape/.test(checkDraft(draft({ options: { A: 'Isoniazid', B: 'Ethambutol', C: '', D: 'Pyrazinamide' } }))), true);
expect('check: correct option not A to D', /shape/.test(checkDraft(draft({ correctOption: 'E' }))), true);

const moved = placeCorrect(draft(), 'D');
expect('place: correct text moved to D', moved.options.D, 'Ethambutol');
expect('place: key letter follows', moved.correctOption, 'D');
expect('place: others keep their order', [moved.options.A, moved.options.B, moved.options.C], ['Isoniazid', 'Rifampicin', 'Pyrazinamide']);
expect('place: reasons travel with their options', [moved.optionReasons.D, moved.optionReasons.B], ['Optic neuritis', 'Orange urine']);
expect('place: to A', placeCorrect(draft(), 'A').options.A, 'Ethambutol');

// ---- mocked end to end
const pageText = (n, body) => `${body} ${'Further text about the drug class and its use in clinical practice. '.repeat(8)}`;
const chapterPages = [
  { page: 10, text: pageText(10, 'Ethambutol causes optic neuritis with loss of red-green colour vision, so colour vision is tested before treatment.') },
  { page: 11, text: pageText(11, 'Pyridoxine is given with isoniazid to prevent peripheral neuropathy. Rifampicin turns urine and tears orange-red.') },
];
const FACTS = [
  { fact: 'Ethambutol causes optic neuritis with red-green colour blindness', quote: 'Ethambutol causes optic neuritis with loss of red-green colour vision', page: 10, importance: 5 },
  { fact: 'Pyridoxine prevents isoniazid neuropathy', quote: 'Pyridoxine is given with isoniazid to prevent peripheral neuropathy', page: 11, importance: 4 },
  { fact: 'Rifampicin colours the urine orange-red', quote: 'Rifampicin turns urine and tears orange-red', page: 11, importance: 3 },
  { fact: 'A made-up fact', quote: 'Streptomycin is given orally with food in every patient', page: 11, importance: 5 },
];
const seen = { plan: 0, write: 0, exam: 0, failedOnce: false };
const writerReply = (content) => {
  const indexes = [...content.matchAll(/FACT (\d+):/g)].map((m) => Number(m[1]));
  const rewrite = /earlier draft was rejected/.test(content);
  return JSON.stringify({
    questions: indexes.map((i) => ({
      factIndex: i, stem: i === 2 ? '' : `A patient (case ${i}) is on antitubercular treatment and has a problem related to fact ${i}.`,
      questionText: i === 2 ? 'Which antitubercular drug colours the urine orange-red?' : 'Which is the most likely cause?',
      options: { A: `Option A${i}${rewrite ? ' revised' : ''}`, B: `Option B${i}`, C: `Option C${i}`, D: `Option D${i}` }, correctOption: 'A',
      explanation: `Option A${i} is right. [p. ${10 + (i ? 1 : 0)}]`, optionReasons: { A: 'right', B: 'no', C: 'no', D: 'no' }, keyFact: `fact ${i}`, boardPearl: 'pearl', cognitiveTier: 'Direct Recall',
    })),
  });
};
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const raw = init?.body ?? '{}';
  const body = JSON.parse(raw);
  const reply = (t) => new Response(JSON.stringify({ text: t }));
  if (u.includes('/api/ai/jobs')) {
    const content = JSON.stringify(body).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    // The request that carries the prompt is the real write; any other request for the job result gets the last reply.
    if (/FACT \d+:/.test(content)) { seen.write += 1; globalThis.__lastWrite = writerReply(content); }
    return new Response(JSON.stringify({ id: 'j', done: true, status: 200, body: { text: globalThis.__lastWrite ?? '{"questions":[]}' } }));
  }
  if (u.includes('/api/ai/complete')) {
    const content = body.messages?.map((m) => m.content).join('\n') ?? '';
    if (body.purpose === 'plan') { seen.plan += 1; return reply(JSON.stringify({ subject: 'Pharmacology', facts: FACTS })); }
    if (body.purpose === 'examiner') {
      seen.exam += 1;
      const n = [...content.matchAll(/QUESTION (\d+)/g)].length;
      // The first question checked fails once (it is rewritten), every later one passes.
      return reply(JSON.stringify({ verdicts: Array.from({ length: n }, (_, i) => {
        if (!seen.failedOnce && i === 0) { seen.failedOnce = true; return { index: i, ok: false, reason: 'The case is not needed.', fix: 'Ask it directly.' }; }
        return { index: i, ok: true, reason: '', fix: '' };
      }) }));
    }
  }
  return new Response('{}', { status: 404 });
};

const progress = [];
const result = await generateChapterMcqs({ bookTitle: 'Test Pharmacology', chapterTitle: 'Antitubercular drugs', pages: chapterPages, provider: 'claude', model: 'test', onProgress: (p) => progress.push(p.stage) });
expect('e2e: the made-up quote was dropped, 3 facts planned', result.factsPlanned, 3);
expect('e2e: all 3 became questions (one after a rewrite)', result.questions.length, 3);
expect('e2e: the dropped fact is recorded', result.dropped.some((d) => /quote is not in the pages/.test(d.reason)), true);
expect('e2e: the examiner ran', seen.exam >= 1, true);
expect('e2e: the rewrite used the examiner reason', seen.write >= 2, true);
expect('e2e: citations carry the book and page', result.questions.every((q) => /^Test Pharmacology, p\. 1[01]$/.test(q.citations[0])), true);
expect('e2e: subject taken from the plan', result.questions[0]?.subject, 'Pharmacology');
expect('e2e: chapter is the subtopic', result.questions[0]?.subtopic, 'Antitubercular drugs');
expect('e2e: every question has 4 options and a valid key', result.questions.every((q) => q.options.length === 4 && q.options.some((o) => o.id === q.correctOption)), true);
expect('e2e: the key text is the planned option whatever its letter', result.questions.every((q) => /^Option A\d/.test(q.options.find((o) => o.id === q.correctOption).text)), true);
expect('e2e: answer letters are spread', new Set(result.questions.map((q) => q.correctOption)).size >= 2, true);
expect('e2e: the one-liner has an empty stem and a question line', result.questions.some((q) => q.stem === '' && /colours the urine/.test(q.questionText)), true);
expect('e2e: ids are unique', new Set(result.questions.map((q) => q.id)).size, 3);
expect('e2e: progress was reported', progress.includes('Finding the testable facts') && progress.includes('Writing and checking questions'), true);

const thin = await generateChapterMcqs({ bookTitle: 'B', chapterTitle: 'C', pages: [{ page: 1, text: 'Too short.' }], provider: 'claude', model: 'test' });
expect('thin chapter: no questions and a clear note', [thin.questions.length, /too little readable text/.test(thin.note)], [0, true]);

// Yield level: 'high' keeps only importance 4-5, 'low' only 2-3, 'all' keeps 3 and above.
{
  const { selectFacts } = await import('../../src/lib/chapterMcq.ts');
  const f = (importance, i) => ({ fact: `f${i}`, quote: 'q', page: 1, importance });
  const pool = [f(5, 1), f(4, 2), f(3, 3), f(2, 4), f(1, 5)];
  expect('yield all keeps 3+', selectFacts(pool, 1, 100, 'all').map((x) => x.importance).sort(), [3, 4, 5]);
  expect('yield high keeps 4+', selectFacts(pool, 1, 100, 'high').map((x) => x.importance).sort(), [4, 5]);
  expect('yield low keeps 2-3', selectFacts(pool, 1, 100, 'low').map((x) => x.importance).sort(), [2, 3]);
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
