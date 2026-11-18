// Chapter-level view over the PYQ topic database (src/data/chapterTopics.json).
//
// The database stores, for every subject, the chapters in book order and inside each chapter
// the topics with: tier index, score, how many past papers asked it, a predicted percent and a
// plain note on how it is asked. Everything here is a read-only derivation of that file plus
// the importance table — no AI calls, so the subject and chapter screens are instant and work
// offline.
//
// Every number shown to a learner is an estimate made from past papers. Callers must label it
// "predicted", never "official".
import raw from '../data/chapterTopics.json';
import { TOPIC_IMPORTANCE } from '../data/topicImportance.ts';

export type TopicTier = 'Very high' | 'High' | 'Medium' | 'Low';

export interface SubjectStat {
  subject: string;
  chapters: number;
  topics: number;
  pyqTopics: number;
  avgPredicted: number;
}

export interface ChapterSummary {
  subject: string;
  chapter: string;
  topicCount: number;
  pyqCount: number;
  maxTier: TopicTier;
  avgPredicted: number;
  forecastCount: number;
}

export interface ChapterTopic {
  topic: string;
  tier: TopicTier;
  score: number;
  pyq: number;
  predicted: number;
  howAsked: string;
}

export interface ForecastRow {
  topic: string;
  rank: number;
  tier: TopicTier;
  pyq: number;
  predicted: number;
  importancePercent: number | null;
  verified: boolean;
  reason: string;
  format: string | null;
}


const TIERS: TopicTier[] = ['Low', 'Medium', 'High', 'Very high'];
type RawRow = [string, number, number, number, number, string?];
const DATA = raw as unknown as Record<string, [string, RawRow[]][]>;

const tierOf = (i: number): TopicTier => TIERS[i] ?? 'Medium';

// ---------------------------------------------------------------- aggregate caches
// The JSON is 3.5 MB and static, so every aggregate is built once and reused. Without this the
// subject screen would re-walk 26,581 rows on every render.

let SUBJECTS: SubjectStat[] | null = null;
const CHAPTERS = new Map<string, ChapterSummary[]>();
const TOPICS = new Map<string, ChapterTopic[]>();

function chapterTopicsOf(subject: string, chapter: string): RawRow[] {
  const chapters = DATA[subject];
  if (!chapters) return [];
  const found = chapters.find(([name]) => name === chapter);
  return found ? found[1] : [];
}

/** Every subject that has chapter data. Never includes a subject with no chapters. */
export function listPyqSubjects(): SubjectStat[] {
  if (SUBJECTS) return SUBJECTS;
  const out: SubjectStat[] = [];
  for (const [subject, chapters] of Object.entries(DATA)) {
    let topics = 0;
    let pyqTopics = 0;
    let predictedSum = 0;
    for (const [, rows] of chapters) {
      for (const r of rows) {
        topics += 1;
        if ((r[3] ?? 0) > 0) pyqTopics += 1;
        predictedSum += r[4] ?? 0;
      }
    }
    if (topics === 0) continue;
    out.push({
      subject,
      chapters: chapters.length,
      topics,
      pyqTopics,
      avgPredicted: Math.round((predictedSum / topics) * 10) / 10,
    });
  }
  out.sort((a, b) => b.topics - a.topics);
  SUBJECTS = out;
  return out;
}

/** Chapters of one subject, each with its aggregate numbers. Empty rows are dropped. */
export function chaptersForSubject(subject: string): ChapterSummary[] {
  const cached = CHAPTERS.get(subject);
  if (cached) return cached;
  const chapters = DATA[subject];
  if (!chapters) return [];
  const out: ChapterSummary[] = [];
  for (const [chapter, rows] of chapters) {
    if (!rows.length) continue;
    let pyqCount = 0;
    let predictedSum = 0;
    let maxTierIdx = 0;
    let forecastCount = 0;
    for (const r of rows) {
      const pyq = r[3] ?? 0;
      pyqCount += pyq;
      predictedSum += r[4] ?? 0;
      if ((r[1] ?? 0) > maxTierIdx) maxTierIdx = r[1];
      if ((r[1] ?? 0) >= 2 || (r[4] ?? 0) >= 40) forecastCount += 1;
    }
    out.push({
      subject,
      chapter,
      topicCount: rows.length,
      pyqCount,
      maxTier: tierOf(maxTierIdx),
      avgPredicted: Math.round((predictedSum / rows.length) * 10) / 10,
      forecastCount,
    });
  }
  CHAPTERS.set(subject, out);
  return out;
}

