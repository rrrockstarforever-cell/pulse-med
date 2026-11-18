// Chapter teaching: one note that explains a whole chapter, written from the learner's own books.
//
// The existing "Teach me this" note (src/lib/teachNote.ts) teaches a short list of topics the
// learner got wrong. A chapter is different: it is 5 to 40 topics that have to be tied together.
// So this module reuses the same structure (TeachingNote, StructuredNote, TeachChat) and the same
// plain-language rules, but asks for a chapter-shaped plan.
//
// The forecast is NOT folded into this note. It is a ranked list with numbers and bars, and mixing
// it into prose would bury it. It is shown right after the lesson, on the same screen.
import { aiComplete, extractJson, getActiveProvider, getEffectiveModel } from './ai.ts';
import { toTeachingNote, type TeachingNote } from '../components/StructuredNote.tsx';
import type { ChapterTopic } from './pyqChapter.ts';

export interface ChapterTeachResult {
  note: TeachingNote;
  fromBooks: boolean;
  label: string;
  at: string;
}

/** New cache key: chapter notes are much larger than topic notes, so they are kept separately. */
const KEY = 'pulse.chapterTeachNotes.v1';
const MAX_NOTES = 40;

const keyFor = (subject: string, chapter: string): string => `${subject}::${chapter}`;
export const labelForChapter = (subject: string, chapter: string): string => `${chapter} (${subject})`;

type Stored = Record<string, ChapterTeachResult>;

function readAll(): Stored {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

export function getCachedChapterNote(subject: string, chapter: string): ChapterTeachResult | null {
  return readAll()[keyFor(subject, chapter)] ?? null;
}

function save(subject: string, chapter: string, result: ChapterTeachResult): void {
  try {
    const all = readAll();
    all[keyFor(subject, chapter)] = result;
    const entries = Object.entries(all)
      .sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at))
      .slice(0, MAX_NOTES);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage full or unavailable: the note still shows this session, it just will not persist.
  }
}

export function clearChapterNote(subject: string, chapter: string): void {
  try {
    const all = readAll();
    delete all[keyFor(subject, chapter)];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* nothing to clear */
  }
}

/** Up to two passages from the learner's own books, so the note can quote real text. */
async function bookPassages(query: string): Promise<{ title: string; text: string }[]> {
  try {
    const res = await fetch('/api/web/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, books: true }),
    });
    const data = await res.json().catch(() => ({}));
    const list = res.ok && Array.isArray(data.sources) ? data.sources : [];
    return list
      .filter((s: { kind?: string; text?: string }) => s?.kind === 'book' && s.text)
      .slice(0, 2);
  } catch {
    return [];
  }
}

