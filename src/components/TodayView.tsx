import React, { useEffect, useMemo, useState } from 'react';
import { Award, Check, Flame, Lock, RefreshCw, Snowflake, Sparkles, TrendingDown, Trophy } from 'lucide-react';
import type { AppView, ExamType } from '../types.ts';
import { subscribeDataChanged } from '../utils/dataEvents.ts';
import { getTodayProgress } from '../utils/studyPlanStore.ts';
import { getBadges, getMission, getStreak, getXp, weekActivity } from '../utils/gameStore.ts';
import { lessonMessage, listReviews, weakAcrossTests } from '../lib/testReview.ts';
import { setTutorSeed } from '../lib/tutorSeed.ts';
import { TeachMeModal } from './TeachMeModal.tsx';
import type { TopicStat } from '../lib/testReview.ts';

interface Props {
  exam: ExamType;
  onNavigate: (view: AppView, targetId?: string) => void;
}

const greeting = (): string => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export const TodayView: React.FC<Props> = ({ exam, onNavigate }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeDataChanged(() => setTick((n) => n + 1)), []);

  const mission = useMemo(() => getMission(exam), [exam, tick]);
  const streak = useMemo(() => getStreak(), [tick]);
  const level = useMemo(() => getXp(), [tick]);
  const badges = useMemo(() => getBadges(), [tick]);
  const week = useMemo(() => weekActivity(), [tick]);
  const due = useMemo(() => getTodayProgress(exam).reviewsDue, [exam, tick]);
  const weak = useMemo(() => weakAcrossTests(listReviews(), 3), [tick]);

  const maxWeek = Math.max(1, ...week.map((d) => d.count));
  const weekTotal = week.reduce((n, d) => n + d.count, 0);
  const ring = 2 * Math.PI * 56;
  const done = mission.doneCount;

  const card = 'rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:rounded-2xl md:p-5 dark:border-slate-700 dark:bg-slate-900';
  const muted = 'text-slate-600 dark:text-slate-400';
  const title = 'text-slate-900 dark:text-white';

  const [teaching, setTeaching] = useState<TopicStat[] | null>(null);
  const teachWeak = () => {
    if (weak.length) setTeaching(weak.slice(0, 1));
    else onNavigate('ai-tutor');
  };
  const goTask = (id: string) => {
    if (id === 'questions') onNavigate('practice');
    else if (id === 'review') onNavigate('mistakes');
    else teachWeak();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-3 max-md:space-y-2.5 md:space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-2 max-md:items-start max-md:gap-2 md:gap-3">
        <div className="min-w-0">
          <div className={`text-xs max-md:text-[12px]! max-md:font-medium md:text-sm ${muted}`}>{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <h1 className={`mt-0.5 text-base font-semibold tracking-tight max-md:mt-0 max-md:text-lg! max-md:font-bold! md:mt-1 md:text-3xl ${title}`}>
            {greeting()}. {done === 3 ? 'Mission complete.' : `${done} of 3 done today.`}
          </h1>
        </div>
        <div className="flex min-h-10 max-w-full items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 max-md:shrink-0 max-md:gap-1 max-md:whitespace-nowrap max-md:border-amber-200 max-md:px-2 max-md:py-0.5 max-md:text-[11px]! md:gap-2 md:px-4 md:py-2 md:text-sm dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200">
          <Flame className="h-3.5 w-3.5 text-amber-500 max-md:h-3 max-md:w-3 md:h-4 md:w-4" />
          {streak.current}-day streak
          <span className="hidden font-normal text-amber-800/80 md:inline dark:text-amber-200/70">· {streak.freezes} freeze{streak.freezes === 1 ? '' : 's'} saved</span>
        </div>
      </header>

      <section className="grid gap-3 md:gap-5 lg:grid-cols-3">
        {/* Mission */}
        <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-3 shadow-sm max-md:border-slate-200/70 max-md:bg-none max-md:bg-white max-md:p-3! max-md:shadow-[0_1px_2px_rgba(15,23,42,0.05)] md:rounded-2xl md:p-6 dark:border-teal-900/60 dark:from-[#0e2a3a] dark:to-[#0b1f33] max-md:dark:border-slate-700/60 max-md:dark:bg-[#111a2b] lg:col-span-2">
          <div className="flex items-start gap-3 max-md:gap-2.5 md:flex-wrap md:items-center md:gap-6">
            <div className="relative h-[72px] w-[72px] shrink-0 max-md:h-16 max-md:w-16 md:h-[132px] md:w-[132px]">
              <svg viewBox="0 0 132 132" className="h-full w-full" role="img" aria-label={`${done} of 3 missions done`}>
                <circle cx="66" cy="66" r="56" fill="none" strokeWidth="12" className="stroke-teal-100 dark:stroke-[#1b3550]" />
                <circle cx="66" cy="66" r="56" fill="none" strokeWidth="12" strokeLinecap="round" className="stroke-[#0f8b8d] dark:stroke-teal-300" strokeDasharray={`${(ring * done) / 3} ${ring}`} transform="rotate(-90 66 66)" style={{ transition: 'stroke-dasharray .6s ease' }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className={`text-lg font-bold md:text-3xl ${title}`}>{done}/3</div>
                <div className={`text-xs ${muted}`}>today</div>
              </div>
            </div>
            <div className="min-w-0 flex-1 basis-0 md:basis-72">
              <div className="text-xs font-semibold tracking-widest max-md:text-[11px]! text-[#0f8b8d] dark:text-teal-300">TODAY'S MISSION</div>
              <ul className="mt-1.5 space-y-1 md:mt-3 md:space-y-2.5">
                {mission.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 md:gap-3">
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full md:h-6 md:w-6 ${t.done ? 'bg-emerald-500 text-white' : 'border-2 max-md:border border-[#0f8b8d] dark:border-teal-300'}`}>
                      {t.done && <Check className="h-3 w-3 md:h-3.5 md:w-3.5" strokeWidth={3.5} />}
                    </span>
                    <button onClick={() => goTask(t.id)} className={`min-h-[44px] max-md:min-h-[40px] min-w-0 flex-1 text-left text-xs max-md:text-[13px]! max-md:py-0.5 md:min-h-[32px] md:text-sm ${t.done ? `line-through ${muted}` : `font-semibold ${title} hover:underline`}`}>
                      {t.title} <span className={`font-normal ${muted}`}>· {t.progress}</span>
                    </button>
                    <span className={`shrink-0 text-xs font-semibold max-md:text-[11px]! ${t.done ? muted : 'text-[#0f8b8d] dark:text-teal-300'}`}>+{t.xp} XP</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2 max-md:mt-2 max-md:flex-col max-md:gap-1.5 md:mt-4 md:flex md:flex-wrap">
                <button onClick={() => onNavigate('practice')} className="h-10 w-full rounded-lg bg-[#0f8b8d] px-4 text-sm font-semibold text-white hover:bg-[#0b6b6d] max-md:h-auto max-md:min-h-10 max-md:py-1 max-md:w-full max-md:min-w-0 max-md:whitespace-normal max-md:leading-tight max-md:px-3 max-md:text-[13px]! md:h-auto md:min-h-[44px] md:w-auto md:rounded-xl md:px-5">
                  <span className="md:hidden">Continue practice</span>
                  <span className="hidden md:inline">Start practice</span>
                </button>
                <button onClick={teachWeak} className="h-10 w-full rounded-lg border border-[#0f8b8d] px-4 text-left text-xs font-semibold text-[#0f8b8d] hover:bg-[#0f8b8d] hover:text-white max-md:flex max-md:h-auto max-md:min-h-10 max-md:w-full max-md:min-w-0 max-md:items-start max-md:break-words max-md:whitespace-normal max-md:px-2.5 max-md:py-1.5 max-md:leading-tight max-md:text-[12px]! md:h-auto md:min-h-[44px] md:w-auto md:rounded-xl md:px-5 md:text-center md:text-sm dark:border-teal-300 dark:text-teal-300">
                  <Sparkles className="mr-1 inline h-4 w-4 max-md:mt-px max-md:h-3.5 max-md:w-3.5 max-md:shrink-0 md:mr-1.5" />
                  <span className="max-md:line-clamp-2 max-md:min-w-0 max-md:flex-1 max-md:break-words">{weak.length ? `Teach me ${weak[0].topic}` : 'Ask the tutor'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Level */}
        <div className={`${card} flex items-center gap-3 max-md:hidden md:block`}>
          <div className="min-w-0 flex-1 md:block">
            <div className={`flex items-center gap-1.5 text-xs font-semibold tracking-widest md:gap-2 ${muted}`}><Trophy className="h-3.5 w-3.5 md:h-4 md:w-4" /> LEVEL</div>
            <div className="mt-0.5 flex items-baseline gap-1.5 md:mt-2 md:gap-2"><span className={`text-xl font-bold md:text-4xl ${title}`}>{level.level}</span><span className={`truncate text-xs md:text-base ${muted}`}>{level.name}</span></div>
          </div>
          <div className="w-28 shrink-0 md:mt-3 md:w-auto">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200 md:h-2 dark:bg-slate-700"><div className="h-full rounded-full bg-gradient-to-r from-[#0f8b8d] to-teal-300" style={{ width: `${Math.max(3, level.pct)}%`, transition: 'width .6s ease' }} /></div>
            <div className={`mt-1 text-xs ${muted} md:mt-2`}>{level.into} / {level.need} XP to level {level.level + 1}</div>
          </div>
          <div className={`mt-4 hidden text-xs leading-relaxed md:block ${muted}`}>10 XP for each right answer, 20 for finishing a test, 50 for a perfect set and 50 for a lesson with the tutor.</div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2 md:hidden">
        <div className="rounded-xl border border-slate-200/70 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:border-slate-700/60 dark:bg-[#111a2b]">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0f8b8d]/10 text-[#0f8b8d] dark:bg-teal-400/10 dark:text-teal-300">
            <Trophy className="h-4 w-4" />
          </div>
          <div className="mt-2 text-[11px]! font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">Level</div>
          <div className="mt-0.5 text-[20px]! font-bold leading-none tabular-nums text-slate-900 dark:text-slate-100">{level.level}</div>
          <div className="mt-1 text-[11px]! tabular-nums text-slate-500 dark:text-slate-400">{level.into}/{level.need} XP</div>
        </div>
        <div className="rounded-xl border border-slate-200/70 bg-white p-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:border-slate-700/60 dark:bg-[#111a2b]">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
            <Flame className="h-4 w-4" />
          </div>
          <div className="mt-2 text-[11px]! font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">Streak</div>
          <div className="mt-0.5 text-[20px]! font-bold leading-none tabular-nums text-slate-900 dark:text-slate-100">{streak.current}</div>
          <div className="mt-1 text-[11px]! tabular-nums text-slate-500 dark:text-slate-400">best {streak.longest}</div>
        </div>
        <button onClick={() => onNavigate('mistakes')} className="min-h-10 min-w-0 rounded-xl border border-slate-200/70 bg-white p-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:border-slate-700/60 dark:bg-[#111a2b]">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0f8b8d]/10 text-[#0f8b8d] dark:bg-teal-400/10 dark:text-teal-300">
            <RefreshCw className="h-4 w-4" />
          </div>
          <div className="mt-2 text-[11px]! font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">Due</div>
          <div className="mt-0.5 text-[20px]! font-bold leading-none tabular-nums text-slate-900 dark:text-slate-100">{due}</div>
          <div className="mt-1 text-[11px]! tabular-nums text-slate-500 dark:text-slate-400">{due === 1 ? 'card' : 'cards'}{due > 0 ? ` · ${Math.max(1, Math.ceil(due / 3))} min` : ''}</div>
        </button>
      </div>
      <div className="flex min-h-10 items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-white px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)] md:hidden dark:border-slate-700/60 dark:bg-[#111a2b]">
        <span className="text-[11px]! font-semibold uppercase tracking-[0.06em] text-slate-500 dark:text-slate-400">Last 7 days</span>
        <div className="flex items-center gap-2">
          {streak.days.map((d) => (
            <span
              key={d.key}
              title={`${d.label}: ${d.state}`}
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.state === 'done' ? 'bg-[#0f8b8d] dark:bg-teal-300' : d.state === 'today' ? 'bg-white ring-2 ring-[#0f8b8d] dark:bg-[#111a2b] dark:ring-teal-300' : d.state === 'frozen' ? 'bg-sky-400 dark:bg-sky-300' : 'bg-slate-200 dark:bg-slate-700'}`}
            />
          ))}
        </div>
      </div>

      <section className="grid gap-3 max-md:gap-2.5 md:gap-5 lg:grid-cols-3">
        {/* Streak */}
        <div className={`${card} max-md:hidden`}>
          <div className="flex items-center justify-between"><div className={`flex items-center gap-1.5 text-xs font-semibold tracking-widest md:gap-2 ${muted}`}><Flame className="h-3.5 w-3.5 md:h-4 md:w-4" /> STREAK</div><div className="text-xs text-amber-600 dark:text-amber-300">Longest: {streak.longest}</div></div>
          <div className="mt-1 flex items-baseline gap-1.5 md:mt-2 md:gap-2"><span className={`text-2xl font-bold leading-none md:text-5xl ${title}`}>{streak.current}</span><span className={`text-xs md:text-sm ${muted}`}>days in a row</span></div>
          <div className="mt-2 flex gap-1 md:mt-4 md:gap-2">
            {streak.days.map((d) => (
              <div key={d.key} className="flex-1 text-center">
                <div className={`flex h-6 items-center justify-center rounded-md text-[10px] font-semibold md:h-9 md:rounded-lg ${d.state === 'done' ? 'bg-amber-400 text-amber-950' : d.state === 'frozen' ? 'bg-sky-200 text-sky-900 dark:bg-sky-900/60 dark:text-sky-100' : d.state === 'today' ? 'border-2 border-dashed border-[#0f8b8d] dark:border-teal-300' : 'bg-slate-200 dark:bg-slate-800'}`}>
                  {d.state === 'frozen' && <Snowflake className="h-3 w-3 md:h-4 md:w-4" />}
                </div>
                <div className={`mt-0.5 text-[10px] md:mt-1 ${d.state === 'today' ? 'font-semibold text-[#0f8b8d] dark:text-teal-300' : muted}`}>{d.label}</div>
              </div>
            ))}
          </div>
          <div className={`mt-3 hidden text-xs leading-relaxed md:block ${muted}`}>A missed day uses a freeze, so one bad day does not erase your run. You earn a freeze for every 7 days in a row.</div>
        </div>

        {/* Due reviews */}
        <div className={`${card} max-md:hidden`}>
          <div className="flex items-center justify-between"><div className={`flex items-center gap-1.5 text-xs font-semibold tracking-widest md:gap-2 ${muted}`}><RefreshCw className="h-3.5 w-3.5 md:h-4 md:w-4" /> DUE FOR REVIEW</div></div>
          <div className="mt-1 flex items-baseline gap-1.5 md:mt-2 md:gap-2"><span className={`text-2xl font-bold leading-none md:text-5xl ${title}`}>{due}</span><span className={`text-xs md:text-sm ${muted}`}>{due === 1 ? 'card' : 'cards'}{due > 0 ? `, about ${Math.max(1, Math.ceil(due / 3))} min` : ''}</span></div>
          <p className={`mt-3 hidden text-sm md:block ${muted}`}>{due > 0 ? 'A short review now keeps what you learned from fading.' : 'Nothing is waiting. Add questions you got wrong to your review deck.'}</p>
          <button onClick={() => onNavigate('mistakes')} className="mt-2 min-h-[40px] w-full rounded-lg bg-[#0f8b8d] text-sm font-semibold text-white hover:bg-[#0b6b6d] md:mt-4 md:min-h-[44px] md:rounded-xl">{due > 0 ? 'Start the review' : 'Open spaced review'}</button>
        </div>

        {/* Weak topics */}
        <div className={`${card} max-md:py-2.5`}>
          <div className={`flex items-center gap-1.5 text-xs font-semibold tracking-widest max-md:text-[11px]! md:gap-2 ${muted}`}><TrendingDown className="h-3.5 w-3.5 md:h-4 md:w-4" /> WEAK TOPICS</div>
          {weak.length === 0 ? (
            <p className={`mt-2 text-xs max-md:hidden md:mt-3 md:text-sm ${muted}`}>Submit a test and your weakest topics will appear here, with a Teach me button for each.</p>
          ) : (
            <ul className="mt-2 space-y-2 max-md:hidden md:mt-3 md:space-y-3">
              {weak.map((s) => (
                <li key={s.key}>
                  <div className="flex items-center justify-between text-xs md:text-sm"><span className={`font-semibold ${title}`}>{s.topic}</span><span className="font-semibold text-rose-500">{s.accuracy}%</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-rose-500" style={{ width: `${Math.max(4, s.accuracy)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1.5 flex items-center justify-between gap-2 md:hidden">
            <span className="min-w-0 truncate text-[13px]! font-medium text-slate-700 dark:text-slate-200">
              {weak.length === 0 ? 'No weak topics yet' : <>{weak.length} weak topic{weak.length === 1 ? '' : 's'} · <span className="font-semibold text-rose-600 dark:text-rose-400">{weak[0].topic} {weak[0].accuracy}%</span></>}
            </span>
            <button onClick={() => onNavigate('reviews')} className="min-h-10 shrink-0 px-1 text-[12px]! font-semibold text-[#0f8b8d] dark:text-teal-300">Open reviews</button>
          </div>
          <button onClick={() => onNavigate('reviews')} className={`mt-3 max-md:hidden text-xs font-semibold text-[#0f8b8d] hover:underline md:mt-4 dark:text-teal-300`}>Open all test reviews</button>
        </div>
      </section>

      <section className="grid gap-3 max-md:grid-cols-[minmax(0,1fr)] max-md:gap-2.5 md:gap-5 lg:grid-cols-3">
        <div className={`${card} max-md:min-w-0 lg:col-span-1`}>
          <div className="flex items-center justify-between"><div className={`text-xs max-md:text-[11px]! font-semibold tracking-widest ${muted}`}>THIS WEEK</div><div className={`text-xs max-md:text-[11px]! ${muted}`}>{weekTotal} questions</div></div>
          <div className="mt-2 flex h-20 items-end gap-1 max-md:mt-1.5 max-md:h-16 md:mt-4 md:h-28 md:gap-2">
            {week.map((d, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div className={`w-full rounded-t-md ${d.today ? 'bg-teal-300' : d.count ? 'bg-[#0f8b8d]' : 'bg-slate-200 dark:bg-slate-700'}`} style={{ height: `${d.count ? Math.max(8, (d.count / maxWeek) * 100) : 6}%`, transition: 'height .6s ease' }} title={`${d.count} questions`} />
                </div>
                <span className={`text-[10px] ${d.today ? 'font-semibold text-[#0f8b8d] dark:text-teal-300' : muted}`}>{d.today ? 'Today' : d.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={`${card} max-md:min-w-0 lg:col-span-2`}>
          <div className={`flex items-center gap-2 text-xs max-md:text-[11px]! font-semibold tracking-widest ${muted}`}><Award className="h-4 w-4" /> BADGES</div>
          <ul className="mt-2 grid gap-2 max-md:hidden md:mt-3 sm:grid-cols-2 xl:grid-cols-3">
            {badges.map(({ def, earnedOn }) => (
              <li key={def.id} className={`flex items-center gap-2 rounded-lg border p-2 md:gap-3 md:rounded-xl md:p-3 ${earnedOn ? 'border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30' : 'border-slate-200 opacity-70 dark:border-slate-700'}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full md:h-9 md:w-9 ${earnedOn ? 'bg-amber-400 text-amber-950' : 'bg-slate-200 text-slate-500 dark:bg-slate-800'}`}>{earnedOn ? <Award className="h-4 w-4 md:h-5 md:w-5" /> : <Lock className="h-4 w-4" />}</span>
                <div className="min-w-0"><div className={`truncate text-xs font-semibold md:text-sm ${title}`}>{def.name}</div><div className={`truncate text-xs ${muted}`}>{earnedOn ? `Earned ${earnedOn}` : def.hint}</div></div>
              </li>
            ))}
          </ul>
          <ul className="mt-2 grid min-w-0 grid-cols-3 gap-2 md:hidden">
            {badges.map(({ def, earnedOn }) => (
              <li key={def.id} className="min-w-0 text-center" title={earnedOn ? `Earned ${earnedOn}` : def.hint}>
                <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${earnedOn ? 'bg-[#0f8b8d]/10 text-[#0f8b8d] dark:bg-teal-400/10 dark:text-teal-300' : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}`}>
                  {earnedOn ? <Award className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
                </div>
                <div className="mt-1 truncate text-[11px]! font-semibold text-slate-700 dark:text-slate-200">{def.name}</div>
              </li>
            ))}
          </ul>
        </div>
      </section>
      {teaching && <TeachMeModal topics={teaching} onClose={() => setTeaching(null)} onAskTutor={() => { setTutorSeed(lessonMessage(teaching)); onNavigate('ai-tutor'); }} />}
    </div>
  );
};