/** The topics of one chapter, in the database's own order (most asked first). */
export function topicsForChapter(subject: string, chapter: string): ChapterTopic[] {
  const key = `${subject}::${chapter}`;
  const cached = TOPICS.get(key);
  if (cached) return cached;
  const out: ChapterTopic[] = chapterTopicsOf(subject, chapter).map((r) => ({
    topic: r[0],
    tier: tierOf(r[1] ?? 0),
    score: r[2] ?? 0,
    pyq: r[3] ?? 0,
    predicted: r[4] ?? 0,
    howAsked: (r[5] ?? '').trim(),
  }));
  TOPICS.set(key, out);
  return out;
}

/** True when this subject/chapter pair exists in the database. */
export function hasChapter(subject: string, chapter: string): boolean {
  return chapterTopicsOf(subject, chapter).length > 0;
}

// ---------------------------------------------------------------- importance matching
// TOPIC_IMPORTANCE has 1,297 free-form rows from several research sources; the same topic can
// appear many times. A row matches when the subject matches and the topic words overlap enough.

const IMPORTANCE_STOP = new Set(['the', 'and', 'of', 'in', 'on', 'for', 'to', 'a', 'an', 'whole', 'unit', 'subject', 'general']);

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !IMPORTANCE_STOP.has(w));
}

// Rows are grouped by subject once, and each row's topic words are split once, so a lookup walks
// only its own subject's rows instead of the whole 1,297-row table. Scanning the full table per
// call made a 649-topic chapter freeze for over half a second, twice per chapter open.
interface ImportanceEntry {
  words: Set<string>;
  wordCount: number;
  percent: number;
  verified: boolean;
}

let IMPORTANCE_INDEX: Map<string, ImportanceEntry[]> | null = null;

function importanceIndex(): Map<string, ImportanceEntry[]> {
  if (IMPORTANCE_INDEX) return IMPORTANCE_INDEX;
  const out = new Map<string, ImportanceEntry[]>();
  for (const row of TOPIC_IMPORTANCE) {
    const key = row.subject.trim().toLowerCase();
    const rowWords = words(row.topic);
    const entry: ImportanceEntry = {
      words: new Set(rowWords),
      wordCount: rowWords.length,
      percent: row.percent,
      verified: row.verified,
    };
    const list = out.get(key);
    if (list) list.push(entry);
    else out.set(key, [entry]);
  }
  IMPORTANCE_INDEX = out;
  return out;
}

// Every chapter topic is asked for at least twice (the asked list and the predicted list both
// rank the same chapter), so results are kept per subject+topic.
const IMPORTANCE_MEMO = new Map<string, { percent: number; verified: boolean } | null>();

/**
 * The strongest importance figure recorded for a chapter topic, or null when nothing matches.
 * Only rows whose topic words substantially overlap the topic name count, so a chapter called
 * "Diabetes" does not borrow an unrelated number.
 */
export function matchImportance(subject: string, topic: string): { percent: number; verified: boolean } | null {
  const memoKey = `${subject.trim().toLowerCase()}::${topic.trim().toLowerCase()}`;
  const cached = IMPORTANCE_MEMO.get(memoKey);
  if (cached !== undefined) return cached;

  const subjectRows = importanceIndex().get(subject.trim().toLowerCase());
  let best: { percent: number; verified: boolean; hits: number } | null = null;
  const target = subjectRows ? words(topic) : [];
  if (subjectRows && target.length) {
    for (const row of subjectRows) {
      // A "whole unit" style row is too broad to be a topic match.
      if (row.wordCount === 0 || row.wordCount > 6) continue;
      let hits = 0;
      for (const w of target) if (row.words.has(w)) hits += 1;
      if (hits < 1 || hits / row.wordCount < 0.5) continue;
      if (!best || hits > best.hits || (hits === best.hits && row.verified && !best.verified)) {
        best = { percent: row.percent, verified: row.verified, hits };
      }
    }
  }

  const result = best ? { percent: best.percent, verified: best.verified } : null;
  IMPORTANCE_MEMO.set(memoKey, result);
  return result;
}

