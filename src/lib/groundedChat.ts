import { aiComplete, getActiveProvider, getEffectiveModel, NOT_CONNECTED_MESSAGE } from './ai';

export type GroundMode = 'both' | 'books' | 'web';

export type SearchOutcome = 'found' | 'no-direct-source' | 'empty' | 'unavailable' | 'books-only';

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
  /** Whether the pages read actually share the asked words. */
  coversQuestion?: boolean;
}

interface LookupResult {
  sources: RawSource[];
  /** The server's own verdict: 'ok' | 'no-results' | 'no-connection' | 'local' | 'empty' | 'unavailable'. */
  search: string;
  /** True when the pages read actually share the asked words; false when only unrelated pages loaded. */
  coversQuestion?: boolean;
  /** The server's plain-language account of what it did. */
  detail?: string;
}

const UNREACHABLE = new Set(['no-connection', 'unavailable']);

/** "My books" is the one mode where the internet is deliberately never used. */
export function bookOrWebMode(mode: GroundMode): boolean {
  return mode === 'books';
}

export function decideOutcome(booksMode: boolean, webSearch: string, sourceCount: number): SearchOutcome {
  if (booksMode) return sourceCount > 0 ? 'books-only' : 'empty';
  if (UNREACHABLE.has(webSearch)) return sourceCount > 0 ? 'books-only' : 'unavailable';
  return sourceCount > 0 ? 'found' : 'empty';
}

/** Asks the outcome whether the internet really supported the answer, not just whether a page loaded. */
export function decideGroundedOutcome(
  mode: GroundMode,
  webSearch: string,
  bookCount: number,
  webCount: number,
  coversQuestion: boolean,
): SearchOutcome {
  if (mode === 'books') return bookCount > 0 ? 'books-only' : 'empty';
  if (UNREACHABLE.has(webSearch)) return bookCount > 0 ? 'books-only' : 'unavailable';
  if (webCount === 0) return bookCount > 0 ? 'books-only' : 'empty';
  // Pages loaded but none of them states the asked detail: that is not "checked against sources".
  if (!coversQuestion) return 'no-direct-source';
  return 'found';
}

export function reconcileSearchOutcome(outcome: SearchOutcome, answer: string): SearchOutcome {
  if (outcome !== 'found') return outcome;
  const admitsMissingEvidence =
    /\bsearch did not return a direct source\b/i.test(String(answer || '')) ||
    /\bfrom general knowledge\s*\(not verified\)\s*:/i.test(String(answer || ''));
  return admitsMissingEvidence ? 'no-direct-source' : outcome;
}

export function describeSearch(
  mode: GroundMode,
  webSearch: string,
  bookCount: number,
  webCount: number,
  coversQuestion = true,
): string {
  const web =
    mode === 'books'
      ? 'The internet was not searched, because the student chose "My books" only.'
      : UNREACHABLE.has(webSearch)
        ? 'The internet search could not run: the device could not reach the internet (no connection, a firewall, or a timeout). No web page was checked.'
        : webCount > 0
          ? coversQuestion
            ? `The internet search returned ${webCount} usable web source${webCount === 1 ? '' : 's'}.`
            : `The internet was reached and ${webCount} web page${webCount === 1 ? ' was' : 's were'} read, but none of the passages read states the detail asked for.`
          : 'The internet search ran and reached the internet, but matched nothing usable for these words.';
  const books =
    mode === 'books' || bookCount > 0
      ? bookCount > 0
        ? `${bookCount} passage${bookCount === 1 ? '' : 's'} from the student's own book${bookCount === 1 ? '' : 's'} ${bookCount === 1 ? 'was' : 'were'} found on this device.`
        : "The student's own books were searched and nothing matched."
      : '';
  return [web, books].filter(Boolean).join(' ');
}

const STORAGE_PREFIX = 'pulse.planchat.v1.';
const MAX_TURNS = 40;
// The server now sends the whole page. Do not cut it back to the opening paragraph:
// the treatment sentence can sit past the first 1800 characters.
const MAX_SOURCE_TEXT = 100_000;
// A search string still has a sane bound, but the student's own words are not cut away to make it:
// the whole question is sent separately and the server builds its own short variant from it.
const MAX_SEARCH_QUERY = 400;
// How many numbered sources of each kind reach the model, and how much of one web page. The old rule kept the first
// four of each kind in the order the server listed them, so an official page listed fifth was dropped while a
// 226-character stub listed second was kept.
const MAX_BOOK_SOURCES = 6;
const MAX_WEB_SOURCES = 8;
const MAX_WEB_TEXT = 8000;
const OFFICIAL_HOST_RE =
  /(who\.int|mohfw\.gov\.in|nhp\.gov\.in|dghs\.|icmr\.|cdc\.gov|nice\.org\.uk|nih\.gov|ncbi\.nlm|europepmc|doi\.org|cochrane|statpearls|msdmanuals|natboard|aiims|\.gov(\.|\/|$)|\.edu(\.|\/|$))/i;
