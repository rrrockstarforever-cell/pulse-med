// Study plan for one question bank: the questions answered wrong and the questions flagged are analysed together, the
// gaps behind them are grouped into concepts, the AI decides how many chunks the notes need and in what order to read them,
// each chunk is written on its own call (so no single prompt has to carry everything), and the chunks are put together as
// one note in reading order. The plan is kept per bank.
import type { ClinicalQuestion } from '../types.ts';
import { aiComplete, extractJson } from './ai.ts';

type Provider = NonNullable<Parameters<typeof aiComplete>[0]['provider']>;

export interface Miss {
  n: number;
  id: string;
  reason: 'wrong' | 'flagged' | 'both' | 'skipped' | 'preread';
  /** How many times the learner has missed it in tests (from the Mistake Notebook); repeated misses are planned first. */
  times?: number;
  subject: string;
  topic: string;
  text: string;
  chosen: string;
  correct: string;
  fact: string;
  explanation: string;
}

export interface NoteSection { heading: string; points: string[] }
export interface PlanChunk {
  title: string;
  why: string;
  /** How this chunk connects to the one before it (empty for the first). */
  connects: string;
  intro: string;
  sections: NoteSection[];
  traps: string[];
  recall: string[];
  /** Ids of the questions this chunk covers. */
  questionIds: string[];
  /** True when the notes could not be written and only the facts from the questions are shown. */
  fallback?: boolean;
}
export interface StudyPlan {
  bankId: string;
  at: string;
  wrong: number;
  flagged: number;
  overview: string;
  chunks: PlanChunk[];
}

export interface PlanProgress { stage: string; done: number; total: number }

const KEY = 'pulse.studyplan.v1.';
const clip = (s: unknown, n: number): string => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const optionText = (q: ClinicalQuestion, id?: string): string => (id ? q.options.find((o) => o.id === id)?.text ?? '' : '');

/**
 * The questions that count: answered wrong, flagged by the learner (right or wrong), or skipped once the learner has
 * answered others in the run. Questions missed again and again (`misses`, from the Mistake Notebook) come first.
 */
export function collectMisses(
  questions: ClinicalQuestion[],
  answers: Record<string, string>,
  flags: Record<string, boolean>,
  misses: Record<string, number> = {},
): Miss[] {
  const out: Miss[] = [];
  const ranAny = Object.keys(answers).length > 0;
  for (const q of questions) {
    const chosen = answers[q.id];
    const wrong = !!chosen && chosen !== q.correctOption;
    const flagged = !!flags[q.id];
    const skipped = ranAny && !chosen;
    if (!wrong && !flagged && !skipped) continue;
    out.push({
      n: 0,
      id: q.id,
      times: misses[q.id] ?? 0,
      reason: wrong && flagged ? 'both' : wrong ? 'wrong' : flagged ? 'flagged' : 'skipped',
      subject: clip(q.subject, 60),
      topic: clip(q.subtopic || q.subject || 'General', 80),
      text: clip(`${q.stem ? q.stem + ' ' : ''}${q.questionText}`, 500),
      chosen: clip(optionText(q, chosen), 120),
      correct: clip(optionText(q, q.correctOption), 120),
      fact: clip(q.keyFact || q.boardPearl, 300),
      explanation: clip(q.explanation, 400),
    });
  }
  out.sort((a, b) => (b.times ?? 0) - (a.times ?? 0));
  out.forEach((m, i) => { m.n = i + 1; });
  return out;
}

/** For a bank with nothing answered yet: one question per subtopic (up to `limit`), so a pre-read plan covers the bank's topics. */
export function collectPreRead(questions: ClinicalQuestion[], limit = 24): Miss[] {
  const seen = new Set<string>();
  const out: Miss[] = [];
  for (const q of questions) {
    const key = (q.subtopic || q.subject || q.id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      n: out.length + 1,
      id: q.id,
      reason: 'preread',
      subject: clip(q.subject, 60),
      topic: clip(q.subtopic || q.subject || 'General', 80),
      text: clip(`${q.stem ? q.stem + ' ' : ''}${q.questionText}`, 500),
      chosen: '',
      correct: clip(optionText(q, q.correctOption), 120),
      fact: clip(q.keyFact || q.boardPearl, 300),
      explanation: clip(q.explanation, 400),
    });
    if (out.length >= limit) break;
  }
  return out;
}

