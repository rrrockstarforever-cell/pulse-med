import React, { useEffect, useRef, useState } from 'react';
import { useBackLayer } from '../lib/backLayers.ts';
import { AlertCircle, BookOpen, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Flag, Loader2, MessageCircle, RefreshCw, SkipForward, Sparkles, X, XCircle } from 'lucide-react';
import type { AppView, ClinicalQuestion } from '../types.ts';
import { aiComplete, getActiveProvider, getEffectiveModel, NOT_CONNECTED_MESSAGE } from '../lib/ai.ts';
import {
  buildStudyPlan,
  chunkMinutes,
  collectMisses,
  collectPreRead,
  isPartDone,
  loadPlanDone,
  loadStudyPlan,
  planQuestionIds,
  saveStudyPlan,
  setPlanPartDone,
  splitRecall,
  type CoveredQuestion,
  type Miss,
  type PlanProgress,
  type StudyPlan,
} from '../lib/studyPlan.ts';
import { researchForPlan } from '../lib/planResearch.ts';
import { getModule } from '../utils/moduleStore.ts';
import { loadRunSession } from '../utils/sessionStore.ts';
import { listCapturedQuestions } from '../utils/mistakeStore.ts';
import { KeyPoint, renderKeyPoints } from './KeyText.tsx';
import { GroundedChat } from './GroundedChat.tsx';

type PlanSourceMode = 'both' | 'books' | 'web';

const PLAN_SOURCE_MODES: Array<{ value: PlanSourceMode; label: string }> = [
  { value: 'both', label: 'Books + Internet' },
  { value: 'books', label: 'My books' },
  { value: 'web', label: 'Internet' },
];

const normalizePlanSourceMode = (value: unknown): PlanSourceMode =>
  value === 'books' || value === 'web' ? value : 'both';

type CoveredQuestionView = CoveredQuestion & { questionNumber?: string | number; questionText?: string };

const safeHttpHref = (value: string): string | null => {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

// Phone-only text cleanup: drops citation markers and leaked writer wording. Never used on the PC layout.
const cleanForPhone = (text: string): string =>
  String(text ?? '')
    .replace(/\s?\[\d+\](\[\d+\])*/g, '')
    .replace(/\s*\(Background knowledge\)/gi, '')
    .replace(/\bthe supplied book excerpts?\b/gi, 'the book')
    .replace(/\bthe supplied notes\b/gi, 'the notes')
    .replace(/\bthis chunk\b/g, 'this part')
    .replace(/\bThis chunk\b/g, 'This part')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:])/g, '$1')
    .trim();

