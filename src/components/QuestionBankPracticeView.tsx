// Question Bank: the saved question sets.
// The imported eMedici / recall-paste bank and the empty "Generated question banks by category" panel were removed
// from this page at the user's request (2026-11-14).
import React from 'react';
import { ExamType, AppView, ClinicalQuestion } from '../types.ts';
import { SavedModulesPanel } from './SavedModulesPanel.tsx';

interface QuestionBankPracticeViewProps {
  onNavigate: (view: AppView) => void;
  onLaunchTest: (questions: ClinicalQuestion[], mode: 'EXAM' | 'TUTOR', exam: ExamType) => void;
  onOpenPlan?: (id: string, title: string) => void;
  /** Kept for the analytics link; the saved sets below are not filtered by it. */
  initialSubjects?: string[];
}

export const QuestionBankPracticeView: React.FC<QuestionBankPracticeViewProps> = ({ onLaunchTest, onOpenPlan }) => (
  <div className="space-y-6 max-w-7xl mx-auto pb-12 max-md:pb-0">
    <SavedModulesPanel onLaunchTest={onLaunchTest} onOpenPlan={onOpenPlan} />
  </div>
);