// Same voice as the topic note: plain words, every medical word defined the first time, bold only
// on the fact to remember. Different shape: the chapter is the subject of every section, and the
// high-yield topics become their own sections inside it.
const CHAPTER_TEACH_SYSTEM = [
  'You are a kind teacher writing a chapter review for a medical exam learner (NEET-PG / INI-CET). The learner has never studied this chapter. TEACH the whole chapter, not a list of separate topics: the sections must build on each other and end with a clear picture of how the chapter fits together.',
  'Language: plain, everyday words, like talking to a friend. Short sentences (about 12 words). The first time any medical word, abbreviation, drug class, test or mechanism appears, explain it in a few plain words in brackets. Use a small real-life comparison when it helps. No jargon dumps.',
  'Structure, in this exact order:',
  '1) One section headed "What this chapter is about": 2 short paragraphs saying what the chapter covers and why it matters for patients and for the exam.',
  '2) One section per HIGH priority topic given to you below (at most 8), in the order given. Heading: "<Topic name>: what it is and why it matters". Inside: 2 to 4 short sentences that define it, then one "steps" or "text" block with the cause-and-effect chain ("this blocks that, so this happens").',
  '3) One section headed "How the exam asks these topics": for each topic that has an "asked as" note below, ONE short line starting with "- " followed by the topic name and how it is usually asked. Do not invent formats for topics with no note.',
  '4) One section headed "Traps and look-alikes": 2 to 4 "trap" blocks, each one sentence naming a specific mistake learners make (for example confusing two similar drugs or two similar tests).',
  'Marking: put **bold** on the 1 to 3 words or phrases per block that the learner must remember. Never bold a whole sentence.',
  'If a MY BOOKS block follows, take facts from it and keep them exact, and call the source "your book". You may add standard textbook facts; put a single dagger symbol at the END of a block that contains a fact not from the book. If the books have nothing for a topic, teach from standard textbooks and add no dagger at all. Never write a block that talks about the books themselves.',
  'Set "title" to "<Chapter name> — chapter review" and "takeaway" to ONE short sentence with the single idea that ties the chapter together.',
  'Set every section "page" to null. Never use a "figure" block.',
  'Write 3 selfCheck questions that test the WHY and the links between topics, not single facts. Each answer is one short sentence.',
  'Reply only with JSON: {"title":"...","takeaway":"...","sections":[{"heading":"...","page":null,"blocks":[{"type":"text","text":"..."},{"type":"steps","items":[{"title":"...","detail":"...","tag":"..."}]},{"type":"trap","text":"..."},{"type":"hook","text":"..."}]}],"selfCheck":[{"q":"...","a":"..."}]}.',
].join('\n');

function topicLines(topics: ChapterTopic[]): string {
  return topics
    .map((t) => {
      const meta = [`tier: ${t.tier}`, `asked in ${t.pyq} papers`, `predicted ${t.predicted}%`];
      const how = t.howAsked ? ` | asked as: ${t.howAsked}` : '';
      return `- ${t.topic} (${meta.join(', ')})${how}`;
    })
    .join('\n');
}

/**
 * Writes (or returns a cached) teaching note for one chapter.
 *
 * `topics` should be the chapter's topics, highest priority first — `teachableTopics()` in
 * pyqChapter.ts gives that order. Only the first 8 are turned into sections; the rest still feed
 * the "how the exam asks" line.
 */
export async function generateChapterTeachNote(
  input: { subject: string; chapter: string; topics: ChapterTopic[] },
  force = false,
): Promise<ChapterTeachResult> {
  const { subject, chapter, topics } = input;

  if (!force) {
    const cached = getCachedChapterNote(subject, chapter);
    if (cached) return cached;
  }

  const provider = getActiveProvider();
  if (!provider) {
    throw new Error('No AI provider is connected. Connect one in Settings → AI Subscription Hub.');
  }

  const ranked = [...topics].sort((a, b) => b.score - a.score || b.pyq - a.pyq || b.predicted - a.predicted);
  const passages = await bookPassages(`${subject} ${chapter}`.trim());
  const books = passages.map((p) => `${p.title}\n${p.text}`).join('\n\n');

  const content = [
    `Chapter to teach: "${chapter}"`,
    `Subject: ${subject}`,
    '',
    'Topics in this chapter, highest priority first (a HIGH priority topic means it has been asked often):',
    topicLines(ranked),
    books ? `\nMY BOOKS (the learner's own books):\n"""\n${books.slice(0, 9000)}\n"""` : '',
  ].join('\n');

  const raw = await aiComplete({
    system: CHAPTER_TEACH_SYSTEM,
    messages: [{ role: 'user', content }],
    json: true,
    purpose: 'chapter-teach',
    provider,
    model: getEffectiveModel(provider),
  });

  const note = toTeachingNote(extractJson(raw));
  if (!note) throw new Error('The AI did not return a usable chapter note. Try again.');

  const result: ChapterTeachResult = {
    note,
    fromBooks: Boolean(books),
    label: labelForChapter(subject, chapter),
    at: new Date().toISOString(),
  };
  save(subject, chapter, result);
  return result;
}