// ---------------------------------------------------------------- forecast
// Pure client-side ranking: no AI call, so it is free, instant, offline-safe and cannot invent a
// topic that is not already in the database.

const norm = (value: number, max: number): number => (max > 0 ? Math.max(0, Math.min(1, value / max)) : 0);

/** One plain sentence saying why this topic is on the list, built only from stored fields. */
function reasonFor(t: ChapterTopic, importancePercent: number | null): string {
  const parts: string[] = [];
  if (t.pyq > 0) {
    parts.push(`has been asked in ${t.pyq} past ${t.pyq === 1 ? 'paper' : 'papers'}`);
  } else {
    parts.push('has not appeared in the papers checked, so treat it as a gap that can be asked');
  }
  if (t.tier === 'Very high' || t.tier === 'High') {
    parts.push(`marked ${t.tier.toLowerCase()} yield by the question survey`);
  } else if (t.tier === 'Medium') {
    parts.push('rated a medium-frequency topic');
  } else {
    parts.push('rated low frequency so far');
  }
  if (importancePercent != null) parts.push(`about ${Math.round(importancePercent)}% of questions in the research source`);
  const clean = (t.howAsked || '').replace(/\s+/g, ' ').trim();
  const base = `${capitalise(t.topic)} ${parts.join(', ')}.`;
  return base;
}

function reasonWithHowAsked(t: ChapterTopic, importancePercent: number | null): string {
  const base = reasonFor(t, importancePercent);
  const clean = (t.howAsked || '').replace(/\s+/g, ' ').trim();
  if (!clean) return base;
  const trimmed = clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
  return `${base} Usually asked as: ${trimmed}`;
}

