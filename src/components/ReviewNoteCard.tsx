import React from 'react';
import { AlertTriangle, ArrowRight, Brain, CheckCircle2, ChevronDown, Lightbulb, Sparkles, XCircle } from 'lucide-react';
import type { ClinicalQuestion } from '../types.ts';
import { renderKeyPoints } from './KeyText.tsx';

// The note shown after a question is answered. It is written to be pleasant to read: a warm result line, the one big idea,
// why each wrong option is wrong, a memory hook, a trap to watch for, and a short recall check at the end.
// Each marker keeps one meaning: yellow = key point, teal = the big idea, rose = wrong or a trap, amber = remember this.

const HIGH_YIELD = /^\s*(?:[-•]\s*)?(?:\*\*)?(high[- ]yield|exam tip|remember|pearl|trap)\b[:\-–]?(?:\*\*)?[:\-–]?\s*/i;
const BULLET = /^\s*[-•*]\s+/;
const strip = (s: string) => s.replace(/\*\*/g, '').trim();

interface Parsed { bigIdea: string; wrong: string[]; focus: string[]; more: string[] }

function parse(q: ClinicalQuestion): Parsed {
  const correct = q.options.find((o) => o.id === q.correctOption)?.text ?? '';
  const lines = String(q.explanation || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const out: Parsed = { bigIdea: '', wrong: [], focus: [], more: [] };
  lines.forEach((line, i) => {
    if (HIGH_YIELD.test(line)) out.focus.push(line.replace(HIGH_YIELD, ''));
    else if (i === 0 && /^\*\*/.test(line) && !out.bigIdea) out.bigIdea = line;
    else if (BULLET.test(line)) out.wrong.push(line.replace(BULLET, ''));
    else out.more.push(line);
  });
  if (!out.bigIdea) out.bigIdea = (q.keyFact || '').trim() || (correct ? `The answer is ${correct}.` : '');
  // When the explanation has no bullets, the per-option reasons (NEET PG / INI-CET questions carry them) say why each
  // wrong option is wrong.
  if (!out.wrong.length && q.optionReasons) {
    for (const o of q.options) {
      const why = q.optionReasons[o.id];
      if (o.id !== q.correctOption && why) out.wrong.push(`**${o.text}:** ${why}`);
    }
  }
  return out;
}

export const ReviewNoteCard: React.FC<{
  q: ClinicalQuestion;
  userChoice?: string;
  onTeach?: () => void;
  /** Jump to another unanswered question on the same topic, only offered after a wrong answer. */
  onTryRelated?: () => void;
}> = ({ q, userChoice, onTeach, onTryRelated }) => {
  const p = parse(q);
  const answered = !!userChoice;
  const right = answered && userChoice === q.correctOption;
  const correctText = q.options.find((o) => o.id === q.correctOption)?.text ?? '';
  const trap = (q.trapExplanation || '').trim();

  return (
    <div className="space-y-4 max-md:space-y-2.5">
      {/* Result */}
      <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 max-md:rounded-xl max-md:px-3 max-md:py-2.5 max-md:gap-2 max-md:border-0 max-md:bg-none max-md:px-2.5! max-md:py-2! max-md:shadow-none ${right ? 'border-emerald-300 bg-gradient-to-r from-emerald-50 to-white dark:border-emerald-800/60 dark:from-emerald-950/40 dark:to-slate-900 max-md:bg-emerald-50 max-md:dark:bg-emerald-950/30' : answered ? 'border-amber-300 bg-gradient-to-r from-amber-50 to-white dark:border-amber-800/60 dark:from-amber-950/30 dark:to-slate-900 max-md:bg-amber-50 max-md:dark:bg-amber-950/30' : 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40 max-md:bg-slate-100 max-md:dark:bg-slate-800/40'}`}>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full max-md:h-7 max-md:w-7 max-md:h-6! max-md:w-6! ${right ? 'bg-emerald-500 text-white' : answered ? 'bg-amber-400 text-amber-950' : 'bg-slate-300 text-slate-700'}`}>
          {right ? <CheckCircle2 className="h-5 w-5 max-md:h-4 max-md:w-4 max-md:h-[14px]! max-md:w-[14px]!" /> : <Sparkles className="h-5 w-5 max-md:h-4 max-md:w-4 max-md:h-[14px]! max-md:w-[14px]!" />}
        </span>
        <div className="min-w-0 max-md:flex-1 max-md:[&>div:first-child]:text-[13px]! max-md:[&>div:first-child]:leading-5 max-md:[&>div:first-child]:truncate">
          <div className={`text-[15px] font-semibold max-md:text-[14px]! ${right ? 'text-emerald-900 dark:text-emerald-100' : 'text-slate-900 dark:text-white'}`}>
            {right ? 'Nice work, you got it.' : answered ? 'Not this time, and that is how it sticks.' : 'Here is the idea.'}
          </div>
          <div className="text-[12.5px] text-slate-600 dark:text-slate-300 max-md:text-[12px]! max-md:hidden">{right ? 'Read the idea once more so it is easy to find again.' : 'Read the big idea below, then try the recall check at the end.'}</div>
        </div>
        {answered && !right && onTeach && (
          <button onClick={onTeach} className="ml-auto inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl bg-[#0f8b8d] px-3.5 text-[13px] font-semibold text-white shadow-sm hover:bg-[#0b6b6d] max-md:min-h-[32px]! max-md:rounded-lg max-md:px-2.5! max-md:text-[11px]! max-md:gap-1 max-md:shadow-none max-md:whitespace-nowrap"><Sparkles className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> Teach me this</button>
        )}
      </div>

      {/* Try the idea on a second question: offered only after a wrong answer, and only when another
          unanswered question on the exact same topic is already in this set. */}
      {answered && !right && onTryRelated && (
        <button
          type="button"
          onClick={onTryRelated}
          className="flex w-full items-center gap-2.5 rounded-xl border border-[#0f8b8d]/40 bg-[#e3f4f4] px-3.5 py-2.5 text-left transition-colors hover:border-[#0f8b8d] hover:bg-[#d3eeee] dark:border-teal-700/50 dark:bg-teal-950/30 dark:hover:bg-teal-950/50 max-md:py-2"
        >
          <ArrowRight className="h-4 w-4 shrink-0 text-[#0f8b8d] dark:text-teal-300" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-[#0a5d5f] dark:text-teal-100">
              Try a related question
            </span>
            <span className="block text-[12px] text-[#0f8b8d]/80 dark:text-teal-300/80">
              Same topic, one more time, so the idea moves from reading to doing.
            </span>
          </span>
        </button>
      )}

      {/* Big idea */}
      {strip(p.bigIdea) && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0d3b3e] via-[#0f6b6d] to-[#14a8a3] p-4 text-white shadow-md max-md:rounded-xl max-md:bg-[#0f6b6d] max-md:p-3! max-md:dark:bg-[#0d4f52] max-md:bg-none max-md:shadow-none">
          <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 max-md:hidden" />
          <div className="relative flex gap-3 max-md:gap-2">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-200 max-md:mt-0 max-md:h-4 max-md:w-4" />
            <div className="min-w-0 max-md:[&_p]:text-[13.5px]! max-md:[&_p]:leading-[1.5]! max-md:[&_p]:font-semibold">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-100 max-md:text-[11px]!">The big idea</div>
              <p className="mt-1 text-[16px] leading-7 text-white max-md:text-[15px]! max-md:leading-[1.55] max-md:mt-0.5">{strip(p.bigIdea)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Why the others are wrong */}
      {p.wrong.length > 0 && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900/50 dark:bg-rose-950/20 max-md:rounded-xl max-md:p-3! max-md:border-0 max-md:bg-rose-50/70 max-md:dark:bg-rose-950/20 max-md:shadow-none">
          <h4 className="flex items-center gap-2 text-[14px] font-semibold text-rose-900 dark:text-rose-100 max-md:text-[12px]! max-md:gap-1.5"><XCircle className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" /> Why the other options are wrong</h4>
          <ul className="mt-2.5 space-y-2 max-md:mt-2 max-md:space-y-1.5">
            {p.wrong.map((line, i) => (
              <li key={i} className="flex gap-2.5 rounded-xl bg-white px-3 py-2 text-[14px] leading-6 text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200 max-md:rounded-none max-md:bg-transparent max-md:px-0 max-md:py-0.5 max-md:shadow-none max-md:text-[13.5px]! max-md:leading-[1.5]! max-md:gap-2 max-md:dark:bg-transparent">
                <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-rose-400 max-md:mt-[7px] max-md:h-1.5 max-md:w-1.5" />
                <span className="min-w-0">{renderKeyPoints(line, `w${i}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.more.map((line, i) => <p key={i} className="text-[14.5px] leading-7 text-slate-700 dark:text-slate-200 max-md:text-[13.5px]! max-md:leading-[1.5]! max-md:text-slate-600 max-md:dark:text-slate-300">{renderKeyPoints(line, `m${i}`)}</p>)}

      {/* Focus */}
      {p.focus.map((line, i) => (
        <div key={i} className="flex gap-3 rounded-2xl border border-amber-300 bg-gradient-to-br from-amber-50 to-white p-3.5 shadow-sm dark:border-amber-700/50 dark:from-amber-950/40 dark:to-slate-900 max-md:rounded-xl max-md:p-3! max-md:border-0 max-md:bg-none max-md:bg-amber-50 max-md:dark:bg-amber-950/30 max-md:shadow-none max-md:gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 text-amber-950 max-md:h-6 max-md:w-6"><Lightbulb className="h-[18px] w-[18px] max-md:h-3.5 max-md:w-3.5" /></span>
          <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">Focus on this</div><p className="mt-0.5 text-[14px] leading-6 text-slate-800 dark:text-slate-100 max-md:text-[13.5px]! max-md:leading-[1.5]! max-md:mt-0">{renderKeyPoints(line, `f${i}`)}</p></div>
        </div>
      ))}

      {/* Trap */}
      {(trap || q.trapType) && (
        <div className="flex gap-3 rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-3.5 shadow-sm dark:border-rose-900/60 dark:from-rose-950/40 dark:to-slate-900 max-md:rounded-xl max-md:p-3! max-md:border-0 max-md:bg-none max-md:bg-rose-50 max-md:dark:bg-rose-950/30 max-md:shadow-none max-md:gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-500 text-white max-md:h-6 max-md:w-6"><AlertTriangle className="h-[18px] w-[18px] max-md:h-3.5 max-md:w-3.5" /></span>
          <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">Watch out{q.trapType ? `: ${q.trapType}` : ''}</div><p className="mt-0.5 text-[14px] leading-6 text-slate-800 dark:text-slate-100 max-md:text-[13.5px]! max-md:leading-[1.5]! max-md:mt-0">{trap || 'The other options look reasonable but do not fit this case.'}</p></div>
        </div>
      )}

      {/* Memory hook */}
      {q.boardPearl && (
        <div className="flex gap-3 rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-3.5 shadow-sm dark:border-teal-900/60 dark:from-teal-950/40 dark:to-slate-900 max-md:rounded-xl max-md:p-3! max-md:border-0 max-md:bg-none max-md:bg-teal-50 max-md:dark:bg-teal-950/30 max-md:shadow-none max-md:gap-2 max-md:items-center">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0f8b8d] text-white max-md:h-6 max-md:w-6"><Brain className="h-[18px] w-[18px] max-md:h-3.5 max-md:w-3.5" /></span>
          <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-wider text-[#00696b] dark:text-teal-300 max-md:hidden">Memory hook</div><p className="mt-0.5 text-[14px] leading-6 text-slate-800 dark:text-slate-100 max-md:mt-0 max-md:text-[13.5px]! max-md:leading-[1.5]!">{renderKeyPoints(q.boardPearl, 'pearl')}</p></div>
        </div>
      )}

      {/* Recall check */}
      <details className="group rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 open:ring-2 open:ring-emerald-300/50 dark:border-emerald-900/60 dark:from-emerald-950/30 dark:to-slate-900 max-md:rounded-xl max-md:p-3! max-md:border-0 max-md:bg-none max-md:bg-emerald-50 max-md:dark:bg-emerald-950/30 max-md:open:ring-0 max-md:shadow-none">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-semibold text-emerald-900 dark:text-emerald-100 max-md:text-[12.5px]! max-md:gap-1.5 max-md:leading-5">
          <Brain className="h-5 w-5 max-md:h-4 max-md:w-4" />
          <span className="min-w-0 flex-1 max-md:truncate">Recall check: say it back in one sentence</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180 max-md:h-3.5 max-md:w-3.5" />
        </summary>
        <p className="mt-2 text-[13px] text-emerald-800/90 dark:text-emerald-200/80 max-md:mt-1.5 max-md:text-[12px]! max-md:leading-[1.5]">Close your eyes and explain why this is the answer. Trying to recall it is what makes it stick. Then tap to compare.</p>
        <p className="mt-2 flex gap-2 rounded-xl bg-white p-3 text-[14px] leading-6 text-slate-700 shadow-sm dark:bg-slate-900 dark:text-slate-200 max-md:mt-2 max-md:rounded-none max-md:bg-transparent max-md:p-0 max-md:shadow-none max-md:text-[13.5px]! max-md:leading-[1.5]! max-md:dark:bg-transparent max-md:gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 max-md:mt-[3px] max-md:h-3.5 max-md:w-3.5" />
          <span className="min-w-0">{correctText ? <><b>{correctText}</b>. </> : null}{strip(p.bigIdea)}</span>
        </p>
      </details>
    </div>
  );
};