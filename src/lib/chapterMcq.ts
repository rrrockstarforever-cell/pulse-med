// MCQs written from the pages of one book chapter, using only the text of those pages.
//
// 1. Plan: the AI lists the distinct, exam-testable facts the chapter text states (one fact = one question), each with
//    an exact quote and its page. The chapter decides how many facts there are, not the learner.
// 2. Write: one MCQ per fact, written from the quoted page text only.
// 3. Check: code checks the shape and the answer-in-stem and source-leak rules; an examiner call checks that the key is
//    in the text, only one option is defensible, the stem does not give the answer away and the point is worth asking.
//    A draft that fails is rewritten once with the examiner's reason, then dropped.
import type { ClinicalQuestion, ExamType } from '../types.ts';
import { aiComplete, extractJson } from './ai.ts';
import { SUBTOPICS } from '../data/subtopics.ts';

type Provider = NonNullable<Parameters<typeof aiComplete>[0]['provider']>;
type Letter = 'A' | 'B' | 'C' | 'D';
const LETTERS: Letter[] = ['A', 'B', 'C', 'D'];

export interface ChapterPage { page: number; text: string }
export interface ChapterMcqProgress { stage: string; done: number; total: number }
export interface ChapterMcqOptions {
  bookTitle: string;
  chapterTitle: string;
  pages: ChapterPage[];
  provider: Provider;
  model: string;
  exam?: ExamType;
  /** At most this many questions in one run (the chapter's content decides below this). */
  maxQuestions?: number;
  /** 'all' = every fact rated 3 or more (default); 'high' = only the core high-yield facts (4 or 5); 'low' = only the minor details (2 or 3). */
  yieldLevel?: YieldLevel;
  onProgress?: (p: ChapterMcqProgress) => void;
  shouldStop?: () => boolean;
}
export interface ChapterMcqResult {
  questions: ClinicalQuestion[];
  factsFound: number;
  factsPlanned: number;
  dropped: { fact: string; reason: string }[];
  note: string;
}

export type YieldLevel = 'all' | 'high' | 'low';

export interface PlannedChapterFact {
  fact: string; quote: string; page: number; importance: number;
  /** Short name of the disease, drug group or concept the fact belongs to; the review groups questions by it. */
  topic?: string;
  /** Subject of the passage the fact came from (one of the app's subject names). */
  subject?: string;
}

/** A topic name as a short, tidy label (empty when the model gave nothing usable). */
export function cleanTopic(raw: unknown): string {
  const t = String(raw ?? '').replace(/\s+/g, ' ').replace(/^[\s\-–:•\d.)]+/, '').trim();
  return t.length >= 3 ? t.slice(0, 60) : '';
}

interface Draft {
  factIndex: number;
  stem: string;
  questionText: string;
  options: Record<Letter, string>;
  correctOption: Letter;
  explanation: string;
  optionReasons: Partial<Record<Letter, string>>;
  keyFact: string;
  boardPearl: string;
  cognitiveTier: ClinicalQuestion['cognitiveTier'];
}

const norm = (s: string): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const bigWords = (s: string): string[] => norm(s).split(' ').filter((w) => w.length >= 4);

/** True when the quote is in the text (exactly after normalising, or with at least 85% of its longer words present). */
export function quoteInText(quote: string, text: string): boolean {
  const nq = norm(quote);
  if (!nq) return false;
  const nt = norm(text);
  if (nt.includes(nq)) return true;
  const words = bigWords(quote);
  if (words.length < 4) return false;
  const have = new Set(nt.split(' '));
  return words.filter((w) => have.has(w)).length / words.length >= 0.85;
}

/**
 * Splits the chapter into chunks of whole pages, each at most about maxChars long (2 to 3 dense pages). One planning call
 * over a whole 6 to 8 page chapter returned only about 36 facts whatever the chapter held, because a model lists a limited
 * number of items per reply; small chunks make it list what each page holds.
 */
