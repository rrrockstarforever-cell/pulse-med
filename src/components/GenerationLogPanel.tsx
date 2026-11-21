import { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Copy, Download, RefreshCw, Share2, Trash2 } from 'lucide-react';
import { clearRunLogs, deleteRunLog, getRunLog, listRunLogs, runLogText } from '../utils/generationLogStore';
import type { RunLogSummary } from '../utils/generationLogStore';

const val = (run: RunLogSummary, keys: string[]): unknown => {
  const r = run as unknown as Record<string, unknown>;
  return keys.map((k) => r[k]).find((v) => v !== undefined && v !== null);
};
const num = (v: unknown, f = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : String(x))) : [];
const idOf = (run: RunLogSummary) => String(val(run, ['id', 'runId', 'key']) ?? '');
const dateOf = (v: unknown) => {
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  return 'Unknown time';
};
const secondsOf = (run: RunLogSummary) => {
  const s = num(val(run, ['durationSeconds', 'seconds', 'timeSeconds']), NaN);
  return Number.isFinite(s) ? s : num(val(run, ['durationMs', 'timeMs', 'elapsedMs'])) / 1000;
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function downloadJson(report: unknown) {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pulse-gen-log-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error(e);
  }
}

export default function GenerationLogPanel() {
  const [runs, setRuns] = useState<RunLogSummary[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const refresh = useCallback(() => { void listRunLogs().then(setRuns); }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('pulse-gen-log-changed', onChange);
    return () => window.removeEventListener('pulse-gen-log-changed', onChange);
  }, [refresh]);

  const flash = (key: string) => {
    setCopied(key);
    window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
  };
  const handleCopy = async (run: RunLogSummary, full: boolean) => {
    const report = await getRunLog(idOf(run));
    if (!report) return;
    if (await copyText(full ? JSON.stringify(report) : runLogText(report))) flash(`${idOf(run)}-${full ? 'full' : 'summary'}`);
  };
  const handleShare = async (run: RunLogSummary) => {
    const report = await getRunLog(idOf(run));
    if (!report || typeof navigator.share !== 'function') return;
    try {
      await navigator.share({ title: 'Pulse Med generation log', text: runLogText(report) });
    } catch {}
  };
  const handleDownload = async (run: RunLogSummary) => {
    const report = await getRunLog(idOf(run));
    if (report) downloadJson(report);
  };
  const handleDelete = async (run: RunLogSummary) => {
    await deleteRunLog(idOf(run));
    refresh();
    refresh();
  };
  const handleClearAll = () => {
    if (window.confirm('Clear all generation logs? This cannot be undone.')) {
      void clearRunLogs().then(refresh);
      refresh();
    }
  };

  const btn = 'inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';
  const primary = 'inline-flex h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl bg-[#0f8b8d] px-3 text-sm font-medium text-white transition hover:bg-[#0c7375]';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardList className="h-5 w-5 shrink-0 text-[#0f8b8d]" />
          <h2 className="text-base font-semibold sm:text-lg">Generation log</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={refresh} className={btn}><RefreshCw className="h-4 w-4" />Refresh</button>
          <button type="button" onClick={handleClearAll} className={btn}><Trash2 className="h-4 w-4" />Clear all</button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {runs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No generation runs recorded yet. Build a question set in the Practice Builder and it will appear here.
          </p>
        ) : runs.map((run) => {
          const id = idOf(run);
          const date = dateOf(val(run, ['startedAt', 'createdAt', 'timestamp', 'date', 'time']));
          const asked = num(val(run, ['requested', 'asked', 'total', 'questions']));
          const kept = num(val(run, ['kept', 'accepted']));
          const rejected = num(val(run, ['rejected']));
          const specialities = list(val(run, ['specialities', 'specialties']));
          const topics = list(val(run, ['chosenTopics', 'topics']));
          return (
            <article key={id || `${date}-${asked}-${kept}`} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:p-4">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold sm:text-base">{date}</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">asked {asked}, kept {kept}, rejected {rejected}, {Math.round(secondsOf(run))} s</p>
                {num(val(run, ['tokens'])) > 0 && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">~{num(val(run, ['tokens'])).toLocaleString()} tokens used (estimated)</p>}
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400" title={specialities.join(', ')}>
                  <span className="font-medium text-slate-600 dark:text-slate-300">Specialities: </span>
                  {specialities.length ? specialities.join(', ') : '—'}
                </p>
                <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400" title={topics.join(', ')}>
                  <span className="font-medium text-slate-600 dark:text-slate-300">Topics: </span>
                  {topics.length ? topics.join(', ') : '—'}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => handleCopy(run, false)} className={primary}>
                  <Copy className="h-4 w-4" />{copied === `${id}-summary` ? 'Copied' : 'Copy summary'}
                </button>
                <button type="button" onClick={() => handleCopy(run, true)} className={btn}>
                  <Copy className="h-4 w-4" />{copied === `${id}-full` ? 'Copied' : 'Copy full log'}
                </button>
                {canShare && (
                  <button type="button" onClick={() => handleShare(run)} className={btn}><Share2 className="h-4 w-4" />Share</button>
                )}
                <button type="button" onClick={() => handleDownload(run)} className={btn}><Download className="h-4 w-4" />Download</button>
                <button type="button" onClick={() => handleDelete(run)} className={btn}><Trash2 className="h-4 w-4" />Delete</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
