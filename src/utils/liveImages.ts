import { debugLog } from './debugLog.ts';
import { getActiveProvider, getEffectiveModel } from '../lib/ai.ts';
// Live clinical-image lookup for image-based questions.
// The local server queries Open-i (NLM) and Wikimedia Commons and returns only
// explicit CC0/Public Domain licences, proxied through /api/images/proxy so the
// page never hotlinks NLM and the picture still works offline after the first fetch.

export interface LiveImage {
  id: string;
  provider: string;
  title: string;
  caption: string;
  credit: string;
  licence: string;
  licenceUrl: string;
  articleUrl: string;
  modality: string;
  imageUrl: string;
  proxyUrl: string;
  thumbUrl: string;
  /** Vision verdict for this image against the question's claim (set on the found image). */
  verified?: boolean;
  verifyReason?: string;
}

const LIVE_KEY = 'pulse.images.live';

/** Words that name no particular condition, so a caption containing them says nothing about a match. */
const GENERIC_TOPIC_WORDS = new Set(['disease', 'diseases', 'syndrome', 'change', 'changes', 'injury', 'injuries', 'lesion', 'lesions', 'finding', 'findings', 'with', 'from', 'case', 'sign', 'signs', 'acute', 'chronic', 'severe', 'image', 'picture', 'common', 'typical', 'photo', 'photograph', 'clinical', 'skin', 'facial', 'plaques', 'plaque', 'patch', 'patches', 'appearance', 'showing', 'stain', 'stained', 'microscopy']);

// Session cache: image search is slow (Commons + Open-i), so the same query is only
// ever fetched once per page load.
const rowsCache = new Map<string, LiveImage[]>();

// Session cache of vision verdicts, keyed by image id + the claim it was checked
// against. Verification is a vision call (seconds), and the same candidate can be
// reconsidered across batches, so a verdict is only ever computed once per claim.
const verdictCache = new Map<string, { pass: boolean; reason: string }>();

export interface ImageVerdict {
  pass: boolean;
  reason: string;
  /** The caller's check budget is used up: the search stops. */
  stop?: boolean;
}

/**
 * Look at the actual image and decide whether it shows the claimed finding.
 * Fail-closed: any network/parse error or a missing vision provider returns pass:false,
 * so an unverified picture is never attached — the question falls back to text-only.
 */
async function verifyImageMatches(image: LiveImage, claim: string, timeoutMs = 45000): Promise<ImageVerdict> {
  const key = `${image.id}::${claim.toLowerCase().slice(0, 160)}`;
  const cached = verdictCache.get(key);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const provider = getActiveProvider();
    const model = provider ? getEffectiveModel(provider) : undefined;
    const res = await fetch('/api/images/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: image.imageUrl,
        claim,
        modality: image.modality || '',
        ...(provider ? { provider, model } : {}),
      }),
      signal: controller.signal,
    });
    const body: any = await res.json().catch(() => ({}));
    const verdict: ImageVerdict = {
      pass: body?.pass === true,
      reason: typeof body?.reason === 'string' ? body.reason : res.ok ? 'Not confirmed.' : `HTTP ${res.status}`,
    };
    verdictCache.set(key, verdict);
    return verdict;
  } catch (e: any) {
    const verdict: ImageVerdict = { pass: false, reason: e?.name === 'AbortError' ? 'Vision check timed out.' : (e?.message || 'Vision check failed.') };
    // Do not cache transport failures — a transient outage should not blacklist an image.
    return verdict;
  } finally {
    clearTimeout(timer);
  }
}

/** The question a picture is meant for. The picture is checked against it, not only against the search words. */
export interface PictureQuestion {
  id?: string;
  stem?: string;
  questionText?: string;
  options: { id: string; text: string }[];
  correctOption: string;
  explanation?: string;
  boardPearl?: string;
  figureQuery?: string;
  figureModality?: string;
}

