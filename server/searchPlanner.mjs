// Pure helpers for plan-chat search. No network, no files.
// A short search string is allowed. The student's question is not discarded to make it.

const STOP = new Set([
  'what', 'which', 'does', 'that', 'this', 'with', 'from', 'have', 'were', 'their', 'your',
  'about', 'into', 'when', 'while', 'there', 'these', 'those', 'would', 'could', 'should',
  'being', 'given', 'shows', 'patient', 'patients', 'they', 'them', 'been', 'make', 'makes',
  'most', 'some', 'only', 'other', 'than', 'such', 'also', 'after', 'before', 'will', 'used',
  'where', 'among', 'through', 'whose', 'whom', 'have', 'been',
  // Generic testing/teaching wording carries little search meaning; the named topic should lead.
  'direct', 'fact', 'student', 'students', 'must', 'know', 'knows', 'including', 'name', 'number',
]);

/** Distinctive words, in the order they appear. Keep uppercase clinical acronyms even when short. */
export function questionTerms(text) {
  const original = String(text || '');
  const seen = new Set();
  const out = [];
  const terms = original.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) || [];
  // Meaningful medical abbreviations such as MDT, TB, and MRI are often only 2–3 letters long.
  // Keep the uppercase form, but do not let all-caps ordinary glue words become search terms.
  const acronyms = original.match(/\b[A-Z][A-Z0-9]{1,7}\b/g) || [];
  for (const raw of [...terms, ...acronyms]) {
    const term = raw.toLowerCase();
    if (STOP.has(term) || ['the', 'and', 'for', 'but', 'not', 'are', 'how', 'why', 'who', 'can', 'all'].includes(term) || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
}

/**
 * Keep the whole question. The search string leads with the question's own words,
 * including words at the end, so a long topic cannot push the ask off the query.
 */
export function planResearchQuery({ question, topic, subject, query } = {}) {
  const asked = String(question || '').trim();
  const fallback = String(query || '').trim();
  const fullQuestion = asked || fallback;
  const topicText = String(topic || '').trim();
  const subjectText = String(subject || '').trim();
  const askedTerms = questionTerms(fullQuestion);
  const topicTerms = questionTerms(topicText).filter((term) => !askedTerms.includes(term));
  const terms = [...askedTerms, ...topicTerms].slice(0, 24);
  const lead = pickDistinctive(askedTerms.length ? askedTerms : topicTerms, 12);
  const subjectBit = subjectText && !lead.some((term) => subjectText.toLowerCase().includes(term))
    ? [subjectText]
    : [];
  const variant = fitWords([...lead, ...topicTerms.slice(0, 4), ...subjectBit], 200)
    || fullQuestion.slice(0, 200);
  return {
    question: fullQuestion,
    topic: topicText,
    subject: subjectText,
    terms,
    searchVariant: variant,
  };
}

/**
 * The most specific words: the rare ones, longest first, keeping the question's own order in the
 * result. "Exact dose of clofazimine" must survive an n-word limit; "recommended complete" need not.
 */
function pickDistinctive(terms, n) {
  if (terms.length <= n) return terms;
  const counts = new Map();
  for (const term of terms) counts.set(term, (counts.get(term) || 0) + 1);
  const ranked = terms.map((term, index) => ({ term, index, weight: term.length + counts.get(term) * 2 }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .slice(0, n)
    .sort((a, b) => a.index - b.index)
    .map((x) => x.term);
  return ranked;
}

function fitWords(words, limit) {
  let out = '';
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > limit) break;
    out = next;
  }
  return out;
}

/**
 * Rank pages by how many asked words they share. A known medical host is a small
 * boost, not a reason to put an unrelated page first.
 */
export function rankWebHits(hits, plan, isTrusted = () => false) {
  const terms = plan?.terms?.length ? plan.terms : questionTerms(plan?.question || '');
  return (hits || []).map((hit, index) => {
    const hay = `${hit?.title || ''} ${hit?.snippet || ''} ${hit?.url || ''}`.toLowerCase();
    const overlap = terms.filter((term) => hay.includes(term)).length;
    const trusted = isTrusted(hit?.url) ? 1 : 0;
    return { ...hit, overlap, trusted, score: overlap * 10 + trusted, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
}

export function termHits(text, terms) {
  const lower = String(text || '').toLowerCase();
  return (terms || []).filter((term) => term && lower.includes(String(term).toLowerCase())).length;
}

/**
 * The stretch of a long page that shares the most asked words.
 * A cut taken from the start is what dropped a fact sitting a few thousand characters in.
 */
export function passageWindow(text, terms, limit = 12000) {
  const raw = String(text || '');
  const cap = Math.max(400, Number(limit) || 12000);
  if (raw.length <= cap) return raw;
  const words = (terms || []).map((term) => String(term).toLowerCase()).filter((term) => term.length >= 3);
  if (!words.length) return raw.slice(0, cap);
  const lower = raw.toLowerCase();
  const step = 500;
  let bestAt = 0;
  let bestScore = -1;
  for (let at = 0; at < raw.length; at += step) {
    const stretch = lower.slice(at, at + cap);
    let score = 0;
    for (const word of words) if (stretch.includes(word)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestAt = at;
    }
  }
  if (bestScore <= 0) return raw.slice(0, cap);
  return raw.slice(bestAt, bestAt + cap);
}

/**
 * True when some passage shares enough of the question's own words to be about the ask.
 * A page that merely loaded is not treated as a page that states the fact.
 */
export function passagesCoverQuestion(texts, questionOrTerms) {
  const terms = Array.isArray(questionOrTerms) ? questionOrTerms : questionTerms(questionOrTerms);
  const distinctive = terms.filter((term) => term.length >= 5);
  const need = distinctive.length <= 1 ? distinctive.length : 2;
  if (!need) return (texts || []).some((text) => String(text || '').trim().length > 40);
  return (texts || []).some((text) => termHits(text, distinctive) >= need);
}