function capitalise(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/** A short exam-format guess taken from the stored "how asked" note. Display only. */
export function formatOf(howAsked: string): string | null {
  const text = (howAsked || '').toLowerCase();
  if (!text) return null;
  if (/one[- ]liner|single line|one line/.test(text)) return 'one-liner';
  if (/vignette|case|clinical scenario|patient/.test(text)) return 'vignette';
  if (/negative|not true|except/.test(text)) return 'negative';
  if (/match|pair|combination/.test(text)) return 'match';
  if (/image|photograph|radiograph|x-ray|slide/.test(text)) return 'image';
  if (/assertion|reason/.test(text)) return 'assertion-reason';
  if (/calculat|numerical/.test(text)) return 'calculation';
  return null;
}

/**
 * The ranked "likely next" shortlist for one chapter.
 *
 * Ranking blends three signals — the survey tier, the predicted percent, and the importance
 * table where one exists — then gives a small boost to topics that have actually been asked
 * before. It is a priority order, not a probability.
 */
export function buildForecast(subject: string, chapter: string, limit = 8): ForecastRow[] {
  return rankChapter(subject, chapter).slice(0, Math.max(1, limit)).map((row, i) => toRow(row, i + 1));
}

/**
 * Every topic in the chapter, scored once, newest-first by priority. Shared by the forecast,
 * the "already asked" list and the "not yet asked" list so all three use one ranking and cannot
 * drift apart.
 */
interface Ranked {
  t: ChapterTopic;
  importancePercent: number | null;
  verified: boolean;
  score: number;
}

// The asked list, the predicted list and the forecast all rank the same chapter, and the chapter
// screen asks for all of them when it opens. Scoring is kept per chapter so it happens once.
const RANKED = new Map<string, Ranked[]>();

function rankChapter(subject: string, chapter: string): Ranked[] {
  const memoKey = `${subject}::${chapter}`;
  const cached = RANKED.get(memoKey);
  if (cached) return cached;

  const topics = topicsForChapter(subject, chapter);
  if (!topics.length) return [];
  const maxTierScore = Math.max(...topics.map((t) => t.score), 1);
  const maxPredicted = Math.max(...topics.map((t) => t.predicted), 1);

  const scored: Ranked[] = topics.map((t) => {
    const imp = matchImportance(subject, t.topic);
    const importancePercent = imp?.percent ?? null;
    const tierPart = norm(t.score, maxTierScore) * 0.45;
    const predictedPart = norm(t.predicted, maxPredicted) * 0.3;
    const importancePart = importancePercent != null ? Math.min(1, importancePercent / 100) * 0.25 : 0;
    let score = tierPart + predictedPart + importancePart;
    if (imp?.verified) score *= 1.1;
    if (t.pyq > 0) score *= 1.1;
    return { t, importancePercent, verified: Boolean(imp?.verified), score };
  });

  scored.sort((a, b) => b.score - a.score || b.t.pyq - a.t.pyq || b.t.predicted - a.t.predicted);
  RANKED.set(memoKey, scored);
  return scored;
}

/**
 * Shapes one ranked topic into a display row.
 *
 * `reason` and `format` are built on first read, not up front. A 649-topic chapter produces
 * 152,000 characters of reason text and runs eight format regexes per topic, but the panel only
 * shows six rows until "Show all" is pressed — building every string on open cost about 165 ms
 * of main-thread time for text nobody had looked at yet.
 */
function toRow(row: Ranked, rank: number): ForecastRow {
  let reason: string | null = null;
  let format: string | null | undefined;
  const t = row.t;
  return {
    topic: t.topic,
    rank,
    tier: t.tier,
    pyq: t.pyq,
    predicted: t.predicted,
    importancePercent: row.importancePercent,
    verified: row.verified,
    get reason(): string {
      if (reason === null) reason = reasonWithHowAsked(t, row.importancePercent);
      return reason;
    },
    get format(): string | null {
      if (format === undefined) format = formatOf(t.howAsked);
      return format;
    },
  };
}

/**
 * Topics this chapter has ALREADY been asked about, most-asked first.
 *
 * Within the asked group the order is paper count first (a topic asked in 9 papers comes before
 * one asked in 2), then the same blended priority score, so a frequently asked high-yield topic
 * still rises above a frequently asked minor one.
 */
export function askedTopics(subject: string, chapter: string, limit = 0): ForecastRow[] {
  const asked = rankChapter(subject, chapter).filter((r) => r.t.pyq > 0);
  asked.sort((a, b) => b.t.pyq - a.t.pyq || b.score - a.score || b.t.predicted - a.t.predicted);
  const rows = asked.map((row, i) => toRow(row, i + 1));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

/**
 * Topics that have NOT been asked in the papers checked, but are still strong candidates.
 *
 * These are ranked by the blended score alone (tier, predicted percent, research importance) —
 * there is no paper count to lean on, which is exactly what makes this a prediction rather than
 * a record. A topic with a low tier and a low predicted percent stays at the bottom.
 */
export function predictedTopics(subject: string, chapter: string, limit = 0): ForecastRow[] {
  const unseen = rankChapter(subject, chapter).filter((r) => r.t.pyq === 0);
  const rows = unseen.map((row, i) => toRow(row, i + 1));
  return limit > 0 ? rows.slice(0, limit) : rows;
}

/** How many of this chapter's topics have been asked before, and how many have not. */
export function chapterAskedSplit(subject: string, chapter: string): { asked: number; notAsked: number } {
  const topics = topicsForChapter(subject, chapter);
  const asked = topics.filter((t) => t.pyq > 0).length;
  return { asked, notAsked: topics.length - asked };
}

/** The topics in a chapter worth teaching first: the top forecast rows, in the chapter's own order. */
export function teachableTopics(subject: string, chapter: string, limit = 10): string[] {
  const rows = buildForecast(subject, chapter, limit);
  const names = rows.map((r) => r.topic);
  const order = topicsForChapter(subject, chapter).map((t) => t.topic);
  return names.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Total chapters across every subject, for the summary line on the subject screen. */
export function totalChapters(): number {
  return listPyqSubjects().reduce((sum, s) => sum + s.chapters, 0);
}