const describe = (m: Miss): string => [
  `#${m.n} [${({ wrong: 'answered wrong', flagged: 'flagged, unsure', both: 'wrong and flagged', skipped: 'skipped, not answered', preread: 'topic to read before practising' } as Record<string, string>)[m.reason]}${m.times && m.times > 1 ? `, missed ${m.times} times` : ''}] ${m.subject}${m.topic && m.topic !== m.subject ? ' / ' + m.topic : ''}`,
  `Question: ${m.text}`,
  m.chosen ? `Student chose: ${m.chosen}` : '',
  `Correct answer: ${m.correct}`,
  m.fact ? `Key fact: ${m.fact}` : '',
].filter(Boolean).join('\n');

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return out;
}

const ANALYSE_SYSTEM = [
  'You are a NEET-PG / INI-CET teacher. A student got these questions wrong or flagged them as unsure.',
  'Find the CONCEPTS the student has not learned well enough, not the individual facts. Several questions can come from one concept; one question can point to a concept that is bigger than the question.',
  'For each concept give a short "title" (2 to 6 words, a standard textbook name), a "gap" of one or two sentences that says what the student seems not to know or confuse, and "misses": the question numbers it explains.',
  'Every question number must be in exactly one concept.',
  'Reply with ONLY JSON: {"concepts":[{"title":"...","gap":"...","misses":[1,2]}]}.',
].join(' ');

const PLAN_SYSTEM = [
  'You plan a study note for a NEET-PG / INI-CET student from a list of weak concepts.',
  'Decide how many chunks the note needs, so that each chunk can be written fully on its own (about 1 to 4 related concepts per chunk; use as many chunks as needed, from 1 to 10, and fewer when the concepts are few).',
  'Group concepts that belong together. Put the chunks in the order the student should READ them: basics and prerequisites first, then what builds on them.',
  'For each chunk give "title", "why" (one sentence: why this chunk is needed for the missed questions), "concepts" (the concept numbers it holds, every concept in exactly one chunk) and "connects" (one sentence saying how it builds on or links to the chunk before it; empty for the first chunk).',
  'Also give "overview": two or three plain sentences telling the student what the whole note covers and in what order to read it.',
  'Reply with ONLY JSON: {"overview":"...","chunks":[{"title":"...","why":"...","concepts":[1,2],"connects":"..."}]}.',
].join(' ');

const WRITE_SYSTEM = [
  'You write one chunk of a study note for a NEET-PG / INI-CET student who has just got questions wrong. Write as if the student is meeting the topic for the first time, in simple everyday words, with no jargon dumps.',
  'Teach the WHOLE topic around the missed points so the student learns it properly, not only the answer to the question: what it is, why it happens, the key features, how to tell it from look-alikes, and what exams ask about it.',
  'Use only facts you are sure of from standard medical textbooks. Never invent numbers, doses or names. If a detail is uncertain, leave it out.',
  'Mark the few most important words or phrases with **double asterisks**.',
  'Connect this chunk to the previous and next chunk when that helps, in the "connects" field only (one or two sentences).',
  'Fields: "intro" (two or three sentences on what this chunk is about), "sections" (3 to 6 items, each {"heading","points"} with 2 to 6 short points), "traps" (1 to 4 typical exam traps or confusions), "recall" (2 to 4 short self-check questions with the answer after a dash).',
  'Reply with ONLY JSON: {"intro":"...","connects":"...","sections":[{"heading":"...","points":["..."]}],"traps":["..."],"recall":["Question? - answer"]}.',
].join(' ');

const asStrings = (v: unknown, max: number, len = 400): string[] =>
  (Array.isArray(v) ? v : []).map((x) => clip(x, len)).filter(Boolean).slice(0, max);

/** Splits the misses into groups of at most `size`, keeping questions of one subject together where possible. */
function batches(misses: Miss[], size: number): Miss[][] {
  const sorted = [...misses].sort((a, b) => a.subject.localeCompare(b.subject) || a.topic.localeCompare(b.topic));
  const out: Miss[][] = [];
  for (let i = 0; i < sorted.length; i += size) out.push(sorted.slice(i, i + size));
  return out;
}