/** Looks at the picture with the written question beside it: right kind of picture, shows what the answer depends on. */
async function verifyImageForQuestion(image: LiveImage, q: PictureQuestion, timeoutMs = 60000): Promise<ImageVerdict> {
  const key = `${image.id}::q::${q.id ?? ''}::${(q.questionText ?? '').slice(0, 80)}`;
  const cached = verdictCache.get(key);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const provider = getActiveProvider();
    const model = provider ? getEffectiveModel(provider) : undefined;
    const res = await fetch('/api/images/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageUrl: image.imageUrl,
        claim: q.figureQuery || q.questionText || 'picture for the question',
        modality: q.figureModality || image.modality || '',
        questionStem: q.stem ?? '',
        questionText: q.questionText ?? '',
        correctAnswer: q.options.find((o) => o.id === q.correctOption)?.text ?? '',
        explanation: (q.explanation ?? '').slice(0, 1500),
        boardPearl: q.boardPearl ?? '',
        attached: true,
        ...(provider ? { provider, model } : {}),
      }),
      signal: controller.signal,
    });
    const body: any = await res.json().catch(() => ({}));
    const verdict: ImageVerdict = {
      pass: body?.pass === true,
      reason: typeof body?.reason === 'string' ? body.reason : res.ok ? 'Not confirmed.' : `HTTP ${res.status}`,
    };
    verdictCache.set(key, verdict);
    return verdict;
  } catch (e: any) {
    return { pass: false, reason: e?.name === 'AbortError' ? 'Vision check timed out.' : (e?.message || 'Vision check failed.') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A picture for one written question. The first search uses the question's own picture words and checks each candidate
 * against the written question. If none passes, ONE second search runs with different words (the answer plus the
 * picture type) and its candidates are checked the same way. No picture after that means the caller drops the question.
 */
/** Starts a picture search without waiting for it, so the server holds the rows when the real search asks for them. */
export function warmPictureSearch(query: string): void {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q || !isLiveImageSearchEnabled()) return;
  void fetch(`/api/images/search?q=${encodeURIComponent(q)}`).catch(() => undefined);
}

// Picture words whose search found nothing that fits a question. Several questions on one disease ask for the same
// picture words, so the search runs once, not once per question (it cost about 40 s each time). Kept for 20 minutes.
const failedPictureQueries = new Map<string, number>();
const FAILED_TTL_MS = 20 * 60 * 1000;
const failedKey = (query: string) => query.toLowerCase().replace(/\s+/g, ' ').trim();

export async function findPictureForQuestion(q: PictureQuestion, exclude: Set<string>): Promise<LiveImage | null> {
  const first = (q.figureQuery ?? '').trim();
  if (!first) return null;
  const failedAt = failedPictureQueries.get(failedKey(first));
  if (failedAt && Date.now() - failedAt < FAILED_TTL_MS) return null;
  const answer = (q.options.find((o) => o.id === q.correctOption)?.text ?? '').replace(/\s+/g, ' ').trim();
  const second = `${answer} ${q.figureModality ?? ''}`.replace(/\s+/g, ' ').trim();
  const tried = new Set(exclude);
  // Two picture checks at most: the first picture, and one second picture if the first one is doubtful.
  let checks = 0;
  const check = async (image: LiveImage): Promise<ImageVerdict> => {
    if (checks >= 2) return { pass: false, reason: 'Check budget used.', stop: true };
    checks += 1;
    return verifyImageForQuestion(image, q);
  };
  const searches = [first, ...(second && second.toLowerCase() !== first.toLowerCase() ? [second] : [])].slice(0, 2);
  // The second search is warmed while the first picture is being checked, so a doubtful first picture does not wait for it.
  if (searches[1]) warmPictureSearch(searches[1]);
  for (const query of searches) {
    const found = await findLiveImage(query, tried, 12000, check);
    if (found) return found;
    if (checks >= 2) break;
  }
  // Only a search that really looked and found nothing is remembered (not one that was cut short by an error).
  failedPictureQueries.set(failedKey(first), Date.now());
  return null;
}

export function isLiveImageSearchEnabled(): boolean {
  try {
    const raw = localStorage.getItem(LIVE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function setLiveImageSearchEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LIVE_KEY, enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * Best **unused** reusable figure for a query, or null (never throws — generation must
 * not fail). Pass the ids of images already used in this run so a module never repeats one.
 */
export async function findLiveImage(
  query: string,
  exclude?: Set<string>,
  timeoutMs = 12000,
  /** Replaces the search-word check: used to check each candidate against the written question. */
  check?: (image: LiveImage, query: string) => Promise<ImageVerdict>,
): Promise<LiveImage | null> {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q || !isLiveImageSearchEnabled()) return null;

  // Build a list of progressively simpler queries to try. Long, highly-specific
  // phrases (e.g. "acute angle closure mid-dilated pupil hazy cornea") almost
  // never match anything in Open-i / Commons, so we fall back to shorter
  // variants that name the modality + the core finding.
  const variants: string[] = [q];
  const words = q.split(/\s+/);
  // The diagnosis comes first and the modality last ("caseous necrosis granuloma histology"). Commons needs every word
  // to match, so the diagnosis alone (without the modality word and then with fewer words) finds far more pictures.
  const MODALITY_WORD = /^(histology|histological|histopathology|biopsy|micrograph|ecg|ekg|x-ray|xray|radiograph|ct|mri|ultrasound|smear|fundus|photo|photograph|clinical|image|picture)$/i;
  const core = words.filter((w) => !MODALITY_WORD.test(w));
  if (core.length && core.length < words.length) variants.push(core.join(' '));
  // Captions often say "radiograph" or "chest film" instead of "X-ray", so each plain-name variant is also tried with those words.
  if (core.length && core.length <= 3 && words.some((w) => /^(x-?ray|xray)$/i.test(w))) variants.push(`${core.join(' ')} radiograph`);
  if (core.length && core.length <= 3 && words.some((w) => /^(histology|histological|histopathology|micrograph)$/i.test(w))) variants.push(`${core.join(' ')} biopsy`, `${core.join(' ')} micrograph`);
  if (core.length > 3) variants.push(core.slice(0, 3).join(' '));
  if (core.length > 2) variants.push(core.slice(0, 2).join(' '));
  if (words.length > 4) {
    // Last 3-4 words usually carry the modality + key finding.
    variants.push(words.slice(-4).join(' '));
    variants.push(words.slice(-3).join(' '));
    variants.push(words.slice(-2).join(' '));
  }
  if (words.length > 2) {
    // Drop leading adjective-heavy words.
    variants.push(words.slice(1).join(' '));
  }
  // Dedupe while preserving order.
  const seen = new Set<string>();
  const tries = variants.filter((v) => {
    const k = v.toLowerCase().trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // The picture sources are slow when several searches run at once (7-10 s each), so the search gets 20 s in all.
  const deadline = Date.now() + Math.max(timeoutMs, 20000);
  // One budget of vision checks for the whole picture search, across all query variants: a question never
  // costs more than this many vision calls, however many variants were tried.
  const MAX_VISION_CHECKS_PER_QUESTION = 4;
  let visionChecks = 0;
  for (const tryQ of tries) {
    const remaining = deadline - Date.now();
    if (remaining < 2500) break;
    debugLog('H8', `trying query: "${tryQ}" (${Math.round(remaining / 1000)}s left)`);
    const controller = new AbortController();
    // Each variant gets its own budget: a cold search (Commons + Open-i + licence
    // check) can take 5–15 s, so a short per-variant timeout made every attempt abort.
    const timer = setTimeout(() => controller.abort(), Math.min(15000, remaining));
    try {
      const cacheKey = tryQ.toLowerCase();
      let rows: LiveImage[] = rowsCache.get(cacheKey) ?? [];
      if (!rowsCache.has(cacheKey)) {
        const res = await fetch(`/api/images/search?q=${encodeURIComponent(tryQ)}`, { signal: controller.signal });
        debugLog('H8', `query "${tryQ}" -> status ${res.status}`);
        if (!res.ok) continue;
        const body: any = await res.json().catch(() => ({}));
        rows = Array.isArray(body?.results) ? body.results : [];
        rowsCache.set(cacheKey, rows);
      } else {
        debugLog('H8', `query "${tryQ}" -> cache hit (${rows.length} rows)`);
      }
      debugLog('H8', `query "${tryQ}" -> ${rows.length} results`);
      const expanded = tryQ.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3 || ['ecg', 'ct', 'mri', 'xray'].includes(t));
      const MODALITY_ALIASES: Record<string, string[]> = {
        ecg: ['ecg', 'ekg', 'electrocardiogram', 'electrocardiography'],
 'x-ray': ['x-ray', 'xray', 'radiograph', 'chest film'],
        xray: ['x-ray', 'xray', 'radiograph'],
        ct: ['ct', 'computed tomography'],
        mri: ['mri', 'magnetic resonance'],
        ultrasound: ['ultrasound', 'sonograph', 'echograph'],
        histology: ['histology', 'histological', 'biopsy', 'micrograph'],
        fundus: ['fundus', 'fundal', 'retina'],
      };
      const expandedTokens = expanded.flatMap((t) => [t, ...(MODALITY_ALIASES[t] ?? [])]);
      const modalityTokens = expandedTokens.filter((t) =>
        ['ecg', 'ekg', 'electrocardiogram', 'electrocardiography', 'x-ray', 'xray',
 'radiograph', 'ct', 'mri', 'ultrasound', 'histology', 'fundus', 'retina'].includes(t),
      );
      const relevant = (row: LiveImage) => {
        const hay = `${row.title} ${row.caption}`.toLowerCase();
        const matches = (t: string) =>
          t.length <= 3 ? new RegExp(`\\b${t}\\b`, 'i').test(hay) : hay.includes(t);
        // Topic tokens are the non-modality words of the query.
        const topicTokens = expandedTokens.filter((t) => !modalityTokens.includes(t));
        // Words like "disease" or "change" appear in any caption, so they do not count towards a match. Most of the
        // remaining words must be in the figure's own text ("minimal change disease" must not match a brain slide
        // that only says "histopathologic changes").
        const distinctive = topicTokens.filter((t) => !GENERIC_TOPIC_WORDS.has(t));
        const needed = distinctive.length <= 1 ? distinctive.length : Math.ceil(distinctive.length * 0.6);
        const topicOk = topicTokens.length === 0 || (distinctive.length ? distinctive.filter(matches).length >= needed : topicTokens.some(matches));
        // Most of the condition words must be in the figure's own text. The modality ("histology", "x-ray") is often
        // missing from a Commons title ("Leprosy - Lepromatous (LL) 4x.jpg"), and a condition rarely has every query
        // word ("skin plaques"), so neither is required here: the vision check that follows looks at the picture
        // itself and rejects the wrong modality or the wrong finding.
        return topicOk && (topicTokens.length > 0 || modalityTokens.some(matches));
      };
      const unused = rows.filter((row) =>
        typeof row?.proxyUrl === 'string' &&
        !(exclude?.has(row.id) || exclude?.has(row.imageUrl) || exclude?.has(row.proxyUrl)),
      );
      debugLog('H8', `query "${tryQ}" -> unused=${unused.length} expandedTokens=${expandedTokens.join(',')}`);
      // Only accept a figure whose own text names the finding — never fall back to an
      // unrelated picture just to have one. "Verified images" means relevant images.
      // Metadata match is only a PRE-FILTER: a wrong picture can still share the words
      // (a tangerine captioned "cornea"). Every surviving candidate is then checked
      // against the actual pixels by the vision verifier before it may be returned.
      const candidates = unused.filter(relevant);
      // Each verification is a vision call, so cap how many candidates we are willing
      // to check per query variant — a topic with many metadata-close-but-wrong rows
      // must not stall the whole generation.
      for (const candidate of candidates) {
        if (visionChecks >= MAX_VISION_CHECKS_PER_QUESTION) break;
        visionChecks += 1;
        const verdict = check ? await check(candidate, tryQ) : await verifyImageMatches(candidate, tryQ);
        if (verdict.stop) return null;
        // A candidate the question check turned down is not offered again in the second search.
        if (!verdict.pass && check) exclude?.add(candidate.id);
        if (verdict.pass) {
          debugLog('H8', `query "${tryQ}" -> VERIFIED ${candidate.id} ${candidate.title} — ${verdict.reason}`);
          return { ...candidate, verified: true, verifyReason: verdict.reason };
        }
        debugLog('H8', `query "${tryQ}" -> rejected ${candidate.id} ${candidate.title} — ${verdict.reason}`);
      }
      if (candidates.length === 0) {
        debugLog('H8', `query "${tryQ}" -> no metadata-relevant figure (rows=${rows.length})`);
      }
    } catch (e: any) {
      debugLog('H8', `query "${tryQ}" -> ERROR: ${e.message}`);
      // try next variant
    } finally {
      clearTimeout(timer);
    }
  }
  debugLog('H8', 'all variants exhausted -> null');
  return null;
}

/**
 * One-line attribution for a live figure.
 *
 * EXAM-INTEGRITY: this is shown ABOVE the image before the student answers, so it must
 * not reveal the diagnosis. Open-i/Commons captions are frequently nothing but the
 * diagnosis itself, so a short diagnosis-like caption (or one identical to the title)
 * is dropped and only the credit/licence is shown pre-answer.
 */
export function liveImageCaption(image: LiveImage): string {
  // A source caption usually names the diagnosis ("...radiograph of tetralogy of Fallot... boot-shaped heart"), so no
  // part of it is shown before the student answers. Only the credit and licence are.
  const parts = [image.credit, image.licence, image.provider || 'Open-i/NLM'].filter(Boolean);
  return parts.join(' · ');
}
