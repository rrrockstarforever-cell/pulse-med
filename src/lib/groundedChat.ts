import { aiComplete, getActiveProvider, getEffectiveModel, NOT_CONNECTED_MESSAGE } from './ai';

export type GroundMode = 'both' | 'books' | 'web';

/**
 * What the source lookup actually did. The assistant is told this, and says it to the student,
 * so a failed internet check can never be presented as a check that was made.
 *   found        — the internet search returned usable sources
 *   empty        — the search ran, the internet answered, nothing matched
 *   unavailable  — the internet could not be reached and no source came back at all
 *   books-only   — the internet could not be reached (or books were chosen), but book passages exist
 */
export type SearchOutcome = 'found' | 'empty' | 'unavailable' | 'books-only';

export interface Source {
  n: number;
  title: string;
  url: string;
  text: string;
  kind: 'book' | 'web';
}

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: Source[];
  mode?: GroundMode;
  grounded?: boolean;
  /** What the search actually did, so the chip can say "offline" instead of pretending. */
  searchOutcome?: SearchOutcome;
  error?: boolean;
}

interface RawSource {
  title?: string;
  url?: string;
  text?: string;
  kind?: string;
}

interface ResearchResponse {
  success?: boolean;
  sources?: RawSource[];
  /** 'ok' | 'empty' | 'unavailable' | 'local' — the server's own report of the search. */
  search?: string;
  searchDetail?: string;
}

interface LookupResult {
  sources: RawSource[];
  /** The server's own verdict: 'ok' | 'no-results' | 'no-connection' | 'local' | 'empty' | 'unavailable'. */
  search: string;
}

const UNREACHABLE = new Set(['no-connection', 'unavailable']);

/** "My books" is the one mode where the internet is deliberately never used. */
export function bookOrWebMode(mode: GroundMode): boolean {
  return mode === 'books';
}

/**
 * Turns the two lookup verdicts into one honest outcome. Kept pure and exported so it can be
 * tested directly: a book passage found on this device is never proof that the internet was checked.
 */
export function decideOutcome(booksMode: boolean, webSearch: string, sourceCount: number): SearchOutcome {
  if (booksMode) return sourceCount > 0 ? 'books-only' : 'empty';
  if (UNREACHABLE.has(webSearch)) return sourceCount > 0 ? 'books-only' : 'unavailable';
  return sourceCount > 0 ? 'found' : 'empty';
}

/**
 * What to tell the assistant about the search, naming each side separately.
 * "The internet returned 4 sources" must never be said when those four came off the local disk.
 */
export function describeSearch(
  mode: GroundMode,
  webSearch: string,
  bookCount: number,
  webCount: number,
): string {
  const web =
    mode === 'books'
      ? 'The internet was not searched, because the student chose "My books" only.'
      : UNREACHABLE.has(webSearch)
        ? 'The internet search could not run: the device could not reach the internet (no connection, a firewall, or a timeout). No web page was checked.'
        : webCount > 0
          ? `The internet search returned ${webCount} usable web source${webCount === 1 ? '' : 's'}.`
          : 'The internet search ran and reached the internet, but matched nothing usable for these words.';
  const books =
    mode === 'books' || bookCount > 0
      ? bookCount > 0
        ? `${bookCount} passage${bookCount === 1 ? '' : 's'} from the student's own books were found on this device.`
        : "The student's own books were searched and nothing matched."
      : '';
  return [web, books].filter(Boolean).join(' ');
}

const STORAGE_PREFIX = 'pulse.planchat.v1.';
const MAX_TURNS = 40;
const MAX_SOURCE_TEXT = 1800;
const MAX_QUERY = 220;

function makeId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function storageKey(bankId: string): string {
  return `${STORAGE_PREFIX}${bankId}`;
}

function isChatTurn(value: unknown): value is ChatTurn {
  if (!value || typeof value !== 'object') return false;
  const turn = value as Partial<ChatTurn>;
  return (
    typeof turn.id === 'string' &&
    (turn.role === 'user' || turn.role === 'assistant') &&
    typeof turn.text === 'string'
  );
}