export async function buildStudyPlan(opts: {
  bankId: string;
  misses: Miss[];
  provider: Provider;
  model?: string;
  onProgress?: (p: PlanProgress) => void;
  shouldStop?: () => boolean;
}): Promise<StudyPlan> {
  const { misses, provider, model, bankId } = opts;
  const stopped = () => opts.shouldStop?.() === true;
  const report = (stage: string, done: number, total: number) => opts.onProgress?.({ stage, done, total });
  const call = (system: string, user: string, purpose: string) =>
    aiComplete({ system, messages: [{ role: 'user', content: user }], json: true, effort: 'medium', provider, model, purpose });
  const withRetry = async <T,>(fn: () => Promise<T | null>): Promise<T | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (stopped()) return null;
      try { const v = await fn(); if (v) return v; } catch { /* try once more */ }
    }
    return null;
  };

  // 1. Analyse the misses into concepts, a few questions per call.
  const groups = batches(misses, 20);
  report('Analysing your wrong and flagged questions', 0, groups.length);
  let analysed = 0;
  const concepts: { title: string; gap: string; misses: number[] }[] = [];
  const perGroup = await pool(groups, 3, async (group) => {
    const parsed = await withRetry(async () => {
      const raw = extractJson<{ concepts?: any[] }>(await call(ANALYSE_SYSTEM, `${group.map(describe).join('\n\n')}\n\nGroup them into concepts as JSON.`, 'study-analyse'));
      return raw?.concepts?.length ? raw : null;
    });
    report('Analysing your wrong and flagged questions', ++analysed, groups.length);
    const valid = new Set(group.map((m) => m.n));
    const found: { title: string; gap: string; misses: number[] }[] = [];
    const seen = new Set<number>();
    for (const c of parsed?.concepts ?? []) {
      const ids = (Array.isArray(c?.misses) ? c.misses : []).map(Number).filter((n: number) => valid.has(n) && !seen.has(n));
      ids.forEach((n: number) => seen.add(n));
      const title = clip(c?.title, 80);
      if (title && ids.length) found.push({ title, gap: clip(c?.gap, 300), misses: ids });
    }
    // Questions the analysis left out are kept, grouped by their own topic label.
    const left = group.filter((m) => !seen.has(m.n));
    for (const topic of [...new Set(left.map((m) => m.topic))]) {
      found.push({ title: topic, gap: 'These questions were missed or flagged.', misses: left.filter((m) => m.topic === topic).map((m) => m.n) });
    }
    return found;
  });
  perGroup.flat().forEach((c) => concepts.push(c));
  if (stopped() || !concepts.length) return { bankId, at: new Date().toISOString(), wrong: 0, flagged: 0, overview: '', chunks: [] };

  // 2. Decide the chunks and the reading order.
  report('Planning the order of the notes', 0, 1);
  const conceptList = concepts.map((c, i) => `${i + 1}. ${c.title}: ${c.gap}`).join('\n');
  const planned = await withRetry(async () => {
    const raw = extractJson<{ overview?: string; chunks?: any[] }>(await call(PLAN_SYSTEM, `Weak concepts:\n${conceptList}\n\nPlan the chunks as JSON.`, 'study-plan'));
    return raw?.chunks?.length ? raw : null;
  });
  const used = new Set<number>();
  const layout: { title: string; why: string; connects: string; concepts: number[] }[] = [];
  for (const c of planned?.chunks ?? []) {
    const ids = (Array.isArray(c?.concepts) ? c.concepts : []).map(Number).filter((n: number) => n >= 1 && n <= concepts.length && !used.has(n));
    ids.forEach((n: number) => used.add(n));
    const title = clip(c?.title, 90);
    if (title && ids.length) layout.push({ title, why: clip(c?.why, 250), connects: clip(c?.connects, 300), concepts: ids });
  }
  // Concepts the plan left out go in a last chunk (or one chunk per concept when the plan failed).
  const leftover = concepts.map((_, i) => i + 1).filter((n) => !used.has(n));
  if (!layout.length) leftover.forEach((n) => layout.push({ title: concepts[n - 1].title, why: concepts[n - 1].gap, connects: '', concepts: [n] }));
  else if (leftover.length) layout.push({ title: 'Other points to revise', why: 'More points from your wrong and flagged questions.', connects: '', concepts: leftover });
  // At most 10 chunks: the concepts of any extra chunk are folded into the last one, never dropped.
  if (layout.length > 10) {
    const extra = layout.splice(10);
    layout[9].concepts.push(...extra.flatMap((e) => e.concepts));
  }
  report('Planning the order of the notes', 1, 1);

  // 3. Write each chunk on its own call.
  report('Writing the notes', 0, layout.length);
  let written = 0;
  const byN = new Map(misses.map((m) => [m.n, m]));
  const chunks = await pool(layout, 3, async (item, i): Promise<PlanChunk> => {
    const ownMisses = [...new Set(item.concepts.flatMap((ci) => concepts[ci - 1].misses))].map((n) => byN.get(n)).filter((m): m is Miss => Boolean(m));
    const detail = item.concepts.map((ci) => {
      const c = concepts[ci - 1];
      return `Concept: ${c.title}\nGap: ${c.gap}\n` + c.misses.map((n) => byN.get(n)).filter((m): m is Miss => Boolean(m)).map(describe).join('\n\n');
    }).join('\n\n---\n\n');
    const before = i > 0 ? layout[i - 1].title : '(none, this is the first chunk)';
    const after = i < layout.length - 1 ? layout[i + 1].title : '(none, this is the last chunk)';
    const user = `Chunk ${i + 1} of ${layout.length}: ${item.title}\nWhy it is needed: ${item.why}\nPrevious chunk: ${before}\nNext chunk: ${after}\n\nThe student's missed questions and gaps:\n${detail}\n\nWrite this chunk as JSON.`;
    const parsed = await withRetry(async () => {
      const raw = extractJson<{ intro?: string; connects?: string; sections?: any[]; traps?: any[]; recall?: any[] }>(await call(WRITE_SYSTEM, user, 'study-write'));
      return raw?.sections?.length ? raw : null;
    });
    report('Writing the notes', ++written, layout.length);
    const questionIds = ownMisses.map((m) => m.id);
    if (!parsed) {
      // Better a short note than a gap: the facts from the questions themselves.
      return {
        title: item.title, why: item.why, connects: item.connects, intro: 'The notes for this chunk could not be written. These are the facts from your questions.',
        sections: [{ heading: 'Facts from your questions', points: ownMisses.map((m) => m.fact || `${m.text} Answer: ${m.correct}`).filter(Boolean).map((s) => clip(s, 400)) }],
        traps: [], recall: [], questionIds, fallback: true,
      };
    }
    const sections = (parsed.sections ?? [])
      .map((s) => ({ heading: clip(s?.heading, 100), points: asStrings(s?.points, 8) }))
      .filter((s) => s.heading && s.points.length)
      .slice(0, 8);
    return {
      title: item.title, why: item.why, connects: clip(parsed.connects, 300) || item.connects, intro: clip(parsed.intro, 500),
      sections, traps: asStrings(parsed.traps, 5), recall: asStrings(parsed.recall, 5), questionIds,
    };
  });

  const wrong = misses.filter((m) => m.reason === 'wrong' || m.reason === 'both').length;
  const flagged = misses.filter((m) => m.reason === 'flagged' || m.reason === 'both').length;
  return {
    bankId, at: new Date().toISOString(), wrong, flagged,
    overview: clip(planned?.overview, 600) || `${chunks.length} part${chunks.length === 1 ? '' : 's'}, in the order to read them.`,
    chunks,
  };
}

