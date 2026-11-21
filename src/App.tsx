import React, { useState, useEffect, useRef } from 'react';
import { AppView, ExamType, DifficultyTier, DifficultySubLevel, ClinicalQuestion } from './types.ts';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { PerformanceAnalyticsView } from './components/PerformanceAnalyticsView.tsx';
import { MistakeNotebookView } from './components/MistakeNotebookView.tsx';
import { HighlightsSavedView } from './components/HighlightsSavedView.tsx';
import { SettingsAIView } from './components/SettingsAIView.tsx';
import { QAReviewDashboard } from './components/QAReviewDashboard.tsx';
import { ClinicalBrowserView } from './components/ClinicalBrowserView.tsx';
import { PracticeModuleBuilderView } from './components/PracticeModuleBuilderView.tsx';
import { PyqTopicsView } from './components/PyqTopicsView.tsx';
import { QuestionBankPracticeView } from './components/QuestionBankPracticeView.tsx';
import { TestRunnerView } from './components/TestRunnerView.tsx';
import { AITutorView } from './components/AITutorView.tsx';
import { PDFReaderView } from './components/PDFReaderView.tsx';
import { JobsBanner } from './components/JobsBanner.tsx';
import { StudyPlanView } from './components/StudyPlanView.tsx';
import { StudyPlanPage } from './components/StudyPlanPage.tsx';
import { SyllabusTrackerView } from './components/SyllabusTrackerView.tsx';
import { RemindersView } from './components/RemindersView.tsx';
import { SyncView } from './components/SyncView.tsx';
import { TestReviewsView } from './components/TestReviewsView.tsx';
import { TodayView } from './components/TodayView.tsx';
import { FirstRunGuide } from './components/FirstRunGuide.tsx';
import { playPageSwitch } from './lib/sounds.ts';
import { useIsMobile } from './lib/useIsMobile.ts';
import { runBackLayer } from './lib/backLayers.ts';
import { dueCount } from './utils/flashcardStore.ts';
import { listCapturedQuestions } from './utils/mistakeStore.ts';
import { subscribeDataChanged } from './utils/dataEvents.ts';
import { loadActiveTest, saveActiveTest, signature } from './utils/sessionStore.ts';
import { saveModule, storedQuestions, withoutStoredDuplicates } from './utils/moduleStore.ts';
import { cleanQuestions } from './lib/questionCleanup.ts';
import { PanelLeftClose, PanelLeftOpen, Maximize2, Minimize2, Sun, Moon, Home, FileQuestion, Timer, CalendarCheck, Menu } from 'lucide-react';

// Remembered on this computer: hide the left sidebar, or hide every bar and keep only the screen itself.
const readFlag = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* storage may be blocked */ } };

