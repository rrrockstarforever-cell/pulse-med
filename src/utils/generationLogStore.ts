const DB_NAME = 'pulse-gen-log';
const STORE = 'runs';
const MAX_RUNS = 30;

const toNum = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const toStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const toArr = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : undefined;

function toNames(v: unknown): string[] {
  try {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === 'string' && item.trim()) out.push(item);
      else if (item && typeof item === 'object') {
        const n = item.name ?? item.topic ?? item.subtopic ?? item.label ?? item.id;
        if (typeof n === 'string' && n.trim()) out.push(n);
      }
    }
    return out;
  } catch { return []; }
}

function countEntries(value: any): Array<[string, number]> {
  try {
    if (!value) return [];
    if (Array.isArray(value)) {
      const out: Array<[string, number]> = [];
      const strCounts = new Map<string, number>();
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          strCounts.set(item, (strCounts.get(item) ?? 0) + 1);
        } else if (item && typeof item === 'object') {
          const name = item.name ?? item.subject ?? item.subtopic ?? item.topic ?? item.reason ?? item.key ?? item.label;
          const n = item.count ?? item.kept ?? item.value ?? item.n ?? item.total;
          if (name != null) out.push([String(name), toNum(n)]);
        }
      }
      for (const [k, v] of strCounts) out.push([k, v]);
      return out;
    }
    if (typeof value === 'object') {
      return Object.entries(value).map(([k, v]) => [k, toNum(v)] as [string, number]);
    }
    return [];
  } catch { return []; }
}

function formatFact(f: any): string {
  try {
    if (typeof f === 'string') return f.slice(0, 240);
    if (f && typeof f === 'object') {
      const text = f.text ?? f.fact ?? f.statement ?? f.content ?? f.value;
      const cost = f.cost ?? f.score ?? f.count;
      if (typeof text === 'string') return (cost != null ? `[${cost}] ` : '') + text.slice(0, 240);
      return JSON.stringify(f).slice(0, 240);
    }
    return String(f).slice(0, 240);
  } catch { return ''; }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        } catch { /* ignore */ }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

export interface RunLogSummary {
  id: string;
  startedAt: string;
  seconds: number;
  requested: number;
  kept: number;
  rejected: number;
  /** Estimated tokens used by the run (input plus output). */
  tokens?: number;
  exam?: string;
  specialities?: string[];
  chosenTopics?: string[];
  source?: string;
  provider?: string;
  model?: string;
}

async function saveRunLogInner(report: any): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const r = report && typeof report === 'object' ? report : {};
    const settings = r.settings && typeof r.settings === 'object' ? r.settings : {};
    const totals = r.totals && typeof r.totals === 'object' ? r.totals : {};
    const startedAt = toStr(r.startedAt) ?? new Date().toISOString();
    const id = startedAt;
    const summary: RunLogSummary = {
      id,
      startedAt,
      seconds: toNum(r.seconds),
      requested: toNum(settings.requested ?? totals.requested),
      kept: toNum(totals.kept),
      rejected: toNum(totals.rejected),
      tokens: toNum((r.tokens as { total?: unknown } | undefined)?.total),
    };
    const exam = toStr(settings.exam); if (exam) summary.exam = exam;
    const specialities = toArr(settings.specialities); if (specialities) summary.specialities = specialities;
    const chosenTopics = toArr(settings.chosenTopics); if (chosenTopics) summary.chosenTopics = chosenTopics;
    const source = toStr(settings.source); if (source) summary.source = source;
    const provider = toStr(settings.provider); if (provider) summary.provider = provider;
    const model = toStr(settings.model); if (model) summary.model = model;

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.put({ id, savedAt: Date.now(), summary, report: r });
        const allReq = store.getAll();
        allReq.onsuccess = () => {
          try {
            const all = Array.isArray(allReq.result) ? allReq.result : [];
            if (all.length > MAX_RUNS) {
              all.sort((a: any, b: any) => (b?.savedAt || 0) - (a?.savedAt || 0));
              for (const old of all.slice(MAX_RUNS)) {
                if (old && typeof old.id === 'string') store.delete(old.id);
              }
            }
          } catch { /* ignore */ }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
    });
    db.close();
  } catch { /* ignore */ }
}

