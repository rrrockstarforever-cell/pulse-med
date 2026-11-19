// Plan-scoped source lookup. One adapter is created per plan run, fixed to the
// student's chosen ground mode, then called once per missed question with the
// exact question detail. No imports; no React; no disease or drug hardcoding.

export type PlanSource = {
  n: number;
  title: string;
  url: string;
  text: string;
  kind: 'book' | 'web';
};

export type GroundMode = 'both' | 'books' | 'web';

interface RawResearchItem {
  title?: string;
  url?: string;
  text?: string;
  kind?: string;
}

interface ResearchResponse {
  success?: boolean;
  sources?: RawResearchItem[];
  search?: string;
  coversQuestion?: boolean;
  retrievedAt?: string;
  searchDetail?: string;
}

interface ResearchRequest {
  query: string;
  question: string;
  topic: string;
  subject: string;
}

type FetchOutcome =
  | {
      kind: 'ok';
      sources: RawResearchItem[];
      search: string;
      coversQuestion: boolean;
      retrievedAt?: string;
    }
  | { kind: 'http-failure' }
  | { kind: 'network-failure' };

const BOOK_URL_PREFIXES = ['book:', 'mybooks:', 'mylib:', 'file:', 'internal:'];
const MAX_SOURCES_PER_CALL = 4;
const MAX_QUERY_CHARS = 400;
const FETCH_TIMEOUT_MS = 10_000;

function isKnownBookScheme(protocol: string): boolean {
  return BOOK_URL_PREFIXES.includes(protocol.toLowerCase());
}

function decideSourceKind(url: string, rawKind?: string): 'book' | 'web' | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (isKnownBookScheme(protocol)) return 'book';
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  if (rawKind === 'book') return 'book';
  return 'web';
}

function normalizeSources(raw: RawResearchItem[], requestedKind?: 'book' | 'web'): PlanSource[] {
  const out: PlanSource[] = [];
  for (const item of raw) {
    if (out.length >= MAX_SOURCES_PER_CALL) break;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) continue;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const kind = decideSourceKind(url, item.kind);
    if (!kind) continue;
    if (requestedKind && kind !== requestedKind) continue;
    const title =
      (typeof item.title === 'string' ? item.title.trim() : '') ||
      (kind === 'book' ? 'Book source' : 'Web source');
    out.push({ n: out.length + 1, title, url, text, kind });
  }
  return out;
}

export function selectMerged(books: PlanSource[], web: PlanSource[], max = 4): PlanSource[] {
  const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  if (cap === 0) return [];

  const bookList = books.filter((source) => source.kind === 'book');
  const webList = web.filter((source) => source.kind === 'web');

  if (cap === 1) {
    const only = bookList[0] ?? webList[0];
    return only ? [{ ...only, n: 1 }] : [];
  }

  let selected: PlanSource[];
  if (bookList.length > 0 && webList.length > 0) {
    const selectedBooks = bookList.slice(0, Math.min(bookList.length, cap - 1));
    const remaining = cap - selectedBooks.length;
    selected = [...selectedBooks, ...webList.slice(0, remaining)];
  } else {
    selected = [...bookList, ...webList].slice(0, cap);
  }

  return selected.slice(0, cap).map((source, index) => ({ ...source, n: index + 1 }));
}

async function postResearch(request: ResearchRequest, books: boolean): Promise<FetchOutcome> {
  try {
    const response = await fetch('/api/web/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        query: request.query,
        question: request.question,
        topic: request.topic,
        subject: request.subject,
        // The books flag follows the mode that built this adapter; q.books is
        // never allowed to override the student's selected ground mode.
        books,
        pageChars: 6000,
      }),
    });
    if (!response.ok) return { kind: 'http-failure' };
    let data: ResearchResponse | null = null;
    try {
      data = (await response.json()) as ResearchResponse | null;
    } catch {
      return { kind: 'network-failure' };
    }
    if (!data || data.success !== true || !Array.isArray(data.sources)) {
      return { kind: 'network-failure' };
    }
    return {
      kind: 'ok',
      sources: data.sources,
      search: typeof data.search === 'string' ? data.search : 'ok',
      coversQuestion: data.coversQuestion === true,
      retrievedAt: typeof data.retrievedAt === 'string' ? data.retrievedAt : undefined,
    };
  } catch {
    return { kind: 'network-failure' };
  }
}

export function researchForPlan(mode: GroundMode): (q: {
  question: string;
  topic: string;
  subject: string;
  books: boolean;
}) => Promise<{
  sources: PlanSource[];
  search: string;
  coversQuestion?: boolean;
  retrievedAt?: string;
}> {
  return async (q) => {
    const query = `${q.question} ${q.topic}`.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_CHARS);
    const request: ResearchRequest = {
      query,
      question: q.question,
      topic: q.topic,
      subject: q.subject,
    };

    if (mode === 'books') {
      const outcome = await postResearch(request, true);
      if (outcome.kind === 'network-failure') {
        return { sources: [], search: 'unavailable', coversQuestion: false };
      }
      if (outcome.kind === 'http-failure') {
        return { sources: [], search: 'unavailable' };
      }
      const sources = normalizeSources(outcome.sources, 'book');
      if (sources.length > 0) {
        return {
          sources,
          search: 'local',
          coversQuestion: false,
          retrievedAt: outcome.retrievedAt,
        };
      }
      return {
        sources,
        search: outcome.search,
        coversQuestion: false,
        retrievedAt: outcome.retrievedAt,
      };
    }

    if (mode === 'web') {
      const outcome = await postResearch(request, false);
      if (outcome.kind === 'network-failure') {
        return { sources: [], search: 'unavailable', coversQuestion: false };
      }
      if (outcome.kind === 'http-failure') {
        return { sources: [], search: 'unavailable' };
      }
      const sources = normalizeSources(outcome.sources, 'web');
      return {
        sources,
        search: outcome.search,
        coversQuestion: outcome.coversQuestion,
        retrievedAt: outcome.retrievedAt,
      };
    }

    // mode === 'both': attempt BOTH lookups in parallel, merge books first,
    // then web, and renumber once across the trimmed list.
    const [booksOutcome, webOutcome] = await Promise.all([
      postResearch(request, true),
      postResearch(request, false),
    ]);
    const bookSources =
      booksOutcome.kind === 'ok' ? normalizeSources(booksOutcome.sources, 'book') : [];
    const webSources =
      webOutcome.kind === 'ok' ? normalizeSources(webOutcome.sources, 'web') : [];
    const merged = selectMerged(bookSources, webSources, MAX_SOURCES_PER_CALL);
    const webSearch = webOutcome.kind === 'ok' ? webOutcome.search : 'web unavailable';
    const booksSearch = booksOutcome.kind === 'ok' ? booksOutcome.search : 'books unavailable';
    const webCovers = webOutcome.kind === 'ok' ? webOutcome.coversQuestion : false;
    const booksRetrievedAt = booksOutcome.kind === 'ok' ? booksOutcome.retrievedAt : undefined;
    const webRetrievedAt = webOutcome.kind === 'ok' ? webOutcome.retrievedAt : undefined;
    const search =
      booksOutcome.kind === 'ok'
        ? webSearch
        : webOutcome.kind === 'ok'
          ? `books unavailable; ${webSearch}`
          : `${booksSearch}; ${webSearch}`;
    return {
      sources: merged,
      search,
      coversQuestion: webCovers === true,
      retrievedAt: webRetrievedAt ?? booksRetrievedAt,
    };
  };
}
