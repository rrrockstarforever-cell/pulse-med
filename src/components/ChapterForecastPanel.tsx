import React, { useState } from 'react';
import { ChevronDown, History, Loader2, Sparkles, TrendingUp } from 'lucide-react';
import type { ForecastRow } from '../lib/pyqChapter.ts';

interface Props {
  /** Topics this chapter has actually been asked about in past papers, most-asked first. */
  asked: ForecastRow[];
  /** Topics not seen in the papers checked, ranked as likely candidates. */
  predicted: ForecastRow[];
  onPractice: (rows: ForecastRow[]) => void;
  busy?: boolean;
  busyLabel?: string;
}

const TIER_CLASSES: Record<ForecastRow['tier'], string> = {
  'Very high': 'bg-rose-50 text-rose-700 border-rose-200',
  High: 'bg-amber-50 text-amber-700 border-amber-200',
  Medium: 'bg-teal-50 text-teal-700 border-teal-200',
  Low: 'bg-slate-100 text-slate-600 border-slate-200',
};

const COLLAPSED_COUNT = 6;

/** One topic line. The number badge is the paper count for asked topics and the rank for predicted ones. */
const TopicRow: React.FC<{ row: ForecastRow; badge: string; note: string; accent: boolean }> = ({
  row,
  badge,
  note,
  accent,
}) => (
  <article
    className={`rounded-lg border p-3 ${
      accent ? 'border-[#0f8b8d]/30 bg-[#0f8b8d]/[0.04] dark:border-teal-800/50 dark:bg-teal-950/20' : 'border-slate-200 bg-white'
    }`}
  >
    <div className="flex items-start gap-3">
      <div
        className={`flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white ${
          accent ? 'bg-[#0f8b8d]' : 'bg-slate-400'
        }`}
      >
        {badge}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[#13294b] dark:text-slate-100">{row.topic}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${TIER_CLASSES[row.tier]}`}>
            {row.tier}
          </span>
          {row.format !== null && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {row.format}
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {note}
          {row.importancePercent !== null && (
            <>
              {` · ${row.importancePercent}% in research`}
              {row.verified && (
                <span className="ml-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                  verified
                </span>
              )}
            </>
          )}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{row.reason}</p>
      </div>
    </div>
  </article>
);

function Section({
  title,
  subtitle,
  icon,
  accent,
  rows,
  emptyText,
  badgeOf,
  noteOf,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: boolean;
  rows: ForecastRow[];
  emptyText: string;
  badgeOf: (row: ForecastRow) => string;
  noteOf: (row: ForecastRow) => string;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, COLLAPSED_COUNT);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-[#13294b] dark:text-slate-100">{title}</h4>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <span className="shrink-0 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">{emptyText}</p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {shown.map((row) => (
              <TopicRow key={row.topic} row={row} badge={badgeOf(row)} note={noteOf(row)} accent={accent} />
            ))}
          </div>
          {rows.length > COLLAPSED_COUNT && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#0f8b8d] hover:underline dark:text-teal-300"
            >
              {open ? 'Show fewer' : `Show all ${rows.length}`}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

export const ChapterForecastPanel: React.FC<Props> = ({
  asked,
  predicted,
  onPractice,
  busy = false,
  busyLabel = 'Preparing questions...',
}) => {
  const total = asked.length + predicted.length;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp aria-hidden="true" className="h-5 w-5 shrink-0 text-[#0f8b8d]" />
          <h3 className="text-base font-semibold text-[#13294b] dark:text-slate-100">What this chapter gets asked</h3>
        </div>
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
          Predictions are estimated
        </span>
      </div>

      {total === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">This chapter has no topics to rank.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {asked.length} topic{asked.length === 1 ? '' : 's'} have appeared in past papers. The rest are predicted
            from the topic survey and the curriculum maps.
          </p>

          <div className="mt-4 space-y-3">
            {/* 1. Already asked — the record. Shown first, because these are facts, not guesses. */}
            <Section
              title="Already asked in past papers"
              subtitle="Highest paper count first. These are recorded, not predicted."
              icon={<History aria-hidden="true" className="h-4 w-4 text-[#0f8b8d]" />}
              accent
              rows={asked}
              emptyText="None of this chapter's topics appear in the papers checked."
              badgeOf={(row) => `${row.pyq}×`}
              noteOf={(row) =>
                `Asked in ${row.pyq} ${row.pyq === 1 ? 'paper' : 'papers'} · predicted ${row.predicted}%`
              }
            />

            {/* 2. Not asked yet — the forecast. Kept in its own section so the two never blur together. */}
            <Section
              title="Predicted questions for the next papers"
              subtitle="Not in the papers checked, but ranked by tier, predicted percent and research maps."
              icon={<Sparkles aria-hidden="true" className="h-4 w-4 text-amber-500" />}
              accent={false}
              rows={predicted}
              emptyText="Every topic in this chapter has already been asked at least once."
              badgeOf={(row) => String(row.rank)}
              noteOf={(row) => `Not in papers checked · predicted ${row.predicted}%`}
            />
          </div>
        </>
      )}

      <div className="mt-4 flex flex-wrap justify-stretch gap-2 md:justify-end">
        <button
          type="button"
          onClick={() => onPractice(asked)}
          disabled={busy || asked.length === 0}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#0f8b8d] px-4 py-2.5 text-sm font-semibold text-[#0f8b8d] transition-colors hover:bg-[#0f8b8d]/10 disabled:cursor-not-allowed disabled:opacity-50 md:flex-none dark:border-teal-500 dark:text-teal-300"
        >
          Practice asked topics
        </button>
        <button
          type="button"
          onClick={() => onPractice(predicted)}
          disabled={busy || predicted.length === 0}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#0f8b8d] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#00696b] disabled:cursor-not-allowed disabled:opacity-60 md:flex-none"
        >
          {busy && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
          {busy ? busyLabel : 'Practice predicted topics'}
        </button>
      </div>
      <p className="mt-3 text-[11px] text-slate-400">
        Paper counts and predicted percents come from the stored PYQ database. A priority list, not a promise.
      </p>
    </section>
  );
};