export async function listRunLogs(): Promise<RunLogSummary[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    const result = await new Promise<RunLogSummary[]>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
          try {
            const all = Array.isArray(req.result) ? req.result : [];
            all.sort((a: any, b: any) => (b?.savedAt || 0) - (a?.savedAt || 0));
            resolve(all.map((x: any) => x?.summary).filter(Boolean) as RunLogSummary[]);
          } catch { resolve([]); }
        };
        req.onerror = () => resolve([]);
        tx.onerror = () => resolve([]);
        tx.onabort = () => resolve([]);
      } catch { resolve([]); }
    });
    db.close();
    return result;
  } catch { return []; }
}

export async function getRunLog(id: string): Promise<any | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const out = await new Promise<any | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => {
          try { resolve(req.result ? (req.result.report ?? null) : null); } catch { resolve(null); }
        };
        req.onerror = () => resolve(null);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch { resolve(null); }
    });
    db.close();
    return out;
  } catch { return null; }
}

async function deleteRunLogInner(id: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
    });
    db.close();
  } catch { /* ignore */ }
}

async function clearRunLogsInner(): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch { resolve(); }
    });
    db.close();
  } catch { /* ignore */ }
}

export function runLogText(report: any): string {
  const r = report && typeof report === 'object' ? report : {};
  const settings = r.settings && typeof r.settings === 'object' ? r.settings : {};
  const totals = r.totals && typeof r.totals === 'object' ? r.totals : {};
  const plan = r.plan && typeof r.plan === 'object' ? r.plan : {};
  const planSummary = plan.summary && typeof plan.summary === 'object' ? plan.summary : {};
  const out: string[] = [];

  const asked: string[] = [];
  const exam = toStr(settings.exam);
  if (exam) asked.push('exam: ' + exam);
  asked.push('requested: ' + toNum(settings.requested));
  const specialities = toArr(settings.specialities);
  if (specialities) asked.push('specialities: ' + specialities.join(', '));
  const chosen = toNames(settings.chosenTopics);
  if (chosen.length) asked.push('chosenTopics: ' + chosen.join(', '));
  const subtopics = toNames(settings.subtopicsChosen ?? settings.chosenSubtopics);
  if (subtopics.length) asked.push('subtopicsChosen: ' + subtopics.join(', '));
  const difficulty = toStr(settings.difficulty);
  if (difficulty) asked.push('difficulty: ' + difficulty);
  const sourceMode = toStr(settings.sourceMode ?? settings.source ?? settings.mode);
  if (sourceMode) asked.push('source mode: ' + sourceMode);
  const imagesMode = toStr(settings.imagesMode ?? settings.images);
  if (imagesMode) asked.push('images mode: ' + imagesMode);
  const provider = toStr(settings.provider), model = toStr(settings.model);
  if (provider || model) asked.push('provider/model: ' + [provider, model].filter(Boolean).join('/'));
  const rounds = toNum(settings.rounds);
  if (rounds) asked.push('rounds: ' + rounds);
  out.push('ASKED', ...(asked.length ? asked : ['(none)']), '');

  const kept = toNum(totals.kept), rejected = toNum(totals.rejected);
  const share = kept + rejected > 0 ? Math.round((kept / (kept + rejected)) * 100) : 0;
  out.push('DELIVERED', `kept: ${kept}`, `rejected: ${rejected}`, `share kept: ${share}%`, `seconds: ${toNum(r.seconds)}`, '');

  const planLines: string[] = [];
  const found = planSummary.found ?? planSummary.foundCount;
  const planned = planSummary.planned ?? planSummary.plannedCount;
  if (found != null || planned != null) planLines.push(`found: ${toNum(found)}`, `planned: ${toNum(planned)}`);
  const bySubtopic = countEntries(planSummary.bySubtopic);
  if (bySubtopic.length) planLines.push('bySubtopic: ' + bySubtopic.map(([k, v]) => `${k}: ${v}`).join(', '));
  const empty = toNames(planSummary.emptySubtopics);
  if (empty.length) planLines.push('emptySubtopics: ' + empty.join(', '));
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  for (const s of steps) {
    try {
      if (s && typeof s === 'object') {
        const name = toStr(s.step) ?? toStr(s.name) ?? toStr(s.label) ?? toStr(s.id) ?? 'step';
        const before = s.before ?? s.from ?? s.beforeCount;
        const after = s.after ?? s.to ?? s.afterCount;
        planLines.push(`${name}: ${before ?? '?'} -> ${after ?? '?'}`);
      } else if (typeof s === 'string') planLines.push(s);
    } catch { /* ignore */ }
  }
  out.push('PLAN', ...(planLines.length ? planLines : ['(none)']), '');

  const keptBySubject = countEntries(r.keptBySubject);
  out.push('KEPT BY SUBJECT', ...(keptBySubject.length ? keptBySubject.map(([k, v]) => `${k}: ${v}`) : ['(none)']), '');
  const keptBySubtopic = countEntries(r.keptBySubtopic);
  out.push('KEPT BY SUBTOPIC', ...(keptBySubtopic.length ? keptBySubtopic.map(([k, v]) => `${k}: ${v}`) : ['(none)']), '');

  const keptMap = new Map(keptBySubtopic);
  const vsLines: string[] = [];
  for (const [k, v] of bySubtopic) vsLines.push(`${k}: planned ${v}, kept ${keptMap.get(k) ?? 0}`);
  out.push('REQUESTED VS DELIVERED PER SUBTOPIC', ...(vsLines.length ? vsLines : ['(none)']), '');

  const rejections = countEntries(r.rejectionsByReason);
  out.push('REJECTIONS BY REASON', ...(rejections.length ? rejections.map(([k, v]) => `${k}: ${v}`) : ['(none)']), '');

  const facts = Array.isArray(r.costliestFacts) ? r.costliestFacts.slice(0, 10) : [];
  const factLines = facts.map((f: any) => formatFact(f)).filter(Boolean);
  out.push('COSTLIEST FACTS', ...(factLines.length ? factLines : ['(none)']), '');

  const deliveredLines: string[] = [];
  if (Array.isArray(r.delivered)) {
    r.delivered.forEach((q: any, i: number) => {
      try {
        if (!q || typeof q !== 'object') return;
        const subject = toStr(q.subject) ?? toStr(q.subjectName) ?? '?';
        const subtopic = toStr(q.subtopic) ?? toStr(q.subtopicName) ?? '?';
        const stemRaw = toStr(q.stem) ?? toStr(q.question) ?? toStr(q.text) ?? '';
        const stem = stemRaw.replace(/\s+/g, ' ').slice(0, 140);
        let correct = q.correctOption ?? q.correct ?? q.answer ?? q.correctAnswer;
        if (correct == null && Array.isArray(q.options)) {
          const idx = typeof q.correctIndex === 'number' ? q.correctIndex : typeof q.correctOptionIndex === 'number' ? q.correctOptionIndex : -1;
          if (idx >= 0 && idx < q.options.length) correct = q.options[idx];
        }
        const correctText = typeof correct === 'string'
          ? correct
          : correct && typeof correct === 'object'
            ? String(correct.text ?? correct.label ?? correct.value ?? JSON.stringify(correct))
            : correct != null ? String(correct) : '?';
        deliveredLines.push(`${i + 1}. [${subject} / ${subtopic}] ${stem} | correct: ${correctText.slice(0, 140)}`);
      } catch { /* ignore */ }
    });
  }
  const tk = r.tokens && typeof r.tokens === 'object' ? r.tokens : null;
  if (tk) {
    const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('en-US');
    out.push('TOKENS USED (estimated, about 4 characters per token)',
      `total ${fmt(tk.total)} (input ${fmt(tk.input)}, output ${fmt(tk.output)}) in ${fmt(tk.calls)} AI calls; about ${fmt(tk.perKeptQuestion)} per kept question`,
      `wasted on failed calls: ${fmt(tk.wastedTotal)} tokens in ${fmt(tk.failedCalls)} calls`);
    for (const [name, row] of Object.entries((tk.byPurpose ?? {}) as Record<string, any>)) out.push(`  ${name}: ${fmt(row.calls)} calls, ${fmt(row.input + row.output)} tokens`);
  }
  out.push('QUESTIONS DELIVERED', ...(deliveredLines.length ? deliveredLines : ['(none)']));

  return out.join('\n').trim();
}

const notifyChanged = (): void => { try { window.dispatchEvent(new Event("pulse-gen-log-changed")); } catch { /* no window */ } };
export async function saveRunLog(report: any): Promise<void> { await saveRunLogInner(report); notifyChanged(); }
export async function deleteRunLog(id: string): Promise<void> { await deleteRunLogInner(id); notifyChanged(); }
export async function clearRunLogs(): Promise<void> { await clearRunLogsInner(); notifyChanged(); }
