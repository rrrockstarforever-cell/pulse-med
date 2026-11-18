// Web research for the "Use web sources" option and for question evidence: DuckDuckGo results and Europe PMC
// abstracts, fetched here (not in the page). Every source is returned with its URL so the answer can cite it.
// Only public http(s) pages are fetched. PubMed is not used.
import { bookPassages } from './books.mjs';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) PulseMed/0.2 (study tool)';
const TRUSTED = /(nih\.gov|ncbi\.nlm|who\.int|cdc\.gov|nice\.org\.uk|medlineplus|mayoclinic|msdmanuals|statpearls|radiopaedia|cochrane|bmj\.com|thelancet|nejm|jamanetwork|icmr|mohfw|aiims)/i;

const ents = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ents[m] ?? m);
const strip = (h) => decode(h.replace(/<(script|style|nav|header|footer|aside|svg|noscript|form)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function isPublicUrl(u) {
  let x;
  try { x = new URL(u); } catch { return false; }
  if (!/^https?:$/.test(x.protocol)) return false;
  const h = x.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h.includes(':')) return false;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [+m[1], +m[2]];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

/**
 * Per-call record of what the network actually did.
 *
 * This exists because a backend that swallows its own errors cannot answer "did the internet work?".
 * openFDA catches every failure and returns an empty list, so a dead connection and a genuine
 * no-match looked identical. Every HTTP attempt ticks this counter, so `ok > 0` means the internet
 * really answered. Kept per call, never module-level, so two searches cannot corrupt each other.
 */
function newNet() {
  return { attempts: 0, ok: 0 };
}

async function get(url, ms = 12000, net) {
  if (net) net.attempts += 1;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/json,application/xml' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  if (net) net.ok += 1;
  return r;
}

async function ddg(q, net) {
  const html = await (await get('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), 12000, net)).text();
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snip = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => strip(m[1]));
  let m, i = 0;
  while ((m = re.exec(html)) && out.length < 8) {
    let href = decode(m[1]);
    if (href.startsWith('//')) href = 'https:' + href;
    try {
      const u = new URL(href);
      if (u.hostname.endsWith('duckduckgo.com') && u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
    } catch { /* keep */ }
    if (isPublicUrl(href)) out.push({ title: strip(m[2]), url: href, snippet: snip[i] ?? '' });
    i++;
  }
  return out;
}

/** Europe PMC abstracts, optionally limited to some journals. Each result: title, url and abstract text. */
const EUROPE_PMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
async function europePmc(query, journals = [], net) {
  const terms = String(query || '').replace(/["\\]/g, ' ').trim().slice(0, 300);
  if (!terms) return [];
  const journalPart = journals.length ? `(${journals.map((j) => `JOURNAL:"${j}"`).join(' OR ')}) AND ` : '';
  const url = `${EUROPE_PMC}?query=${encodeURIComponent(`${journalPart}(${terms}) AND HAS_ABSTRACT:y`)}&format=json&pageSize=3&resultType=core`;
  if (net) net.attempts += 1;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  if (net) net.ok += 1;
  const data = await res.json().catch(() => ({}));
  return (data?.resultList?.result || [])
    .filter((r) => r.abstractText)
    .map((r) => ({
      title: strip(r.title || '').slice(0, 300),
      url: r.doi ? `https://doi.org/${r.doi}` : `https://europepmc.org/article/${r.source || 'MED'}/${r.id}`,
      text: `${r.journalTitle || ''} ${r.pubYear || ''}. ${strip(r.abstractText)}`.slice(0, 1500),
    }));
}

async function pageText(url, chars = 2500, net) {
  const r = await get(url, 12000, net);
  const type = r.headers.get('content-type') || '';
  if (!/text\/html|text\/plain|xml/.test(type)) throw new Error('not a web page');
  return strip((await r.text()).slice(0, 1_500_000)).slice(0, chars);
}

// pageChars: how much of each page to keep. The start of a page is often menus, so a fact check asks for more.
export async function research(query, pageChars = 2500) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) throw new Error('Nothing to search for.');
  const net = newNet();
  const [w, p, label] = await Promise.allSettled([ddg(q, net), europePmc(q, [], net), openFdaByDrug(q, net)]);
  // "The internet answered but had nothing" and "the internet could not be reached" are different
  // facts, and the learner is told which one happened. `net.ok` counts HTTP responses that actually
  // arrived, so a backend that swallows its own errors (openFDA) can no longer fake a live search.
  const reachable = net.ok > 0;
  const web = (w.status === 'fulfilled' ? w.value : []).sort((a, b) => Number(TRUSTED.test(b.url)) - Number(TRUSTED.test(a.url))).slice(0, 3);
  const papers = p.status === 'fulfilled' ? p.value : [];
  const pages = await Promise.allSettled(web.map((x) => pageText(x.url, pageChars, net)));
  // Textbook passages from the user's own library come first: they are the book the student studies from.
  const books = bookPassages(q, 6).map((b) => ({ ...b, kind: 'book' }));
  // The drug label is first when the query names a drug: full label text beats abstracts for adverse-effect facts.
  const labels = label.status === 'fulfilled' ? label.value.map((x) => ({ ...x, kind: 'label' })) : [];
  const sources = [
    ...labels,
    ...books,
    ...web.map((x, i) => ({ title: x.title, url: x.url, text: (pages[i].status === 'fulfilled' && pages[i].value.length > 200 ? pages[i].value : x.snippet) || x.snippet, kind: 'web' })),
    ...papers.map((x) => ({ ...x, kind: 'europepmc' })),
  ].filter((s) => s.text).map((s, i) => ({ n: i + 1, ...s }));
  // Never throw on an empty result: the caller has to be able to tell "searched, nothing found"
  // from "could not search". The old throw made an offline device look like a normal empty answer.
  //
  // `search` reports the INTERNET, not whether any source exists anywhere. The library is local, so
  // book passages survive an offline device — counting all sources would call a dead connection "ok".
  const search = !reachable ? 'no-connection' : sources.some((s) => s.kind !== 'book') ? 'ok' : 'no-results';
  if (!sources.length) {
    return {
      sources: [],
      retrievedAt: new Date().toISOString().slice(0, 10),
      search,
      detail: reachable
        ? 'The search ran but matched nothing usable for these words.'
        : 'The search could not reach the internet (no connection, firewall or timeout).',
    };
  }
  const detail =
    search === 'no-connection'
      ? `The internet could not be reached, so no web source was checked. ${sources.length} passage${sources.length === 1 ? '' : 's'} from the student's own books were found and are numbered below.`
      : search === 'no-results'
        ? `The internet was reached but matched nothing usable. ${sources.length} passage${sources.length === 1 ? '' : 's'} from the student's own books were found and are numbered below.`
        : '';
  return { sources, retrievedAt: new Date().toISOString().slice(0, 10), search, detail };
}

/**
 * Indian journals that Europe PMC indexes, per subject. A subject searches only its own journals, so a
 * pharmacology question never pulls surgery papers. Anatomy has no indexed Indian journal and searches all of Europe PMC.
 */
const SUBJECT_JOURNALS = [
  [/physiolog/i, ['Indian J Physiol Pharmacol']],
  [/biochem/i, ['Indian J Biochem Biophys']],
  [/patholog/i, ['Indian J Pathol Microbiol']],
  [/pharmacolog/i, ['Indian J Pharmacol']],
  [/microbiolog/i, ['Indian J Med Microbiol']],
  [/forensic/i, ['Indian J Forensic Med Toxicol']],
  [/community|preventive|\bpsm\b/i, ['Indian J Community Med']],
  [/general medicine|internal medicine/i, ['J Assoc Physicians India', 'Indian J Med Res']],
  [/surg/i, ['Indian J Surg']],
  [/obstet|gynae/i, ['J Obstet Gynaecol India']],
  [/pediatric|paediatric/i, ['Indian Pediatr']],
  [/orthop/i, ['Indian J Orthop']],
  [/\bENT\b|oto-?rhino|otolaryng/i, ['Indian J Otolaryngol Head Neck Surg']],
  [/ophthalm/i, ['Indian J Ophthalmol']],
  [/dermatolog/i, ['Indian J Dermatol Venereol Leprol']],
  [/psychiatr/i, ['Indian J Psychiatry']],
  [/anesth|anaesth/i, ['Indian J Anaesth']],
  [/radio/i, ['Indian J Radiol Imaging']],
];

export function journalsFor(subject) {
  const s = String(subject || '');
  const hit = SUBJECT_JOURNALS.find(([re]) => re.test(s));
  return hit ? hit[1] : [];
}

/** Drug-label text from openFDA for a query, when a label's indications mention it. Used for drug and medicine questions. */
async function openFdaLabel(query) {
  const phrase = String(query || '').replace(/["\\]/g, ' ').trim();
  if (!phrase) return [];
  const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`indications_and_usage:"${phrase}"`)}&limit=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const hit = data?.results?.[0];
  if (!hit) return [];
  const name = hit.openfda?.generic_name?.[0] || hit.openfda?.brand_name?.[0] || 'Drug label';
  const text = [hit.indications_and_usage?.[0], hit.warnings?.[0] || hit.boxed_warning?.[0]]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
  if (!text) return [];
  return [{ title: `${name} (FDA drug label)`, url: 'https://open.fda.gov/apis/drug/label/', text: text.slice(0, 1200) }];
}

const NOT_A_DRUG = new Set(['adverse', 'effects', 'effect', 'side', 'drug', 'drugs', 'toxicity', 'treatment', 'features', 'feature',
  'criteria', 'causes', 'cause', 'diagnosis', 'diagnostic', 'management', 'clinical', 'disease', 'syndrome', 'investigation',
  'investigations', 'the', 'and', 'with', 'from', 'for', 'about', 'overview', 'complications', 'anatomy', 'physiology',
  // Words that appear inside a product's name but are never the drug itself. "therapy" returned
  // "PAIN RELIEF HEAT THERAPY ROLL-ON" as the top source for "treatment of leprosy", because the
  // lookup matches the word anywhere in the generic name.
  'therapy', 'therapies', 'therapeutic', 'regimen', 'regimens', 'dose', 'doses', 'dosage', 'duration', 'monthly',
  'daily', 'weekly', 'course', 'prophylaxis', 'prevention', 'control', 'programme', 'program']);

/**
 * The FDA label of a named drug in the query (for example "adverse effects of isoniazid"). Its adverse-reactions and
 * warnings sections are full, label-grade text, which is what an adverse-effect question needs.
 */
async function openFdaByDrug(query, net) {
  const words = [...new Set(String(query || '').toLowerCase().match(/[a-z][a-z-]{4,}/g) || [])].filter((w) => !NOT_A_DRUG.has(w));
  for (const word of words.slice(0, 6)) {
    const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`openfda.generic_name:"${word}"`)}&limit=1`;
    if (net) net.attempts += 1;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!res) continue; // a dead attempt: attempts went up, ok did not
    if (!res.ok) continue;
    if (net) net.ok += 1;
    const hit = (await res.json().catch(() => ({})))?.results?.[0];
    if (!hit) continue;
    const name = hit.openfda?.generic_name?.[0] || word;
    // The search is a substring match inside the product name, so "therapy" pulled in
    // "PAIN RELIEF HEAT THERAPY ROLL-ON". A real drug name must contain the query word as a whole word.
    if (!new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(name)) continue;
    const text = [hit.adverse_reactions?.[0], hit.warnings_and_cautions?.[0] || hit.warnings?.[0]]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ');
    if (text) return [{ title: `${name} (FDA label: adverse reactions)`, url: 'https://open.fda.gov/apis/drug/label/', text: text.slice(0, 2500) }];
  }
  // A drug class ("proton pump inhibitors") is not a generic name, so it is searched as an established pharmacologic class.
  // Every non-generic word counts here, including short ones such as "pump".
  const classWords = String(query || '').toLowerCase().match(/[a-z][a-z-]{2,}/g) || [];
  const phrase = classWords.filter((w) => !NOT_A_DRUG.has(w)).map((w) => w.replace(/s$/, '')).join(' ').trim();
  if (phrase) {
    const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(`openfda.pharm_class_epc:"${phrase}"`)}&limit=1`;
    if (net) net.attempts += 1;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (res && res.ok && net) net.ok += 1;
    const hit = res && res.ok ? (await res.json().catch(() => ({})))?.results?.[0] : null;
    if (hit) {
      const name = hit.openfda?.generic_name?.[0] || phrase;
      const text = [hit.adverse_reactions?.[0], hit.warnings_and_cautions?.[0] || hit.warnings?.[0]].filter(Boolean).join(' ').replace(/\s+/g, ' ');
      if (text) return [{ title: `${name} (FDA label, ${phrase} class: adverse reactions)`, url: 'https://open.fda.gov/apis/drug/label/', text: text.slice(0, 2500) }];
    }
  }
  return [];
}

/** Drug and medicine subjects, plus unknown subjects (the tutor), also read openFDA labels. */
function usesDrugLabels(subject) {
  return !subject || /pharmacolog|medicine|therap|drug|anesth|anaesth|toxicolog/i.test(String(subject));
}

/**
 * Evidence for a question on a subject: the subject's Indian journals on Europe PMC, plus an openFDA
 * drug label where the subject uses drugs. Capped at four items. Each source fails on its own.
 */
export async function literatureSources(query, subject) {
  const drugSubject = usesDrugLabels(subject);
  // Every subject first reads passages from the owned textbook library, then the drug label, then papers.
  const book = bookPassages(query, 2, subject);
  const [label, subjectPapers] = await Promise.all([
    drugSubject ? openFdaLabel(query).catch(() => []) : Promise.resolve([]),
    europePmc(query, journalsFor(subject)).catch(() => []),
  ]);
  // The subject's journals often hold nothing on a specific claim. If they give fewer than two abstracts,
  // widen the search to all of Europe PMC, so the judge has something that addresses the claim.
  let papers = subjectPapers;
  if (subjectPapers.length < 2) {
    const wider = await europePmc(query, []).catch(() => []);
    const seen = new Set(subjectPapers.map((p) => p.title));
    papers = [...subjectPapers, ...wider.filter((p) => !seen.has(p.title))];
  }
  return [...book, ...label, ...papers].slice(0, 4);
}

/**
 * The sources the question writer and checker may read, with the licence and status of each.
 * "live" sources are searched when a question is written or checked; "reference" pages are not searchable yet.
 */
export const SOURCE_REGISTRY = [
  { id: 'europepmc', name: 'Europe PMC abstracts (subject Indian journals)', licence: 'Abstracts free; full text varies by article', fetch: 'Europe PMC REST API', status: 'live' },
  { id: 'openfda', name: 'openFDA drug labels', licence: 'US government data (openFDA terms)', fetch: 'api.fda.gov', status: 'live' },
  { id: 'library', name: 'Your textbook library (pulse-library.db, 37 books)', licence: 'Books the user owns; excerpts only', fetch: 'local SQLite full-text index', status: 'live' },
  { id: 'bookshelf', name: 'NCBI Bookshelf (StatPearls and open textbooks)', licence: 'Varies per book; StatPearls is free to read', fetch: 'NCBI web pages', status: 'blocked: NCBI shows a bot check instead of chapter text' },
  { id: 'reference-pages', name: 'Reference websites (TeachMeAnatomy, CV Physiology, LibreTexts, WebPath, DermNet, EyeWiki, NHSRC treatment guidelines and others)', licence: 'Varies per site; check before quoting', fetch: 'page text only; no search yet', status: 'reference: readable pages, not searched per question' },
];

/** Question-writing and checking evidence (kept for the older route name). */
export async function topicSources(query, subject) {
  return literatureSources(query, subject);
}