export function loadChat(bankId: string): ChatTurn[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(storageKey(bankId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChatTurn).slice(-MAX_TURNS);
  } catch {
    return [];
  }
}

export function saveChat(bankId: string, turns: ChatTurn[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey(bankId), JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch {
    // ignore
  }
}

export function clearChat(bankId: string): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(storageKey(bankId));
  } catch {
    // ignore
  }
}

/**
 * One lookup against the app's own search route.
 *
 * The search verdict is kept, not thrown away: a network error, a non-OK response or an unreadable
 * reply all mean the search never ran. Returning a bare empty array for all of them is what let the
 * assistant claim it had checked the internet when it had not.
 */
async function fetchResearchSources(query: string, books: boolean, signal?: AbortSignal): Promise<LookupResult> {
  try {
    const response = await fetch('/api/web/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(books ? { query, books: true, pageChars: 2500 } : { query, pageChars: 2500 }),
      signal,
    });
    if (!response.ok) return { sources: [], search: 'unavailable' };
    const data: ResearchResponse | null = await response.json().catch(() => null);
    if (!data || data.success !== true || !Array.isArray(data.sources)) return { sources: [], search: 'unavailable' };
    // The server names the outcome; the client reports it rather than guessing from the count.
    return { sources: data.sources, search: typeof data.search === 'string' ? data.search : 'ok' };
  } catch {
    // A real abort is handled by the caller; anything else is a dead connection.
    return { sources: [], search: 'unavailable' };
  }
}

function normalizeSources(raw: RawSource[], kind: 'book' | 'web', startAt: number): Source[] {
  const out: Source[] = [];
  for (const item of raw) {
    if (out.length >= 4) break;
    const title = (item.title ?? '').trim() || (kind === 'book' ? 'Book source' : 'Web source');
    const text = (item.text ?? '').trim().slice(0, MAX_SOURCE_TEXT);
    const url = (item.url ?? '').trim();
    out.push({
      n: startAt + out.length,
      title,
      url,
      text,
      kind,
    });
  }
  return out;
}

function errorTurn(text: string, mode?: GroundMode): ChatTurn {
  return {
    id: makeId(),
    role: 'assistant',
    text,
    mode,
    error: true,
  };
}

function formatHistory(history: ChatTurn[]): string {
  const recent = history.slice(-4);
  if (!recent.length) return 'No earlier turns.';
  return recent
    .map((turn) => `${turn.role === 'user' ? 'Student' : 'Tutor'}: ${turn.text}`)
    .join('\n');
}

function formatSources(sources: Source[]): string {
  if (!sources.length) return 'None found.';
  return sources
    .map((source) => `[${source.n}] (${source.kind === 'book' ? 'Book' : 'Web'}) ${source.title}\n${source.text}`)
    .join('\n\n');
}

