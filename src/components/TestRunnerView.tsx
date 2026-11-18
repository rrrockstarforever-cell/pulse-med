import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  CheckCircle2,
  BookOpen,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  X,
  Activity,
  Zap,
  Flag,
  Clock,
  Gauge,
  Send,
  LayoutGrid,
  Stethoscope,
  Lightbulb,
  Quote,
} from 'lucide-react';
import { ClinicalQuestion, AppView, ExamType } from '../types.ts';
import { AiQuestionTools } from './AiQuestionTools.tsx';
import { TestCoachPanel } from './TestCoachPanel.tsx';
import { ReviewNoteCard } from './ReviewNoteCard.tsx';
import { TeachMeModal } from './TeachMeModal.tsx';
import { setTutorSeed } from '../lib/tutorSeed.ts';
import { lessonMessage, type TopicStat } from '../lib/testReview.ts';
import { ZoomableImage } from './ZoomableImage.tsx';
import { addAttempt } from '../utils/attemptStore.ts';
import { recordTestMisses } from '../utils/mistakeStore.ts';
import { buildReview, saveReview, type ReviewRecord } from '../lib/testReview.ts';
import { rewardForTest } from '../utils/gameStore.ts';
import { loadRunSession, saveRunSession, signature } from '../utils/sessionStore.ts';
import { useIsMobile } from '../lib/useIsMobile.ts';

interface TestRunnerViewProps {
  initialQuestionId?: string;
  onNavigate: (view: AppView, targetId?: string) => void;
  questions?: ClinicalQuestion[];
  mode?: 'EXAM' | 'TUTOR';
  /** app-level theme: the cockpit renders a light skin when this is false */
  darkMode?: boolean;
  onImmersiveChange?: (immersive: boolean) => void;
  active?: boolean;
  /** Starts a new run with the questions that were wrong or skipped. */
  onRetryQuestions?: (questions: ClinicalQuestion[]) => void;
}

type MatrixTab = 'rationale' | 'pearl' | 'evidence' | 'ai';

const EXAM_LABEL: Record<ExamType, string> = {
  NEET_PG: 'NEET-PG',
  INI_CET: 'INI-CET',
};

/**
 * EXAM-INTEGRITY: the subtopic is rendered in the runner header BEFORE the student
 * answers, and for image-first questions it historically held the ground-truth dx (the
 * answer). Suppress it pre-answer whenever it would give the diagnosis away — this also
 * protects questions already saved to localStorage from before the fix. Once the answer
 * is revealed the real subtopic is shown, where it becomes useful revision context.
 */
function safeSubtopic(q: ClinicalQuestion | undefined, revealed: boolean): string {
  const sub = (q?.subtopic || '').trim();
  if (revealed) return sub || 'Clinical image';
  if (!sub) return 'Clinical image';
  const answer = (q?.options?.find((o) => o.id === q.correctOption)?.text || '').trim().toLowerCase();
  const hay = sub.toLowerCase();
  // Leaks if the subtopic contains the correct option text, or vice versa.
  if (answer && (answer.includes(hay) || hay.includes(answer))) return q?.figureModality ? `${q.figureModality} interpretation` : 'Image interpretation';
  return sub;
}

/**
 * EXAM-INTEGRITY: the image header must never name the diagnosis. Captions written by
 * earlier versions of the app were stored as "PANCREATITIS — Hellerhoff", i.e. the answer
 * itself, and they persist in localStorage — so a render-time guard is required, not just
 * a safer producer. Any caption segment that overlaps the ground truth, the subtopic or
 * the correct option is dropped, as is the licence (shown separately from the trusted
 * field, which also stops the licence appearing twice).
 */
