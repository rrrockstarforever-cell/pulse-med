import React from 'react';
import type { SubjectStat } from '../lib/pyqChapter.ts';

interface Props {
  subjects: SubjectStat[];
  onPick: (subject: string) => void;
}

export const PyqSubjectGrid: React.FC<Props> = ({ subjects, onPick }) => {
  return (
    <section className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-[#13294b]">PYQ Topics</h2>
        <p className="mt-1 text-sm text-slate-600">
          Pick a subject. You will be taught the chapter, shown which topics are likely next, then answer MCQs on it.
        </p>
        <p className="mt-1 text-xs font-medium text-slate-500">Predicted, not official</p>
      </header>

      {subjects.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-xs">
          No chapter map is available yet.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {subjects.map((item) => (
            <button
              key={item.subject}
              type="button"
              onClick={() => onPick(item.subject)}
              className="flex h-full flex-col items-start rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:-translate-y-0.5 hover:border-[#0f8b8d] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b8d] focus-visible:ring-offset-2"
            >
              <span className="text-sm font-semibold text-[#13294b]">{item.subject}</span>
              <span className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{item.chapters} chapters</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{item.topics} topics</span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-600">{item.pyqTopics} asked before</span>
              </span>
              <span className="mt-auto w-full pt-4">
                <span className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span>avg predicted %</span>
                  <span className="font-medium text-slate-700">{item.avgPredicted}%</span>
                </span>
                <span className="mt-1.5 block h-1.5 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                  <span
                    className="block h-full rounded-full bg-[#0f8b8d]"
                    style={{ width: `${Math.max(0, Math.min(100, item.avgPredicted))}%` }}
                  />
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