export async function askGrounded(opts: {
  question: string;
  topic: string;
  context?: string;
  history: ChatTurn[];
  mode: GroundMode;
  signal?: AbortSignal;
}): Promise<ChatTurn> {
  const { question, topic, context, history, mode, signal } = opts;

  if (signal?.aborted) return errorTurn('Stopped.', mode);

  const query = `${topic} ${question}`.trim().slice(0, MAX_QUERY);
  let rawBooks: RawSource[] = [];
  let rawWeb: RawSource[] = [];
  // What each lookup reported. Kept apart from the sources, because a book passage found locally
  // must never be read as "the internet was checked".
  let bookSearch = 'local';
  let webSearch = 'ok';

  if (mode === 'both') {
    const [books, web] = await Promise.all([
      fetchResearchSources(query, true, signal),
      fetchResearchSources(query, false, signal),
    ]);
    rawBooks = books.sources;
    rawWeb = web.sources;
    bookSearch = books.search;
    webSearch = web.search;
  } else if (mode === 'books') {
    const books = await fetchResearchSources(query, true, signal);
    rawBooks = books.sources;
    bookSearch = books.search;
  } else {
    const web = await fetchResearchSources(query, false, signal);
    rawWeb = web.sources;
    webSearch = web.search;
  }

  if (signal?.aborted) return errorTurn('Stopped.', mode);

  const bookSources = normalizeSources(rawBooks, 'book', 1);
  const webSources = normalizeSources(rawWeb, 'web', bookSources.length + 1);
  const sources = [...bookSources, ...webSources];

  const outcome = decideOutcome(bookOrWebMode(mode), webSearch, sources.length);

  const searchReport = describeSearch(mode, webSearch, bookSources.length, webSources.length);
  const searchBlocker =
    outcome === 'unavailable'
      ? ' Say this plainly in your first sentence.'
      : outcome === 'books-only' && mode !== 'books'
        ? ' Do not present the book passages as an internet check.'
        : '';

  const provider = getActiveProvider();
  if (!provider) return errorTurn(NOT_CONNECTED_MESSAGE, mode);

  let model: string | undefined;
  try {
    model = getEffectiveModel(provider) ?? undefined;
  } catch {
    model = undefined;
  }

  const hasContext = Boolean(context && context.trim());
  const system = [
    'You are a careful NEET-PG and INI-CET tutor sitting beside a study note the student is reading.',
    'The app runs a source search for every question before you answer, and it reports the real outcome below. You have no search tool of your own: what the app found is all there is.',
    'Never say you searched, browsed or "checked the internet" unless the report says a search ran. Never say you cannot search either — say what the report says happened. If no search could run, still give a short, useful answer from your own knowledge, clearly labelled as such.',
    'Use ONLY the numbered sources for every factual claim, and cite them like [1] or [2] right after the claim.',
    'If the numbered sources do not contain the answer, say "The search did not return a direct source for this." in your first sentence, then give at most a short answer clearly labelled "From general knowledge (not verified):".',
    'Never invent numbers, doses, criteria, or page numbers.',
    'If sources disagree, say so.',
    'Use simple words.',
    'Format the answer in markdown so it is easy to scan, and keep it under 220 words unless the student asks for more. Start with ONE bold line like "**Answer: ...**" that gives the direct answer. Then use short sections with "## " headings (for example "## Key points", "## Why", "## Exam trap") and "- " bullets, never long paragraphs. When comparing two or more things (drugs, diseases, stages, criteria) use a markdown table with a header row. When the answer is a process, a management pathway or a decision sequence, give it as a flow chart inside a fenced block that starts with a line ```flow and ends with ```, one step per line, and write a branch as "condition -> next step" and a decision question as "? question". End with a one-line pearl written as "> Pearl: ..." and, only if there is a common mistake, "> Trap: ...". Keep citations like [1] right after the claims. Do not use any other markdown (no images, no HTML).',
    'Say which source is a book and which is the internet when you use them.',
    `Source search result: ${searchReport}${searchBlocker}`,
  ].join(' ');

  const userMessage = [
    `Topic: ${topic}`,
    hasContext ? `Study note context:\n${context!.trim()}` : '',
    `Numbered sources:\n${formatSources(sources)}`,
    `Recent chat (last 4 turns):\n${formatHistory(history)}`,
    `Question: ${question}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const answer = await aiComplete({
      system,
      messages: [{ role: 'user', content: userMessage }],
      effort: 'medium',
      purpose: 'plan-chat',
      provider,
      model,
      signal,
    });

    return {
      id: makeId(),
      role: 'assistant',
      text: answer.trim() || 'I could not write an answer. Please try again.',
      sources,
      mode,
      grounded: sources.length > 0,
      searchOutcome: outcome,
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return errorTurn('Stopped.', mode);
    }
    return errorTurn('I could not get an answer just now. Please try again.', mode);
  }
}