const THIN_HOST_RE = /(scribd\.|quora\.|reddit\.|facebook\.|pinterest\.|slideshare\.|studocu\.|coursehero\.)/i;
const RANK_STOP = new Set(['what', 'which', 'when', 'where', 'does', 'with', 'from', 'that', 'this', 'have', 'about', 'give', 'explain', 'between', 'difference', 'treatment', 'following', 'regimen']);

/** Orders raw sources so the pages most likely to state the asked fact come first. Stable for equal scores. */
export function rankRawSources(raw: RawSource[], question: string): RawSource[] {
  const terms = Array.from(new Set((question.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []).filter((t) => !RANK_STOP.has(t))));
  const seen = new Set<string>();
  const scored: { item: RawSource; score: number; at: number }[] = [];
  raw.forEach((item, at) => {
    const url = String(item.url ?? '').trim();
    const key = url.replace(/[#?].*$/, '').toLowerCase();
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    const text = String(item.text ?? '');
    const lower = text.toLowerCase();
    const covered = terms.length ? terms.filter((t) => lower.includes(t)).length / terms.length : 0;
    let score = covered * 4;
    if (OFFICIAL_HOST_RE.test(url)) score += 2;
    if (THIN_HOST_RE.test(url)) score -= 2;
    if (text.length >= 1500) score += 1;
    if (text.length < 400) score -= 5;
    scored.push({ item, score, at });
  });
  return scored.sort((a, b) => b.score - a.score || a.at - b.at).map((s) => s.item);
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function normalizeSourceKind(
  item: { kind?: string; url?: string },
  defaultKind: 'book' | 'web',
): 'book' | 'web' {
  void defaultKind;
  const url = (item && item.url ? item.url : '').trim();
  const kind = (item && item.kind ? item.kind : '').trim().toLowerCase();
  if (/^(book|mybooks|mylib|file|internal):/i.test(url)) return 'book';
  if (/^https?:\/\//i.test(url)) return kind === 'book' ? 'book' : 'web';
  return 'web';
}

/**
 * A follow-up like "confirm this on the internet please" is meaningless on its own. When the
 * student's message reads like a follow-up (short, confirmation-style, no fresh subject matter)
 * and there is at least one earlier user turn, fold the most recent substantive user question back
 * in so search ranking and the model both see what the follow-up actually refers to.
 *
 * Purely lexical. No network. No disease- or drug-specific rules.
 */
const FOLLOW_UP_TRIGGER_RE =
  /^(confirm|verify|check|same|that|this|is that|is this|what about|explain\s+(this|that|it|its|the)\b|really\?)/i;
const GENERIC_CONFIRMATION_RE = /^(confirm|verify|check|same|really\?)/i;

// Words that carry no medical content. Everything else counts as a content term for the
// follow-up test: drug names, doses, disease names, mechanisms, etc. all stay content.
const NON_CONTENT_WORDS = new Set<string>([
  'confirm', 'verify', 'check', 'please', 'internet', 'online', 'really',
  'the', 'that', 'this', 'these', 'those', 'same', 'with', 'from', 'into', 'over', 'under', 'about',
  'what', 'when', 'where', 'which', 'who', 'why', 'how',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'done', 'can', 'could', 'should', 'would', 'will', 'may', 'might', 'must',
  'you', 'your', 'we', 'our', 'us', 'i', 'me', 'my', 'mine',
  'it', 'its', 'they', 'them', 'their', 'he', 'she', 'his', 'her',
  'a', 'an', 'of', 'to', 'in', 'on', 'at', 'by', 'or', 'but', 'not', 'no', 'yes',
  'if', 'so', 'then', 'than', 'as', 'also', 'and', 'more', 'less', 'again', 'still', 'just', 'only',
  'even', 'too', 'very', 'here', 'there', 'now',
  'tell', 'say', 'give', 'show', 'need', 'want', 'know', 'search', 'look', 'find', 'source', 'sources',
  'question', 'answer', 'quick', 'quickly', 'actually', 'first', 'second', 'third', 'last', 'next',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
]);

function countContentTerms(text: string): number {
  const tokens = String(text || '').toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [];
  let count = 0;
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (NON_CONTENT_WORDS.has(token)) continue;
    count += 1;
  }
  return count;
}

export function resolveFollowUpForChat(
  question: string,
  history: ChatTurn[],
): { effectiveQuestion: string; wasFollowUp: boolean } {
  const q = String(question ?? '').trim();
  if (!q) return { effectiveQuestion: question, wasFollowUp: false };
  if (!FOLLOW_UP_TRIGGER_RE.test(q)) return { effectiveQuestion: question, wasFollowUp: false };
  if (countContentTerms(q) > 2) return { effectiveQuestion: question, wasFollowUp: false };

  const turns = Array.isArray(history) ? history : [];
  const priorUsers = turns.filter(
    (turn) =>
      turn && turn.role === 'user' && typeof turn.text === 'string' && turn.text.trim().length > 0,
  );
  if (priorUsers.length === 0) return { effectiveQuestion: question, wasFollowUp: false };

  // Skip earlier generic confirmation requests; take the most recent substantive question.
  let prevQuestion = '';
  for (let i = priorUsers.length - 1; i >= 0; i -= 1) {
    const prevText = priorUsers[i].text.trim();
    const prevIsGenericConfirmation =
      GENERIC_CONFIRMATION_RE.test(prevText) && countContentTerms(prevText) <= 2;
    if (prevIsGenericConfirmation) continue;
    prevQuestion = prevText;
    break;
  }
  if (!prevQuestion) return { effectiveQuestion: question, wasFollowUp: false };

  const separator = ' — ';
  const tail = `${separator}${q}`;
  const budget = Math.max(0, 400 - tail.length);
  const head =
    prevQuestion.length <= budget ? prevQuestion : prevQuestion.slice(0, budget).trimEnd();
  const combined = (head ? `${head}${tail}` : q).trim();
  const effectiveQuestion = combined.length > 400 ? combined.slice(0, 400) : combined;
  return { effectiveQuestion, wasFollowUp: true };
}

export function buildSystemPrompt(opts: {
  searchReport: string;
  searchBlocker: string;
  hasContext: boolean;
}): string {
  const { searchReport, searchBlocker } = opts;
  // hasContext is accepted for signature stability; today no rule varies by it.
  void opts.hasContext;
  return [
    'You are a careful NEET-PG and INI-CET tutor sitting beside a study note the student is reading.',
    'The app runs a source search for every question before you answer, and it reports the real outcome below. You have no search tool of your own: what the app found is all there is.',
    'Never say you searched, browsed or "checked the internet" unless the report says a search ran. Never say you cannot search either — say what the report says happened. If no search could run, still give a short, useful answer from your own knowledge, clearly labelled as such.',
    'Use ONLY the numbered sources for every factual claim, and cite them like [1] or [2] right after the claim.',
    'Book passages are the student\'s own textbook notes; Web passages are internet pages. Build the answer on the Book passages first, in the book\'s wording and order, so the answer reads like the student\'s own book.',
    'Use Web passages only to fill points the Book passages do not state, and mark each web-added point, for example "From the internet:" with its source number.',
    'If a Web source and the Book disagree (for example the book gives an older regimen and a current WHO or national guideline gives another), do not silently pick one: show the Book\'s version, show the Web version, say which is more recent or official, and say which one to use for the exam in India if the sources say so.',
    'If the Book passages have nothing on the question, answer from the Web passages and say the book did not cover it.',
    'If the numbered sources do not contain the answer, say "The search did not return a direct source for this." in your first sentence, then give at most a short answer clearly labelled "From general knowledge (not verified):".',
    'Never invent numbers, doses, criteria, or page numbers.',
    'If sources disagree, say so.',
    'For drug regimens, doses, and durations, a current official guideline page (WHO, CDC, NLEP, MoHFW, DGHS, ICMR) is the more recent reference when it differs from an older book passage: show both, name the conflict, and say which is current. A drug missing from a short book excerpt is not evidence that the drug is left out. Do not invent a dose the sources do not state.',
    'Use simple words.',
    'Start with the direct answer in plain words, in ONE bold line like "**Answer: ...**". Then add only what the question needs: a short paragraph for a single fact, "- " bullets for several separate points, a markdown table only when the question asks to compare things, numbered steps only for a procedure, and a ```flow fenced block (one step per line, a branch written "condition -> next step", a decision written "? question") only when the path really branches. A one-fact answer should be one to three sentences and needs no headings.',
    'Keep it as short as it can be while answering every part of the question; go past about 220 words only if the student asks for a full note. A one-line pearl written as "> Pearl: ..." is welcome when there is a real exam point to remember; skip it otherwise. Do not use any other markdown (no images, no HTML).',
    'Say which source is a book and which is the internet when you use them.',
    "When two numbered sources give different regimens, doses, dates or jurisdiction rules, STATE the conflict plainly and say which one is current for the question's country and date. Never present an older complete textbook table as current guidance just because it is complete.",
    'A drug missing from a short book excerpt is not evidence that the drug is absent or excluded. Say the excerpt is incomplete instead of inferring an exclusion.',
    'Every causal "because …" clause, every dose, every age threshold and every universal claim ("all", "never", "always") needs support from a numbered source. If no source supports it, write "not stated in the sources" and stop.',
    'If the student\'s question is a beginner question ("in simple language", "for a first-year"), start with the plain mechanism and hold back advanced exceptions; do not open with a false either-or.',
    'For a genuine side-by-side comparison use a markdown table; otherwise do not use a table.',
    'A web page table is shown with one row per line and cells joined by " | ". Header rows may have fewer cells than data rows, and a merged cell such as a duration may appear only on the first row of a block, so it applies to every row below it in that block. A drug, dose or step listed in a table without a "not used" mark applies to every group column of that block: give it for each group, and say only what differs, such as the duration. Never drop a drug from one group unless the source clearly says it is not used there.',
    `Source search result: ${searchReport}${searchBlocker}`,
  ].join(' ');
}

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

async function fetchResearchSources(
  request: { query: string; question: string; topic: string; subject: string },
  books: boolean,
  signal?: AbortSignal,
): Promise<LookupResult> {
  try {
    const response = await fetch('/api/web/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The whole question, the topic and the subject travel beside the short search string,
      // so the server can rank pages by the fact that was asked for.
      body: JSON.stringify({ ...request, books: books || undefined, pageChars: 6000 }),
      signal,
    });
    if (!response.ok) return { sources: [], search: 'unavailable' };
    const data: ResearchResponse | null = await response.json().catch(() => null);
    if (!data || data.success !== true || !Array.isArray(data.sources)) return { sources: [], search: 'unavailable' };
    // The server names the outcome; the client reports it rather than guessing from the count.
    return {
      sources: data.sources,
      search: typeof data.search === 'string' ? data.search : 'ok',
      coversQuestion: data.coversQuestion === true,
      detail: typeof data.searchDetail === 'string' ? data.searchDetail : '',
    };
  } catch {
    // A real abort is handled by the caller; anything else is a dead connection.
    return { sources: [], search: 'unavailable' };
  }
}

function questionWindow(text: string, question: string, limit: number): string {
  if (text.length <= limit) return text;
  const terms = Array.from(
    new Set((question.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((term) => term.length >= 3)),
  );
  const lower = text.toLowerCase();
  const hits: number[] = [];
  for (const term of terms) {
    let at = lower.indexOf(term);
    while (at !== -1 && hits.length < 50) {
      hits.push(at);
      at = lower.indexOf(term, at + 1);
    }
  }
  if (hits.length === 0) {
    const start = Math.max(0, Math.floor((text.length - limit) / 2));
    return text.slice(start, start + limit);
  }
  hits.sort((a, b) => a - b);
  const first = hits[0];
  const last = hits[hits.length - 1];
  const span = last - first + 1;
  const start = span <= limit
    ? first - Math.floor((limit - span) / 2)
    : first - Math.floor(limit / 2);
  const clampedStart = Math.max(0, Math.min(start, text.length - limit));
  return text.slice(clampedStart, clampedStart + limit);
}

function isSafeWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(String(url || '').trim());
}

export function normalizeSources(
  raw: RawSource[],
  kind: 'book' | 'web',
  startAt: number,
  question = '',
  max = 4,
): Source[] {
  const out: Source[] = [];
  for (const item of raw) {
    if (out.length >= max) break;
    const url = (item.url ?? '').trim();
    const sourceKind = normalizeSourceKind(item, kind);
    if (sourceKind === 'web' && !isSafeWebUrl(url)) continue;
    if (kind === 'web' && sourceKind === 'book') continue;
    const title =
      (item.title ?? '').trim() || (sourceKind === 'book' ? 'Book source' : 'Web source');
    const fullText = (item.text ?? '').trim();
    // A web page is cut to a window around the asked words; a book passage is already one section.
    const limit = sourceKind === 'web' ? MAX_WEB_TEXT : MAX_SOURCE_TEXT;
    const truncated = fullText.length > limit;
    const text = truncated
      ? `${questionWindow(fullText, question, limit - 40)}\n…[text truncated]`
      : fullText;
    out.push({
      n: startAt + out.length,
      title,
      url,
      text,
      kind: sourceKind,
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
    .map((source) => {
      const where = source.kind === 'book' ? 'Book' : `Web, ${sourceDomain(source.url) || 'unknown site'}`;
      return `[${source.n}] (${where}) ${source.title}\n${source.text}`;
    })
    .join('\n\n');
}

export async function askGrounded(opts: {
  question: string;
  topic: string;
  /** The NEET-PG subject, when the screen knows it. Steers the book search and the journal list. */
  subject?: string;
  context?: string;
  history: ChatTurn[];
  mode: GroundMode;
  signal?: AbortSignal;
}): Promise<ChatTurn> {
  const { question, topic, subject = '', context, history, mode, signal } = opts;

  if (signal?.aborted) return errorTurn('Stopped.', mode);

  // Resolve a follow-up like "confirm this on the internet please" against the most recent
  // substantive user question. The effective question goes to the server for ranking; the
  // short original question still keeps its search hint in `query`.
  const resolved = resolveFollowUpForChat(question, history);
  const request = {
    question: resolved.effectiveQuestion,
    topic: resolved.wasFollowUp ? '' : topic,
    subject,
    query: `${question} ${topic}`.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_QUERY),
  };

  let rawBooks: RawSource[] = [];
  let rawWeb: RawSource[] = [];
  // What each lookup reported. Kept apart from the sources, because a book passage found locally
  // must never be read as "the internet was checked".
  let bookSearch = 'local';
  let webSearch = 'ok';
  let coversQuestion = false;

  if (mode === 'both') {
    const [books, web] = await Promise.all([
      fetchResearchSources(request, true, signal),
      fetchResearchSources(request, false, signal),
    ]);
    rawBooks = books.sources;
    rawWeb = web.sources;
    bookSearch = books.search;
    webSearch = web.search;
    coversQuestion = web.coversQuestion === true;
  } else if (mode === 'books') {
    const books = await fetchResearchSources(request, true, signal);
    rawBooks = books.sources;
    bookSearch = books.search;
  } else {
    const web = await fetchResearchSources(request, false, signal);
    rawWeb = web.sources;
    webSearch = web.search;
    coversQuestion = web.coversQuestion === true;
  }

  if (signal?.aborted) return errorTurn('Stopped.', mode);

  const rankQuestion = resolved.effectiveQuestion || question;
  const bookSources = normalizeSources(rawBooks, 'book', 1, rankQuestion, MAX_BOOK_SOURCES);
  const webSources = normalizeSources(rankRawSources(rawWeb, rankQuestion), 'web', bookSources.length + 1, rankQuestion, MAX_WEB_SOURCES);
  const sources = [...bookSources, ...webSources];

  const outcome = decideGroundedOutcome(mode, webSearch, bookSources.length, webSources.length, coversQuestion);

  const searchReport = describeSearch(mode, webSearch, bookSources.length, webSources.length, coversQuestion);
  const searchBlocker =
    outcome === 'unavailable'
      ? ' Say this plainly in your first sentence.'
      : outcome === 'no-direct-source'
        ? ' Say plainly that the internet was reached but the passages read do not state this detail.'
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
  const system = buildSystemPrompt({ searchReport, searchBlocker, hasContext });

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
    const rawAnswer = await aiComplete({
      system,
      messages: [{ role: 'user', content: userMessage }],
      effort: 'medium',
      purpose: 'plan-chat',
      provider,
      model,
      signal,
    });
    const answerText = rawAnswer.trim() || 'I could not write an answer. Please try again.';
    const finalOutcome = reconcileSearchOutcome(outcome, answerText);

    return {
      id: makeId(),
      role: 'assistant',
      text: answerText,
      sources,
      mode,
      grounded: finalOutcome === 'found',
      searchOutcome: finalOutcome,
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return errorTurn('Stopped.', mode);
    }
    return errorTurn('I could not get an answer just now. Please try again.', mode);
  }
}