export function loadStudyPlan(bankId: string): StudyPlan | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY + bankId) || 'null');
    return raw && Array.isArray(raw.chunks) ? (raw as StudyPlan) : null;
  } catch { return null; }
}

export function saveStudyPlan(plan: StudyPlan): void {
  try { localStorage.setItem(KEY + plan.bankId, JSON.stringify(plan)); } catch { /* storage full: the plan is still shown */ }
}

/** Ids of the questions a plan was built from (so a later run can tell what is new). */
export function planQuestionIds(plan: StudyPlan): Set<string> {
  return new Set(plan.chunks.flatMap((c) => c.questionIds));
}

/** About how long one part takes to read and check yourself, in minutes. */
export function chunkMinutes(c: PlanChunk): number {
  const words = [c.intro, ...c.sections.flatMap((x) => [x.heading, ...x.points]), ...c.traps, ...c.recall].join(' ').split(/s+/).filter(Boolean).length;
  return Math.max(2, Math.ceil(words / 170 + c.recall.length * 0.5));
}

// Which parts the learner has finished, kept per bank by part title so a rebuilt plan keeps the ticks.
const DONE_KEY = 'pulse.studyplan.done.v1.';
const titleKey = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function loadPlanDone(bankId: string): Record<string, boolean> {
  try { const v = JSON.parse(localStorage.getItem(DONE_KEY + bankId) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
export function setPlanPartDone(bankId: string, title: string, done: boolean): Record<string, boolean> {
  const cur = loadPlanDone(bankId);
  if (done) cur[titleKey(title)] = true; else delete cur[titleKey(title)];
  try { localStorage.setItem(DONE_KEY + bankId, JSON.stringify(cur)); } catch { /* storage full: the tick is kept for this visit only */ }
  return cur;
}
export const isPartDone = (done: Record<string, boolean>, title: string): boolean => !!done[titleKey(title)];
