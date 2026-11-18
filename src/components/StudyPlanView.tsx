import React, { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, CheckCircle2, Flame, Play, Settings2, Sparkles, Target, Timer } from 'lucide-react';
import { type AppView, type ExamType } from '../types.ts';
import { subscribeDataChanged } from '../utils/dataEvents.ts';
import { listAttempts } from '../utils/attemptStore.ts';
import { buildTodayPlan, getPlanSettings, getStreak, getTodayProgress, savePlanSettings, type PlanTask, type StudyPlanSettings } from '../utils/studyPlanStore.ts';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMPTY_STREAK = { current: 0, longest: 0, lastActiveDate: null as string | null };

const localToday = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const daysUntil = (exam: ExamType): number | null => {
  try {
    const raw = localStorage.getItem(`exam.date.${exam}`);
    if (!raw) return null;
    const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    let target = m ? m[1] : null;
    if (!target) {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return null;
      const p = (n: number) => String(n).padStart(2, '0');
      target = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    const today = localToday();
    const [ty, tm, td] = today.split('-').map(Number);
    const [ey, em, ed] = target.split('-').map(Number);
    return Math.round((new Date(ey, em - 1, ed).getTime() - new Date(ty, tm - 1, td).getTime()) / 86400000);
  } catch {
    return null;
  }
};

const unitLabel = (task: PlanTask): string => {
  if (task.kind === 'mock') return 'mock';
  if (task.unit === 'questions') return 'questions';
  if (task.unit === 'cards') return 'cards';
  if (task.unit === 'topics') return 'topics';
  return 'minutes';
};

export const StudyPlanView: React.FC<{ exam: ExamType; onNavigate: (v: AppView) => void }> = ({ exam, onNavigate }) => {
  const [tasks, setTasks] = useState<PlanTask[]>(() => buildTodayPlan(exam));
  const [progress, setProgress] = useState(() => getTodayProgress(exam));
  const [streak, setStreak] = useState(EMPTY_STREAK);
  const [hasAttempts, setHasAttempts] = useState(() => listAttempts().length > 0);
  const [settings, setSettings] = useState<StudyPlanSettings>(() => getPlanSettings(exam));
  const [saved, setSaved] = useState(false);

  const refresh = () => {
    setTasks(buildTodayPlan(exam));
    setProgress(getTodayProgress(exam));
    setStreak(getStreak());
    setHasAttempts(listAttempts().length > 0);
  };

  useEffect(() => {
    refresh();
    setSettings(getPlanSettings(exam));
    return subscribeDataChanged(() => refresh());
  }, [exam]);

  const restDay = tasks.length === 1 && tasks[0].kind === 'custom' && tasks[0].id.startsWith('rest-');
  const pct = progress.questionsGoal > 0 ? Math.min(100, Math.round((progress.questionsDone / progress.questionsGoal) * 100)) : 0;
  const examDays = daysUntil(exam);
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const phoneTodayLabel = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="space-y-4 max-md:space-y-2.5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 shadow-sm max-md:rounded-xl max-md:border-slate-200/70 max-md:p-3! max-md:shadow-[0_1px_2px_rgba(15,23,42,0.05)] max-md:dark:border-slate-700/60 dark:text-slate-100">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between max-md:flex-row max-md:items-start max-md:justify-between max-md:gap-2">
          <div className="max-md:min-w-0">
            <div className="text-xs uppercase tracking-widest text-[#0f8b8d] max-md:text-[11px]! max-md:font-semibold max-md:tracking-[0.06em]">Daily study plan</div>
            <h1 className="mt-1 text-2xl font-medium text-slate-900 max-md:mt-0.5 max-md:hidden dark:text-white">Today · {todayLabel}</h1>
            <h1 className="mt-0.5 text-[18px] font-semibold leading-tight text-slate-900 dark:text-slate-100 md:hidden">Today · {phoneTodayLabel}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm max-md:mt-1 max-md:gap-1 max-md:text-xs">
              <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-slate-700 inline-flex items-center gap-1 max-md:px-2">
                <CalendarDays size={14} /> {exam.replace('_', ' ')}
              </span>
              {examDays === null ? (
                <span className="text-slate-500">Set your exam date in the sidebar exam card</span>
              ) : examDays < 0 ? (
                <span className="text-rose-700">Exam date passed</span>
              ) : examDays === 0 ? (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-rose-700 inline-flex items-center gap-1 max-md:px-2"><Timer size={14} /> Exam day</span>
              ) : (
                <span className="rounded-full border border-[#0f8b8d]/30 bg-[#0f8b8d]/10 px-2.5 py-0.5 text-[#0f8b8d] inline-flex items-center gap-1 max-md:px-2"><Timer size={14} /> {examDays} day{examDays === 1 ? '' : 's'} to go</span>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-center shadow-sm max-md:flex max-md:shrink-0 max-md:items-center max-md:gap-1.5 max-md:rounded-full max-md:border-amber-200 max-md:bg-amber-50 max-md:px-2.5 max-md:py-1 max-md:text-left max-md:shadow-none max-md:dark:border-amber-500/30 max-md:dark:bg-amber-500/10">
            <div className="flex items-center justify-center gap-1 text-lg font-medium text-amber-800 max-md:gap-0.5 max-md:text-[13px]! max-md:font-semibold max-md:text-amber-800 max-md:dark:text-amber-200 dark:text-white">
              <Flame size={18} className="text-amber-500 max-md:h-3.5 max-md:w-3.5" /> {streak.current}<span className="md:hidden text-[10px] font-semibold text-amber-700 dark:text-amber-300">day streak</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-amber-700 max-md:hidden">day streak · best {streak.longest}</div>
          </div>
        </div>
        <div className="mt-5 max-md:mt-2">
          <div className="flex items-end justify-between text-sm max-md:text-xs">
            <span className="inline-flex items-center gap-1 font-medium text-slate-900 dark:text-white"><Target size={15} className="text-[#0f8b8d]" /> Question goal</span>
            <span className="font-medium text-slate-700">{progress.questionsDone} / {progress.questionsGoal} {progress.goalMet ? '✓' : ''}</span>
          </div>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full border border-slate-200 bg-white/70 max-md:mt-1 max-md:h-1.5 dark:bg-slate-800">
            <div className={`h-full transition-all ${progress.goalMet ? 'bg-emerald-500' : 'bg-[#0f8b8d]'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-xs text-slate-500 max-md:mt-0.5">{progress.reviewsDue} review card{progress.reviewsDue === 1 ? '' : 's'} due now</div>
        </div>
      </section>

      {!hasAttempts && (
        <section className="rounded-2xl border border-[#0f8b8d]/30 bg-[#0f8b8d]/10 p-4 shadow-sm max-md:rounded-xl max-md:p-3!">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between max-md:gap-2">
            <div className="max-md:min-w-0">
              <div className="font-medium text-slate-900 dark:text-white max-md:text-sm">Start with a 10-question practice set</div>
              <div className="text-sm text-slate-600 max-md:text-xs">Your plan gets sharper after the first attempt.</div>
            </div>
            <button type="button" onClick={() => onNavigate('practice')} className="rounded-[16px] border border-[#0f8b8d] bg-[#0f8b8d] px-4 py-2.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-[#00696b] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d]/50 max-md:min-h-10 max-md:px-3 max-md:py-2 inline-flex items-center gap-2">
              <Play size={16} /> Start practice
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm max-md:rounded-xl max-md:border-slate-200/70 max-md:p-3! max-md:shadow-[0_1px_2px_rgba(15,23,42,0.05)] max-md:dark:border-slate-700/60 dark:text-slate-100">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-[#0f8b8d] max-md:h-4 max-md:w-4" />
          <h2 className="text-lg font-medium text-slate-900 dark:text-white max-md:text-[15px]! max-md:font-semibold">Today's tasks</h2>
        </div>
        {restDay ? (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 max-md:p-3 max-md:text-xs">
            Rest day — no scheduled tasks. Recover, sleep well, and come back fresh.
          </div>
        ) : (
          <div className="mt-3 space-y-3 max-md:mt-2 max-md:space-y-1.5">
            {tasks.map(task => {
              const taskView = task.targetView;
              const taskPct = task.target > 0 ? Math.min(100, Math.round((task.done / task.target) * 100)) : 0;
              return (
                <div key={task.id} className="rounded-xl border border-slate-200 bg-white/80 p-3 shadow-sm max-md:flex max-md:min-h-[52px] max-md:flex-col max-md:justify-center max-md:rounded-lg max-md:border-slate-200/70 max-md:p-2 max-md:shadow-none max-md:dark:border-slate-700/60 dark:bg-slate-900/70">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between max-md:flex-row max-md:items-center max-md:justify-between">
                    <div className="max-md:min-w-0 max-md:flex-1">
                      <div className="font-medium text-slate-900 dark:text-white max-md:truncate max-md:text-[14px]! max-md:font-semibold">{task.title}</div>
                      <div className="text-xs text-slate-500 max-md:truncate max-md:text-[12px]! max-md:text-slate-500 max-md:dark:text-slate-400">
                        {task.kind === 'review' ? `${progress.reviewsDue} due now · plan ${task.target}` : `${task.done} / ${task.target} ${unitLabel(task)}`}
                      </div>
                    </div>
                    {taskView && (
                      <button type="button" onClick={() => onNavigate(taskView)} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-[#0f8b8d] max-md:inline-flex max-md:h-8 max-md:w-8 max-md:min-h-0 max-md:shrink-0 max-md:items-center max-md:justify-center max-md:rounded-full max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:text-slate-500 max-md:shadow-none max-md:hover:bg-slate-100 max-md:hover:text-[#0f8b8d] max-md:dark:text-slate-400 max-md:dark:hover:bg-slate-800 inline-flex items-center gap-1 self-start sm:self-auto">
                        <span className="max-md:hidden">Open</span> <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full border border-slate-200 bg-white/70 max-md:mt-1 max-md:h-1 max-md:border-slate-200/70 max-md:dark:border-slate-700/60 dark:bg-slate-800">
                    <div className={`h-full transition-all ${taskPct >= 100 ? 'bg-emerald-500' : 'bg-[#0f8b8d]'}`} style={{ width: `${taskPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-800 shadow-sm max-md:rounded-xl max-md:border-slate-200/70 max-md:p-3! max-md:shadow-[0_1px_2px_rgba(15,23,42,0.05)] max-md:dark:border-slate-700/60 dark:text-slate-100">
        <div className="flex items-center gap-2">
          <Settings2 size={18} className="text-[#0f8b8d] max-md:h-4 max-md:w-4" />
          <h2 className="text-lg font-medium text-slate-900 dark:text-white max-md:text-[15px]! max-md:font-semibold">Daily goals</h2>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 max-md:mt-2 max-md:grid-cols-3 max-md:gap-2">
          <label className="text-sm font-medium text-slate-900 dark:text-white max-md:text-[11px]! max-md:font-semibold max-md:uppercase max-md:tracking-[0.06em] max-md:text-slate-500 max-md:dark:text-slate-400">
            Questions
            <input type="number" min={0} max={500} value={settings.dailyQuestions} onChange={e => setSettings({ ...settings, dailyQuestions: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 max-md:mt-1 max-md:h-9 max-md:rounded-lg max-md:border-slate-200 max-md:bg-slate-50 max-md:px-2 max-md:py-0 max-md:text-center max-md:text-[13px]! max-md:tabular-nums max-md:dark:border-slate-700 max-md:dark:bg-slate-800 max-md:dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]" />
          </label>
          <label className="text-sm font-medium text-slate-900 dark:text-white max-md:text-[11px]! max-md:font-semibold max-md:uppercase max-md:tracking-[0.06em] max-md:text-slate-500 max-md:dark:text-slate-400">
            Reviews cap
            <input type="number" min={0} max={500} value={settings.dailyReviews} onChange={e => setSettings({ ...settings, dailyReviews: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 max-md:mt-1 max-md:h-9 max-md:rounded-lg max-md:border-slate-200 max-md:bg-slate-50 max-md:px-2 max-md:py-0 max-md:text-center max-md:text-[13px]! max-md:tabular-nums max-md:dark:border-slate-700 max-md:dark:bg-slate-800 max-md:dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]" />
          </label>
          <label className="text-sm font-medium text-slate-900 dark:text-white max-md:text-[11px]! max-md:font-semibold max-md:uppercase max-md:tracking-[0.06em] max-md:text-slate-500 max-md:dark:text-slate-400">
            Minutes
            <input type="number" min={0} max={1440} value={settings.dailyMinutes} onChange={e => setSettings({ ...settings, dailyMinutes: Number(e.target.value) || 0 })} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 max-md:mt-1 max-md:h-9 max-md:rounded-lg max-md:border-slate-200 max-md:bg-slate-50 max-md:px-2 max-md:py-0 max-md:text-center max-md:text-[13px]! max-md:tabular-nums max-md:dark:border-slate-700 max-md:dark:bg-slate-800 max-md:dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]" />
          </label>
        </div>
        <div className="mt-3 max-md:mt-2">
          <div className="text-sm font-medium text-slate-900 dark:text-white max-md:text-[11px]! max-md:font-semibold max-md:uppercase max-md:tracking-[0.06em] max-md:text-slate-500 max-md:dark:text-slate-400">Study days</div>
          <div className="mt-1 flex flex-wrap gap-2 max-md:gap-1">
            {DAY_LABELS.map((label, day) => {
              const checked = settings.studyDays.includes(day);
              return (
                <label key={day} className={`cursor-pointer rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-[#0f8b8d] max-md:inline-flex max-md:h-[30px] max-md:min-h-[30px] max-md:items-center max-md:justify-center max-md:rounded-full max-md:px-2 max-md:py-0 max-md:text-[11px]! max-md:font-semibold max-md:leading-none ${checked ? 'border-[#0f8b8d] bg-[#0f8b8d] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 max-md:border-slate-200 max-md:bg-white max-md:text-slate-600 max-md:dark:border-slate-700 max-md:dark:bg-slate-800 max-md:dark:text-slate-300'}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => setSettings({
                      ...settings,
                      studyDays: checked ? settings.studyDays.filter(d => d !== day) : [...settings.studyDays, day].sort((a, b) => a - b),
                    })}
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 max-md:mt-2 max-md:flex-col max-md:items-stretch max-md:gap-1">
          <button
            type="button"
            onClick={() => {
              savePlanSettings(settings);
              setSettings(getPlanSettings(exam));
              setSaved(true);
              refresh();
            }}
            className="rounded-[16px] border border-[#0f8b8d] bg-[#0f8b8d] px-4 py-2.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-[#00696b] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d]/50 max-md:inline-flex max-md:h-10 max-md:min-h-0 max-md:w-full max-md:items-center max-md:justify-center max-md:rounded-xl max-md:px-3 max-md:py-0 max-md:font-semibold"
          >
            <CheckCircle2 size={16} /> Save
          </button>
          {saved && <span className="text-xs font-medium text-emerald-600 max-md:text-center max-md:text-[12px]! max-md:text-emerald-600 max-md:dark:text-emerald-400">Saved</span>}
        </div>
      </section>
    </div>
  );
};
