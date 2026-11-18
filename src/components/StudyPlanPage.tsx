import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Flag, Loader2, MessageCircle, RefreshCw, SkipForward, Sparkles, XCircle } from 'lucide-react';
import type { AppView, ClinicalQuestion } from '../types.ts';
import { getActiveProvider, getEffectiveModel, NOT_CONNECTED_MESSAGE } from '../lib/ai.ts';
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
  type Miss,
  type PlanProgress,
  type StudyPlan,
} from '../lib/studyPlan.ts';
import { getModule } from '../utils/moduleStore.ts';
import { loadRunSession } from '../utils/sessionStore.ts';
import { listCapturedQuestions } from '../utils/mistakeStore.ts';
import { renderKeyPoints } from './KeyText.tsx';
import { GroundedChat } from './GroundedChat.tsx';

export const StudyPlanPage: React.FC<{ bankId: string; title: string; onNavigate: (view: AppView) => void }> = ({ bankId, title, onNavigate }) => {
  const [misses, setMisses] = useState<Miss[] | null>(null);
  const [savedQuestions, setSavedQuestions] = useState<ClinicalQuestion[] | null>(null);
  const [plan, setPlan] = useState<StudyPlan | null>(() => loadStudyPlan(bankId));
  const [done, setDone] = useState<Record<string, boolean>>(() => loadPlanDone(bankId));
  const [busy, setBusy] = useState(false);
  const [buildProgress, setBuildProgress] = useState<PlanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState<{ id: number; text: string; context?: string } | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
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
    setPlan(loadStudyPlan(bankId));
    setDone(loadPlanDone(bankId));
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
    if (!isDesktop) setMobileChatOpen(true);
  };

  const runBuild = async (list: Miss[]) => {
    if (!list.length || busy) return;
    const provider = getActiveProvider();
    if (!provider) {
      setError(`No AI provider is active. ${NOT_CONNECTED_MESSAGE}`);
      return;
    }
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
      });
      if (stopRef.current) return;
      if (!result.chunks.length) throw new Error('The AI gave no usable plan. Nothing was saved. Try again.');
      saveStudyPlan(result);
      setPlan(result);
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

  const toggleDone = (partTitle: string) => {
    const next = setPlanPartDone(bankId, partTitle, !isPartDone(done, partTitle));
    setDone(next);
  };

  const wrongCount = misses?.filter((m) => m.reason === 'wrong' || m.reason === 'both').length ?? 0;
  const flaggedCount = misses?.filter((m) => m.reason === 'flagged' || m.reason === 'both').length ?? 0;
  const skippedCount = misses?.filter((m) => m.reason === 'skipped').length ?? 0;
  const preReadCount = misses?.filter((m) => m.reason === 'preread').length ?? 0;
  const plannedIds = plan ? planQuestionIds(plan) : null;
  const newCount = plan && misses && plannedIds ? misses.filter((m) => m.reason !== 'preread' && !plannedIds.has(m.id)).length : 0;
  const threadId = topic ? `${bankId}::${topic}` : bankId;
  const chatTitle = topic ? `${topic} (${title})` : title;
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
  const doneCount = plan ? plan.chunks.filter((c) => isPartDone(done, c.title)).length : 0;
  const minutesLeft = plan ? plan.chunks.reduce((sum, c) => sum + (isPartDone(done, c.title) ? 0 : chunkMinutes(c)), 0) : 0;
  const donePercent = totalParts > 0 ? Math.round((doneCount / totalParts) * 100) : 0;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
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
            <div className="max-w-3xl flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-700 dark:text-rose-300"><XCircle className="h-4 w-4" /> {wrongCount} wrong</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300"><Flag className="h-4 w-4" /> {flaggedCount} flagged</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300"><SkipForward className="h-4 w-4" /> {skippedCount} skipped</span>
              {preReadCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 dark:text-teal-300"><BookOpen className="h-4 w-4" /> {preReadCount} pre-read</span>
              )}
              <span className="text-xs text-slate-500 dark:text-slate-400">
                The plan covers these {misses.length} question{misses.length === 1 ? '' : 's'}.
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
              <div className="max-w-3xl rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {doneCount} of {totalParts} part{totalParts === 1 ? '' : 's'} done · about {minutesLeft} min left
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full rounded-full bg-[#0f8b8d] transition-all" style={{ width: `${donePercent}%` }} />
                </div>
              </div>

              <article className="max-w-3xl space-y-6">
                <div className="rounded-2xl border border-[#0f8b8d]/30 bg-teal-50/60 px-4 py-3 text-[14px] leading-relaxed text-slate-800 dark:bg-teal-950/30 dark:text-slate-100">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#00696b] dark:text-teal-300">Read in this order</div>
                  {plan.overview}
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
                  const partDone = isPartDone(done, c.title);
                  const partContext = [c.intro, c.sections.map((s) => s.heading).join('; ')].filter(Boolean).join('\n');
                  return (
                    <section key={i} id={`plan-part-${i + 1}`} className={`scroll-mt-4 space-y-3 ${partDone ? 'opacity-75' : ''}`}>
                      {i > 0 && c.connects && (
                        <div className="flex items-start gap-2 rounded-xl bg-slate-100 px-3 py-2 text-[12.5px] italic text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />{c.connects}
                        </div>
                      )}

                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="flex min-w-0 items-center gap-2 text-[17px] font-semibold text-slate-900 dark:text-white">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0f8b8d] text-[13px] text-white">{i + 1}</span>
                          <span className="min-w-0">{c.title}</span>
                          {partDone && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />}
                        </h3>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">~{chunkMinutes(c)} min</span>
                          <button
                            type="button"
                            onClick={() => toggleDone(c.title)}
                            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 text-[12.5px] font-semibold shadow-sm ${
                              partDone
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/40'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                            }`}
                          >
                            {partDone ? <CheckCircle2 className="h-4 w-4" /> : null}
                            {partDone ? 'Mark not done' : 'Mark done'}
                          </button>
                          <button
                            type="button"
                            onClick={() => ask(`Explain more about: ${c.title}`, partContext, c.title)}
                            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#0f8b8d]/40 bg-teal-50 px-3 text-[12.5px] font-semibold text-[#00696b] hover:bg-teal-100 dark:border-teal-500/40 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-900/40"
                          >
                            <Sparkles className="h-4 w-4" /> Ask AI
                          </button>
                        </div>
                      </div>

                      {c.fallback && (
                        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                          Notes for this part could not be written. Press Rebuild plan to try again.
                        </div>
                      )}
                      {c.why && <p className="text-[12.5px] text-slate-500 dark:text-slate-400">Why this part: {c.why}</p>}
                      {c.intro && <p className="text-[14px] leading-relaxed text-slate-800 dark:text-slate-100">{renderKeyPoints(c.intro, `i${i}`)}</p>}

                      {c.sections.map((s, k) => (
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

                      {c.traps.length > 0 && (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 dark:border-rose-800/50 dark:bg-rose-950/30">
                          <div className="mb-1 text-[13px] font-semibold text-rose-800 dark:text-rose-200">Exam traps</div>
                          <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-rose-950 dark:text-rose-100">
                            {c.traps.map((t, j) => <li key={j}>{renderKeyPoints(t, `t${i}-${j}`)}</li>)}
                          </ul>
                        </div>
                      )}

                      {c.recall.length > 0 && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-800/50 dark:bg-amber-950/30">
                          <div className="mb-1 text-[13px] font-semibold text-amber-900 dark:text-amber-200">Check yourself</div>
                          <ul className="space-y-1.5 text-[13.5px] text-amber-950 dark:text-amber-100">
                            {c.recall.map((t, j) => (
                              <li key={j} className="flex flex-wrap items-start justify-between gap-2">
                                <span className="min-w-0 flex-1">{t}</span>
                                <button
                                  type="button"
                                  onClick={() => ask(`Quiz me on this, one question at a time: ${t}`)}
                                  className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white/70 px-2 text-[12px] font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/40"
                                >
                                  <Sparkles className="h-3.5 w-3.5" /> Quiz me
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </section>
                  );
                })}

                <p className="text-[11.5px] text-slate-500 dark:text-slate-400">
                  Written by AI from your wrong and flagged questions on {new Date(plan.at).toLocaleString()}. Check important details against your textbook.
                </p>
              </article>
            </>
          )}
        </div>

        {isDesktop && (
          <div className="hidden lg:block lg:w-[400px] lg:shrink-0 lg:self-stretch">
            <div className="flex flex-col gap-2 lg:sticky lg:top-4 lg:h-[calc(100dvh-7rem)]">
              {topicPicker}
              <div className="min-h-0 flex-1"><GroundedChat key={threadId} bankId={threadId} title={chatTitle} seed={seed} /></div>
            </div>
          </div>
        )}
      </div>

      {!isDesktop && (
        <>
          <button
            type="button"
            onClick={() => {
              setSeed(null);
              setMobileChatOpen(true);
            }}
            className="fixed right-4 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-[#0f8b8d] px-4 text-sm font-semibold text-white shadow-lg hover:bg-[#0b6b6d] lg:hidden"
          >
            <MessageCircle className="h-4 w-4" /> Ask AI
          </button>

          {mobileChatOpen && (
            <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-slate-900">
              {topicPicker}
              <div className="min-h-0 flex-1"><GroundedChat
                key={threadId}
                bankId={threadId}
                title={chatTitle}
                seed={seed}
                onClose={() => {
                  setMobileChatOpen(false);
                  setSeed(null);
                }}
              /></div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
