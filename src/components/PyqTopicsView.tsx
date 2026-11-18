// PYQ Topics practice: the dedicated section where a learner picks a subject, opens a chapter,
// is taught it, sees which topics are likely next, and then answers MCQs on it.
//
// Three screens, plus the existing test runner and its results:
//   subject grid  ->  chapter list  ->  chapter workspace (lesson, then forecast)  ->  runner
//
// Everything on the first two screens and the forecast is computed on the device from
// src/data/chapterTopics.json, so it needs no AI call and works offline. Only the lesson and the
// questions use a provider.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { PyqSubjectGrid } from './PyqSubjectGrid.tsx';
import { PyqChapterList } from './PyqChapterList.tsx';
import { ChapterLessonPanel } from './ChapterLessonPanel.tsx';
import { ChapterForecastPanel } from './ChapterForecastPanel.tsx';
import {
  askedTopics,
  chaptersForSubject,
  listPyqSubjects,
  predictedTopics,
  teachableTopics,
  topicsForChapter,
} from '../lib/pyqChapter.ts';
import { generateExamQuestions } from '../lib/ai.ts';
import type { AppView, ClinicalQuestion, ExamType } from '../types.ts';

interface Props {
  onNavigate: (view: AppView, targetId?: string) => void;
  onLaunchQuestions: (questions: ClinicalQuestion[], mode: 'EXAM' | 'TUTOR', exam: ExamType) => void;
  exam: ExamType;
  initialTargetId?: string;
}

const LAST_PLACE_KEY = 'pulse.pyqTopics.lastPlace.v1';
const QUESTION_COUNT = 10;

type Screen = 'subjects' | 'chapters' | 'chapter';

function readLastPlace(): { subject: string; chapter: string | null } | null {
  try {
    const raw = localStorage.getItem(LAST_PLACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.subject === 'string') {
      return { subject: parsed.subject, chapter: typeof parsed.chapter === 'string' ? parsed.chapter : null };
    }
  } catch {
    /* first visit */
  }
  return null;
}

function rememberPlace(subject: string | null, chapter: string | null): void {
  try {
    if (!subject) localStorage.removeItem(LAST_PLACE_KEY);
    else localStorage.setItem(LAST_PLACE_KEY, JSON.stringify({ subject, chapter }));
  } catch {
    /* storage unavailable: the section still works, it just does not remember */
  }
}

export const PyqTopicsView: React.FC<Props> = ({ onNavigate, onLaunchQuestions, exam, initialTargetId }) => {
  const subjects = useMemo(() => listPyqSubjects(), []);

  const [subject, setSubject] = useState<string | null>(null);
  const [chapter, setChapter] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('subjects');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deep link: the runner's results screen sends the learner back to the chapter they came from.
  useEffect(() => {
    if (!initialTargetId) return;
    const sep = initialTargetId.indexOf('::');
    const s = sep === -1 ? initialTargetId : initialTargetId.slice(0, sep);
    const c = sep === -1 ? null : initialTargetId.slice(sep + 2);
    if (!s) return;
    setSubject(s);
    setChapter(c);
    setScreen(c ? 'chapter' : 'chapters');
  }, [initialTargetId]);

  // First open, with no deep link: go back to where the learner last was.
  useEffect(() => {
    if (initialTargetId) return;
    const last = readLastPlace();
    if (!last) return;
    setSubject(last.subject);
    setChapter(last.chapter);
    setScreen(last.chapter ? 'chapter' : 'chapters');
  }, [initialTargetId]);

  const chapters = useMemo(() => (subject ? chaptersForSubject(subject) : []), [subject]);
  const topics = useMemo(
    () => (subject && chapter ? topicsForChapter(subject, chapter) : []),
    [subject, chapter],
  );
  const asked = useMemo(
    () => (subject && chapter ? askedTopics(subject, chapter) : []),
    [subject, chapter],
  );
  const predicted = useMemo(
    () => (subject && chapter ? predictedTopics(subject, chapter) : []),
    [subject, chapter],
  );

  const pickSubject = useCallback((next: string) => {
    setSubject(next);
    setChapter(null);
    setScreen('chapters');
    setError(null);
    rememberPlace(next, null);
  }, []);

  const pickChapter = useCallback(
    (next: string) => {
      setChapter(next);
      setScreen('chapter');
      setError(null);
      rememberPlace(subject, next);
    },
    [subject],
  );

  const backToSubjects = useCallback(() => {
    setScreen('subjects');
    setSubject(null);
    setChapter(null);
    rememberPlace(null, null);
  }, []);

  const backToChapters = useCallback(() => {
    setScreen('chapters');
    setChapter(null);
  }, []);

  /**
   * Writes the questions for this chapter and hands them to the existing runner.
   * The caller passes the exact topic names to test — the asked topics, the predicted ones, or
   * the whole chapter's priority list — so each button practises exactly what it shows.
   */
  const practice = useCallback(
    async (chosen: string[]) => {
      if (!subject || !chapter) return;
      if (!chosen.length) {
        setError('This chapter has no topics to build questions from.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const { questions, failure } = await generateExamQuestions({
          exam,
          count: QUESTION_COUNT,
          subjectSubtopics: [{ subject, subtopics: chosen }],
          requestedTopic: chapter,
          difficultyTier: 'MEDIUM',
        });
        if (!questions.length) {
          setError(failure || 'No questions could be written for this chapter. Check the AI provider in Settings.');
          return;
        }
        onLaunchQuestions(questions, 'TUTOR', exam);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The questions could not be written.');
      } finally {
        setBusy(false);
      }
    },
    [subject, chapter, exam, onLaunchQuestions],
  );

  // ---------------------------------------------------------------- screen 1
  if (screen === 'subjects' || !subject) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <PyqSubjectGrid subjects={subjects} onPick={pickSubject} />
      </div>
    );
  }

  // ---------------------------------------------------------------- screen 2
  if (screen === 'chapters' || !chapter) {
    return (
      <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
        <PyqChapterList subject={subject} chapters={chapters} onPick={pickChapter} onBack={backToSubjects} />
      </div>
    );
  }

  // ---------------------------------------------------------------- screen 3
  return (
    <div className="mx-auto w-full max-w-4xl p-4 pb-24 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={backToChapters}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#0d9488] hover:text-[#0f766e]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {subject} chapters
        </button>
        <p className="text-xs text-slate-500">
          {topics.length} topics in this chapter
        </p>
      </div>

      <h1 className="mb-1 text-lg font-semibold text-[#13294b]">{chapter}</h1>
      <p className="mb-4 text-xs text-slate-500">{subject}</p>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">Something stopped this step.</p>
            <p className="mt-0.5 text-rose-600">{error}</p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <ChapterLessonPanel subject={subject} chapter={chapter} topics={topics} />
        <ChapterForecastPanel
          asked={asked}
          predicted={predicted}
          busy={busy}
          onPractice={(rows) => void practice(rows.map((r) => r.topic))}
        />
      </div>

      {/* Sticky practice bar: the whole chapter, or just the topics the forecast ranks highest. */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mt-4 sm:rounded-xl sm:border sm:px-5">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#13294b]">Test yourself on this chapter</p>
            <p className="text-[11px] text-slate-500">
              {QUESTION_COUNT} MCQs, written from your books by your connected AI provider.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void practice(teachableTopics(subject, chapter, 12))}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f8b8d] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#00696b] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? 'Writing questions…' : 'Practice whole chapter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