function safeImageCaption(q: ClinicalQuestion | undefined, revealed: boolean): string {
  if (!q?.image) return 'Clinical image';
  if (!revealed) return 'Clinical image';
  const raw = (q?.imageCaption || '').trim();
  if (!raw) return 'Clinical image';
  const norm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const leaks = [q.imageGroundTruth, q.subtopic, q.options?.find((o) => o.id === q.correctOption)?.text]
    .map((s) => norm(s ?? ''))
    .filter((s) => s.length >= 4);
  const kept = String(raw)
    .split(/[·•|—–;]| - |,/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((seg) => {
      if (/^(cc0|cc\s|creative commons|public domain|pd|all rights|©|\d)/i.test(seg)) return false;
      const n = norm(seg);
      if (!n) return false;
      return !leaks.some((l) => l.includes(n) || (n.length >= 4 && n.includes(l)));
    });
  return kept.join(' · ') || 'Clinical image';
}

/**
 * Every colour used by the runner lives here, once per theme. Keeping the two
 * palettes side by side makes it impossible for the screen to get stuck in one
 * mode: the component simply reads `t.<token>` and the theme prop decides.
 */
const LIGHT = {
  page: 'selection: bg-[#f6f8fc] text-slate-800',
  bar: 'border-slate-200 bg-white',
  barBack: 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
  barTitle: 'text-slate-900',
  barSub: 'text-slate-500',
  chip: 'border border-slate-200 bg-slate-100 text-slate-600',
  chipAccent: 'border border-cyan-600/30 bg-cyan-50 text-cyan-700',
  chipMono: 'border border-emerald-600/30 bg-emerald-50 text-emerald-700',
  pace: 'border border-slate-200 bg-slate-50',
  paceLabel: 'text-slate-500',
  timer: 'border border-amber-300 bg-amber-50 text-amber-700',
  flagOn: 'border border-amber-400 bg-amber-100 text-amber-700',
  flagOff: 'border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800',
  submitTop: 'border border-cyan-600/40 bg-cyan-50 text-cyan-700 hover:border-cyan-600',
  card: 'border border-slate-200 bg-white',
  shadow: 'shadow-sm',
  shadowXl: 'shadow-md',
  inner: 'border-y-2 border-r-2 border-l-4 border-l-[#0F8B8D] border-slate-200 bg-slate-50',
  vignetteLabel: 'border border-cyan-600/30 bg-cyan-50 text-cyan-700',
  faint: 'text-slate-400',
  dim: 'text-slate-500',
  text: 'text-slate-500',
  body: 'text-slate-600',
  title: 'text-slate-900',
  strong: 'text-slate-900',
  accent: 'text-teal-700',
  accentCyan: 'text-cyan-700',
  accentAmber: 'text-amber-600',
  chipAnswered: 'border border-slate-200 bg-slate-100 text-slate-700',
  chipOk: 'border border-emerald-600/30 bg-emerald-50 text-emerald-700',
  chipTeal: 'border border-teal-600/30 bg-teal-50 text-teal-700',
  chipWarn: 'border border-amber-500/40 bg-amber-50 text-amber-700',
  track: 'border border-slate-200 bg-slate-100',
  divider: 'border-slate-200',
  optIdle: 'border hover:-translate-y-0.5 border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
  optIdleTile: 'border border-slate-200 bg-slate-100 text-slate-600',
  optIdleText: 'font-semibold text-slate-700',
  optPick: 'border -translate-y-0.5 border-[#0f8b8d] bg-teal-50',
  optPickTile: 'text-white bg-[#0f8b8d]',
  optPickText: 'font-medium text-teal-900',
  optOk: 'border -translate-y-0.5 border-emerald-500 bg-emerald-50',
  optOkTile: 'text-white bg-emerald-600',
  optOkText: 'font-medium text-emerald-800',
  okBadge: 'border border-emerald-600/40 bg-emerald-100 text-emerald-700',
  optBad: 'border -translate-y-0.5 border-rose-500 bg-rose-50',
  optBadTile: 'bg-rose-600 text-white',
  optBadText: 'font-medium text-rose-800',
  badBadge: 'border border-rose-500/40 bg-rose-100 text-rose-700',
  okHint: 'text-emerald-700',
  matrixHead: 'border-b-2 border-slate-200 bg-slate-50',
  tabOn: 'border-b-4 font-medium border-[#0f8b8d] bg-white text-teal-700',
  tabOff: 'border-b-4 border-transparent text-slate-500 hover:text-slate-800',
  warnBox: 'border border-amber-400/60 bg-amber-50',
  warnTitle: 'text-amber-700',
  warnText: 'text-amber-800',
  pearl: 'border border-teal-500/40 bg-teal-50',
  pearlTitle: 'text-teal-700',
  pearlText: 'text-slate-900',
  swallow: 'border border-slate-200 bg-slate-50',
  navBtn: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
  ghostBtn: 'border border-slate-200 bg-white text-slate-500 hover:text-slate-800',
  aside: 'border-l-2 border-slate-200 bg-white',
  paletteIdle: 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-800',
  ringOffset: 'ring-offset-[#FFF9ED]',
  copilot: 'border border-teal-600/30 bg-gradient-to-b from-teal-50 to-white',
  copilotText: 'text-slate-600',
  submit: 'border border-cyan-600/40 bg-white text-cyan-700 hover:border-cyan-600 hover:bg-cyan-50',
  dissect: 'border hover:brightness-105 border-amber-500/60 bg-gradient-to-r from-amber-100 to-teal-100 text-amber-700 hover:border-amber-500',
};

type Theme = typeof LIGHT;

const DARK: Theme = {
  page: 'selection: bg-[#0F172A] text-slate-200',
  bar: 'border-slate-800/90 bg-[#0A101D]',
  barBack: 'border border-slate-700/80 bg-slate-800/80 text-slate-300 hover:bg-slate-700',
  barTitle: 'text-slate-100',
  barSub: 'text-slate-400',
  chip: 'border border-slate-700 bg-slate-800 text-slate-300',
  chipAccent: 'border border-cyan-500/40 bg-cyan-500/20 text-cyan-300',
  chipMono: 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-300',
  pace: 'border border-slate-800 bg-slate-900',
  paceLabel: 'text-slate-400',
  timer: 'border border-amber-500/30 bg-amber-500/10 text-amber-300',
  flagOn: 'border border-amber-400 bg-amber-500/20 text-amber-300',
  flagOff: 'border hover:text-white border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
  submitTop: 'border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:border-cyan-400',
  card: 'border border-slate-700/80 bg-[#1E293B]',
  shadow: 'shadow-md',
  shadowXl: 'shadow-xl',
  inner: 'border-y-2 border-r-2 border-l-4 border-l-[#2DD4BF] border-slate-700/70 bg-[#151F30]',
  vignetteLabel: 'border border-cyan-500/30 bg-cyan-950/80 text-cyan-400',
  faint: 'text-slate-500',
  dim: 'text-slate-400',
  text: 'text-slate-400',
  body: 'text-slate-300',
  title: 'text-white',
  strong: 'text-slate-100',
  accent: 'text-teal-400',
  accentCyan: 'text-cyan-400',
  accentAmber: 'text-amber-300',
  chipAnswered: 'border border-slate-700 bg-slate-900 text-slate-300',
  chipOk: 'border border-emerald-700/60 bg-emerald-950/60 text-emerald-300',
  chipTeal: 'border border-teal-700/60 bg-teal-950/60 text-teal-300',
  chipWarn: 'border border-amber-600/60 bg-amber-950/50 text-amber-300',
  track: 'border border-slate-800 bg-slate-900',
  divider: 'border-slate-800/80',
  optIdle: 'border hover:-translate-y-0.5 border-slate-700/80 bg-slate-900/60 hover:border-slate-600 hover:bg-slate-800/50',
  optIdleTile: 'border border-slate-700 bg-slate-800 text-slate-300',
  optIdleText: 'font-semibold text-slate-300',
  optPick: 'border -translate-y-0.5 border-teal-500 bg-teal-500/10',
  optPickTile: 'bg-teal-600 text-white',
  optPickText: 'font-medium text-teal-100',
  optOk: 'border -translate-y-0.5 border-emerald-500 bg-emerald-950/20',
  optOkTile: 'bg-emerald-500 text-slate-950',
  optOkText: 'font-medium text-emerald-200',
  okBadge: 'border border-emerald-500/40 bg-emerald-900/60 text-emerald-400',
  optBad: 'border -translate-y-0.5 border-rose-500 bg-rose-950/20',
  optBadTile: 'bg-rose-600 text-white',
  optBadText: 'font-medium text-rose-200',
  badBadge: 'border border-rose-500/40 bg-rose-900/60 text-rose-300',
  okHint: 'text-emerald-300/80',
  matrixHead: 'border-b-2 border-slate-700/80 bg-[#131C2E]',
  tabOn: 'border-b-4 font-medium border-cyan-500 bg-[#1E293B] text-sky-300',
  tabOff: 'border-b-4 border-transparent text-slate-400 hover:text-slate-200',
  warnBox: 'border border-amber-500/40 bg-amber-950/20',
  warnTitle: 'text-amber-300',
  warnText: 'text-amber-200/90',
  pearl: 'border border-teal-500/40 bg-[#0B132B]',
  pearlTitle: 'text-teal-300',
  pearlText: 'text-slate-100',
  swallow: 'border border-slate-700/80 bg-slate-900/70',
  navBtn: 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700',
  ghostBtn: 'border border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200',
  aside: 'border-l-2 border-slate-800/90 bg-[#0A101D]',
  paletteIdle: 'border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200',
  ringOffset: 'ring-offset-[#1C1916]',
  copilot: 'border border-teal-500/30 bg-gradient-to-b from-teal-950/40 to-slate-900',
  copilotText: 'text-slate-400',
  submit: 'border border-cyan-500/40 bg-[#0F172A] text-cyan-300 hover:border-cyan-400 hover:bg-slate-900',
  dissect: 'border hover:brightness-110 border-amber-400/50 bg-gradient-to-r from-amber-500/20 to-teal-500/20 text-amber-300 hover:border-amber-400',
};

export const TestRunnerView: React.FC<TestRunnerViewProps> = ({
  initialQuestionId,
  onNavigate,
  questions: propQuestions,
  mode = 'TUTOR',
  darkMode = false,
  onImmersiveChange,
  active = true,
  onRetryQuestions,
}) => {
  const t: Theme = darkMode ? DARK : LIGHT;
  const isPhone = useIsMobile();
  const shouldReduceMotion = useReducedMotion();
  const directionRef = useRef<1 | -1>(1);
  // Seconds spent on each question, counted while it is on screen, for the time-per-question review.
  const qTimeRef = useRef<Record<string, number>>({});
  const currentIdRef = useRef<string>('');
  const dragBlockedRef = useRef(false);
  const touchSwipeRef = useRef<{ x: number; y: number; time: number; lastX: number; lastY: number; lastTime: number; scrollRegion: HTMLElement | null; startScrollTop: number; startAtTopEdge: boolean; startAtBottomEdge: boolean } | null>(null);
  const mouseSwipeRef = useRef<{ x: number; y: number; time: number; scrollRegion: HTMLElement | null; startScrollTop: number; startAtTopEdge: boolean; startAtBottomEdge: boolean } | null>(null);
  const cardShell = `rounded-xl border ${t.card}`;

  const [restoredRun] = useState(() =>
    propQuestions && propQuestions.length > 0 ? loadRunSession(signature(propQuestions)) : null,
  );
  const skipFirstSync = useRef<boolean>(Boolean(restoredRun));

  const [questions, setQuestions] = useState<ClinicalQuestion[]>(propQuestions ?? []);
  const [currentIndex, setCurrentIndex] = useState<number>(restoredRun?.index ?? 0);
  const [userAnswers, setUserAnswers] = useState<Record<string, 'A' | 'B' | 'C' | 'D' | 'E'>>(restoredRun?.answers ?? {});
  const [flaggedIds, setFlaggedIds] = useState<Record<string, boolean>>(restoredRun?.flags ?? {});
  const [examSubmitted, setExamSubmitted] = useState<boolean>(restoredRun?.submitted ?? false);
  const [showExplanation, setShowExplanation] = useState<boolean>(restoredRun?.showExplanation ?? mode === 'TUTOR');
  const [secondsElapsed, setSecondsElapsed] = useState<number>(restoredRun?.seconds ?? 0);
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [teachTopics, setTeachTopics] = useState<TopicStat[] | null>(null);
  const questionTopic = (q: ClinicalQuestion): TopicStat => ({
    key: `${q.subject}|${q.subtopic}`, subject: q.subject, topic: q.subtopic || q.subject, total: 1, wrong: 1, skipped: 0, accuracy: 0,
    missedFacts: [((q.keyFact || '').trim() || (q.options.find((o) => o.id === q.correctOption)?.text ?? '')).slice(0, 200)].filter(Boolean),
  });
  const [showResultsScreen, setShowResultsScreen] = useState<boolean>(restoredRun?.showResults ?? false);
  const [matrixTab, setMatrixTab] = useState<MatrixTab>('rationale');
  // "Dissect with AI Tutor" can open the reasoning matrix before the question is
  // answered, so the panel has its own visibility flag.
  const [matrixOpen, setMatrixOpen] = useState<boolean>(false);
  const [paletteOpen, setPaletteOpen] = useState<boolean>(false);

  const takingQuestion = active && questions.length > 0 && !showResultsScreen;
  useEffect(() => {
    onImmersiveChange?.(takingQuestion);
    return () => onImmersiveChange?.(false);
  }, [takingQuestion, onImmersiveChange]);

  // The run starts over only when a different set of questions is passed in. A parent that passes a new array with the same
  // questions (same ids) must not reset the saved position and answers, or the progress is lost on every re-render.
  const lastSigRef = useRef<string>(propQuestions && propQuestions.length > 0 ? signature(propQuestions) : '');
  useEffect(() => {
    if (skipFirstSync.current) {
      skipFirstSync.current = false;
      return;
    }
    if (propQuestions && propQuestions.length > 0) {
      const sig = signature(propQuestions);
      // Same questions (same ids): keep the progress, but take the new copy so renamed topics show up.
      if (sig === lastSigRef.current) { setQuestions(propQuestions); return; }
      lastSigRef.current = sig;
      // A bank opened again continues from its saved answers, flags, position and time. Only a bank with no saved
      // run starts empty. Starting empty here would also overwrite the saved run with blank progress.
      const saved = loadRunSession(sig);
      setQuestions(propQuestions);
      setCurrentIndex(saved?.index ?? 0);
      setUserAnswers(saved?.answers ?? {});
      setFlaggedIds(saved?.flags ?? {});
      setExamSubmitted(saved?.submitted ?? false);
      setShowResultsScreen(saved?.showResults ?? false);
      setShowExplanation(saved?.showExplanation ?? mode === 'TUTOR');
      setSecondsElapsed(saved?.seconds ?? 0);
    }
  }, [propQuestions, mode]);

  useEffect(() => {
    if (initialQuestionId) {
      const idx = questions.findIndex(q => q.id === initialQuestionId);
      if (idx !== -1) setCurrentIndex(idx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestionId]);

  // The clock stops once the test is submitted, so the time per question is not inflated afterwards.
  useEffect(() => {
    if (examSubmitted) return;
    const timer = setInterval(() => {
      setSecondsElapsed(prev => prev + 1);
      const cur = currentIdRef.current;
      if (cur) qTimeRef.current[cur] = (qTimeRef.current[cur] ?? 0) + 1;
    }, 1000);
    return () => clearInterval(timer);
  }, [examSubmitted]);

  useEffect(() => {
    if (!questions.length) return;
    saveRunSession({
      sig: signature(questions),
      answers: userAnswers,
      flags: flaggedIds,
      index: currentIndex,
      seconds: secondsElapsed,
      submitted: examSubmitted,
      showResults: showResultsScreen,
      showExplanation,
    });
    // Let the Question Bank's saved list show the new progress.
    window.dispatchEvent(new Event('pulse-modules-changed'));
  }, [questions, userAnswers, flaggedIds, currentIndex, secondsElapsed, examSubmitted, showResultsScreen, showExplanation]);

  // A fresh question always opens on the rationale tab.
  useEffect(() => {
    setMatrixTab('rationale');
    setMatrixOpen(false);
  }, [currentIndex]);

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`;
  };

  const currentQ = questions[currentIndex] || questions[0];
  currentIdRef.current = currentQ?.id ?? '';
  const selectedAnswer = currentQ ? userAnswers[currentQ.id] : undefined;
  const isAnswered = !!selectedAnswer;
  const isFlagged = currentQ ? !!flaggedIds[currentQ.id] : false;
  const isLocked = (mode === 'TUTOR' || examSubmitted) && !!selectedAnswer;

  /**
   * Concept transfer: after a wrong Tutor answer, find one other question in this same set that
   * covers the exact same subject and subtopic and has not been answered yet. Nothing is
   * generated and the set is never changed — the runner just moves to an existing question, so
   * the attempt, mistake and SRS records behave exactly as they would if the learner had
   * navigated there themselves. Correct answers, exam mode and a missing exact match all get no
   * action at all.
   */
  const relatedIndex = React.useMemo(() => {
    if (mode !== 'TUTOR' || examSubmitted || !currentQ || !selectedAnswer) return -1;
    if (selectedAnswer === currentQ.correctOption) return -1;
    const key = (s?: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const subject = key(currentQ.subject);
    const subtopic = key(currentQ.subtopic);
    if (!subject || !subtopic) return -1;
    return questions.findIndex(
      (q) => q.id !== currentQ.id && !userAnswers[q.id] && key(q.subject) === subject && key(q.subtopic) === subtopic,
    );
  }, [mode, examSubmitted, currentQ, selectedAnswer, questions, userAnswers]);

  const goToIndex = (idx: number) => {
    if (idx < 0 || idx >= questions.length) return;
    directionRef.current = idx > currentIndex ? 1 : -1;
    setCurrentIndex(idx);
  };

  const totalQuestions = questions.length;
  const answeredCount = Object.keys(userAnswers).length;
  const flaggedCount = Object.values(flaggedIds).filter(Boolean).length;
  const correctCount = Object.entries(userAnswers).filter(([qid, chosen]) => {
    const q = questions.find(item => item.id === qid);
    return q && q.correctOption === chosen;
  }).length;
  const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : null;
  const paceSeconds = answeredCount > 0 ? Math.round(secondsElapsed / answeredCount) : null;
  const paceDisplay = paceSeconds !== null ? `${paceSeconds}s / Q` : '—';
  const progressPct = totalQuestions > 0 ? Math.min(100, Math.round((answeredCount / totalQuestions) * 100)) : 0;

  const handleSelectOption = (optId: 'A' | 'B' | 'C' | 'D' | 'E') => {
    if (!currentQ) return;
    if ((mode === 'TUTOR' || examSubmitted) && userAnswers[currentQ.id]) return;
    setUserAnswers(prev => ({ ...prev, [currentQ.id]: optId }));
    if (mode === 'TUTOR' || examSubmitted) {
      setShowExplanation(true);
    }
  };

  const toggleFlag = () => {
    if (!currentQ) return;
    setFlaggedIds(prev => ({ ...prev, [currentQ.id]: !prev[currentQ.id] }));
  };

  const goNext = () => {
    directionRef.current = 1;
    setCurrentIndex(prev => Math.min(questions.length - 1, prev + 1));
  };
  const goPrev = () => {
    directionRef.current = -1;
    setCurrentIndex(prev => Math.max(0, prev - 1));
  };

  const recordAttempt = (_submitters: 'exam' | 'module') => {
    try {
      const subjects: Record<string, { total: number; correct: number }> = {};
      for (const q of questions) {
        if (!userAnswers[q.id]) continue;
        const s = subjects[q.subject] ?? (subjects[q.subject] = { total: 0, correct: 0 });
        s.total += 1;
        if (userAnswers[q.id] === q.correctOption) s.correct += 1;
      }
      const attemptedQs = questions.filter((q) => userAnswers[q.id]);
      let correct = 0;
      for (const q of attemptedQs) {
        if (userAnswers[q.id] === q.correctOption) correct += 1;
      }
      const attempt = addAttempt({
        exam: questions[0]?.examType ?? 'NEET_PG',
        mode,
        total: questions.length,
        attempted: attemptedQs.length,
        correct,
        subjects,
        questionIds: questions.map((q) => q.id),
        incorrectIds: attemptedQs.filter((q) => userAnswers[q.id] !== q.correctOption).map((q) => q.id),
      });
      // The performance review is kept for good, so it can be opened again from the Test Reviews screen.
      const saved = buildReview(attempt.id, questions, userAnswers as Record<string, string>, new Date().toISOString(), qTimeRef.current);
      // Every wrong or skipped question goes into the Mistake Notebook for spaced review.
      try { recordTestMisses(questions, userAnswers as Record<string, string>, `Test ${new Date().toLocaleDateString()}`, attempt.id); } catch { /* notebook storage full: the review itself is still kept */ }
      const reward = rewardForTest(saved.correct, saved.answered);
      saved.xp = reward.xp;
      saved.leveledUp = reward.leveledUp;
      saved.newBadges = reward.newBadges;
      saveReview(saved);
      setReview(saved);
      setCelebrate(true);
    } catch { /* never block the run on history bookkeeping */ }
  };

  const confirmSubmit = (label: string): boolean => {
    const unanswered = questions.length - answeredCount;
    if (unanswered <= 0) return true;
    return window.confirm(
 `${unanswered} of ${questions.length} question${questions.length === 1 ? '' : 's'} are unanswered. Submit ${label} anyway?`,
    );
  };

  const handleSubmitExam = () => {
    if (!confirmSubmit('the exam')) return;
    recordAttempt('exam');
    setExamSubmitted(true);
    setShowExplanation(true);
    setShowResultsScreen(true);
  };

  const handleSubmitModule = () => {
    if (!confirmSubmit('this module')) return;
    recordAttempt('module');
    setExamSubmitted(true);
    setShowExplanation(true);
    setShowResultsScreen(true);
  };

  if (questions.length === 0) {
    return (
      <div className={`-m-4 min-h-[70vh] p-6 max-md:-m-3 max-md:min-h-0 max-md:p-4 sm:-m-6 sm:p-8 lg:-m-8 ${t.page}`}>
        <div className={`mx-auto mt-10 max-w-2xl rounded-xl border p-10 text-center ${t.card} ${t.shadowXl}`}>
          <BookOpen className={`mx-auto h-9 w-9 ${t.faint}`} />
          <h2 className={`mt-3 text-base font-medium ${t.title}`}>No active module</h2>
          <p className={`mx-auto mt-2 max-w-md text-xs leading-relaxed ${t.text}`}>
            The runner only shows questions you actually launched. Build a module in the Practice Builder, or open a
            question from your bank, and it will appear here with your answers recorded to your real progress.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => onNavigate('practice')}
              className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-medium text-white hover:bg-teal-500"
            >
              Open Practice Builder
            </button>
            <button
              onClick={() => onNavigate('question-bank')}
              className={`rounded-lg border px-4 py-2 text-xs font-semibold ${t.navBtn}`}
            >
              Open Question Bank
            </button>
          </div>
        </div>
      </div>
    );
  }

  const questionPrompt = ((currentQ as any)?.question || currentQ?.questionText || '').trim();
  const rawStem = (currentQ?.stem || '').trim();
  const hasVignette = !!rawStem && rawStem.toLowerCase() !== questionPrompt.toLowerCase();
  const examLabel = EXAM_LABEL[(currentQ?.examType ?? 'NEET_PG') as ExamType] ?? 'NEET-PG';
  const bankLabel = (currentQ?.sourceType ?? 'ai-generator').replace(/-/g, ' ').toUpperCase();
  const reveal = isAnswered && showExplanation;
  const tabButton = (tab: MatrixTab, label: string, Icon: React.ComponentType<{ className?: string }>) => {
    const tabNo = tab === 'rationale' ? '01' : tab === 'pearl' ? '02' : tab === 'evidence' ? '03' : '04';
    return (
      <button
        key={tab}
        onClick={() => setMatrixTab(tab)}
        className={`flex min-h-[44px] items-center gap-2 rounded-t-md border-b-4 px-2.5 py-1.5 font-mono text-[11px] transition max-md:h-8 max-md:min-h-[32px] max-md:shrink-0 max-md:gap-1.5 max-md:rounded-full max-md:border! max-md:border-slate-200 max-md:px-2.5 max-md:py-1 max-md:font-sans max-md:leading-none max-md:dark:border-slate-700 ${
          matrixTab === tab
            ? `${t.tabOn} max-md:border-[#0f8b8d]! max-md:bg-[#0f8b8d]/10 max-md:text-[#0f8b8d] max-md:text-[12px]! max-md:dark:bg-teal-400/10 max-md:dark:text-teal-300`
            : `${t.tabOff} max-md:bg-white max-md:text-slate-600 max-md:text-[12px]! max-md:dark:bg-slate-900 max-md:dark:text-slate-300`
        }`}
      >
        <span className={`text-sm tracking-wide max-md:hidden ${matrixTab === tab ? '' : 'opacity-60'}`}>{tabNo}</span>
        <Icon className="h-3.5 w-3.5" />
        <span className="whitespace-nowrap font-medium">{label}</span>
      </button>
    );
  };

  const questionCardVariants = {
    enter: (dir: number) => ({
      x: isPhone || shouldReduceMotion ? 0 : dir * 84,
      y: isPhone && !shouldReduceMotion ? dir * 24 : 0,
      rotate: isPhone || shouldReduceMotion ? 0 : dir * 1.4,
      opacity: 0,
    }),
    center: { x: 0, y: 0, rotate: 0, opacity: 1 },
    exit: (dir: number) => ({
      x: isPhone || shouldReduceMotion ? 0 : -dir * 64,
      y: isPhone && !shouldReduceMotion ? -dir * 24 : 0,
      rotate: isPhone || shouldReduceMotion ? 0 : -dir * 1,
      opacity: 0,
    }),
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    if (!isPhone || matrixOpen || paletteOpen || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const region = (event.target as HTMLElement).closest('[data-question-scroll]') as HTMLElement | null;
    const canScroll = region ? region.scrollHeight > region.clientHeight + 1 : false;
    touchSwipeRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      lastX: touch.clientX,
      lastY: touch.clientY,
      lastTime: Date.now(),
      scrollRegion: region,
      startScrollTop: region ? region.scrollTop : 0,
      startAtTopEdge: !region || !canScroll || region.scrollTop <= 1,
      startAtBottomEdge: !region || !canScroll || region.scrollTop + region.clientHeight >= region.scrollHeight - 1,
    };
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchSwipeRef.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    start.lastX = touch.clientX;
    start.lastY = touch.clientY;
    start.lastTime = Date.now();
  };

  const evaluateQuestionSwipe = (
    start: { x: number; y: number; time: number; scrollRegion: HTMLElement | null; startScrollTop: number; startAtTopEdge: boolean; startAtBottomEdge: boolean },
    endX: number,
    endY: number,
    endTime: number,
  ) => {
    if (matrixOpen || paletteOpen) return;
    const dx = endX - start.x;
    const dy = endY - start.y;
    const elapsed = Math.max(endTime - start.time, 1);
    const distance = Math.abs(dy);
    const requiredDistance = Math.max(140, Math.round(window.innerHeight * 0.2));
    const isFlick = distance >= 100 && distance / elapsed > 0.7;
    if ((distance < requiredDistance && !isFlick) || distance <= Math.abs(dx) * 1.3) return;
    const region = start.scrollRegion;
    if (region && Math.abs(region.scrollTop - start.startScrollTop) > 2) return;
    if (dy < 0) {
      if (!start.startAtBottomEdge) return;
      if (currentIndex < questions.length - 1) goNext();
    } else if (currentIndex > 0) {
      if (!start.startAtTopEdge) return;
      goPrev();
    }
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLElement>) => {
    const start = touchSwipeRef.current;
    touchSwipeRef.current = null;
    if (!start || !isPhone || !event.changedTouches.length) return;
    const touch = event.changedTouches[0];
    evaluateQuestionSwipe(start, touch.clientX, touch.clientY, Date.now());
  };

  const handleTouchCancel = () => {
    const start = touchSwipeRef.current;
    touchSwipeRef.current = null;
    if (!start || !isPhone) return;
    evaluateQuestionSwipe(start, start.lastX, start.lastY, start.lastTime);
  };

  const handleMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (matrixOpen || paletteOpen || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a')) return;
    const region = target.closest('[data-question-scroll]') as HTMLElement | null;
    const canScroll = region ? region.scrollHeight > region.clientHeight + 1 : false;
    mouseSwipeRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
      scrollRegion: region,
      startScrollTop: region ? region.scrollTop : 0,
      startAtTopEdge: !region || !canScroll || region.scrollTop <= 1,
      startAtBottomEdge: !region || !canScroll || region.scrollTop + region.clientHeight >= region.scrollHeight - 1,
    };
  };

  const handleMouseUp = (event: React.MouseEvent<HTMLElement>) => {
    const start = mouseSwipeRef.current;
    mouseSwipeRef.current = null;
    if (!start) return;
    evaluateQuestionSwipe(start, event.clientX, event.clientY, Date.now());
  };

  const handleQuestionDragStart = (event: any) => {
    const tagName = String((event?.target as HTMLElement | null)?.tagName || '').toUpperCase();
    dragBlockedRef.current = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  };

  const handleQuestionDragEnd = (_event: any, info: any) => {
    if (dragBlockedRef.current) {
      dragBlockedRef.current = false;
      return;
    }
    if (info.offset.x < -80 || info.velocity.x < -500) {
      goNext();
    } else if (info.offset.x > 80 || info.velocity.x > 500) {
      goPrev();
    }
  };

  const palette = (
    <div className={`${cardShell} p-3.5 ${t.shadow}`}>
      <div className="mb-3 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <LayoutGrid className={`h-4 w-4 shrink-0 ${t.accentCyan}`} />
          <h3 className={`whitespace-nowrap font-mono text-[11px] font-medium ${t.strong}`}>Question Palette</h3>
        </div>
        <span className="whitespace-nowrap font-mono text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
          {answeredCount} / {totalQuestions} Attempted
        </span>
      </div>

      <div className="grid grid-cols-5 gap-1.5 font-mono text-xs font-semibold">
        {questions.map((q, idx) => {
          const ans = userAnswers[q.id];
          const isCurrent = idx === currentIndex;
          const wasFlagged = !!flaggedIds[q.id];

          const answerCls = ans === q.correctOption
            ? darkMode
              ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
              : 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
            : darkMode
              ? 'bg-rose-600 text-white hover:bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
              : 'bg-rose-600 text-white hover:bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.25)]';
          let cls = t.paletteIdle;
          // In an exam, nothing shows whether an answer is right until the test is submitted.
          if (ans) cls = mode === 'EXAM' && !examSubmitted ? 'bg-cyan-600 text-white hover:bg-cyan-500' : answerCls;
          if (isCurrent) {
            cls += ` ring-2 ring-cyan-400 ring-offset-1 ${t.ringOffset}`;
          }

          return (
            <button
              key={q.id}
              onClick={() => setCurrentIndex(idx)}
              className={`relative flex min-h-[44px] items-center justify-center rounded-md border font-medium transition active:translate-y-0.5 sm:min-h-[36px] ${cls}`}
              title={`Question ${idx + 1}${wasFlagged ? ' · flagged' : ''}`}
            >
              {idx + 1}
              {wasFlagged && (
                <span
                  className={`absolute -right-1 -top-1 h-3 w-3 border ${
                    darkMode ? 'border-amber-800 bg-amber-400' : 'border-amber-200 bg-amber-400'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 font-mono text-[10px] ${t.divider} ${t.text}`}>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Correct</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Wrong</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-500" /> Current</span>
        <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${darkMode ? 'bg-slate-700' : 'bg-slate-300'}`} /> Unseen</span>
      </div>
    </div>
  );

  return (
    <div className={`-m-4 min-h-[calc(100vh-56px)] selection:bg-teal-500/30 sm:-m-6 lg:-m-8 ${takingQuestion ? 'max-md:fixed max-md:inset-0 max-md:z-40 max-md:m-0 max-md:flex max-md:h-[100dvh] max-md:min-h-0 max-md:flex-col max-md:overflow-hidden' : 'max-md:-m-3 max-md:min-h-0'} ${t.page}`}>
      {/* ── Top cockpit bar ─────────────────────────────────────────────── */}
      <header className={`z-20 overflow-hidden border-b-2 px-2 py-0 max-md:shrink-0 max-md:border-b md:sticky md:top-0 md:px-6 md:py-2 ${t.bar}`}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage: shouldReduceMotion
              ? 'none'
              : 'repeating-conic-gradient(from 0deg at 50% 50%, currentColor 0deg 2deg, transparent 2deg 12deg)',
          }}
        />

        {/* Dense native-app header: phones only */}
        <div className="relative z-10 flex h-9 items-center gap-1.5 md:hidden">
          <button
            onClick={() => onNavigate(currentQ?.sourceType ? 'question-bank' : 'practice')}
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition before:absolute before:-inset-1.5 before:content-[''] ${t.barBack}`}
            title="Return to modules"
          >
            <ChevronLeft className="h-[18px] w-[18px]" />
          </button>

          <span className={`flex items-baseline gap-1 text-[13px] font-semibold tabular-nums ${darkMode ? 'text-slate-200' : 'text-slate-700'}`}>
            <span className={`text-[11px] font-medium ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>Q</span>
            <span>{currentIndex + 1}/{totalQuestions}</span>
          </span>

          <div className={`ml-auto flex items-center gap-1 font-semibold tabular-nums ${t.timer} max-md:border-0! max-md:bg-transparent! max-md:px-1! max-md:py-0!`}>
            <Clock className="h-3 w-3" />
            <span className="max-md:text-[12px]!">{formatTimer(secondsElapsed)}</span>
          </div>

          {examSubmitted && (
            <button onClick={() => setShowResultsScreen(true)} className="shrink-0 rounded-lg bg-[#0f8b8d] px-2.5 py-1 text-[11px] font-semibold text-white">Results</button>
          )}

          <button
            onClick={toggleFlag}
            aria-pressed={isFlagged}
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition before:absolute before:-inset-1.5 before:content-[''] ${isFlagged ? t.flagOn : t.flagOff}`}
            title={isFlagged ? 'Remove flag from this question' : 'Flag this question for review'}
          >
            <Flag className={`h-[18px] w-[18px] ${isFlagged ? 'fill-current' : ''}`} />
          </button>

          <button
            onClick={() => setPaletteOpen(true)}
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition before:absolute before:-inset-1.5 before:content-[''] ${
              darkMode ? 'border-slate-700 bg-slate-800 text-slate-300' : 'border-slate-200 bg-white text-slate-600'
            }`}
            title="Open question palette"
            aria-expanded={paletteOpen}
          >
            <LayoutGrid className="h-[18px] w-[18px]" />
          </button>

        </div>

        <div className={`relative z-10 -mx-2 h-[2px] overflow-hidden md:hidden ${darkMode ? 'bg-slate-800' : 'bg-slate-200'}`}>
          <div
            className="h-full bg-[#0f8b8d] transition-all duration-300 dark:bg-teal-400"
            style={{ width: `${totalQuestions > 0 ? Math.round(((currentIndex + 1) / totalQuestions) * 100) : 0}%` }}
          />
        </div>

        <div className="relative z-10 hidden flex-col gap-2 md:flex lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              onClick={() => onNavigate(currentQ?.sourceType ? 'question-bank' : 'practice')}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition sm:h-10 sm:w-10 ${t.barBack}`}
              title="Return to modules"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className={` text-lg tracking-wide ${t.barTitle}`}>
                  {examLabel} • AI MODULE
                </span>
                <span className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide ${t.chipAccent}`}>
                  {currentQ?.cognitiveTier ?? 'CLINICAL 2-STEP'}
                </span>
                <span className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${t.chip}`}>
                  {mode === 'EXAM' ? 'Exam Mode' : 'Tutor Mode'}
                </span>
                <span className={`hidden rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium sm:inline ${t.chipMono}`}>
                  BANK: {bankLabel}
                </span>
              </div>
              <p className={`mt-0.5 max-w-xl truncate text-[11px] ${t.barSub}`}>
                {currentQ?.subject} • {safeSubtopic(currentQ, reveal)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] font-medium">
              <span className={`rounded-md border px-2 py-1 ${t.chipAnswered}`}>
                Q {currentIndex + 1}/{totalQuestions}
              </span>
              <span className={`rounded-md border px-2 py-1 ${t.chipOk}`}>
                ANS {answeredCount}
              </span>
              <span className={`rounded-md border px-2 py-1 ${t.chipWarn}`}>
                FLAG {flaggedCount}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className={`hidden items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs sm:flex ${t.pace}`}>
              <Gauge className={`h-4 w-4 ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
              <span className={t.paceLabel}>PACE</span>
              <span className={` text-base ${t.accent}`}>{paceDisplay}</span>
            </div>

            {mode === 'EXAM' && !examSubmitted && (
              <button
                onClick={handleSubmitExam}
                className={`hidden min-h-[44px] rounded-lg px-3 py-1.5 font-mono text-[11px] font-medium sm:block ${t.submitTop}`}
              >
                SUBMIT EXAM
              </button>
            )}
            {examSubmitted && (
              <>
                <span className={`hidden rounded-lg px-2.5 py-1 font-mono text-[11px] font-medium sm:block ${t.chipMono}`}>
                  SUBMITTED
                </span>
                <button
                  onClick={() => setShowResultsScreen(true)}
                  className={`min-h-[44px] rounded-lg px-3 py-1.5 font-mono text-[11px] font-medium ${t.submitTop}`}
                >
                  PERFORMANCE REVIEW
                </button>
              </>
            )}

            <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-xs font-semibold ${t.timer}`}>
              <Clock className="h-4 w-4" />
              <span className=" text-xl tracking-wider">{formatTimer(secondsElapsed)}</span>
            </div>

            <button
              onClick={toggleFlag}
              aria-pressed={isFlagged}
              className={`relative flex min-h-[44px] items-center gap-1.5 rounded-lg p-2 transition ${isFlagged ? t.flagOn : t.flagOff}`}
              title={isFlagged ? 'Remove flag from this question' : 'Flag this question for review'}
            >
              <Flag className={`h-4 w-4 ${isFlagged ? 'fill-current' : ''}`} />
              <AnimatePresence>
                {isFlagged && (
                  <motion.span
                    initial={shouldReduceMotion ? false : { scale: 0.6, rotate: -12, opacity: 0 }}
                    animate={{ scale: 1, rotate: -6, opacity: 1 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                    className={`pointer-events-none absolute -right-2 -top-3 rounded-md border  px-1.5 py-0.5 text-[10px] tracking-wide  ${
                      darkMode ? 'border-amber-400 bg-amber-500/20 text-amber-300' : 'border-amber-400 bg-amber-100 text-amber-700'
                    }`}
                  >
                    FLAGGED!
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </div>

        <div className={`relative z-10 mt-2 hidden h-2 w-full overflow-hidden rounded-full border md:block ${t.track}`}>
          <div className="h-full rounded-full  transition-all duration-500 ease-out" style={{ width: `${progressPct}%` }} />
        </div>
      </header>

      <div className={`flex ${takingQuestion ? 'max-md:min-h-0 max-md:flex-1 max-md:flex-col' : ''}`}>
        {/* ── Scrollable workspace ─────────────────────────────────────── */}
        <main className={`min-w-0 flex-1 px-3 py-2 md:px-6 md:py-5 ${takingQuestion ? 'max-md:flex max-md:min-h-0 max-md:flex-col max-md:overflow-hidden max-md:px-1.5 max-md:pb-[calc(46px+env(safe-area-inset-bottom))] max-md:pt-1' : ''}`}>
          <div className={`mx-auto max-w-4xl space-y-3 pb-40 max-md:space-y-2.5 md:space-y-5 md:pb-16 ${takingQuestion ? 'max-md:flex max-md:h-full max-md:min-h-0 max-md:flex-col max-md:gap-2 max-md:space-y-0 max-md:overflow-hidden max-md:pb-0' : ''}`}>
            {/* Session telemetry */}
            <div className={`relative hidden overflow-hidden md:block ${cardShell} p-3.5 ${t.shadow}`}>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-12 opacity-10"
                style={{
                  backgroundImage: `radial-gradient(circle, ${darkMode ? '#EEEEED' : '#14110F'} 1px, transparent 1px)`,
                  backgroundSize: '8px 8px',
                }}
              />
              <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2 font-mono">
                  <span className={`flex items-center gap-1.5 text-lg tracking-wide ${t.accent}`}>
                    <Zap className="h-4 w-4" /> PULSE PROGRESS
                  </span>
                  <span className={`rounded-md border px-2 py-1 font-medium ${t.chipAnswered}`}>ANSWERED {answeredCount}/{totalQuestions}</span>
                  <span className={`rounded-md border px-2 py-1 font-medium ${t.chipOk}`}>CORRECT {correctCount}</span>
                  <span className={`rounded-md border px-2 py-1 font-medium ${t.chipTeal}`}>ACCURACY {accuracy === null ? '—' : `${accuracy}%`}</span>
                  <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-medium ${t.chipWarn}`}>
                    FLAG {flaggedCount}
                    <span className="flex gap-1">
                      {Array.from({ length: Math.min(flaggedCount, 4) }).map((_, i) => (
                        <span
                          key={i}
                          className={`h-2 w-2 border ${darkMode ? 'bg-amber-400 border-amber-800' : 'bg-amber-400 border-amber-200'}`}
                        />
                      ))}
                    </span>
                  </span>
                </div>
                <div className={`font-mono text-[11px] ${t.dim}`}>
                  CURRENT <span className={` text-base ${t.accentCyan}`}>Q{currentIndex + 1}</span> OF {totalQuestions}
                </div>
              </div>

              <div className="relative z-10 mt-3">
                <div className={`h-3 w-full overflow-hidden rounded-full border ${t.track}`}>
                  <div
                    className="h-full rounded-full  transition-all duration-500 ease-out"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className={`mt-1 flex justify-between font-mono text-[11px] ${t.dim}`}>
                  <span>1</span>
                  <span className={`font-medium ${t.accentCyan}`}>
                    {answeredCount} of {totalQuestions} answered ({progressPct}%)
                  </span>
                  <span>{totalQuestions}</span>
                </div>
              </div>
            </div>

            {/* Question card */}
            <AnimatePresence mode="popLayout" initial={false} custom={directionRef.current}>
              <motion.div
                key={currentIndex}
                className={takingQuestion ? 'max-md:flex max-md:h-full max-md:min-h-0 max-md:flex-col' : undefined}
                custom={directionRef.current}
                variants={questionCardVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: 'easeOut' }}
                drag={isPhone ? false : 'x'}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.2}
                onDragStart={handleQuestionDragStart}
                onDragEnd={handleQuestionDragEnd}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
              >
                <section className={`space-y-3 rounded-xl border p-3 md:space-y-5 md:p-6 ${takingQuestion ? 'max-md:flex max-md:h-full max-md:min-h-0 max-md:flex-col max-md:gap-2 max-md:space-y-0 max-md:overflow-hidden max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none' : ''} ${t.card} ${t.shadowXl}`}>
              <div data-question-scroll className={`space-y-3 md:contents md:space-y-5 ${takingQuestion ? 'max-md:min-h-[88px] max-md:max-h-[60%] max-md:flex-[0_1_auto] max-md:overflow-y-auto max-md:overscroll-y-contain max-md:rounded-xl max-md:border max-md:p-2.5 max-md:space-y-2 ' + t.card : ''}`}>
              {hasVignette && (
                <div className={`rounded-r-xl border p-3 max-md:rounded-none max-md:border-0 max-md:border-l-2 max-md:bg-transparent max-md:p-0 max-md:pl-2.5 md:p-5 ${t.inner}`}>
                  <div className="mb-2 flex items-center justify-between max-md:mb-1">
                    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:font-sans max-md:text-[11px]! max-md:text-slate-500 max-md:dark:text-slate-400 ${t.vignetteLabel}`}>
                      Clinical Vignette
                    </span>
                    <span className={`font-mono text-[10px] max-md:hidden ${t.faint}`}>
                      {currentQ?.moduleCode ?? `Q-${currentQ?.id?.slice(-6) ?? currentIndex + 1}`}
                    </span>
                  </div>
                  <p className={`whitespace-pre-line break-words text-[16px] leading-6 max-md:text-[15px]! max-md:leading-[1.55] max-md:text-slate-800 max-md:dark:text-slate-200 md:text-[20px] md:leading-relaxed ${t.strong}`}>{rawStem}</p>
                </div>
              )}

              {currentQ?.image && (
                <div className={`space-y-2 rounded-xl border p-3 ${t.swallow}`}>
                  <div className={`flex items-start justify-between gap-2 font-mono text-[10px] uppercase tracking-wider ${t.dim}`}>
                    <span className="leading-snug">
                      {/* Pre-answer we show ONLY the neutral label: an image caption or
                          attribution can name the diagnosis (which is the answer), so the
                          descriptive caption is withheld until the answer is revealed.
                          safeImageCaption() also scrubs legacy stored captions that
                          contained the diagnosis outright. */}
                      {safeImageCaption(currentQ, reveal)}
                      {currentQ.imageVerified && (
                        <span className="ml-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-600 dark:text-emerald-400" title={currentQ.imageVerifyReason || 'Image verified against this question'}>
                          ✓ Verified
                        </span>
                      )}
                    </span>
                    {reveal && (currentQ.imageLicence || currentQ.imageSourceUrl) && (
                      <span className="flex shrink-0 items-center gap-2">
                        {/* Licence is rendered once, from the trusted field — the caption
                            used to repeat it, which is why it appeared twice. */}
                        {currentQ.imageCredit && <span className="opacity-70 max-w-[220px] truncate" title={currentQ.imageCredit}>{currentQ.imageCredit}</span>}
                        {currentQ.imageLicence && (
                          currentQ.imageLicenceUrl
                            ? <a href={currentQ.imageLicenceUrl} target="_blank" rel="noopener noreferrer" className="opacity-70 hover:underline">· {currentQ.imageLicence}</a>
                            : <span className="opacity-70">· {currentQ.imageLicence}</span>
                        )}
                        {currentQ.imageSourceUrl && (
                          <a
                            href={currentQ.imageSourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`font-semibold hover:underline ${t.accentCyan}`}
                            title="Open source"
                          >
                            Source ↗
                          </a>
                        )}
                      </span>
                    )}
                  </div>
                  <ZoomableImage
                    src={currentQ.image}
                    alt={safeImageCaption(currentQ, reveal)}
                    className={`max-h-80 w-full max-w-full rounded-lg border bg-white object-contain ${t.divider}`}
                  />
                </div>
              )}

              {/* Question — large enough to read comfortably, in step with the vignette above */}
              <div>
                <h2 className={`flex items-start gap-2 break-words text-[16px] font-semibold leading-6 max-md:gap-2 max-md:text-[17px]! max-md:leading-[1.4] md:gap-3 md:text-[20px] md:leading-relaxed ${t.title}`}>
                  <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium max-md:mt-0 max-md:rounded-full max-md:px-2 max-md:font-sans max-md:text-[10px]! ${t.vignetteLabel}`}>
                    Q{currentIndex + 1}
                  </span>
                  <span className="min-w-0">{questionPrompt}</span>
                </h2>
                <div className="flex flex-wrap items-center justify-between gap-2 pl-0 sm:pl-12">
                  <span className={`mt-2 block font-mono text-[10px] uppercase tracking-wider max-md:hidden ${t.dim}`}>
                    Select one option from below
                  </span>
                  {isFlagged && (
                    <span
                      className={`mt-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider ${t.chipWarn}`}
                    >
                      Flagged for review
                    </span>
                  )}
                </div>
              </div>
              </div>

              {/* Options */}
              <div data-question-scroll className={`space-y-2 md:space-y-2.5 max-md:space-y-1.5 ${takingQuestion ? 'max-md:min-h-0 max-md:flex-[0_1_auto] max-md:overflow-y-auto max-md:overscroll-y-contain max-md:rounded-xl max-md:border max-md:p-2 max-md:pb-4 max-md:shadow-sm ' + t.card : ''}`}>
                {currentQ.options.map((opt) => {
                  const picked = selectedAnswer === opt.id;
                  const correct = currentQ.correctOption === opt.id;
                  const showCorrect = reveal && correct;
                  const showWrong = reveal && picked && !correct;
                  const pending = picked && !reveal;

                  const shell = showCorrect ? t.optOk : showWrong ? t.optBad : pending ? t.optPick : t.optIdle;
                  const tile = showCorrect
                    ? `${t.optOkTile} shadow-md`
                    : showWrong
                      ? `${t.optBadTile} shadow-md`
                      : pending
                        ? `${t.optPickTile} shadow-md`
                        : t.optIdleTile;
                  const label = showCorrect ? t.optOkText : showWrong ? t.optBadText : pending ? t.optPickText : t.optIdleText;

                  return (
                    <button
                      key={opt.id}
                      onClick={() => handleSelectOption(opt.id)}
                      disabled={isLocked}
                      aria-pressed={picked}
                      className={`group relative flex min-h-[52px] w-full flex-col gap-1.5 rounded-xl px-3 py-2 text-left transition-all duration-150 max-md:min-h-[40px] max-md:gap-0.5 max-md:border max-md:px-2.5 max-md:py-2 max-md:shadow-[0_1px_2px_rgba(15,23,42,0.05)] max-md:hover:translate-y-0 active:translate-y-0 md:gap-2 md:px-4 md:py-3.5 ${shell} ${
                        isLocked
                          ? 'cursor-default'
                          : `cursor-pointer hover:-translate-y-1 `
                      }`}
                    >
                      {showCorrect && (
                        <span
                          className={`absolute -right-1 -top-2 z-10 -rounded-md border px-2 py-0.5 text-sm tracking-wide max-md:static max-md:order-last max-md:mt-0 max-md:w-fit max-md:self-start max-md:rounded-full max-md:border max-md:px-1.5 max-md:py-0 max-md:text-[11px]! max-md:leading-4 max-md:tracking-normal ${t.okBadge}`}
                        >
                          CORRECT!
                        </span>
                      )}
                      {showWrong && (
                        <span
                          className={`absolute -right-1 -top-2 z-10 rounded-md border px-2 py-0.5 text-sm tracking-wide max-md:static max-md:order-last max-md:mt-0 max-md:w-fit max-md:self-start max-md:rounded-full max-md:border max-md:px-1.5 max-md:py-0 max-md:text-[11px]! max-md:leading-4 max-md:tracking-normal ${t.badBadge}`}
                        >
                          YOUR PICK
                        </span>
                      )}
                      {pending && (
                        <span
                          className={`absolute -right-1 -top-2 z-10 -rounded-md border px-2 py-0.5 text-sm tracking-wide max-md:static max-md:order-last max-md:mt-0 max-md:w-fit max-md:self-start max-md:rounded-full max-md:border max-md:px-1.5 max-md:py-0 max-md:text-[11px]! max-md:leading-4 max-md:tracking-normal ${t.okBadge}`}
                        >
                          LOCKED IN
                        </span>
                      )}
                      <div className="flex items-center justify-between gap-2 md:gap-3">
                        <div className="flex min-w-0 items-center gap-2.5 max-md:gap-2 md:gap-4">
                          <div
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-medium max-md:h-[22px] max-md:w-[22px] max-md:rounded-full max-md:font-sans max-md:text-[11px]! max-md:font-semibold md:h-10 md:w-10 md:rounded-lg md:text-sm ${tile}`}
                          >
                            {opt.id}
                          </div>
                          <div className={`break-words text-[15px] leading-5 max-md:text-[13.5px]! max-md:leading-[1.4] md:text-[17px] md:leading-relaxed ${label}`}>{opt.text}</div>
                        </div>
                        {showCorrect && (
                          <CheckCircle2 className={`h-6 w-6 shrink-0 ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
                        )}
                        {showWrong && (
                          <X className={`h-6 w-6 shrink-0 ${darkMode ? 'text-rose-400' : 'text-rose-500'}`} />
                        )}
                      </div>

                      {showCorrect && (
                        <div className={`pl-9 font-mono text-[11px] font-medium max-md:hidden max-md:pl-[36px] max-md:font-sans max-md:text-[12px]! md:pl-12 md:text-xs ${t.okHint}`}>
                          ✓ Keyed correct option for this item.
                        </div>
                      )}
                    </button>
                  );
                })}
                {reveal && mode === 'TUTOR' && !matrixOpen && (
                  <button onClick={() => setMatrixOpen(true)} className={`flex h-9 w-fit items-center gap-2 rounded-full border px-3 text-xs font-semibold ${t.navBtn}`}>
                    <BookOpen className={`h-3.5 w-3.5 ${t.accentCyan}`} /> See explanation
                  </button>
                )}
              </div>
                </section>
              </motion.div>
            </AnimatePresence>

            {/* Clinical Reasoning Matrix */}
            {matrixOpen && (
              <>
                {matrixOpen && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] md:hidden"
                    onClick={() => setMatrixOpen(false)}
                    aria-hidden
                  />
                )}
                <section
                  id="reasoning-matrix"
                  className={`${
                    matrixOpen
                      ? `fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-y-auto rounded-t-2xl border pb-[env(safe-area-inset-bottom)] sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[560px] sm:max-w-[92vw] sm:rounded-none sm:border-l-4 sm:pb-0 max-md:top-[6dvh]! max-md:flex max-md:max-h-none max-md:flex-col max-md:overflow-hidden ${takingQuestion ? 'max-md:bottom-[calc(46px+env(safe-area-inset-bottom))]' : ''}`
                      : `overflow-hidden rounded-xl border ${takingQuestion ? 'max-md:hidden' : ''}`
                    } ${t.card} ${t.shadowXl} ${isPhone && !matrixOpen ? 'max-md:hidden' : ''}`}
                >
                <div className="md:hidden max-md:mx-auto max-md:mt-1.5 max-md:mb-1 max-md:h-1 max-md:w-9 max-md:rounded-full max-md:bg-slate-300 max-md:dark:bg-slate-600" aria-hidden />
                <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 pt-2.5 md:px-4 max-md:flex-col max-md:flex-nowrap max-md:items-stretch max-md:gap-0 max-md:px-3 max-md:pt-2 max-md:pb-0 max-md:shrink-0 ${t.matrixHead}`}>
                  <div className="flex items-center gap-2 pb-2 max-md:w-full max-md:justify-between max-md:gap-0 max-md:pb-0">
                    <Activity className={`h-4 w-4 max-md:hidden ${t.accentCyan}`} />
                    <span className={`font-mono text-xs font-medium uppercase tracking-wider max-md:hidden ${t.strong}`}>
                      Clinical Reasoning Matrix
                    </span>
                    <span className={`font-sans font-semibold md:hidden max-md:text-[14px]! ${t.strong}`}>
                      Explanation
                    </span>
                    {matrixOpen && (
                      <button
                        onClick={() => setMatrixOpen(false)}
                        className={`ml-1 flex h-11 w-11 items-center justify-center rounded-md sm:h-8 sm:w-8 max-md:ml-0 max-md:h-9! max-md:w-9! max-md:shrink-0 max-md:rounded-full ${t.ghostBtn}`}
                        title="Close reasoning matrix"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {reveal && (
                    <div className="flex items-center gap-0.5 overflow-x-auto max-md:-mx-3 max-md:w-full max-md:shrink-0 max-md:flex-nowrap max-md:gap-1.5 max-md:overflow-y-hidden max-md:px-3 max-md:pb-2 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden">
                      {tabButton('rationale', 'Rationale', Stethoscope)}
                      {tabButton('pearl', 'High-Yield Pearls', Lightbulb)}
                      {tabButton('evidence', 'Evidence', BookOpen)}
                      {tabButton('ai', 'AI Tutor Copilot', Sparkles)}
                    </div>
                  )}
                </div>

                <div className="space-y-2.5 p-3 md:space-y-4 md:p-5 max-md:flex-1 max-md:min-h-0 max-md:overflow-y-auto max-md:overscroll-y-contain max-md:px-3 max-md:pb-3 max-md:pt-0">
                  {!reveal && (
                    <AiQuestionTools dark={darkMode} question={currentQ} userChoice={selectedAnswer} />
                  )}

                  {reveal && matrixTab === 'rationale' && (
                    <>
                      <ReviewNoteCard
                        q={currentQ}
                        userChoice={selectedAnswer}
                        onTeach={() => setTeachTopics([questionTopic(currentQ)])}
                        onTryRelated={relatedIndex >= 0 ? () => goToIndex(relatedIndex) : undefined}
                      />
                    </>
                  )}

                  {reveal && matrixTab === 'pearl' && (
                    currentQ?.boardPearl ? (
                      <div className={`flex items-start gap-3.5 rounded-xl border p-4 max-md:gap-2.5 max-md:p-3 ${t.pearl}`}>
                        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-teal-500/40 bg-teal-500/15 max-md:mt-0 max-md:h-7 max-md:w-7 max-md:rounded-md ${t.pearlTitle}`}>
                          <CheckCircle2 className="h-4 w-4 max-md:h-3.5 max-md:w-3.5" />
                        </div>
                        <div>
                          <span className={`mb-0.5 block font-mono text-[11px] font-medium uppercase tracking-wider max-md:mb-0 max-md:text-[11px]! ${t.pearlTitle}`}>
                            High-Yield Board Pearl
                          </span>
                          <p className={`font-mono text-sm font-semibold max-md:text-[13px]! max-md:leading-snug ${t.pearlText}`}>{currentQ.boardPearl}</p>
                        </div>
                      </div>
                    ) : (
                      <p className={`text-xs ${t.text}`}>No board pearl attached to this item.</p>
                    )
                  )}

                  {reveal && matrixTab === 'evidence' && (
                    <div className="space-y-3 max-md:space-y-2.5">
                      <div className={`rounded-xl border p-3.5 max-md:p-3 ${t.swallow}`}>
                        <div className={`mb-2 flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-wider max-md:mb-1.5 max-md:gap-1.5 max-md:text-[11px]! ${t.accentCyan}`}>
                          <Quote className="h-3.5 w-3.5" /> Verified citations
                        </div>
                        {currentQ?.citations && currentQ.citations.length > 0 ? (
                          <ul className={`space-y-1.5 text-xs max-md:space-y-1 max-md:text-[13px]! ${t.body}`}>
                            {currentQ.citations.map((c, i) => (
                              <li key={`${c}-${i}`} className="flex items-start gap-2">
                                <span className="mt-0.5 text-cyan-500">•</span>
                                <span>{c}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={`text-xs max-md:text-[13px]! ${t.text}`}>No citations attached to this item.</p>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 font-mono text-xs max-md:gap-1.5">
                        <div className={`rounded-lg border p-2.5 text-center max-md:p-2 ${t.swallow}`}>
                          <div className={`text-base font-medium leading-tight max-md:text-[15px]! ${t.title}`}>
                            {currentQ?.difficultyTier ?? '—'}
                          </div>
                          <div className={`mt-1 text-[9px] font-medium uppercase max-md:mt-0.5 max-md:text-[11px]! ${t.dim}`}>Difficulty</div>
                        </div>
                        <div className={`rounded-lg border p-2.5 text-center max-md:p-2 ${t.swallow}`}>
                          <div className={`text-base font-medium leading-tight max-md:text-[15px]! ${t.accentCyan}`}>
                            {currentQ?.targetAccuracy ?? '—'}%
                          </div>
                          <div className={`mt-1 text-[9px] font-medium uppercase max-md:mt-0.5 max-md:text-[11px]! ${t.dim}`}>Target accuracy</div>
                        </div>
                      </div>

                      {currentQ?.imageSourceUrl && (
                        <a
                          href={currentQ.imageSourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`block truncate rounded-lg border p-2.5 text-xs hover:underline max-md:p-2 max-md:text-[13px]! ${t.swallow} ${t.accentCyan}`}
                        >
                          Image source ↗ {currentQ.imageSourceUrl}
                        </a>
                      )}
                    </div>
                  )}

                  {reveal && matrixTab === 'ai' && (
                    <AiQuestionTools dark={darkMode} question={currentQ} userChoice={selectedAnswer} />
                  )}
                </div>
              </section>
              </>
            )}

            {/* Bottom navigation — fixed above the 64px app tab bar on phones */}
            <div
              className={`fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 flex h-14 flex-nowrap items-center justify-between gap-1.5 border-t px-2 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] max-md:my-0 max-md:bg-white max-md:px-3 max-md:shadow-[0_-4px_12px_rgba(15,23,42,0.06)] max-md:dark:bg-[#0f1729] ${takingQuestion ? 'max-md:bottom-0 max-md:h-[calc(46px+env(safe-area-inset-bottom))] max-md:pb-[env(safe-area-inset-bottom)] max-md:pt-0' : 'max-md:h-[52px]'} md:static md:z-auto md:h-auto md:flex-wrap md:gap-2 md:border-0 md:bg-transparent md:px-0 md:py-0 md:shadow-none ${
                darkMode
                  ? 'border-slate-800 bg-slate-950/95'
                  : 'border-slate-200 bg-white/95'
              }`}
            >
              <button
                disabled={currentIndex === 0}
                onClick={goPrev}
                className={`relative flex h-11 min-h-[44px] items-center gap-1 rounded-lg border px-2 text-xs font-medium transition active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 max-md:h-9 max-md:min-h-0 max-md:px-2.5 max-md:font-semibold max-md:text-[12px]! max-md:before:absolute max-md:before:-inset-1 max-md:before:content-[''] md:gap-1.5 md:px-4 md:py-2 ${t.navBtn}`}
              >
                <ChevronLeft className="h-4 w-4" />
                <span className="md:hidden">Prev</span>
                <span className="hidden md:inline">Previous</span>
              </button>

              <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 md:flex-none md:flex-wrap md:gap-2">
                <button
                  disabled={currentIndex === questions.length - 1}
                  onClick={goNext}
                  className={`relative flex h-11 min-h-[44px] items-center justify-center rounded-lg border px-2 text-xs font-medium transition active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 max-md:h-9 max-md:min-h-0 max-md:px-2.5 max-md:text-[12px]! max-md:before:absolute max-md:before:-inset-1 max-md:before:content-[''] md:px-3 md:py-2 ${t.ghostBtn}`}
                  title="Skip without answering"
                >
                  Skip
                </button>

                {(mode === 'TUTOR' || examSubmitted) && (
                  <button
                    onClick={() => setMatrixOpen(true)}
                    className={`relative flex h-11 min-h-[44px] w-11 items-center justify-center rounded-lg border text-xs font-medium transition active:scale-95 max-md:h-9 max-md:min-h-0 max-md:w-9 max-md:shrink-0 max-md:before:absolute max-md:before:-inset-1 max-md:before:content-[''] md:w-auto md:gap-2 md:px-4 md:py-2 ${t.dissect}`}
                    title="Dissect with AI Tutor"
                  >
                    <Stethoscope className="h-4 w-4" />
                    <span className="hidden md:inline">Dissect with AI Tutor</span>
                  </button>
                )}

                <button
                  disabled={currentIndex === questions.length - 1}
                  onClick={goNext}
                  className={`relative flex h-11 min-h-[44px] flex-1 items-center justify-center gap-1 rounded-lg border px-2 text-xs font-medium transition active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 max-md:h-9 max-md:min-h-0 max-md:rounded-lg max-md:border-[#0f8b8d] max-md:bg-[#0f8b8d] max-md:px-3 max-md:font-semibold max-md:text-[12px]! max-md:text-white max-md:hover:bg-[#0b6b6d] max-md:dark:border-teal-500 max-md:dark:bg-teal-600 max-md:dark:text-white max-md:before:absolute max-md:before:-inset-1 max-md:before:content-[''] md:flex-none md:gap-1.5 md:px-5 md:py-2 ${
                    darkMode ? 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>

                {!examSubmitted && (
                  <button
                    onClick={mode === 'EXAM' ? handleSubmitExam : handleSubmitModule}
                    className="relative flex h-9 min-h-0 items-center justify-center gap-1 rounded-lg border border-[#0f8b8d] bg-[#0f8b8d] px-2.5 text-xs font-semibold text-white transition hover:bg-[#0b6b6d] active:translate-y-0.5 md:hidden max-md:text-[12px]! max-md:before:absolute max-md:before:-inset-1 max-md:before:content-[''] dark:border-teal-500 dark:bg-teal-600 dark:text-white dark:hover:bg-teal-500"
                  >
                    <Send className="h-4 w-4" />
                    Submit
                  </button>
                )}
              </div>
            </div>

            {/* Compact palette for tablets — phones use the bottom-sheet palette */}
            <div className="hidden md:block xl:hidden">{palette}</div>
          </div>
        </main>

        {teachTopics && (
          <TeachMeModal topics={teachTopics} onClose={() => setTeachTopics(null)} onAskTutor={() => { setTutorSeed(lessonMessage(teachTopics)); onNavigate('ai-tutor'); }} />
        )}
        {examSubmitted && showResultsScreen && (
          <TestCoachPanel
            celebrate={celebrate}
            review={review ?? buildReview(`run-${signature(questions)}`, questions, userAnswers as Record<string, string>)}
            darkMode={darkMode}
            onClose={() => setShowResultsScreen(false)}
            onTeach={() => onNavigate('ai-tutor')}
            onOpenNotebook={() => onNavigate('mistakes')}
            onRetry={onRetryQuestions ? () => { const again = questions.filter((q) => userAnswers[q.id] !== q.correctOption); if (again.length) onRetryQuestions(again.map((q) => ({ ...q }))); } : undefined}
          />
        )}

        {/* ── Right rail: palette + telemetry + CTA ───────────────────── */}
        <aside className={`hidden w-72 shrink-0 flex-col space-y-4 border-l p-4 xl:sticky xl:top-[57px] xl:flex xl:max-h-[calc(100vh-57px)] xl:self-start xl:overflow-y-auto ${t.aside}`}>
          {palette}

          <div className={`${cardShell} p-3.5 font-mono ${t.shadow}`}>
            <h4 className={`mb-2.5 flex items-center gap-1.5 text-xs font-medium ${t.strong}`}>
              <Gauge className={`h-4 w-4 ${t.accent}`} /> Telemetry Status
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div className={`rounded-lg border p-2.5 text-center ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'}`}>
                <div className={`text-lg font-medium leading-tight ${t.title}`}>{correctCount} / {answeredCount}</div>
                <div className={`mt-1 text-[9px] font-medium uppercase ${t.dim}`}>Correct Hits</div>
              </div>
              <div className={`rounded-lg border p-2.5 text-center ${darkMode ? 'border-emerald-700/50 bg-emerald-950/40' : 'border-emerald-600/30 bg-emerald-50'}`}>
                <div className="text-lg font-medium leading-tight text-emerald-600 dark:text-emerald-400">
                  {accuracy === null ? '—' : `${accuracy}%`}
                </div>
                <div className={`mt-1 text-[9px] font-medium uppercase ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>Accuracy</div>
              </div>
            </div>
            <div className={`mt-2 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[10px] ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'} ${t.dim}`}>
              <span>Pace</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{paceDisplay}</span>
            </div>
            <div className={`mt-1.5 flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[10px] ${darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-200 bg-slate-50'} ${t.dim}`}>
              <span>Flagged</span>
              <span className="font-medium text-amber-600 dark:text-amber-300">{flaggedCount}</span>
            </div>
          </div>

          <div className="mt-auto pt-1">
            <button
              onClick={handleSubmitModule}
              disabled={examSubmitted}
              className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 font-mono text-[11px] font-medium shadow-sm transition disabled:opacity-50 ${t.submit}`}
            >
              {examSubmitted ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Module Submitted
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Submit Module &amp; View Results
                </>
              )}
            </button>
            <button
              onClick={() => onNavigate(currentQ?.sourceType ? 'question-bank' : 'practice')}
              className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-semibold transition ${t.ghostBtn}`}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
          </div>
        </aside>
      </div>

      {/* Phone question palette bottom sheet */}
      {paletteOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] md:hidden"
            onClick={() => setPaletteOpen(false)}
            aria-hidden
          />
          <div
            className={`fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl p-3 pb-4 ${takingQuestion ? 'max-md:bottom-[calc(46px+env(safe-area-inset-bottom))]' : ''} md:hidden ${t.card} ${t.shadowXl}`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <LayoutGrid className={`h-4 w-4 ${t.accentCyan}`} />
                <h3 className={`font-mono text-sm font-medium ${t.strong}`}>Question Palette</h3>
              </div>
              <button
                onClick={() => setPaletteOpen(false)}
                className={`flex h-11 w-11 items-center justify-center rounded-lg ${t.ghostBtn}`}
                title="Close question palette"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-5 gap-2 font-mono text-xs font-semibold">
              {questions.map((q, idx) => {
                const ans = userAnswers[q.id];
                const isCurrent = idx === currentIndex;
                const wasFlagged = !!flaggedIds[q.id];
                const answerCls = ans === q.correctOption
                  ? 'bg-emerald-600 text-white'
                  : 'bg-rose-600 text-white';
                let cls = t.paletteIdle;
                if (ans) cls = mode === 'EXAM' && !examSubmitted ? 'bg-cyan-600 text-white' : answerCls;
                if (isCurrent) cls += ` ring-2 ring-cyan-400 ring-offset-1 ${t.ringOffset}`;
                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIndex(idx)}
                    className={`relative mx-auto flex h-10 w-10 min-h-[40px] items-center justify-center rounded-full border font-medium transition active:translate-y-0.5 ${cls}`}
                    title={`Question ${idx + 1}${wasFlagged ? ' · flagged' : ''}`}
                  >
                    {idx + 1}
                    {wasFlagged && (
                      <span
                        className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border ${
                          darkMode ? 'border-slate-900 bg-amber-400' : 'border-white bg-amber-400'
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 font-mono text-[10px] ${t.divider} ${t.text}`}>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Correct</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> Wrong</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-500" /> Current</span>
              <span className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${darkMode ? 'bg-slate-700' : 'bg-slate-300'}`} /> Unseen</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
