// The lesson half of the chapter workspace: the chapter taught in plain words, then a chat scoped
// to that note.
//
// The note is cached per chapter (src/lib/teachChapter.ts), so coming back to a chapter is instant
// and costs no AI call. "Write again" forces a fresh one when the learner wants a different angle.
import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { StructuredNote } from './StructuredNote.tsx';
import { TeachChat } from './TeachChat.tsx';
import { generateChapterTeachNote, getCachedChapterNote, type ChapterTeachResult } from '../lib/teachChapter.ts';
import type { ChapterTopic } from '../lib/pyqChapter.ts';

interface Props {
  subject: string;
  chapter: string;
  topics: ChapterTopic[];
}

export const ChapterLessonPanel: React.FC<Props> = ({ subject, chapter, topics }) => {
  const [result, setResult] = useState<ChapterTeachResult | null>(() => getCachedChapterNote(subject, chapter));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteRootRef = useRef<HTMLDivElement>(null);

  // A different chapter means a different note: drop the old one before it flashes on screen.
  useEffect(() => {
    setResult(getCachedChapterNote(subject, chapter));
    setError(null);
  }, [subject, chapter]);

  const write = async (force: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await generateChapterTeachNote({ subject, chapter, topics }, force);
      setResult(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The chapter note could not be written.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[#0f8b8d]" />
          <h3 className="text-sm font-semibold text-[#13294b]">Learn this chapter</h3>
        </div>
        <button
          type="button"
          onClick={() => void write(Boolean(result))}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#0d9488] hover:text-[#0f766e] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {busy ? 'Writing the lesson…' : result ? 'Write again' : 'Write the lesson'}
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="font-medium">The lesson could not be written.</p>
            <p className="mt-0.5 text-rose-600">{error}</p>
            <button
              type="button"
              onClick={() => void write(false)}
              className="mt-1.5 font-semibold underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {!result && !busy && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
          <p className="text-sm text-slate-600">
            The lesson for <span className="font-medium text-[#13294b]">{chapter}</span> has not been written yet.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            It explains the whole chapter in plain words, using your own books where they cover it.
          </p>
          <button
            type="button"
            onClick={() => void write(false)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#0f8b8d] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#00696b]"
          >
            <BookOpen className="h-4 w-4" />
            Teach me this chapter
          </button>
        </div>
      )}

      {busy && !result && (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-[#0f8b8d]" />
          Reading your books and writing the chapter lesson…
        </div>
      )}

      {result && (
        <div ref={noteRootRef}>
          {result.fromBooks && (
            <p className="mb-2 text-[11px] text-slate-500">Built with passages from your own books.</p>
          )}
          <StructuredNote note={result.note} range={result.label} readImages={false} plain />
          <TeachChat note={result.note} topicLabel={result.label} noteRootRef={noteRootRef} />
        </div>
      )}
    </section>
  );
};
