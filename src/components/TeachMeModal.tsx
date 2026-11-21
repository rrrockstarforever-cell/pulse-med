import React, { useEffect, useRef, useState } from 'react';
import { TeachChat } from './TeachChat.tsx';
import { BookOpen, Loader2, MessageCircle, RefreshCw, X } from 'lucide-react';
import type { TopicStat } from '../lib/testReview.ts';
import { generateTeachNote, getCachedTeachNote, labelFor, type TeachResult } from '../lib/teachNote.ts';
import { rewardForLesson } from '../utils/gameStore.ts';
import { StructuredNote } from './StructuredNote.tsx';
import { useBackLayer } from '../lib/backLayers.ts';

interface Props {
  topics: TopicStat[];
  onClose: () => void;
  /** Continue in the Clinical AI Tutor chat. */
  onAskTutor: () => void;
}

/** "Teach me": the note for the topics a learner got wrong, in the same friendly design as the PDF Reader notes. */
export const TeachMeModal: React.FC<Props> = ({ topics, onClose, onAskTutor }) => {
  const [result, setResult] = useState<TeachResult | null>(() => getCachedTeachNote(topics));
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>(result ? 'ready' : 'loading');
  const [error, setError] = useState('');
  const noteRef = useRef<HTMLDivElement>(null);
  useBackLayer(true, onClose);

  const run = (force: boolean) => {
    setState('loading');
    setError('');
    generateTeachNote(topics, force)
      .then((r) => { setResult(r); setState('ready'); rewardForLesson(); })
      .catch((e) => { setError(String(e?.message || e)); setState('failed'); });
  };

  useEffect(() => {
    if (result) { rewardForLesson(); return; }
    run(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-950/70 p-3 max-md:bg-slate-100 max-md:p-0 max-md:dark:bg-slate-950 sm:p-6" role="dialog" aria-modal="true" aria-label="Teach me">
      <div className="w-full max-w-3xl max-md:pb-28">
        <div className="mb-2 flex items-center justify-between gap-2 max-md:sticky max-md:top-0 max-md:z-20 max-md:mb-3 max-md:border-b max-md:border-slate-200 max-md:bg-white max-md:px-3 max-md:py-2 max-md:dark:border-slate-700 max-md:dark:bg-slate-900">
          <div className="flex min-w-0 items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow dark:bg-slate-800/90 dark:text-slate-100 max-md:rounded-none max-md:bg-transparent max-md:px-0 max-md:text-[15px] max-md:shadow-none max-md:dark:bg-transparent">
            {result?.fromBooks ? <><BookOpen className="h-3.5 w-3.5 shrink-0 text-[#0f8b8d] max-md:h-4 max-md:w-4" /> <span className="truncate">From your books</span></> : <span className="truncate">Teach me</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2 max-md:gap-1.5">
            <button onClick={onAskTutor} aria-label="Ask the tutor" className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow hover:bg-white dark:bg-slate-800/90 dark:text-slate-100 max-md:h-10 max-md:w-10 max-md:justify-center max-md:bg-slate-100 max-md:p-0 max-md:shadow-none max-md:dark:bg-slate-800"><MessageCircle className="h-3.5 w-3.5 max-md:h-5 max-md:w-5" /> <span className="max-md:hidden">Ask the tutor</span></button>
            {state === 'ready' && <button onClick={() => run(true)} aria-label="Write again" className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow hover:bg-white dark:bg-slate-800/90 dark:text-slate-100 max-md:h-10 max-md:w-10 max-md:justify-center max-md:bg-slate-100 max-md:p-0 max-md:shadow-none max-md:dark:bg-slate-800"><RefreshCw className="h-3.5 w-3.5 max-md:h-5 max-md:w-5" /> <span className="max-md:hidden">Write again</span></button>}
            <button onClick={onClose} aria-label="Close" className="rounded-lg bg-white/90 p-2 text-slate-800 shadow hover:bg-white dark:bg-slate-800/90 dark:text-slate-100 max-md:flex max-md:h-10 max-md:w-10 max-md:items-center max-md:justify-center max-md:bg-slate-100 max-md:p-0 max-md:shadow-none max-md:dark:bg-slate-800"><X className="h-4 w-4 max-md:h-5 max-md:w-5" /></button>
          </div>
        </div>
        <div className="max-md:px-3">

        {state === 'loading' && (
          <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-md dark:border-slate-700 dark:bg-slate-900">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#0f8b8d]" />
            <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">Writing your note…</p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Looking in your books for {labelFor(topics)}. This takes about half a minute.</p>
          </div>
        )}
        {state === 'failed' && (
          <div className="rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-md dark:border-rose-900/60 dark:bg-slate-900">
            <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Could not write the note.</p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{error}</p>
            <button onClick={() => run(false)} className="mt-4 rounded-lg bg-[#0f8b8d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0b6b6d]">Try again</button>
          </div>
        )}
        {state === 'ready' && result && <div ref={noteRef}><StructuredNote note={result.note} range={result.label} readImages plain /></div>}
        </div>
      </div>
      {state === 'ready' && result && <TeachChat note={result.note} topicLabel={result.label} noteRootRef={noteRef} />}
    </div>
  );
};