export default function App() {
  const [currentView, setCurrentView] = useState<AppView>('today');
  const [bankPlan, setBankPlan] = useState<{ id: string; title: string } | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState(() => readFlag('pulse.sidebarHidden'));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => readFlag('pulse.sidebarCollapsed'));
  const [focusMode, setFocusMode] = useState(() => readFlag('pulse.focusMode'));
  const [testImmersive, setTestImmersive] = useState(false);
  const isMobile = useIsMobile();
  const immersiveTest = isMobile && testImmersive && currentView === 'test-runner';
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Phone Back button: step back through the screens (and close an open menu or dialog first) instead of closing the app.
  const viewRef = useRef<AppView>(currentView);
  const navOpenRef = useRef(false);
  const viewStackRef = useRef<AppView[]>([]);
  const lastViewRef = useRef<AppView>(currentView);
  const fromBackRef = useRef(false);
  viewRef.current = currentView;
  navOpenRef.current = mobileNavOpen;
  useEffect(() => {
    if (fromBackRef.current) { fromBackRef.current = false; lastViewRef.current = currentView; return; }
    if (lastViewRef.current !== currentView) {
      const stack = viewStackRef.current;
      // Do not stack the same screen twice in a row.
      if (stack[stack.length - 1] !== lastViewRef.current) {
        viewStackRef.current = [...stack.slice(-30), lastViewRef.current];
      }
      lastViewRef.current = currentView;
    }
  }, [currentView]);
  const lastExitPressRef = useRef(0);
  const exitToastTimerRef = useRef<number | undefined>(undefined);
  const [exitToast, setExitToast] = useState(false);
  useEffect(() => {
    // The Android shell calls this on Back. 'handled' = the app dealt with it, 'exit' = nothing left to go back to.
    (window as unknown as { __pmBack?: () => string }).__pmBack = () => {
      if (navOpenRef.current) { setMobileNavOpen(false); return 'handled'; }
      if (runBackLayer()) return 'handled';
      const closeBtn = document.querySelector<HTMLElement>('[role="dialog"] [aria-label="Close"], button[title="Close reasoning matrix"]');
      if (closeBtn) { closeBtn.click(); return 'handled'; }
      const prev = viewStackRef.current[viewStackRef.current.length - 1];
      if (prev) {
        viewStackRef.current = viewStackRef.current.slice(0, -1);
        fromBackRef.current = true;
        setCurrentView(prev);
        return 'handled';
      }
      if (viewRef.current !== 'today') { setCurrentView('today'); return 'handled'; }
      // Double Back to leave: the first press only shows a hint.
      const now = Date.now();
      if (now - lastExitPressRef.current < 2000) return 'exit';
      lastExitPressRef.current = now;
      setExitToast(true);
      window.clearTimeout(exitToastTimerRef.current);
      exitToastTimerRef.current = window.setTimeout(() => setExitToast(false), 2000);
      return 'handled';
    };
    return () => {
      delete (window as unknown as { __pmBack?: () => string }).__pmBack;
      window.clearTimeout(exitToastTimerRef.current);
    };
  }, []);
  const drawerOpen = isMobile && mobileNavOpen && !focusMode;
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const drawerGestureRef = useRef<{
    mode: 'open' | 'close';
    startX: number;
    startY: number;
    startOffset: number;
    panelWidth: number;
    moved: boolean;
  } | null>(null);
  const suppressDrawerClickRef = useRef(false);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const [drawerDragX, setDrawerDragX] = useState(0);
  const drawerDragXRef = useRef(0);
  useEffect(() => { drawerDragXRef.current = drawerDragX; }, [drawerDragX]);
  useEffect(() => writeFlag('pulse.sidebarHidden', sidebarHidden), [sidebarHidden]);
  useEffect(() => writeFlag('pulse.sidebarCollapsed', sidebarCollapsed), [sidebarCollapsed]);
  useEffect(() => writeFlag('pulse.focusMode', focusMode), [focusMode]);
  useEffect(() => { if (!isMobile || focusMode) setMobileNavOpen(false); }, [isMobile, focusMode]);
  useEffect(() => { setMobileNavOpen(false); }, [currentView]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);
  // Lock the page and the inner scroller while the phone drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [drawerOpen]);
  // Swipe right from the first 24px of the screen to pull the closed drawer in.
  useEffect(() => {
    if (!isMobile || focusMode || mobileNavOpen) return;
    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch || touch.clientX > 24) return;
      const width = drawerPanelRef.current?.offsetWidth ?? 280;
      drawerGestureRef.current = {
        mode: 'open',
        startX: touch.clientX,
        startY: touch.clientY,
        startOffset: -width,
        panelWidth: width,
        moved: false,
      };
      drawerDragXRef.current = -width;
      setDrawerDragX(-width);
      setDrawerDragging(true);
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    return () => window.removeEventListener('touchstart', onTouchStart);
  }, [isMobile, focusMode, mobileNavOpen]);
  // One set of move/end listeners follows the finger for open and close swipes.
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      const gesture = drawerGestureRef.current;
      if (!gesture) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      if (!gesture.moved && Math.abs(dy) > Math.abs(dx) + 4) return;
      if (!gesture.moved && Math.abs(dx) < 4) return;
      gesture.moved = true;
      if (e.cancelable) e.preventDefault();
      const next = gesture.mode === 'open'
        ? Math.min(0, gesture.startOffset + dx)
        : Math.min(0, Math.max(-gesture.panelWidth, dx));
      drawerDragXRef.current = next;
      setDrawerDragX(next);
    };
    const finishGesture = () => {
      const gesture = drawerGestureRef.current;
      if (!gesture) return;
      drawerGestureRef.current = null;
      setDrawerDragging(false);
      if (!gesture.moved) {
        if (gesture.mode === 'open') setMobileNavOpen(false);
        return;
      }
      suppressDrawerClickRef.current = true;
      window.setTimeout(() => { suppressDrawerClickRef.current = false; }, 350);
      if (gesture.mode === 'open') {
        setMobileNavOpen(drawerDragXRef.current > -gesture.panelWidth * 0.55);
      } else {
        setMobileNavOpen(drawerDragXRef.current > -gesture.panelWidth * 0.35);
      }
    };
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', finishGesture, { passive: true });
    window.addEventListener('touchcancel', finishGesture, { passive: true });
    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', finishGesture);
      window.removeEventListener('touchcancel', finishGesture);
    };
  }, []);
  // Ctrl+B hides or shows the sidebar; Ctrl+Shift+F turns focus mode on or off.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'b' && !e.shiftKey) { e.preventDefault(); setSidebarHidden((v) => !v); }
      else if (k === 'f' && e.shiftKey) { e.preventDefault(); setFocusMode((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The launched test is restored from storage so a restart never loses generated questions.
  const [restoredTest] = useState(() => loadActiveTest());
  const [currentExam, setCurrentExam] = useState<ExamType>((restoredTest?.exam as ExamType) ?? 'INI_CET');
  const [activeQuestionId, setActiveQuestionId] = useState<string>(restoredTest?.activeQuestionId ?? '');
  // Subject sent from the analytics remediation link; pre-selects the Question Bank filter once.
  const [remediationSubjects, setRemediationSubjects] = useState<string[]>([]);
  const [activeTestQuestions, setActiveTestQuestions] = useState<ClinicalQuestion[] | undefined>(restoredTest?.questions);
  const [activeTestMode, setActiveTestMode] = useState<'EXAM' | 'TUTOR'>(restoredTest?.mode ?? 'TUTOR');

  useEffect(() => {
    saveActiveTest(
      activeTestQuestions && activeTestQuestions.length
        ? { questions: activeTestQuestions, mode: activeTestMode, exam: currentExam, activeQuestionId }
        : null,
    );
  }, [activeTestQuestions, activeTestMode, currentExam, activeQuestionId]);

  // Screens that hold long-running or unsaved work stay mounted (hidden) once opened, so
  // switching away never destroys an in-flight generation, filters, or a test in progress.
  // The study plan, tutor, PDF reader and research screens also stop their running work when removed
  // (their effects set a stop flag on unmount), so they stay mounted too.
  const KEEP_ALIVE: AppView[] = ['practice', 'pyq-topics', 'test-runner', 'question-bank', 'bank-plan', 'study-plan', 'ai-tutor', 'pdf-reader', 'research'];
  // The PYQ Topics screen remembers which chapter it is showing; navigating back to it
  // (e.g. after a test) restores that chapter instead of dropping to the subject grid.
  const [pyqTarget, setPyqTarget] = useState<string | undefined>(undefined);
  const [mountedViews, setMountedViews] = useState<AppView[]>([]);

  // Generation can finish while the learner is on another screen. Read the live view from a
  // ref (the launch callback is captured when they pressed Launch) and, if they have moved
  // on, leave them where they are and offer the finished module instead of yanking them away.
  const currentViewRef = useRef<AppView>(currentView);
  useEffect(() => { currentViewRef.current = currentView; }, [currentView]);
  // The first-run guide shows once, on the first launch; closing it (or finishing it) records that it was seen.
  const [showGuide, setShowGuide] = useState<boolean>(() => {
    try { return localStorage.getItem('pulse-first-run-guide-seen') !== '1'; } catch { return false; }
  });
  const closeGuide = () => {
    try { localStorage.setItem('pulse-first-run-guide-seen', '1'); } catch { /* the guide may then show again */ }
    setShowGuide(false);
  };
  const [readyNotice, setReadyNotice] = useState<{ count: number } | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('pulse-dark-mode');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    localStorage.setItem('pulse-dark-mode', String(isDarkMode));
  }, [isDarkMode]);
  // Bumped whenever a store writes, so the sidebar badges stay truthful.
  const [, setDataVersion] = useState(0);
  useEffect(() => subscribeDataChanged(() => setDataVersion((v) => v + 1)), []);

  // Real sidebar badges: captured-but-unresolved mistakes and cards due now.
  const unresolvedMistakes = listCapturedQuestions().filter((q) => q.status === 'unresolved').length;
  const srsDue = dueCount();

  useEffect(() => {
    if (KEEP_ALIVE.includes(currentView)) {
      setMountedViews((m) => (m.includes(currentView) ? m : [...m, currentView]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  const handleNavigate = (view: AppView, targetId?: string) => {
    setMobileNavOpen(false);
    if (view !== 'test-runner') setTestImmersive(false);
    if (view === 'test-runner') setReadyNotice(null);
    if (view !== currentView) playPageSwitch();
    setCurrentView(view);
    // The PYQ Topics section uses the target id as "<subject>::<chapter>", not a question id.
    if (view === 'pyq-topics' && targetId) {
      setPyqTarget(targetId);
    } else if (targetId) {
      setActiveQuestionId(targetId);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearchSubmit = (query: string) => {
    const q = query.trim();
    if (!q) return;
    try { sessionStorage.setItem('pulse.research.query', q); } catch { /* storage unavailable */ }
    setMobileNavOpen(false);
    setCurrentView('research');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLaunchModule = async (
    exam: ExamType, 
    count: number, 
    mode: 'EXAM' | 'TUTOR', 
    subjects: string[],
    difficultyTier: DifficultyTier,
    difficultySubLevel?: DifficultySubLevel,
    chosenSubtopics?: string[],
    generatedQuestions?: ClinicalQuestion[]
  ) => {
    setCurrentExam(exam);
    setActiveTestMode(mode);
    // Only real, validated AI-generated questions may launch a module. There is no
    // sample-question fallback: an empty batch is reported by the builder itself.
    const questions = generatedQuestions ?? [];
    if (questions.length === 0) {
      setCurrentView('practice');
      return;
    }
    // Drop any question that repeats one already stored (saved banks or the QA review list), so the
    // same question never appears twice with different answers.
    const stored = await storedQuestions().catch(() => []);
    const { kept, dropped } = withoutStoredDuplicates(cleanQuestions(questions), stored);
    if (dropped > 0) console.info(`[modules] ${dropped} question(s) repeated a stored question and were left out.`);
    if (kept.length === 0) {
      setCurrentView('practice');
      return;
    }
    const tagged = kept.map(q => ({
      ...q,
      sourceType: 'ai-generator' as const,
    }));
    setActiveTestQuestions(tagged);
    // Keep every generated bank, not only the latest, so it can be reopened and finished later.
    void saveModule({ id: signature(tagged), exam, mode, questions: tagged });
    if (tagged.length > 0) {
      setActiveQuestionId(tagged[0].id);
    }
    if (currentViewRef.current === 'practice') {
      setReadyNotice(null);
      setCurrentView('test-runner');
    } else {
      setReadyNotice({ count: tagged.length });
    }
  };

  // MCQs made from a book chapter's pages in the PDF reader: saved as a bank (named after the chapter) and opened
  // in the test runner. They are not filtered against stored questions: the learner asked for this chapter's set.
  const handleLaunchChapterQuestions = (questions: ClinicalQuestion[], meta: { title: string; bookTitle: string }) => {
    if (questions.length === 0) return;
    const tagged = cleanQuestions(questions).map((q) => ({ ...q, examType: currentExam, sourceType: 'ai-generator' as const }));
    setActiveTestMode('TUTOR');
    setActiveTestQuestions(tagged);
    void saveModule({ id: signature(tagged), exam: currentExam, mode: 'TUTOR', questions: tagged });
    setActiveQuestionId(tagged[0].id);
    setReadyNotice(null);
    console.info(`[chapter-mcq] ${tagged.length} questions from "${meta.title}" (${meta.bookTitle})`);
    setCurrentView('test-runner');
  };

  const handleLaunchBankQuestions = (
    questions: ClinicalQuestion[], 
    mode: 'EXAM' | 'TUTOR', 
    exam: ExamType
  ) => {
    setCurrentExam(exam);
    setActiveTestMode(mode);
    setActiveTestQuestions(questions);
    // No forced first question: the runner reopens a saved bank at the position it was left at.
    setActiveQuestionId('');
    setCurrentView('test-runner');
  };

  const renderView = (view: AppView) => {
    switch (view) {
      case 'analytics':
        return (
          <PerformanceAnalyticsView 
            onNavigate={handleNavigate}
            // Sample change: remediation no longer jumps to fixed sample questions; the student picks a real
            // question for the weak subject in the Question Bank.
            onLaunchRemediation={(subject: string) => {
              setRemediationSubjects([subject]);
              handleNavigate('question-bank');
            }}
          />
        );
      case 'pyq-topics':
        return (
          <PyqTopicsView
            onNavigate={handleNavigate}
            onLaunchQuestions={handleLaunchBankQuestions}
            exam={currentExam}
            initialTargetId={pyqTarget}
          />
        );
      case 'practice':
        return (
          <PracticeModuleBuilderView 
            currentExam={currentExam}
            onLaunchModule={handleLaunchModule}
            onNavigate={handleNavigate}
            onExamChange={setCurrentExam}
          />
        );
      case 'question-bank':
        return (
          <QuestionBankPracticeView
            initialSubjects={remediationSubjects}
            onNavigate={handleNavigate}
            onLaunchTest={handleLaunchBankQuestions}
            onOpenPlan={(id, title) => { setBankPlan({ id, title }); handleNavigate('bank-plan'); }}
          />
        );
      case 'test-runner':
        return (
          <TestRunnerView 
            initialQuestionId={activeQuestionId}
            onNavigate={handleNavigate}
            questions={activeTestQuestions}
            mode={activeTestMode}
            darkMode={isDarkMode}
            active={currentView === 'test-runner'}
            onImmersiveChange={setTestImmersive}
            onRetryQuestions={(again) => {
              if (!again.length) return;
              setActiveTestMode('TUTOR');
              setActiveTestQuestions(again);
              setActiveQuestionId('');
              setCurrentView('test-runner');
            }}
          />
        );
      case 'mistakes':
        return (
          <MistakeNotebookView 
            onNavigate={handleNavigate}
            onStartSprint={(questions) => {
              if (!questions.length) return;
              setActiveTestMode('TUTOR');
              setActiveTestQuestions(questions);
              setActiveQuestionId(questions[0].id);
              setCurrentView('test-runner');
            }}
            currentExam={currentExam}
          />
        );
      case 'highlights':
        return (
          <HighlightsSavedView 
            onNavigate={handleNavigate}
          />
        );
      case 'ai-tutor':
        return (
          <AITutorView 
            initialQuestionId={activeQuestionId}
            attachedQuestion={
              (activeQuestionId
                ? activeTestQuestions?.find((q) => q.id === activeQuestionId)
                : null) ?? null
            }
            onNavigate={handleNavigate}
            currentExam={currentExam}
          />
        );
      case 'pdf-reader':
        return (
          <PDFReaderView onNavigate={handleNavigate} onLaunchChapterQuestions={handleLaunchChapterQuestions} />
        );
      case 'research':
        return (
          <ClinicalBrowserView 
            onNavigate={handleNavigate}
          />
        );
      case 'today':
        return <TodayView exam={currentExam} onNavigate={handleNavigate} />;
      case 'reviews':
        return <TestReviewsView onNavigate={handleNavigate} darkMode={isDarkMode} />;
      case 'study-plan':
        return <StudyPlanView exam={currentExam} onNavigate={handleNavigate} />;
      case 'bank-plan':
        return bankPlan ? <StudyPlanPage bankId={bankPlan.id} title={bankPlan.title} onNavigate={handleNavigate} /> : (
          <div className="mx-auto max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-center">
            <p className="text-sm font-medium text-slate-700">Open a question bank and press Study plan.</p>
            <button
              type="button"
              onClick={() => handleNavigate('question-bank')}
              className="inline-flex items-center justify-center rounded-xl bg-[#0f8b8d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#00696b]"
            >
              Go to Question Bank
            </button>
          </div>
        );
      case 'syllabus':
        return <SyllabusTrackerView exam={currentExam} onNavigate={handleNavigate} />;
      case 'reminders':
        return <RemindersView exam={currentExam} />;
      case 'sync':
        return <SyncView />;
      case 'settings':
        return (
          <SettingsAIView />
        );
      case 'qa':
        return (
          <QAReviewDashboard />
        );
      default:
        return (
          <PerformanceAnalyticsView 
            onNavigate={handleNavigate} 
            onLaunchRemediation={(subject: string) => handleNavigate('test-runner')}
          />
        );
    }
  };

  const startCloseDrawerGesture = (e: React.TouchEvent) => {
    if (!drawerOpen) return;
    const touch = e.touches[0];
    if (!touch) return;
    const width = drawerPanelRef.current?.offsetWidth ?? 280;
    drawerGestureRef.current = {
      mode: 'close',
      startX: touch.clientX,
      startY: touch.clientY,
      startOffset: 0,
      panelWidth: width,
      moved: false,
    };
    drawerDragXRef.current = 0;
    setDrawerDragX(0);
    setDrawerDragging(true);
  };

  const closeDrawerFromBackdrop = () => {
    if (suppressDrawerClickRef.current) {
      suppressDrawerClickRef.current = false;
      return;
    }
    setMobileNavOpen(false);
  };

  const drawerPanelWidthForOpacity = drawerPanelRef.current?.offsetWidth ?? 280;
  const drawerBackdropOpacity = drawerDragging
    ? Math.max(0, Math.min(1, 1 + drawerDragX / drawerPanelWidthForOpacity))
    : undefined;

  const bottomNavItems = [
    { id: 'today' as AppView, label: 'Today', Icon: Home },
    { id: 'practice' as AppView, label: 'Practice', Icon: FileQuestion },
    { id: 'test-runner' as AppView, label: 'Test', Icon: Timer },
    { id: 'study-plan' as AppView, label: 'Plan', Icon: CalendarCheck },
  ];
  const bottomNavActive = mobileNavOpen
    ? 'more'
    : bottomNavItems.some((item) => item.id === currentView)
      ? currentView
      : 'more';

  return (
    <div className={`app-shell min-h-screen text-slate-800 flex font-sans antialiased ${drawerOpen ? 'drawer-open ' : ''}${
      isDarkMode ? 'dark' : ''
    }${isMobile && !focusMode && !immersiveTest ? ' has-bottom-nav' : ''}`}>
      {/* Persistent Clinical Navy Sidebar (desktop only; phones use the drawer below) */}
      {!isMobile && !sidebarHidden && !focusMode && <Sidebar
        currentView={currentView}
        onNavigate={handleNavigate}
        selectedExam={currentExam}
        onSelectExam={setCurrentExam}
        darkMode={isDarkMode}
        onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
        unresolvedMistakesCount={unresolvedMistakes}
        srsDueCount={srsDue}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
      />}

      {/* Phone navigation drawer: always mounted so it can slide in and follow a swipe */}
      {isMobile && (
        <div
          className={`mobile-drawer fixed inset-0 z-50 md:hidden ${drawerOpen || drawerDragging ? 'pointer-events-auto' : 'pointer-events-none'}`}
          role={drawerOpen || drawerDragging ? 'dialog' : undefined}
          aria-modal={drawerOpen || drawerDragging ? true : undefined}
          aria-label="Navigation menu"
          aria-hidden={!drawerOpen && !drawerDragging}
          inert={!drawerOpen && !drawerDragging ? true : undefined}
        >
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={closeDrawerFromBackdrop}
            onTouchStart={startCloseDrawerGesture}
            className={`mobile-drawer-backdrop absolute inset-0 bg-slate-900/60 transition-opacity duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)] ${drawerOpen ? 'opacity-100' : 'opacity-0'}`}
            style={drawerDragging ? { opacity: drawerBackdropOpacity } : undefined}
          />
          <div
            ref={drawerPanelRef}
            className={`mobile-drawer-panel absolute inset-y-0 left-0 shadow-2xl will-change-transform ${drawerDragging ? 'transition-none' : 'transition-transform duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)]'} ${drawerOpen ? 'translate-x-0' : '-translate-x-full'}`}
            style={{ transform: drawerDragging ? `translateX(${drawerDragX}px)` : undefined, willChange: 'transform' }}
            onTouchStart={startCloseDrawerGesture}
            onClickCapture={(e) => {
              if (suppressDrawerClickRef.current) {
                e.preventDefault();
                e.stopPropagation();
                suppressDrawerClickRef.current = false;
              }
            }}
          >
            <Sidebar
              currentView={currentView}
              onNavigate={handleNavigate}
              selectedExam={currentExam}
              onSelectExam={setCurrentExam}
              darkMode={isDarkMode}
              onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
              unresolvedMistakesCount={unresolvedMistakes}
              srsDueCount={srsDue}
            />
          </div>
        </div>
      )}

      {isMobile && exitToast && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center px-4"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}
        >
          <span className="rounded-full bg-slate-900/90 px-4 py-2 text-sm font-medium text-white shadow-lg">Press back again to exit</span>
        </div>
      )}

      {showGuide && <FirstRunGuide exam={currentExam} onNavigate={(v) => { closeGuide(); handleNavigate(v); }} onClose={closeGuide} />}

      {/* Main Content Area */}
      <div className={`app-scroll flex-1 flex flex-col min-w-0 h-screen ${immersiveTest ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden'}`}>
        {/* Sticky Top Clinical Header Bar */}
        {!focusMode && !immersiveTest && (
          <TopBar
            currentView={currentView}
            selectedExam={currentExam}
            onSearchSubmit={handleSearchSubmit}
            onNavigate={handleNavigate}
            onOpenMobileNav={() => setMobileNavOpen(true)}
          />
        )}

        {/* Dynamic Canvas Container */}
        <main className={`app-main flex-1 min-w-0 w-full mx-auto ${immersiveTest ? 'overflow-hidden p-0 max-w-none' : 'p-3 pb-20 sm:p-6 lg:p-8 max-w-[1600px]'}`}>
          {readyNotice && currentView !== 'test-runner' && (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3"
            >
              <span className="text-sm font-semibold text-slate-800">
                Your {readyNotice.count}-question module finished generating and is ready.
              </span>
              <span className="flex items-center gap-2">
                <button
                  onClick={() => handleNavigate('test-runner')}
                  className="rounded-lg bg-[#0f8b8d] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#0b6b6d]"
                >
                  Open test
                </button>
                <button
                  onClick={() => setReadyNotice(null)}
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  Dismiss
                </button>
              </span>
            </div>
          )}
          {KEEP_ALIVE.filter((v) => mountedViews.includes(v) || v === currentView).map((v) => (
            <div key={v} className={v === currentView ? 'page-enter' : 'hidden'}>
              {renderView(v)}
            </div>
          ))}
          {!KEEP_ALIVE.includes(currentView) && <div key={currentView} className="page-enter">{renderView(currentView)}</div>}
        </main>
      </div>

      {isMobile && !focusMode && !immersiveTest && (
        <nav
          className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-white px-1 dark:border-slate-800 dark:bg-[#0f1729] md:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          aria-label="Phone navigation"
        >
          <div className="mx-auto flex h-16 w-full max-w-lg items-stretch justify-around gap-0.5">
            {bottomNavItems.map(({ id, label, Icon }) => {
              const active = bottomNavActive === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleNavigate(id)}
                  aria-current={active ? 'page' : undefined}
                  className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 p-0 active:opacity-80"
                >
                  <span
                    className={`grid h-8 w-14 place-items-center rounded-full transition-colors duration-200 ${
                      active
                        ? 'bg-[#0f8b8d]/12 text-[#0f8b8d] dark:bg-teal-400/15 dark:text-teal-300'
                        : 'bg-transparent text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.9} />
                  </span>
                  <span
                    className={`text-[11px] leading-none ${
                      active
                        ? 'font-semibold text-[#0f8b8d] dark:text-teal-300'
                        : 'font-medium text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="More navigation"
              aria-current={bottomNavActive === 'more' ? 'page' : undefined}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 p-0 active:opacity-80"
            >
              <span
                className={`grid h-8 w-14 place-items-center rounded-full transition-colors duration-200 ${
                  bottomNavActive === 'more'
                    ? 'bg-[#0f8b8d]/12 text-[#0f8b8d] dark:bg-teal-400/15 dark:text-teal-300'
                    : 'bg-transparent text-slate-500 dark:text-slate-400'
                }`}
              >
                <Menu className="h-[22px] w-[22px]" strokeWidth={bottomNavActive === 'more' ? 2.2 : 1.9} />
              </span>
              <span
                className={`text-[11px] leading-none ${
                  bottomNavActive === 'more'
                    ? 'font-semibold text-[#0f8b8d] dark:text-teal-300'
                    : 'font-medium text-slate-500 dark:text-slate-400'
                }`}
              >
                More
              </span>
            </button>
          </div>
        </nav>
      )}

      {/* Small floating controls: hide/show the sidebar, focus mode (only the question screen), light/dark */}
      <div
        className={`fixed right-2 z-40 ${isMobile && !focusMode ? 'hidden' : 'flex'} items-center gap-0.5 rounded-full border border-slate-300 bg-white/90 p-0.5 shadow-md backdrop-blur dark:border-slate-600 dark:bg-slate-800/90 sm:right-3 sm:gap-1 sm:p-1`}
        style={{ bottom: isMobile && !focusMode ? 'calc(76px + env(safe-area-inset-bottom))' : 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        {!focusMode && (
          <button
            onClick={() => setSidebarHidden((v) => !v)}
            title={sidebarHidden ? 'Show sidebar (Ctrl+B)' : 'Hide sidebar (Ctrl+B)'}
            aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            className="hidden items-center justify-center rounded-full p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 md:inline-flex"
          >
            {sidebarHidden ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
        <button
          onClick={() => setFocusMode((v) => !v)}
          title={focusMode ? 'Leave focus mode (Ctrl+Shift+F)' : 'Focus mode: hide the sidebar and top bar (Ctrl+Shift+F)'}
          aria-label={focusMode ? 'Leave focus mode' : 'Focus mode'}
          className="rounded-full p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 sm:p-2"
        >
          {focusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
        <button
          onClick={() => setIsDarkMode((v) => !v)}
          title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          className="rounded-full p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700 sm:p-2"
        >
          {isDarkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      {/* Background task registry banner (OCR, page notes, indexing) */}
      <JobsBanner />
    </div>
  );
}