// The first sentence of a text, cut to about 140 characters.
const firstSentenceForPhone = (text: string): string => {
  const t = cleanForPhone(text).replace(/\*\*/g, '');
  const m = t.match(/^(.+?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > 140 ? `${s.slice(0, 137).replace(/\s+\S*$/, '')}…` : s;
};

// Phone highlights: at most 2 per bullet, and only short phrases (up to 3 words). Longer ones show as plain text.
const renderPhonePoints = (text: string, keyPrefix: string): React.ReactNode[] => {
  let used = 0;
  return cleanForPhone(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => {
    const isKey = part.length > 4 && part.startsWith('**') && part.endsWith('**');
    const inner = isKey ? part.slice(2, -2) : part;
    if (isKey && used < 2 && inner.trim().split(/\s+/).length <= 3) {
      used += 1;
      return <KeyPoint key={`${keyPrefix}-${i}`}>{inner}</KeyPoint>;
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{inner}</React.Fragment>;
  });
};

// Phone: a bullet card that starts closed and shows only its first bullet (cut to about 70 characters).
const PhoneDetailCard: React.FC<{ heading: string; points: string[]; keyPrefix: string; onAsk: () => void }> = ({ heading, points, keyPrefix, onAsk }) => {
  const [open, setOpen] = useState(false);
  const first = cleanForPhone(points[0] ?? '').replace(/\*\*/g, '');
  const preview = first.length > 70 ? `${first.slice(0, 69).replace(/\s+\S*$/, '')}…` : first;
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="toc-bare flex min-w-0 flex-1 items-start gap-2 !px-4 !py-2.5 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-slate-900 dark:text-white">{cleanForPhone(heading)}</span>
            {!open && preview && <span className="block text-[12.5px] text-slate-500 dark:text-slate-400">{preview}</span>}
          </span>
          <span aria-hidden className="shrink-0 pt-0.5 text-slate-500 dark:text-slate-400">
            {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </span>
        </button>
        <button
          type="button"
          onClick={onAsk}
          aria-label={`Ask AI about ${cleanForPhone(heading)}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-[#0f8b8d] dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-teal-300"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <ul className="list-disc space-y-1 px-4 pb-3 pl-9 text-[14px] leading-relaxed text-slate-800 dark:text-slate-100">
          {points.map((p, j) => <li key={j}>{renderPhonePoints(p, `${keyPrefix}-${j}`)}</li>)}
        </ul>
      )}
    </div>
  );
};

// Phone: a trap split into a short statement (the question side) and the full right idea (the answer side).
type PhoneTrapItem = { statement: string; idea: string };
const phoneTrapItem = (trap: string): PhoneTrapItem => {
  const idea = cleanForPhone(trap).replace(/\*\*/g, '');
  const m = idea.match(/^(.+?)(?:[.;:]\s|\s[–—-]\s|$)/);
  let statement = (m ? m[1] : idea).trim();
  if (statement.length > 90) statement = `${statement.slice(0, 89).replace(/\s+\S*$/, '')}…`;
  return { statement, idea };
};

const clipForPhone = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;

// Phone: an exam trap as a self-test card. It shows a short question first; tap to see the full trap.
const PhoneTrapCard: React.FC<{ trap: string; keyPrefix: string }> = ({ trap, keyPrefix }) => {
  const [open, setOpen] = useState(false);
  const { statement } = phoneTrapItem(trap);
  return (
    <div className="rounded-xl border border-l-4 border-slate-200 border-l-rose-500 bg-white px-2 py-1.5 dark:border-slate-700 dark:border-l-rose-500 dark:bg-slate-900/60">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="toc-bare block w-full text-left">
        {open ? (
          <span className="block text-[13.5px] leading-relaxed text-slate-800 dark:text-slate-100">{renderPhonePoints(trap, keyPrefix)}</span>
        ) : (
          <>
            <span className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">
              <span className="text-rose-600 dark:text-rose-400">Trap:</span> {statement}
            </span>
            <span className="block text-[11.5px] text-slate-500 dark:text-slate-400">Tap to see the right idea</span>
          </>
        )}
      </button>
    </div>
  );
};

// Phone: one 3-option recall question built from the traps. Tap an option: right turns green, wrong turns red and shows the right one.
const buildQuickCheck = (traps: string[], index: number) => {
  if (traps.length < 3 || index < 0 || index >= traps.length) return null;
  const items = traps.map(phoneTrapItem);
  const answerOf = (it: PhoneTrapItem): string => {
    const base = it.idea.startsWith(it.statement.replace(/…$/, '')) ? it.idea.slice(it.statement.replace(/…$/, '').length).replace(/^[\s:;.–—-]+/, '') : it.idea;
    return clipForPhone(base || it.idea, 110);
  };
  const correct = answerOf(items[index]);
  const distractors: string[] = [];
  for (let k = 1; k < items.length && distractors.length < 2; k++) {
    const cand = answerOf(items[(index + k) % items.length]);
    if (cand && cand !== correct && !distractors.includes(cand)) distractors.push(cand);
  }
  if (distractors.length < 2) return null;
  const correctIndex = index % 3;
  const options = [distractors[0], distractors[1]];
  options.splice(correctIndex, 0, correct);
  return { stem: items[index].statement, options, correctIndex };
};

const PhoneQuickCheck: React.FC<{ stem: string; options: string[]; correctIndex: number }> = ({ stem, options, correctIndex }) => {
  const [picked, setPicked] = useState<number | null>(null);
  const answered = picked !== null;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-[#00696b] dark:text-teal-300">Quick check</div>
      <div className="mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-100">{stem}</div>
      <div className="text-[12px] text-slate-500 dark:text-slate-400">What is the right idea behind this trap?</div>
      <div className="mt-2 space-y-1.5">
        {options.map((opt, o) => {
          const isCorrect = o === correctIndex;
          const isPicked = picked === o;
          let cls = 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800';
          if (answered && isCorrect) cls = 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-100';
          else if (answered && isPicked) cls = 'border-rose-500 bg-rose-50 text-rose-900 dark:border-rose-500 dark:bg-rose-950/50 dark:text-rose-100';
          return (
            <button
              key={o}
              type="button"
              disabled={answered}
              onClick={() => setPicked(o)}
              className={`block w-full rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] leading-snug transition-colors disabled:cursor-default ${cls}`}
            >
              {clipForPhone(opt, 150)}
            </button>
          );
        })}
      </div>
      {answered && (
        <div role="status" className={`mt-1.5 text-[12px] font-semibold ${picked === correctIndex ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
          {picked === correctIndex ? 'Correct.' : 'Not quite. The green idea is the right one.'}
        </div>
      )}
    </div>
  );
};

// Phone: flashcards over every trap in the plan. Front = trap title, tap to flip to the right idea.
// Got it removes the card from the queue; Again moves it to the end.
const PhoneTrapFlashcards: React.FC<{ traps: string[]; onClose: () => void }> = ({ traps, onClose }) => {
  const items = traps.map(phoneTrapItem);
  const total = items.length;
  const [queue, setQueue] = useState<number[]>(() => items.map((_, k) => k));
  const [flipped, setFlipped] = useState(false);
  const [gotCount, setGotCount] = useState(0);
  const current = queue.length > 0 ? queue[0] : null;
  const position = Math.min(total, gotCount + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const gotIt = () => {
    if (current === null) return;
    setQueue((q) => q.slice(1));
    setGotCount((n) => n + 1);
    setFlipped(false);
  };
  const again = () => {
    if (current === null) return;
    setQueue((q) => [...q.slice(1), q[0]]);
    setFlipped(false);
  };
  const restart = () => {
    setQueue(items.map((_, k) => k));
    setGotCount(0);
    setFlipped(false);
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Practise traps" className="fixed inset-0 z-[200] flex flex-col bg-white dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <div className="text-[15px] font-semibold text-slate-900 dark:text-white">Practise traps</div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">{position} / {total}</span>
          <button type="button" onClick={onClose} className="inline-flex min-h-[36px] items-center rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
            Close
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-6">
        {current !== null && items[current] ? (
          <div className="flex w-full max-w-md flex-col gap-4">
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? 'Show the trap title' : 'Show the right idea'}
              className="relative block h-72 w-full"
              style={{ perspective: '1000px' }}
            >
              <span
                className="absolute inset-0 block transition-transform duration-500"
                style={{ transformStyle: 'preserve-3d', transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}
              >
                <span
                  className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-l-4 border-slate-200 border-l-rose-500 bg-white p-5 text-center dark:border-slate-700 dark:border-l-rose-500 dark:bg-slate-900"
                  style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">Trap</span>
                  <span className="mt-2 text-[18px] font-semibold leading-snug text-slate-900 dark:text-white">{items[current].statement}</span>
                  <span className="mt-4 text-[12px] text-slate-500 dark:text-slate-400">Tap to see the right idea</span>
                </span>
                <span
                  className="absolute inset-0 flex flex-col overflow-y-auto rounded-2xl border border-teal-300 bg-teal-50 p-5 dark:border-teal-700 dark:bg-teal-950/40"
                  style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                >
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#00696b] dark:text-teal-300">Right idea</span>
                  <span className="mt-2 text-[15px] leading-relaxed text-slate-800 dark:text-slate-100">{items[current].idea}</span>
                </span>
              </span>
            </button>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={again} className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white text-[14px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
                Again
              </button>
              <button type="button" onClick={gotIt} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#0f8b8d] text-[14px] font-semibold text-white shadow-sm hover:bg-[#0b6b6d]">
                Got it
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
            <div className="text-[15px] font-semibold text-slate-900 dark:text-white">All {total} traps done</div>
            <button type="button" onClick={restart} className="inline-flex min-h-[44px] items-center rounded-xl bg-[#0f8b8d] px-4 text-[14px] font-semibold text-white shadow-sm hover:bg-[#0b6b6d]">
              Start again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Phone: a small progress ring with "done/total parts" text.
const PhoneProgressRing: React.FC<{ done: number; total: number }> = ({ done, total }) => {
  const size = 40;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="flex items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-slate-200 dark:text-slate-700" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className="text-[#0f8b8d] transition-all"
        />
      </svg>
      <span className="whitespace-nowrap text-[13px] font-semibold text-slate-800 dark:text-slate-100">{done}/{total} parts</span>
    </div>
  );
};

// Phone: which parts the user marked understood. Stored per bank, keyed by part id (or title).
const understoodStorageKey = (bankId: string) => `pulse-med:plan-understood:${bankId}`;
const loadUnderstood = (bankId: string): Record<string, boolean> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(understoodStorageKey(bankId)) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const saveUnderstood = (bankId: string, value: Record<string, boolean>) => {
  try {
    localStorage.setItem(understoodStorageKey(bankId), JSON.stringify(value));
  } catch {}
};

// Phone study aids: three on-demand aids per part. Each answer is asked once and cached per bank, part and kind.
type StudyAidKind = 'memory' | 'case' | 'compare';
const STUDY_AID_KINDS: Array<{ value: StudyAidKind; label: string }> = [
  { value: 'memory', label: 'Memory trick' },
  { value: 'case', label: 'Mini case' },
  { value: 'compare', label: 'Compare' },
];
const studyAidLabel = (kind: StudyAidKind): string => STUDY_AID_KINDS.find((k) => k.value === kind)?.label ?? '';
const STUDY_AID_SAFETY = 'Use only standard textbook facts. If unsure, say so.';
const buildStudyAidPrompt = (kind: StudyAidKind, topic: string, context: string): string => {
  const ctx = context.trim().slice(0, 1200) || 'None';
  if (kind === 'memory') {
    return `Give ONE memorable mnemonic for this NEET-PG topic: an acronym, a rhyme, or a vivid funny picture the student can imagine. Do NOT just repeat or rephrase the facts. Format: first line the mnemonic itself (max 15 words), second line "Means:" and what each part stands for (max 25 words). Plain simple English. Topic: ${topic}\nContext: ${ctx}\n${STUDY_AID_SAFETY}`;
  }
  if (kind === 'case') {
    return `Write a 3 line clinical vignette (patient age, sex, 2 findings) that leads to this topic, then one line 'Answer:' naming the key idea. Max 60 words. Topic: ${topic}\nContext: ${ctx}\n${STUDY_AID_SAFETY}`;
  }
  return `Make a small comparison table in plain text rows: 'Item | Key point | Watch out'. Max 4 rows, only if this topic compares drugs or classes; otherwise reply exactly NONE. Topic: ${topic}\nContext: ${ctx}\n${STUDY_AID_SAFETY}`;
};
const studyAidStorageKey = (bankId: string, partId: string, kind: StudyAidKind) => `pulse-med:study-aid:${bankId}:${partId}:${kind}`;
const loadStudyAid = (bankId: string, partId: string, kind: StudyAidKind): string | null => {
  try {
    return localStorage.getItem(studyAidStorageKey(bankId, partId, kind));
  } catch {
    return null;
  }
};
const saveStudyAid = (bankId: string, partId: string, kind: StudyAidKind, text: string) => {
  try {
    localStorage.setItem(studyAidStorageKey(bankId, partId, kind), text);
  } catch {}
};
// Turns "Item | Key point | Watch out" lines into rows. The header row and the markdown separator line are skipped.
const parseCompareRows = (raw: string): string[][] =>
  raw.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('|') && !/^\|?[\s:-]*-{2,}[\s|:-]*$/.test(line))
    .map((line) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cleanForPhone(cell.trim()).replace(/\*\*/g, '')))
    .filter((cells) => cells.length >= 2 && cells[0].toLowerCase() !== 'item');

// Phone: one study aid result card, shown under the part's "Remember this" box. Asks the AI once; then it reads the cache.
const StudyAidCard: React.FC<{ bankId: string; partId: string; kind: StudyAidKind; topic: string; context: string; onClose: () => void }> = ({ bankId, partId, kind, topic, context, onClose }) => {
  const [text, setText] = useState<string | null>(() => loadStudyAid(bankId, partId, kind));
  const [loading, setLoading] = useState(text === null);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);
  const startedRef = useRef(false);
  const label = studyAidLabel(kind);

  const run = async () => {
    const id = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const out = (await aiComplete({ messages: [{ role: 'user', content: buildStudyAidPrompt(kind, topic, context) }] })).trim();
      if (!out) throw new Error('The AI sent an empty reply.');
      if (id !== reqRef.current) return;
      saveStudyAid(bankId, partId, kind, out);
      setText(out);
    } catch (err: any) {
      if (id === reqRef.current) setError(err?.message || 'Could not get an answer.');
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (text !== null || startedRef.current) return;
    startedRef.current = true;
    void run();
  }, []);

  const isNone = kind === 'compare' && text !== null && /^NONE\b/i.test(text.trim());
  const rows = kind === 'compare' && text !== null && !isNone ? parseCompareRows(text).slice(0, 6) : [];

  return (
    <div role="region" aria-label={label} className="rounded-2xl border border-teal-300 bg-white px-3 py-2.5 dark:border-teal-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#00696b] dark:text-teal-300">{label}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${label}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {loading && (
        <div role="status" className="mt-2 flex items-center gap-2 text-[13px] text-slate-600 dark:text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
        </div>
      )}
      {!loading && error && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-rose-700 dark:text-rose-300">
          <span>Could not load this. {error}</span>
          <button type="button" onClick={() => void run()} className="underline underline-offset-2">Retry</button>
        </div>
      )}
      {!loading && text !== null && (
        isNone ? (
          <p className="mt-2 text-[13.5px] text-slate-700 dark:text-slate-200">Nothing to compare in this part.</p>
        ) : rows.length > 0 ? (
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-left text-[12.5px] text-slate-800 dark:text-slate-100">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="px-2 py-1.5 font-semibold">Item</th>
                  <th className="px-2 py-1.5 font-semibold">Key point</th>
                  <th className="px-2 py-1.5 font-semibold">Watch out</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri} className="border-b border-slate-100 align-top dark:border-slate-800">
                    {[0, 1, 2].map((j) => <td key={j} className="px-2 py-1.5">{r[j] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-slate-800 dark:text-slate-100">{cleanForPhone(text)}</p>
        )
      )}
      {!loading && text !== null && (
        <div className="mt-2">
          <button type="button" onClick={() => void run()} className="text-[12px] font-semibold text-[#00696b] underline-offset-2 hover:underline dark:text-teal-300">Regenerate</button>
        </div>
      )}
    </div>
  );
};

export const StudyPlanPage: React.FC<{ bankId: string; title: string; subject?: string; onNavigate: (view: AppView) => void }> = ({ bankId, title, subject, onNavigate }) => {
  const isPhone = typeof window !== 'undefined' && window.innerWidth < 768;
  // On phone every piece of plan text goes through cleanForPhone; on PC the text is returned unchanged.
  const phoneText = (s: string): string => (isPhone ? cleanForPhone(s) : s);
  const [misses, setMisses] = useState<Miss[] | null>(null);
  const [savedQuestions, setSavedQuestions] = useState<ClinicalQuestion[] | null>(null);
  const [plan, setPlan] = useState<StudyPlan | null>(() => loadStudyPlan(bankId));
  const [done, setDone] = useState<Record<string, boolean>>(() => loadPlanDone(bankId));
  const [planSourceMode, setPlanSourceMode] = useState<PlanSourceMode>(() => normalizePlanSourceMode(plan?.sourceMode));
  const [revealedRecall, setRevealedRecall] = useState<Record<string, boolean>>({});
  const [understood, setUnderstood] = useState<Record<string, boolean>>(() => loadUnderstood(bankId));
  const [trapFlashOpen, setTrapFlashOpen] = useState(false);
  // Phone study aids: which parts show the three-button row, and which aid each part is showing.
  const [aidMenuOpen, setAidMenuOpen] = useState<Record<string, boolean>>({});
  const [aidShown, setAidShown] = useState<Record<string, StudyAidKind>>({});
  const [busy, setBusy] = useState(false);
  const [buildProgress, setBuildProgress] = useState<PlanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ id: number; text: string; context?: string } | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  // The phone chat stays mounted after its first opening, so an answer being written keeps running when the panel is closed.
  const [chatMounted] = useState(true);
  const [chatBusy, setChatBusy] = useState(false);
  const chatBtnRef = useRef<HTMLButtonElement | null>(null);
  const chatPanelRef = useRef<HTMLDivElement | null>(null);
  const chatDragRef = useRef<{ y: number; scroller: HTMLElement | null; dy: number; active: boolean; t: number } | null>(null);
  const chatClosingRef = useRef(false);
  // Every topic has its own chat thread; null is the general thread for the whole plan.
  const [topic, setTopic] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  const stopRef = useRef(false);
  const seedIdRef = useRef(1);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const loaded = loadStudyPlan(bankId);
    setPlan(loaded);
    setDone(loadPlanDone(bankId));
    setPlanSourceMode(normalizePlanSourceMode(loaded?.sourceMode));
    setRevealedRecall({});
    setUnderstood(loadUnderstood(bankId));
  }, [bankId]);

  useEffect(() => {
    let live = true;
    setMisses(null);
    setSavedQuestions(null);
    setError(null);
    (async () => {
      try {
        const saved = await getModule(bankId);
        if (!saved) throw new Error('This question bank is no longer stored.');
        const run = loadRunSession(bankId);
        const notebook: Record<string, number> = {};
        try {
          for (const item of listCapturedQuestions()) {
            const rec = item as { id?: string; timesMissed?: number };
            const id = String(rec.id ?? '');
            if (!id.startsWith('TEST-')) continue;
            const questionId = id.slice(5);
            const times = Number(rec.timesMissed ?? 0);
            if (questionId && Number.isFinite(times) && times > 0) notebook[questionId] = times;
          }
        } catch {}
        const list = collectMisses(saved.questions, run?.answers ?? {}, run?.flags ?? {}, notebook);
        if (live) {
          setSavedQuestions(saved.questions);
          setMisses(list);
        }
      } catch (err: any) {
        if (live) setError(err?.message || 'Could not read this question bank.');
      }
    })();
    return () => {
      live = false;
      stopRef.current = true;
    };
  }, [bankId]);

  const ask = (text: string, context?: string, forTopic?: string) => {
    if (forTopic !== undefined) setTopic(forTopic);
    setSeed({ id: seedIdRef.current++, text, context });
    if (!isDesktop) openChat();
  };

  const chatOrigin = () => {
    const r = chatBtnRef.current?.getBoundingClientRect();
    return r ? `${Math.round(r.left + r.width / 2)}px ${Math.round(r.top + r.height / 2)}px` : '90% 90%';
  };

  // One place for every frame of the open and close motion: p = 0 is a small dot inside the Ask AI button, p = 1 is the full screen.
  // The bias pushes the panel toward the side the finger swiped, so it seems to come out from that side.
  const placeChat = (p: number, biasX = 0, biasY = 0) => {
    const el = chatPanelRef.current;
    if (!el) return;
    el.style.transformOrigin = chatOrigin();
    el.style.transform = `translate(${(biasX * (1 - p)).toFixed(1)}px, ${(biasY * (1 - p)).toFixed(1)}px) scale(${(0.08 + 0.92 * p).toFixed(4)})`;
    el.style.opacity = String(Math.min(1, p * 2.5));
    el.style.borderRadius = `${Math.round((1 - p) * 300)}px`;
  };
  // Moves to p with a decelerating curve that starts fast, so there is no slow start (that looked like a pause).
  const animateChat = (p: number, ms: number) => {
    const el = chatPanelRef.current;
    if (!el) return;
    el.style.transition = `transform ${ms}ms cubic-bezier(0.22,1,0.36,1), opacity ${ms}ms ease-out, border-radius ${ms}ms ease-out`;
    placeChat(p);
  };

  // Open: the panel grows out of the Ask AI button until it fills the screen (from a tap, or finishing a swipe).
  const openChat = (biasX = 0, biasY = 0) => {
    const el = chatPanelRef.current;
    setMobileChatOpen(true);
    if (!el) return;
    chatClosingRef.current = false;
    if (el.style.display !== 'flex') {
      el.style.display = 'flex';
      el.style.transition = 'none';
      placeChat(0, biasX, biasY);
      void el.offsetWidth;
    }
    animateChat(1, 360);
  };

  // Close: the panel shrinks back into the Ask AI button (the answer keeps being written).
  const closeChat = () => {
    const el = chatPanelRef.current;
    if (!el || chatClosingRef.current) return;
    chatClosingRef.current = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    animateChat(0, 260);
    window.setTimeout(() => {
      el.style.display = 'none';
      chatClosingRef.current = false;
      setMobileChatOpen(false);
      setSeed(null);
    }, 270);
  };
  // Phone Back: close the flashcards, or shrink the Ask AI chat.
  useBackLayer(mobileChatOpen, closeChat);
  useBackLayer(trapFlashOpen, () => setTrapFlashOpen(false));

  // Swipe down on the open panel: it shrinks toward the button while the finger follows.
  const chatTouch = {
    onTouchStart: (e: React.TouchEvent) => {
      if (chatClosingRef.current) return;
      let n = e.target as HTMLElement | null;
      let scroller: HTMLElement | null = null;
      while (n && n !== e.currentTarget) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) { scroller = n; break; }
        n = n.parentElement;
      }
      chatDragRef.current = { y: e.touches[0].clientY, scroller, dy: 0, active: false, t: Date.now() };
    },
    onTouchMove: (e: React.TouchEvent) => {
      const d = chatDragRef.current;
      const el = chatPanelRef.current;
      if (!d || !el) return;
      const dy = e.touches[0].clientY - d.y;
      if (!d.active) {
        if (dy > 12 && (!d.scroller || d.scroller.scrollTop <= 0)) { d.active = true; d.y = e.touches[0].clientY; el.style.transition = 'none'; }
        else return;
      }
      d.dy = Math.max(0, e.touches[0].clientY - d.y);
      placeChat(Math.max(0, 1 - d.dy / (window.innerHeight * 0.55)));
    },
    onTouchEnd: () => {
      const d = chatDragRef.current;
      chatDragRef.current = null;
      if (!d || !d.active) return;
      const fast = d.dy / Math.max(1, Date.now() - d.t) > 0.5;
      if (d.dy > 90 || (fast && d.dy > 45)) closeChat();
      else animateChat(1, 240);
    },
  };

  // Press and swipe on the Ask AI button: the panel opens following the finger, from the side it was swiped toward.
  const btnDragRef = useRef<{ x: number; y: number; t: number; active: boolean; p: number; ux: number; uy: number } | null>(null);
  const btnSuppressClickRef = useRef(false);
  const btnTouch = {
    onTouchStart: (e: React.TouchEvent) => {
      if (chatClosingRef.current) return;
      const t = e.touches[0];
      btnDragRef.current = { x: t.clientX, y: t.clientY, t: Date.now(), active: false, p: 0, ux: 0, uy: 0 };
    },
    onTouchMove: (e: React.TouchEvent) => {
      const d = btnDragRef.current;
      const el = chatPanelRef.current;
      if (!d || !el) return;
      const t = e.touches[0];
      const dx = t.clientX - d.x;
      const dy = t.clientY - d.y;
      const dist = Math.hypot(dx, dy);
      if (!d.active) {
        if (dist < 10) return;
        d.active = true;
        chatClosingRef.current = false;
        el.style.display = 'flex';
        el.style.transition = 'none';
      }
      d.ux = dx / dist;
      d.uy = dy / dist;
      d.p = Math.min(1, dist / 240);
      placeChat(d.p, d.ux * 160, d.uy * 160);
    },
    onTouchEnd: () => {
      const d = btnDragRef.current;
      btnDragRef.current = null;
      if (!d || !d.active) return;
      btnSuppressClickRef.current = true;
      window.setTimeout(() => { btnSuppressClickRef.current = false; }, 400);
      const fast = (d.p * 240) / Math.max(1, Date.now() - d.t) > 0.5;
      if (d.p > 0.4 || (d.p > 0.15 && fast)) {
        setSeed(null);
        openChat(d.ux * 160, d.uy * 160);
      } else {
        animateChat(0, 220);
        window.setTimeout(() => {
          const el = chatPanelRef.current;
          if (el && !chatDragRef.current) el.style.display = 'none';
        }, 230);
      }
    },
  };

  const runBuild = async (list: Miss[]) => {
    if (!list.length || busy) return;
    const provider = getActiveProvider();
    if (!provider) {
      setError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`);
      return;
    }
    const sourceMode = normalizePlanSourceMode(planSourceMode);
    stopRef.current = false;
    setBusy(true);
    setError(null);
    setBuildProgress({ stage: 'Starting', done: 0, total: 1 });
    try {
      const result = await buildStudyPlan({
        bankId,
        misses: list,
        provider,
        model: getEffectiveModel(provider),
        onProgress: setBuildProgress,
        shouldStop: () => stopRef.current,
        sourceMode,
        research: researchForPlan(sourceMode),
      });
      if (stopRef.current) return;
      if (!result.chunks.length) throw new Error('The AI gave no usable plan. Nothing was saved. Try again.');
      const planWithSourceMode: StudyPlan = { ...result, sourceMode };
      saveStudyPlan(planWithSourceMode);
      setPlan(planWithSourceMode);
      setPlanSourceMode(sourceMode);
      setRevealedRecall({});
      setDone(loadPlanDone(bankId));
    } catch (err: any) {
      setError(err?.message || 'Could not build the study plan.');
    } finally {
      setBusy(false);
      setBuildProgress(null);
    }
  };

  const generate = () => {
    if (!misses?.length) return;
    void runBuild(misses);
  };

  const buildPreRead = () => {
    if (!savedQuestions?.length) {
      setError('This question bank has no topics to read.');
      return;
    }
    const pre = collectPreRead(savedQuestions);
    if (!pre.length) {
      setError('This question bank has no topics to read.');
      return;
    }
    setMisses(pre);
    void runBuild(pre);
  };

  const toggleDone = (chunkId: string) => {
    const next = setPlanPartDone(bankId, chunkId, !isPartDone(done, chunkId));
    setDone(next);
  };

  const toggleUnderstood = (key: string) => {
    const next = { ...understood, [key]: !understood[key] };
    setUnderstood(next);
    saveUnderstood(bankId, next);
  };

  // Phone-only data: every trap in the plan, in order, and the count of parts marked understood.
  const planTraps = plan ? plan.chunks.flatMap((c) => c.traps) : [];
  const understoodCount = plan ? plan.chunks.filter((c) => understood[c.chunkId || c.title]).length : 0;

  const wrongCount = misses?.filter((m) => m.reason === 'wrong' || m.reason === 'both').length ?? 0;
  const flaggedCount = misses?.filter((m) => m.reason === 'flagged' || m.reason === 'both').length ?? 0;
  const skippedCount = misses?.filter((m) => m.reason === 'skipped').length ?? 0;
  const preReadCount = misses?.filter((m) => m.reason === 'preread').length ?? 0;
  const plannedIds = plan ? planQuestionIds(plan) : null;
  const plannedQuestionCount = plannedIds?.size ?? 0;
  const newCount = plan && misses && plannedIds ? misses.filter((m) => m.reason !== 'preread' && !plannedIds.has(m.id)).length : 0;
  const threadId = topic ? `${bankId}::${topic}` : bankId;
  const chatTitle = topic ? `${topic} (${title})` : title;
  // The bank's own questions carry the subject, so the search can use it without the caller passing it.
  const planSubject = subject || savedQuestions?.[0]?.subject || '';
  const topicPicker = plan && plan.chunks.length ? (
    <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      <span className="shrink-0">Chat about</span>
      <select
        value={topic ?? ''}
        onChange={(e) => { setSeed(null); setTopic(e.target.value || null); }}
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
      >
        <option value="">Whole plan (general)</option>
        {plan.chunks.map((c) => <option key={c.title} value={c.title}>{c.title}</option>)}
      </select>
    </label>
  ) : null;

  const totalParts = plan?.chunks.length ?? 0;
  const doneCount = plan ? plan.chunks.filter((c) => isPartDone(done, c.chunkId)).length : 0;
  const minutesLeft = plan ? plan.chunks.reduce((sum, c) => sum + (isPartDone(done, c.chunkId) ? 0 : chunkMinutes(c)), 0) : 0;
  const donePercent = totalParts > 0 ? Math.round((doneCount / totalParts) * 100) : 0;

  return (
    <div className={`space-y-4 max-w-7xl mx-auto ${isPhone ? 'pb-32' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <button
            type="button"
            onClick={() => onNavigate('question-bank')}
            className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ChevronLeft className="h-4 w-4" /> Question Bank
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              <BookOpen className="h-5 w-5 text-[#0f8b8d]" /> Study plan
            </div>
            <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">{title}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={busy || !misses?.length}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0f8b8d] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#0b6b6d] disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : plan ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Building…' : plan ? 'Rebuild plan' : 'Build my study plan'}
        </button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-4">
          <div className={`max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 ${isPhone ? 'px-3 py-2' : 'px-4 py-3'}`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Source mode</div>
            <div className={isPhone ? 'mt-1.5 flex flex-nowrap gap-1.5' : 'mt-2 flex flex-wrap gap-2'} role="radiogroup" aria-label="Study plan source mode">
              {PLAN_SOURCE_MODES.map((opt) => (
                <label
                  key={opt.value}
                  className={`inline-flex cursor-pointer items-center rounded-xl border font-semibold shadow-sm focus-within:ring-2 focus-within:ring-[#0f8b8d] ${isPhone ? 'min-h-[30px] px-2.5 text-[11.5px]' : 'min-h-[40px] px-3 text-[12.5px]'} ${
                    planSourceMode === opt.value
                      ? 'border-[#0f8b8d] bg-teal-50 text-[#00696b] dark:border-teal-500/60 dark:bg-teal-950/40 dark:text-teal-200'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="plan-source-mode"
                    value={opt.value}
                    checked={planSourceMode === opt.value}
                    disabled={busy}
                    onChange={() => setPlanSourceMode(opt.value)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {!isPhone && <p className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">Applies only to building this study plan. Chat has its own source controls.</p>}
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 dark:border-rose-400/50 dark:bg-rose-950/50 dark:text-rose-100">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
            </div>
          )}

          {misses === null && !error && (
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading your answers…
            </div>
          )}

          {misses && (
            <div className={`max-w-3xl flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 ${isPhone ? 'px-3 py-2 text-[13px] whitespace-nowrap overflow-x-auto gap-x-2.5' : 'px-4 py-3'}`}>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-700 dark:text-rose-300"><XCircle className="h-4 w-4" /> {wrongCount} wrong</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300"><Flag className="h-4 w-4" /> {flaggedCount} flagged</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300"><SkipForward className="h-4 w-4" /> {skippedCount} skipped</span>
              {preReadCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 dark:text-teal-300"><BookOpen className="h-4 w-4" /> {preReadCount} pre-read</span>
              )}
              <span className={`text-xs text-slate-500 dark:text-slate-400 ${isPhone ? 'hidden' : ''}`}>
                {plan && plannedIds
                  ? `This saved plan covers ${plannedQuestionCount} question${plannedQuestionCount === 1 ? '' : 's'}.`
                  : `The plan covers these ${misses.length} question${misses.length === 1 ? '' : 's'}.`}
              </span>
            </div>
          )}

          {misses && misses.length === 0 && (
            <div className="max-w-3xl rounded-2xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-600 dark:border-slate-600 dark:text-slate-300">
              <p>Nothing to study yet. Answer some questions in this bank, or flag the ones you are unsure about, and come back.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate('question-bank')}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="h-4 w-4" /> Go to Question Bank
                </button>
                <button
                  type="button"
                  onClick={buildPreRead}
                  disabled={busy || !savedQuestions?.length}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0f8b8d] px-3 text-[13px] font-semibold text-white shadow-sm hover:bg-[#0b6b6d] disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
                  Build a pre-read plan from this bank's topics
                </button>
              </div>
            </div>
          )}

          {plan && newCount > 0 && (
            <div className="max-w-3xl flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/50 dark:bg-amber-950/40 dark:text-amber-100">
              <span className="font-semibold">{newCount} new question{newCount === 1 ? '' : 's'} since this plan was built</span>
              <button
                type="button"
                onClick={generate}
                disabled={busy}
                className="ml-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#0f8b8d] px-3 text-[13px] font-semibold text-white shadow-sm hover:bg-[#0b6b6d] disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Update plan
              </button>
            </div>
          )}

          {busy && buildProgress && (
            <div role="status" className="max-w-3xl rounded-2xl border border-teal-300 bg-teal-50 px-4 py-3 text-sm text-teal-900 dark:border-teal-400/40 dark:bg-teal-950/40 dark:text-teal-100">
              <div className="font-semibold">{buildProgress.stage}… {buildProgress.done}/{buildProgress.total}</div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-teal-100 dark:bg-teal-900">
                <div className="h-full rounded-full bg-[#0f8b8d] transition-all" style={{ width: `${Math.round((buildProgress.done / Math.max(1, buildProgress.total)) * 100)}%` }} />
              </div>
            </div>
          )}

          {plan && (
            <>
              <div className={`max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 ${isPhone ? 'px-3 py-2' : 'px-4 py-3'}`}>
                {isPhone && (
                  <div className="mb-1.5">
                    <PhoneProgressRing done={understoodCount} total={totalParts} />
                  </div>
                )}
                <div className={`font-semibold text-slate-800 dark:text-slate-100 ${isPhone ? 'whitespace-nowrap text-[13px]' : 'text-sm'}`}>
                  {doneCount} of {totalParts} read · about {minutesLeft} min left
                </div>
                <div className={`overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700 ${isPhone ? 'mt-1.5 h-1' : 'mt-2 h-2'}`}>
                  <div className="h-full rounded-full bg-[#0f8b8d] transition-all" style={{ width: `${donePercent}%` }} />
                </div>
                {!isPhone && <p className="mt-1 text-[11.5px] text-slate-500 dark:text-slate-400">Retesting is not measured here; this checklist only tracks reading.</p>}
              </div>

              <article className="max-w-3xl space-y-6">
                <div className={`rounded-2xl border border-[#0f8b8d]/30 bg-teal-50/60 text-[14px] leading-relaxed text-slate-800 dark:bg-teal-950/30 dark:text-slate-100 ${isPhone ? 'px-3 py-2' : 'px-4 py-3'}`}>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#00696b] dark:text-teal-300">Read in this order</div>
                  {!isPhone && plan.overview}
                  <ol className="mt-2 space-y-1">
                    {plan.chunks.map((c, i) => (
                      <li key={i} className="flex items-start gap-2 text-[13px]">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0f8b8d] text-[11px] font-semibold text-white">{i + 1}</span>
                        <a
                          href={`#plan-part-${i + 1}`}
                          onClick={(e) => {
                            e.preventDefault();
                            document.getElementById(`plan-part-${i + 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                          className="hover:underline"
                        >
                          {c.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>

                {plan.chunks.map((c, i) => {
                  const partDone = isPartDone(done, c.chunkId);
                  const coveredQuestions: CoveredQuestionView[] = c.coveredQuestions ?? [];
                  const evidenceNote = c.evidenceNote ?? '';
                  const partContext = [c.intro, c.sections.map((s) => s.heading).join('; ')].filter(Boolean).join('\n');
                  const partKey = c.chunkId || c.title;
                  return (
                    <section key={c.chunkId || i} id={`plan-part-${i + 1}`} className={`scroll-mt-4 space-y-3 ${partDone ? 'opacity-75' : ''}`}>
                      {!isPhone && i > 0 && c.connects && (
                        <div className="flex items-start gap-2 rounded-xl bg-slate-100 px-3 py-2 text-[12.5px] italic text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />{c.connects}
                        </div>
                      )}

                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="flex min-w-0 items-center gap-2 text-[17px] font-semibold text-slate-900 dark:text-white">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0f8b8d] text-[13px] text-white">{i + 1}</span>
                          <span className="min-w-0">{phoneText(c.title)}</span>
                          {partDone && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Read" />}
                          {isPhone && (() => {
                            const askedHere = coveredQuestions.filter((q) => {
                              const needle = c.title.trim().toLowerCase();
                              return needle !== '' && [q.questionText, q.correctText, q.reason].filter(Boolean).join(' ').toLowerCase().includes(needle);
                            }).length;
                            const trapHeavy = c.traps.length >= 2;
                            if (!askedHere && !trapHeavy) return null;
                            return (
                              <span className="flex shrink-0 gap-1 whitespace-nowrap">
                                {askedHere > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">Asked {askedHere}×</span>}
                                {trapHeavy && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10.5px] font-semibold text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">Trap-heavy</span>}
                              </span>
                            );
                          })()}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2">
                          {isPhone && (
                            <button
                              type="button"
                              onClick={() => toggleUnderstood(c.chunkId || c.title)}
                              aria-pressed={!!understood[c.chunkId || c.title]}
                              aria-label={understood[c.chunkId || c.title] ? 'Unmark understood' : 'Mark understood'}
                              title={understood[c.chunkId || c.title] ? 'Understood' : 'Mark understood'}
                              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                                understood[c.chunkId || c.title]
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
                                  : 'border-slate-300 bg-white text-transparent hover:border-emerald-500 dark:border-slate-600 dark:bg-slate-900'
                              }`}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 max-md:hidden">~{chunkMinutes(c)} min</span>
                          <button
                            type="button"
                            onClick={() => toggleDone(c.chunkId)}
                            aria-pressed={partDone}
                            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold shadow-sm ${
                              partDone
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/40'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                            }`}
                          >
                            {partDone ? <CheckCircle2 className="h-4 w-4" /> : null}
                            {partDone ? 'Mark unread' : 'Mark read'}
                          </button>
                          {isPhone && (
                            <button
                              type="button"
                              onClick={() => setAidMenuOpen((m) => ({ ...m, [partKey]: !m[partKey] }))}
                              aria-expanded={!!aidMenuOpen[partKey]}
                              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              Study aids
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => ask(`Explain more about: ${c.title}`, partContext, c.title)}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#0f8b8d]/40 bg-teal-50 px-3 text-[12.5px] font-semibold text-[#00696b] hover:bg-teal-100 dark:border-teal-500/40 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-900/40"
                          >
                            <Sparkles className="h-4 w-4" /> Ask AI
                          </button>
                        </div>
                      </div>

                      {isPhone && aidMenuOpen[partKey] && (
                        <div role="group" aria-label="Study aids" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                          {STUDY_AID_KINDS.map((k) => (
                            <button
                              key={k.value}
                              type="button"
                              onClick={() => {
                                setAidShown((s) => ({ ...s, [partKey]: k.value }));
                                setAidMenuOpen((m) => ({ ...m, [partKey]: false }));
                              }}
                              className="inline-flex min-h-[34px] flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-[#0f8b8d]/40 bg-white px-2 text-[12px] font-semibold text-[#00696b] hover:bg-teal-50 dark:border-teal-500/40 dark:bg-slate-900 dark:text-teal-200 dark:hover:bg-slate-800"
                            >
                              {k.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {isPhone && (c.intro || c.why) && (
                        <div className="rounded-xl bg-teal-50/70 px-4 py-2 dark:bg-teal-950/30">
                          <span className="block text-[10px] font-bold uppercase tracking-wide text-[#00696b] dark:text-teal-300">Remember this</span>
                          <span className="mt-0.5 block text-[15px] font-semibold leading-snug text-slate-900 dark:text-white">{firstSentenceForPhone(c.intro || c.why)}</span>
                        </div>
                      )}
                      {isPhone && aidShown[partKey] && (
                        <StudyAidCard
                          key={aidShown[partKey]}
                          bankId={bankId}
                          partId={partKey}
                          kind={aidShown[partKey]}
                          topic={c.title}
                          context={partContext}
                          onClose={() => setAidShown((s) => {
                            const next = { ...s };
                            delete next[partKey];
                            return next;
                          })}
                        />
                      )}
                      {c.fallback && (
                        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                          Notes for this part could not be written. Press Rebuild plan to try again.
                        </div>
                      )}
                      {!isPhone && c.why && <p className="text-[12.5px] text-slate-500 dark:text-slate-400">Why this part: {c.why}</p>}
                      {evidenceNote && !(isPhone && /^Sourced from your books only/.test(evidenceNote)) && <p className="text-[12px] text-slate-500 dark:text-slate-400">{phoneText(evidenceNote)}</p>}
                      {(() => {
                        if (!c.intro) return null;
                        if (!isPhone) return <p className="text-[14px] leading-relaxed text-slate-800 dark:text-slate-100">{renderKeyPoints(c.intro, `i${i}`)}</p>;
                        const lead = firstSentenceForPhone(c.intro);
                        const plain = cleanForPhone(c.intro).replace(/\*\*/g, '');
                        const rest = plain.startsWith(lead) ? plain.slice(lead.length).trim() : null;
                        if (rest === '') return null;
                        return <p className="text-[14px] leading-relaxed text-slate-800 dark:text-slate-100">{rest === null ? renderPhonePoints(c.intro, `i${i}`) : rest}</p>;
                      })()}

                      {c.sections.map((s, k) => isPhone ? (
                        <PhoneDetailCard
                          key={k}
                          heading={s.heading}
                          points={s.points}
                          keyPrefix={`s${i}-${k}`}
                          onAsk={() => ask(`Explain more: ${s.heading} (${c.title})`, s.points.join('\n'), c.title)}
                        />
                      ) : (
                        <div key={k} className="rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-700">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <div className="text-[14px] font-semibold text-slate-900 dark:text-white">{s.heading}</div>
                            <button
                              type="button"
                              onClick={() => ask(`Explain more: ${s.heading} (${c.title})`, s.points.join('\n'), c.title)}
                              aria-label={`Ask AI about ${s.heading}`}
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-[#0f8b8d] dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-teal-300"
                            >
                              <Sparkles className="h-4 w-4" />
                            </button>
                          </div>
                          <ul className="list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-slate-800 dark:text-slate-100">
                            {s.points.map((p, j) => <li key={j}>{renderKeyPoints(p, `s${i}-${k}-${j}`)}</li>)}
                          </ul>
                        </div>
                      ))}

                      {c.traps.length > 0 && isPhone && (() => {
                        const offset = plan.chunks.slice(0, i).reduce((sum, prev) => sum + prev.traps.length, 0);
                        const check = buildQuickCheck(planTraps, offset);
                        return (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[13px] font-semibold text-rose-800 dark:text-rose-200">Exam traps</div>
                              {planTraps.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setTrapFlashOpen(true)}
                                  className="inline-flex min-h-[32px] items-center rounded-lg border border-rose-200 bg-white px-2.5 text-[12px] font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800/50 dark:bg-slate-900 dark:text-rose-200 dark:hover:bg-slate-800"
                                >
                                  Practise traps
                                </button>
                              )}
                            </div>
                            {c.traps.map((t, j) => <PhoneTrapCard key={j} trap={t} keyPrefix={`t${i}-${j}`} />)}
                            {check && <PhoneQuickCheck stem={check.stem} options={check.options} correctIndex={check.correctIndex} />}
                          </div>
                        );
                      })()}
                      {c.traps.length > 0 && !isPhone && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 dark:border-rose-800/50 dark:bg-rose-950/30">
                          <div className="mb-1 text-[13px] font-semibold text-rose-800 dark:text-rose-200">Exam traps</div>
                          <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-rose-950 dark:text-rose-100">
                            {c.traps.map((t, j) => <li key={j}>{renderKeyPoints(t, `t${i}-${j}`)}</li>)}
                          </ul>
                        </div>
                      )}

                      {c.sources && c.sources.length > 0 && (
                        <details className={`rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[12.5px] dark:border-slate-700 dark:bg-slate-800/40 ${isPhone ? 'group' : ''}`}>
                          <summary className={`cursor-pointer font-semibold text-slate-700 dark:text-slate-200 ${isPhone ? 'toc-sum flex list-none items-center gap-1.5 text-[12px] [&::-webkit-details-marker]:hidden' : ''}`}>
                            {isPhone && <ChevronRight className="h-5 w-5 shrink-0 transition-transform group-open:rotate-90" />}
                            Sources ({c.sources.length})
                          </summary>
                          <ul className="mt-2 space-y-2 text-slate-600 dark:text-slate-300">
                            {c.sources.map((s, si) => {
                              const href = s.kind === 'web' ? safeHttpHref(s.url) : null;
                              return (
                                <li key={`${s.n}-${si}`} className="space-y-0.5">
                                  <div className="flex flex-wrap items-baseline gap-2">
                                    <span className="font-mono text-[11px]">[{s.n}]</span>
                                    {href ? (
                                      <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#00696b] underline-offset-2 hover:underline dark:text-teal-300">
                                        {s.title || href}
                                      </a>
                                    ) : (
                                      <span className="font-semibold">{s.title || (s.kind === 'book' ? 'Book source' : 'Source')}</span>
                                    )}
                                  </div>
                                  {s.text && <p className="text-[12px] leading-relaxed">{phoneText(s.text)}</p>}
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      )}

                      {coveredQuestions.length > 0 && (
                        <details className={`rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2 text-[12.5px] dark:border-slate-700 dark:bg-slate-800/40 ${isPhone ? 'group' : ''}`}>
                          <summary className={`cursor-pointer font-semibold text-slate-700 dark:text-slate-200 ${isPhone ? 'toc-sum flex list-none items-center gap-1.5 text-[12px] [&::-webkit-details-marker]:hidden' : ''}`}>
                            {isPhone && <ChevronRight className="h-5 w-5 shrink-0 transition-transform group-open:rotate-90" />}
                            Covered questions ({coveredQuestions.length})
                          </summary>
                          <ul className="mt-2 space-y-1.5 text-slate-600 dark:text-slate-300">
                            {coveredQuestions.map((q, j) => {
                              const chosen = [q.chosenLetter, q.chosenText].filter(Boolean).join(' — ') || '—';
                              const correct = [q.correctLetter, q.correctText].filter(Boolean).join(' — ') || '—';
                              const reason = q.missReason && q.reason ? `${q.missReason}: ${q.reason}` : q.missReason || q.reason || '';
                              return (
                                <li key={`${q.id || 'q'}-${j}`} className="space-y-0.5">
                                  <div className="flex flex-wrap items-baseline gap-x-2">
                                    <span className="font-mono text-[11px]">{q.id || `question-${j + 1}`}</span>
                                    {q.questionNumber ? <span className="text-[11px] font-semibold">Q{q.questionNumber}</span> : null}
                                    <span className="min-w-0 flex-1">{q.questionText || 'Question text not recorded'}</span>
                                  </div>
                                  <div>
                                    <span>Selected: {chosen}</span>
                                    <span> · Correct: {correct}</span>
                                    {reason ? <span> · Reason: {reason}</span> : null}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </details>
                      )}
                    </section>
                  );
                })}

                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  Written by AI from your wrong and flagged questions on {new Date(plan.at).toLocaleString()}. Check important details against your textbook.
                  {plan.sourceModeUnrecorded || plan.chunks.some((chunk) => chunk.sourceModeUnrecorded)
                    ? ' · source mode: unrecorded · evidence: not run'
                    : plan.sourceMode !== 'both'
                      ? ` · source mode: ${plan.sourceMode}`
                      : ''}
                </p>
              </article>
            </>
          )}
        </div>

        {isDesktop && (
          <div className="hidden lg:block lg:w-[400px] lg:shrink-0 lg:self-stretch">
            <div className="flex flex-col gap-2 lg:sticky lg:top-4 lg:h-[calc(100dvh-7rem)]">
              {topicPicker}
              <div className="min-h-0 flex-1"><GroundedChat key={threadId} bankId={threadId} title={chatTitle} subject={planSubject} seed={seed} /></div>
            </div>
          </div>
        )}
      </div>

      {!isDesktop && (
        <>
          <button
            ref={chatBtnRef}
            type="button"
            {...btnTouch}
            onClick={() => {
              if (btnSuppressClickRef.current) return;
              setSeed(null);
              openChat();
            }}
            style={{ touchAction: 'none' }}
            className="fixed right-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-[#0f8b8d] px-4 text-sm font-semibold text-white shadow-lg hover:bg-[#0b6b6d] lg:hidden"
          >
            {chatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />} {chatBusy ? 'Writing…' : 'Ask AI'}
          </button>

          {trapFlashOpen && planTraps.length > 0 && (
            <PhoneTrapFlashcards traps={planTraps} onClose={() => setTrapFlashOpen(false)} />
          )}

          {chatMounted && (
            <div
              ref={chatPanelRef}
              aria-hidden={!mobileChatOpen}
              {...chatTouch}
              style={{ display: 'none', overscrollBehavior: 'contain', willChange: 'transform' }}
              className="fixed inset-0 z-50 flex-col overflow-hidden bg-white dark:bg-slate-900"
            >
              {topicPicker}
              <div className="min-h-0 flex-1"><GroundedChat
                key={threadId}
                bankId={threadId}
                title={chatTitle}
                subject={planSubject}
                seed={seed}
                onBusyChange={setChatBusy}
                onClose={closeChat}
              /></div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