export function chunkPages(pages: ChapterPage[], maxChars = 3500): ChapterPage[][] {
  const chunks: ChapterPage[][] = [];
  let current: ChapterPage[] = [];
  let size = 0;
  for (const p of pages) {
    const len = p.text.length;
    if (current.length && size + len > maxChars) { chunks.push(current); current = []; size = 0; }
    current.push(p);
    size += len;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Drops a fact that says nearly the same as a more important one kept before it. */
export function dedupeFacts(facts: PlannedChapterFact[]): PlannedChapterFact[] {
  const ordered = [...facts].sort((a, b) => b.importance - a.importance || a.page - b.page);
  const kept: PlannedChapterFact[] = [];
  const keptWords: Set<string>[] = [];
  for (const f of ordered) {
    const words = new Set(bigWords(f.fact));
    let same = false;
    for (const other of keptWords) {
      let inter = 0;
      for (const w of words) if (other.has(w)) inter += 1;
      const union = words.size + other.size - inter;
      if (union > 0 && inter / union >= 0.4) { same = true; break; }
    }
    if (!same) { kept.push(f); keptWords.push(words); }
  }
  return kept;
}

/**
 * How many facts become questions. The chapter's content decides, within two limits: only facts rated 3 or more, and at
 * most about eight per page of text (a dense page holds that many; it was six, which cut a 6 page chapter to 36; the 68-question run on 10 pages was about 7 a page and
 * included trivia, a cap of 3 a page left a dense chapter half covered). Input is in importance order, as dedupeFacts returns it.
 */
export function selectFacts(facts: PlannedChapterFact[], pageCount: number, maxQuestions = 100, level: YieldLevel = 'all'): PlannedChapterFact[] {
  const cap = Math.min(maxQuestions, Math.max(3, Math.ceil(pageCount * 10)));
  const pool = facts.filter((f) => (level === 'high' ? f.importance >= 4 : level === 'low' ? f.importance >= 2 && f.importance <= 3 : f.importance >= 3));
  if (pool.length <= cap) return pool;
  // Over the cap: the most important facts stay; among equals, each page gets its turn before any page gets a second
  // fact, so the cut does not fall on the last pages of the chapter.
  const seen = new Map<number, number>();
  const ranked = pool.map((f) => {
    const nth = seen.get(f.page) ?? 0;
    seen.set(f.page, nth + 1);
    return { f, nth };
  });
  ranked.sort((a, b) => b.f.importance - a.f.importance || a.nth - b.nth || a.f.page - b.f.page);
  return ranked.slice(0, cap).map((r) => r.f);
}

const SOURCE_LEAK =/\b(the|this|these|that)\s+(passage|text|book|chapter|excerpt|extract|page|author|authors)\b|according to (the|this) (book|text|chapter)|\bas (stated|described|mentioned) (in|above)\b/i;
const COMBINATION_OPTION = /\b(both|all of the|none of the|above|option [a-d]\b)|\b[A-D]\s*(and|&|,)\s*[A-D]\b/i;

/** Deterministic checks on a draft. Returns the reason it fails, or null. */
export function checkDraft(d: Draft): string | null {
  const texts = LETTERS.map((l) => String(d.options?.[l] ?? '').trim());
  if (texts.some((t) => !t)) return 'shape: an option is empty';
  if (!LETTERS.includes(d.correctOption)) return 'shape: the correct option is not A to D';
  if (new Set(texts.map(norm)).size < 4) return 'options: two options are the same';
  if (!String(d.questionText ?? '').trim() && !String(d.stem ?? '').trim()) return 'shape: no question';
  if (!String(d.explanation ?? '').trim()) return 'shape: no explanation';
  const all = [d.stem, d.questionText, ...texts].join(' ');
  if (SOURCE_LEAK.test(all)) return 'source-leak: the question refers to the passage or book';
  const key = norm(d.options[d.correctOption]);
  const asked = norm(`${d.stem} ${d.questionText}`);
  if (key.length >= 6 && asked.includes(key)) return 'answer-in-stem: the correct option is written in the stem';
  return null;
}

/** Moves the correct option to the target letter, keeping the other options in order and the reasons with their options. */
export function placeCorrect(d: Draft, target: Letter): Draft {
  const items = LETTERS.map((l) => ({ text: d.options[l], reason: d.optionReasons?.[l], correct: l === d.correctOption }));
  const correct = items.find((i) => i.correct)!;
  const others = items.filter((i) => !i.correct);
  const ti = LETTERS.indexOf(target);
  const arranged = [...others.slice(0, ti), correct, ...others.slice(ti)];
  const options = {} as Record<Letter, string>;
  const optionReasons: Partial<Record<Letter, string>> = {};
  arranged.forEach((it, i) => { options[LETTERS[i]] = it.text; if (it.reason) optionReasons[LETTERS[i]] = it.reason; });
  return { ...d, options, optionReasons, correctOption: target };
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
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

const SUBJECT_NAMES = Object.keys(SUBTOPICS);

export const PLAN_SYSTEM = [
  'You plan MCQs for NEET-PG and INI-CET from ONE passage of a medical book. A learner will sit these questions, so choose only the points worth a question.',
  'List the facts in the passage that an exam is likely to ask. Use only what the passage states; add nothing from outside it.',
  'Each fact is one definite sentence (a cause, a feature, a number, a test, a drug and its effect or adverse effect, a rule, a complication, how two similar things differ).',
  'When several facts are items of one list, class or table (the drugs of a class, the members of a classification, the steps of a regimen), give ONE fact for the whole group, so one question can ask about the group.',
  '"quote" is copied exactly from the passage, one sentence or phrase under 300 characters, that supports the fact.',
  '"page" is the number of the nearest [page N] marker above the quote.',
  '"importance" is a strict 1 to 5: 5 = a core high-yield point exams ask again and again (a drug of choice, a key mechanism, a characteristic adverse effect, a classic contraindication, a standard regimen); 4 = a standard testable point; 3 = a useful detail; 2 = a minor detail; 1 = trivia. Most facts in a passage are 2 or 3, and only a few are 4 or 5.',
  'Skip a "most effective", "best" or "drug of choice" claim when a standard textbook could name another drug, and any point where two answers would be defensible.',
  'Skip: definitions and general statements any student knows, history, names of authors, figure and table labels and numbering, a heading restated as a fact, facts the passage hedges ("may", "is thought to"), facts that only make sense with a table or figure that is not in the text, reference lists, and anything not stated in the passage.',
  'Cover the passage: give every distinct point an exam could ask: each drug of choice, mechanism, characteristic adverse effect or reaction (and the group of drugs that causes it), contraindication, interaction, classification, spectrum, regimen, and each mnemonic set. Dense pages hold many such points, so do not stop at the first few. But never list the same point twice, never pad with trivia, and a thin passage gives few facts, even none.',
  'Give a fact its own entry even when it comes from a mnemonic or a list, if the entry on its own is a point worth asking (for example which drugs cause a disulfiram-like reaction); group list items only when they are interchangeable members of one set.',
  'Never list a fact that is only a step of a treatment sequence, flow box or algorithm unless the fact itself states the condition for that step (for example "linezolid for pneumonia" without saying which organism or resistance is misleading). Skip facts of the kind "which route is X secreted by" or "which class is anti-Y" that a student could guess without knowing the topic.',
  'Skip vague comparatives ("acts longer than", "widest spectrum", "more potent") and old-fashioned first-line claims that current guidelines have replaced (for example penicillin for tetanus), unless the passage ties them to a clear current standard. Skip facts whose only possible wrong answers are silly (an organ list, a route of excretion): the fact must allow three real near-miss options of the same kind.',
  'Skip a fact when the question would have to repeat its answer (for example "X is nephrotoxic" can only be asked as "which toxicity affects the kidney") and bare administration-route facts such as "depot preparations are given intramuscularly".',
  'Do not list two facts that an exam would test with the same question (for example the same drug of choice, the same regimen, or the same adverse effect stated twice in different words): keep the one best worded fact. Keep the condition ("in pregnancy", "in children", "tertiary") inside the fact.',
  `"subject" is the one of these that the passage belongs to: ${SUBJECT_NAMES.join(' | ')}.`,
  '"topic" is the short name (2 to 5 words) of the disease, drug group, organ problem or concept the fact belongs to, for example "Aminoglycosides", "Tuberculosis treatment" or "Nephrotic syndrome". Facts about the same subject must use the SAME topic wording, and never use the chapter title or a generic word like "General".',
  'Reply with ONLY JSON: {"subject":"...","facts":[{"fact":"...","topic":"...","quote":"...","page":0,"importance":0}]}.',
].join(' ');

/**
 * Second planning pass over the same passage: the facts already listed are shown and the model adds only what is still
 * missing. One pass left about a third of a dense passage's high-yield points unlisted (the model stops after a few per page).
 */
export function buildGapMessage(bookTitle: string, chapterTitle: string, text: string, listed: { fact: string }[]): string {
  return `Book: ${bookTitle}\nChapter: ${chapterTitle}\n\nPassage:\n${text}\n\nThese facts are ALREADY listed:\n${listed.map((f, i) => `${i + 1}. ${f.fact}`).join('\n')}\n\nRe-read the passage line by line, including every table, mnemonic box, list and the small print around figures. List ONLY the further testable facts that no listed fact covers: a drug of choice, a dose or duration, a characteristic adverse effect, an interaction, a contraindication, a mechanism, a classification member, a definition used in exams, a regimen. Use the same rules and the same JSON shape as before. If nothing high-yield is missing, reply {"subject":"","facts":[]}.`;
}

export const WRITE_SYSTEM = [
  'You write NEET-PG and INI-CET single-best-answer MCQs from a book. You get facts and the exact book text they come from.',
  'Use ONLY that text: the keyed option must be directly stated in it. Never put an outside fact in the key.',
  'Write ONE question per fact, testing exactly that fact.',
  'Write in the style of real NEET-PG and INI-CET papers, not as plain recall. Make about half the questions in a batch clinical vignettes (3 to 6 lines: age and sex, presentation, one or two key findings or an investigation, sometimes a drug the patient is on) that make the student first work out the diagnosis, organism, drug or mechanism and only then answer a second step (the drug of choice, the adverse effect, the contraindication, the mechanism, the next step). The vignette must not name what it hides.',
  'Mix the question forms across the batch: "most likely", "drug of choice", "next best step", "mechanism of action of the drug that should be given", "all of the following are true EXCEPT" (only when you can write three clearly true statements from the book text and one false one), "which of the following is NOT", and a few short direct questions. Never make two questions in a batch use the same opening words.',
  'Hide the answer one step deeper where the text allows: ask for the class, the mechanism or the adverse effect of the drug the case points to, instead of naming the drug in the question. Distractors are drugs or terms that a student who half knows the topic would pick, and each must be wrong for this case for a reason stated in the text or standard medicine.',
  'Ask ONE thing per question. Never write a two-part question ("X and Y, respectively") or a pairing of two facts: if a fact has two parts, ask about the more important part only.',
  'The case must not state the answer, name the diagnosis it asks for, or repeat the fact. Use a case only when it adds a reasoning step; a fact that cannot be hidden behind a case stays a short direct question.',
  'Put the question line only in "questionText" (it ends with a question mark). "stem" holds the case and ends with the last finding, never with a question; for a one-line question leave "stem" as an empty string.',
  'Exactly 4 options A to D: similar in length and form, one defensible answer, distractors plausible and of the same kind (same drug class, same organ, same test type). The correct option is not the longest. Never "all of the above", "none of the above" or "A and B".',
  'Before you answer, test every distractor against the book text and standard medicine: if a distractor is also true or defensible for the question asked, replace it with a plausible but wrong one. Avoid "which statement is correct" questions with true-sounding statements; ask a direct question with a single answer instead.',
  'Distractors must be real near-misses of the same kind as the key (same drug class, same organ, same type of reaction), never an unrelated drug or a term from another question. Do not make the key obvious by class alone.',
  'The question line must not contain the answer or a close paraphrase of it (never "which adverse effect makes it contraindicated in epilepsy?" when the key is seizures).',
  'Every distractor must be something a student could really hesitate over; never use an absurd option (sweat, lymph drainage, an unrelated organ). If you cannot find three real near-misses, test the same fact as a short clinical case instead.',
  'Put the condition of the fact (organism, patient group, stage, resistance) into the question so the keyed answer is correct for that condition only.',
  'Never refer to "the passage", "the text", "the book", "the chapter" or "the author": the question must stand alone.',
  '"explanation": 3 to 6 sentences on why the key is right, from the text, ending with the page as [p. N]. "optionReasons": one short reason for each letter. "keyFact": the fact in one sentence. "boardPearl": a one-line takeaway.',
  '"cognitiveTier" is "Direct Recall", "Clinical 2-Step" or "Multi-Step & IBQ".',
  'Reply with ONLY JSON: {"questions":[{"factIndex":0,"stem":"","questionText":"","options":{"A":"","B":"","C":"","D":""},"correctOption":"A","explanation":"","optionReasons":{"A":"","B":"","C":"","D":""},"keyFact":"","boardPearl":"","cognitiveTier":"Direct Recall"}]}.',
].join(' ');

const EXAM_SYSTEM = [
  'You check MCQs that were written from a book passage. For each question return ok=true only if ALL of these hold:',
  '(1) the keyed option is directly stated or clearly implied by the book text given;',
  '(2) exactly one option is defensible, given the text and standard medical knowledge: no distractor is also correct;',
  '(3) the question does not give the answer away, and a patient case is not used where a plain question would do;',
  '(4) the options are similar in form and none is silly;',
  '(5) it tests a point worth asking in NEET-PG or INI-CET, not trivia (a page number, an author, a minor figure);',
  '(6) it makes sense on its own, without the book.',
  'If not ok, give "reason" (one sentence) and "fix" (one sentence on how to rewrite it).',
  'Reply with ONLY JSON: {"verdicts":[{"index":0,"ok":true,"reason":"","fix":""}]}.',
].join(' ');

function contextFor(fact: PlannedChapterFact, pages: ChapterPage[]): string {
  const hit = pages.find((p) => quoteInText(fact.quote, p.text)) ?? pages.find((p) => p.page === fact.page) ?? pages[0];
  if (!hit) return '';
  const at = hit.text.indexOf(fact.quote.slice(0, 40));
  const start = Math.max(0, (at >= 0 ? at : 0) - 1200);
  return `[page ${hit.page}]\n${hit.text.slice(start, start + 3600)}`;
}

/** The user message of one writer call: the facts of a batch, each with the book text it must be written from. */
export function buildWriteMessage(
  bookTitle: string,
  chapterTitle: string,
  items: { fact: PlannedChapterFact; index: number; problem?: string; previous?: unknown }[],
  pages: ChapterPage[],
): string {
  const body = items.map((it) => [
    `FACT ${it.index}: ${it.fact.fact}`,
    `Book text for fact ${it.index} (the only source):\n"""\n${contextFor(it.fact, pages)}\n"""`,
    it.problem ? `Your earlier draft was rejected: ${it.problem}\nEarlier draft: ${JSON.stringify(it.previous)}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
  return `Book: ${bookTitle}\nChapter: ${chapterTitle}\n\n${body}\n\nWrite one MCQ for each fact. Use the fact numbers shown as factIndex. Reply with the JSON.`;
}

export function asDraft(raw: unknown): Draft | null {
  const r = raw as Record<string, any> | null;
  if (!r || typeof r !== 'object') return null;
  const opts = r.options;
  const options = {} as Record<Letter, string>;
  if (Array.isArray(opts)) {
    LETTERS.forEach((l, i) => { options[l] = String(typeof opts[i] === 'string' ? opts[i] : opts[i]?.text ?? '').trim(); });
  } else if (opts && typeof opts === 'object') {
    LETTERS.forEach((l) => { options[l] = String(opts[l] ?? opts[l.toLowerCase()] ?? '').trim(); });
  } else return null;
  const correct = String(r.correctOption ?? '').trim().toUpperCase().replace(/^OPTION\s*/, '').slice(0, 1) as Letter;
  const tier = ['Direct Recall', 'Clinical 2-Step', 'Multi-Step & IBQ'].includes(r.cognitiveTier) ? r.cognitiveTier : 'Direct Recall';
  const reasons: Partial<Record<Letter, string>> = {};
  if (r.optionReasons && typeof r.optionReasons === 'object') LETTERS.forEach((l) => { const v = r.optionReasons[l]; if (typeof v === 'string' && v.trim()) reasons[l] = v.trim(); });
  return {
    factIndex: Number.isFinite(Number(r.factIndex)) ? Number(r.factIndex) : -1,
    stem: String(r.stem ?? '').replace(/\\n/g, '\n').trim(),
    questionText: String(r.questionText ?? r.question ?? '').trim(),
    options,
    correctOption: correct,
    explanation: String(r.explanation ?? '').trim(),
    optionReasons: reasons,
    keyFact: String(r.keyFact ?? '').trim(),
    boardPearl: String(r.boardPearl ?? '').trim(),
    cognitiveTier: tier,
  };
}

export async function generateChapterMcqs(opts: ChapterMcqOptions): Promise<ChapterMcqResult> {
  const { bookTitle, chapterTitle, provider, model, onProgress, shouldStop } = opts;
  const exam: ExamType = opts.exam ?? ('NEET_PG' as ExamType);
  const maxQuestions = Math.max(1, Math.min(100, opts.maxQuestions ?? 100));
  const pages = opts.pages.filter((p) => p.text.trim().length > 0);
  const dropped: { fact: string; reason: string }[] = [];
  const stopped = () => Boolean(shouldStop?.());
  const progress = (stage: string, done: number, total: number) => onProgress?.({ stage, done, total });
  const call = (system: string, user: string, purpose: string, work = false) =>
    aiComplete({ system, messages: [{ role: 'user', content: user }], json: true, effort: work ? 'low' : 'medium', provider, model, work: work || undefined, purpose });

  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  if (chars < 400) {
    return { questions: [], factsFound: 0, factsPlanned: 0, dropped, note: 'These pages have too little readable text to write questions from.' };
  }

  // 1. Plan the facts, chunk by chunk.
  const chunks = chunkPages(pages);
  progress('Finding the testable facts', 0, chunks.length);
  let planDone = 0;
  const subjectVotes = new Map<string, number>();
  const planned = (await pool(chunks, 3, async (chunk) => {
    if (stopped()) return [] as PlannedChapterFact[];
    const text = chunk.map((p) => `[page ${p.page}]\n${p.text}`).join('\n\n');
    let facts: PlannedChapterFact[] = [];
    let chunkSubject: string | undefined;
    for (let attempt = 0; attempt < 2 && !facts.length; attempt++) {
      try {
        const parsed = extractJson<{ subject?: string; facts?: any[] }>(await call(PLAN_SYSTEM, `Book: ${bookTitle}\nChapter: ${chapterTitle}\n\nPassage:\n${text}\n\nList the testable facts as JSON.`, 'plan'));
        if (parsed?.subject && SUBJECT_NAMES.includes(parsed.subject)) {
          chunkSubject = parsed.subject;
          subjectVotes.set(parsed.subject, (subjectVotes.get(parsed.subject) ?? 0) + 1);
        }
        const firstPage = chunk[0].page;
        facts = (parsed?.facts ?? []).flatMap((f) => {
          const fact = String(f?.fact ?? '').trim();
          const quote = String(f?.quote ?? '').trim();
          if (!fact || !quote) return [];
          if (!quoteInText(quote, text)) { dropped.push({ fact, reason: 'plan: the quote is not in the pages' }); return []; }
          let page = Math.floor(Number(f?.page));
          const home = chunk.find((p) => quoteInText(quote, p.text));
          if (home) page = home.page; else if (!chunk.some((p) => p.page === page)) page = firstPage;
          const importance = Math.max(1, Math.min(5, Math.round(Number(f?.importance)) || 3));
          return [{ fact, quote: quote.slice(0, 300), page, importance, topic: cleanTopic(f?.topic), subject: chunkSubject }];
        });
      } catch (err) {
        if (attempt === 1) dropped.push({ fact: `(pages ${chunk[0].page}-${chunk[chunk.length - 1].page})`, reason: `plan: ${(err as Error)?.message ?? 'the call failed'}` });
      }
    }
    // Second pass: what the first listing left out (a failed second pass keeps the first list).
    if (facts.length && !stopped()) {
      try {
        const parsed = extractJson<{ facts?: any[] }>(await call(PLAN_SYSTEM, buildGapMessage(bookTitle, chapterTitle, text, facts), 'plan'));
        const more = (parsed?.facts ?? []).flatMap((f) => {
          const fact = String(f?.fact ?? '').trim();
          const quote = String(f?.quote ?? '').trim();
          if (!fact || !quote || !quoteInText(quote, text)) return [];
          const home = chunk.find((p) => quoteInText(quote, p.text));
          const page = home ? home.page : chunk[0].page;
          const importance = Math.max(1, Math.min(5, Math.round(Number(f?.importance)) || 3));
          return [{ fact, quote: quote.slice(0, 300), page, importance, topic: cleanTopic(f?.topic), subject: chunkSubject }];
        });
        facts = [...facts, ...more];
      } catch { /* the first list stands */ }
    }
    progress('Finding the testable facts', ++planDone, chunks.length);
    return facts;
  })).flat();

  const unique = dedupeFacts(planned);
  const factsFound = planned.length;
  const chosen = selectFacts(unique, pages.length, maxQuestions, opts.yieldLevel ?? 'all').sort((a, b) => a.page - b.page);
  const factsPlanned = chosen.length;
  // The reasons are kept for the page console (globalThis.__chapterMcq) and the first ones are shown in the note, so
  // "no facts" can be told apart: the AI call failed, its reply was not readable, or its quotes were not in the pages.
  (globalThis as { __chapterMcq?: unknown }).__chapterMcq = { bookTitle, chapterTitle, pages: pages.map((p) => p.page), chars, chunks: chunks.length, factsFound, dropped };
  if (!chosen.length) {
    const why = [...new Set(dropped.map((d) => d.reason.slice(0, 90)))].slice(0, 2).join('; ');
    return { questions: [], factsFound, factsPlanned: 0, dropped, note: `No testable facts were found in these pages (${pages.length} pages, ${chars} characters read${why ? `; ${why}` : '; the AI returned no facts'}).` };
  }
  const subject = [...subjectVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? bookTitle;

  // 2 and 3. Write each fact as an MCQ, check it, rewrite once if it fails.
  const writeBatch = async (items: { fact: PlannedChapterFact; index: number; problem?: string; previous?: Draft }[]): Promise<Draft[]> => {
    const parsed = extractJson<{ questions?: any[] }>(await call(WRITE_SYSTEM, buildWriteMessage(bookTitle, chapterTitle, items, pages), 'write', true));
    return (parsed?.questions ?? []).map(asDraft).filter((d): d is Draft => Boolean(d));
  };
  const examine = async (items: { draft: Draft; fact: PlannedChapterFact }[]): Promise<{ ok: boolean; reason: string; fix: string }[]> => {
    const body = items.map((it, i) => [
      `QUESTION ${i}`,
      `Stem: ${it.draft.stem || '(none, a one-line question)'}`,
      `Question: ${it.draft.questionText}`,
      LETTERS.map((l) => `${l}. ${it.draft.options[l]}`).join('\n'),
      `Keyed answer: ${it.draft.correctOption}`,
      `Book text:\n"""\n${contextFor(it.fact, pages)}\n"""`,
    ].join('\n')).join('\n\n');
    const parsed = extractJson<{ verdicts?: any[] }>(await call(EXAM_SYSTEM, `${body}\n\nReturn one verdict per question.`, 'examiner'));
    return items.map((_, i) => {
      const v = (parsed?.verdicts ?? []).find((x) => Number(x?.index) === i);
      // No verdict means the check could not be read: treat it as not passed rather than guessing.
      return v ? { ok: v.ok === true, reason: String(v.reason ?? ''), fix: String(v.fix ?? '') } : { ok: false, reason: 'the check gave no verdict', fix: '' };
    });
  };

  const accepted: { draft: Draft; fact: PlannedChapterFact }[] = [];
  const BATCH = 4;
  const batches: { fact: PlannedChapterFact; index: number }[][] = [];
  chosen.forEach((fact, index) => { const b = Math.floor(index / BATCH); (batches[b] ??= []).push({ fact, index }); });
  let writeDone = 0;
  progress('Writing and checking questions', 0, chosen.length);

  const settle = async (items: { fact: PlannedChapterFact; index: number; problem?: string; previous?: Draft }[], round: number): Promise<{ fact: PlannedChapterFact; index: number; problem: string; previous?: Draft }[]> => {
    if (!items.length || stopped()) return [];
    let drafts: Draft[] = [];
    try { drafts = await writeBatch(items); } catch (err) {
      return items.map((it) => ({ fact: it.fact, index: it.index, problem: `the writer call failed: ${(err as Error)?.message ?? ''}` }));
    }
    const failed: { fact: PlannedChapterFact; index: number; problem: string; previous?: Draft }[] = [];
    const toCheck: { draft: Draft; fact: PlannedChapterFact; index: number }[] = [];
    for (const it of items) {
      const draft = drafts.find((d) => d.factIndex === it.index);
      if (!draft) { failed.push({ fact: it.fact, index: it.index, problem: 'the writer returned no question for this fact' }); continue; }
      const bad = checkDraft(draft);
      if (bad) failed.push({ fact: it.fact, index: it.index, problem: bad, previous: draft });
      else toCheck.push({ draft, fact: it.fact, index: it.index });
    }
    if (toCheck.length) {
      let verdicts: { ok: boolean; reason: string; fix: string }[];
      try { verdicts = await examine(toCheck); } catch { verdicts = toCheck.map(() => ({ ok: false, reason: 'the examiner call failed', fix: '' })); }
      toCheck.forEach((c, i) => {
        if (verdicts[i].ok) accepted.push({ draft: c.draft, fact: c.fact });
        else failed.push({ fact: c.fact, index: c.index, problem: `${verdicts[i].reason} ${verdicts[i].fix}`.trim(), previous: c.draft });
      });
    }
    if (round === 0) return failed;
    return failed;
  };

  await pool(batches, 3, async (batch) => {
    const failed = await settle(batch, 0);
    writeDone += batch.length - failed.length;
    progress('Writing and checking questions', writeDone, chosen.length);
    if (failed.length && !stopped()) {
      const retry = await settle(failed, 1);
      writeDone += failed.length - retry.length;
      progress('Writing and checking questions', writeDone, chosen.length);
      for (const r of retry) dropped.push({ fact: r.fact.fact, reason: r.problem.slice(0, 200) });
    }
  });

  // 4. Build the questions: balance the answer letters, mix the order.
  const stamp = Date.now().toString(36);
  let turn = 0;
  const built = accepted.map(({ draft, fact }, i) => {
    const fixed = LETTERS.some((l) => COMBINATION_OPTION.test(draft.options[l]));
    const placed = fixed ? draft : placeCorrect(draft, LETTERS[turn++ % 4]);
    const q: ClinicalQuestion = {
      id: `CH-${stamp}-${i + 1}`,
      moduleCode: `${bookTitle} · ${chapterTitle}`,
      examType: exam,
      // The review groups by subject and subtopic: the fact's own topic gives a real per-topic breakdown instead of one
      // lump for the whole chapter.
      subject: fact.subject && SUBJECT_NAMES.includes(fact.subject) ? fact.subject : subject,
      subtopic: fact.topic || chapterTitle,
      cognitiveTier: placed.cognitiveTier,
      difficultyTier: 'MEDIUM',
      stem: placed.stem,
      questionText: placed.questionText,
      options: LETTERS.map((l) => ({ id: l, text: placed.options[l] })),
      correctOption: placed.correctOption,
      boardPearl: placed.boardPearl || placed.keyFact,
      keyFact: placed.keyFact || fact.fact,
      optionReasons: placed.optionReasons,
      citations: [`${bookTitle}, p. ${fact.page}`],
      targetAccuracy: 60,
      explanation: placed.explanation,
      ...(fixed ? { fixedOptionOrder: true } : {}),
    };
    return q;
  });
  for (let i = built.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [built[i], built[j]] = [built[j], built[i]];
  }

  const note = `${pages.length} pages read: ${factsFound} testable facts found${unique.length < factsFound ? `, ${factsFound - unique.length} repeats removed` : ''}; ${factsPlanned} planned; ${built.length} questions kept${dropped.length ? `, ${dropped.length} dropped` : ''}.`;
  return { questions: built, factsFound, factsPlanned, dropped, note };
}

/** True when a saved question came from a PDF chapter and still carries the old one-label-per-chapter topic. */
export function needsTopicRelabel(questions: ClinicalQuestion[]): boolean {
  const chapter = questions.filter((q) => String(q.id).startsWith('CH-'));
  if (chapter.length < 2) return false;
  return new Set(chapter.map((q) => (q.subtopic || '').trim())).size <= 1;
}

const RELABEL_SYSTEM = [
  'You label medical MCQs by topic so a student can see which topics they are weak in.',
  'For each numbered question give "topic": the short name (2 to 5 words) of the disease, drug group, organ problem or concept it tests, for example "Aminoglycosides", "Tuberculosis treatment" or "Nephrotic syndrome".',
  'Questions about the same thing must use the SAME wording. Never use the chapter title or a generic word like "General". Use a standard textbook name.',
  'Reply with ONLY JSON: {"topics":[{"index":0,"topic":"..."}]}.',
].join(' ');

/**
 * Gives each PDF-made question its own topic (the old banks labelled the whole chapter with one topic, so the test review
 * could not tell topics apart). Question ids, answers and everything else stay the same, so saved progress still lines up.
 * Returns the questions with new `subtopic` values and how many were changed.
 */
export async function relabelTopics(
  questions: ClinicalQuestion[],
  opts: { provider: Provider; model?: string; onProgress?: (done: number, total: number) => void; shouldStop?: () => boolean },
): Promise<{ questions: ClinicalQuestion[]; changed: number }> {
  const next = questions.map((q) => ({ ...q }));
  const targets = next.map((q, i) => ({ q, i })).filter(({ q }) => String(q.id).startsWith('CH-'));
  const SIZE = 20;
  const groups: { q: ClinicalQuestion; i: number }[][] = [];
  for (let k = 0; k < targets.length; k += SIZE) groups.push(targets.slice(k, k + SIZE));
  let changed = 0;
  let done = 0;
  await pool(groups, 3, async (group) => {
    if (opts.shouldStop?.()) return;
    const body = group.map(({ q }, n) => `${n}. ${(q.stem ? q.stem + ' ' : '') + q.questionText}\nKey: ${q.options.find((o) => o.id === q.correctOption)?.text ?? ''}${q.keyFact ? `\nFact: ${q.keyFact}` : ''}`).join('\n\n');
    try {
      const parsed = extractJson<{ topics?: { index?: number; topic?: string }[] }>(
        await aiComplete({ system: RELABEL_SYSTEM, messages: [{ role: 'user', content: `${body}\n\nLabel every question.` }], json: true, effort: 'low', provider: opts.provider, model: opts.model, work: true, purpose: 'relabel' }),
      );
      for (const t of parsed?.topics ?? []) {
        const hit = group[Number(t?.index)];
        const topic = cleanTopic(t?.topic);
        if (hit && topic && next[hit.i].subtopic !== topic) { next[hit.i].subtopic = topic; changed += 1; }
      }
    } catch { /* this group keeps its old labels */ }
    done += group.length;
    opts.onProgress?.(Math.min(done, targets.length), targets.length);
  });
  return { questions: next, changed };
}
