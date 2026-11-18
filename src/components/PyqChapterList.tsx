import React, { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { ChapterSummary } from '../lib/pyqChapter.ts';

interface Props {
  subject: string;
  chapters: ChapterSummary[];
  onPick: (chapter: string) => void;
  onBack: () => void;
}

const tierClasses: Record<ChapterSummary['maxTier'], string> = {
  'Very high': 'bg-rose-50 text-rose-700 border-rose-200',
  High: 'bg-amber-50 text-amber-700 border-amber-200',
  Medium: 'bg-teal-50 text-teal-700 border-teal-200',
  Low: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const PyqChapterList: React.FC<Props> = ({ subject, chapters, onPick, onBack }) => {
  const [filter, setFilter] = useState('');
  const filteredChapters = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return query ? chapters.filter((chapter) => chapter.chapter.toLowerCase().includes(query)) : chapters;
  }, [chapters, filter]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          All subjects
        </button>
        <h2 className="text-lg font-semibold text-[#13294b]">{subject}</h2>
      </div>

      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder={`Search chapters in ${subject}`}
        aria-label={`Search chapters in ${subject}`}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#0f8b8d] focus:outline-none focus:ring-2 focus:ring-[#0f8b8d]/20"
      />

      {chapters.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          No chapters have been mapped for this subject yet.
        </p>
      ) : filteredChapters.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          No chapter matches that search.
        </p>
      ) : (
        <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          {filteredChapters.map((chapter) => (
            <button
              key={chapter.chapter}
              type="button"
              onClick={() => onPick(chapter.chapter)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#0f8b8d]"
            >
              <span className="min-w-0">
                <span className="block font-medium text-[#13294b]">{chapter.chapter}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  {chapter.topicCount} topics · {chapter.pyqCount} questions asked before · avg predicted {chapter.avgPredicted}%
                </span>
              </span>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${tierClasses[chapter.maxTier]}`}>
                {chapter.maxTier}
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Tiers and percents are estimates built from past papers. Predicted, not official.
      </p>
    </section>
  );
};
