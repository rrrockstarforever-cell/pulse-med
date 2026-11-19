import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Mic, Send, Square, Trash2, X } from 'lucide-react';
import { useVoiceInput } from './useVoiceInput.ts';
import { RichAnswer } from './RichAnswer.tsx';
import {
  askGrounded,
  clearChat,
  loadChat,
  saveChat,
  type ChatTurn,
  type GroundMode,
  type Source,
} from '../lib/groundedChat';

const EXAMPLES = [
  'Explain this in simpler words',
  'What are the exam traps here?',
  'Give me a 5-line summary',
];

const MODES: { value: GroundMode; label: string }[] = [
  { value: 'both', label: 'Books + Internet' },
  { value: 'books', label: 'My books' },
  { value: 'web', label: 'Internet' },
];

function makeLocalId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The honest status line under an answer: what the search really did, not what it was asked to do. */
function searchBadge(turn: ChatTurn): { text: string; className: string } {
  if (turn.searchOutcome === 'books-only') {
    return {
      text: 'Books only: no internet check, rest is from memory',
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    };
  }
  if (turn.searchOutcome === 'no-direct-source') {
    return {
      text: 'Internet reached, but the pages read do not state this detail',
      className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    };
  }
  if (turn.grounded || turn.searchOutcome === 'found') {
    return {
      text: 'Checked against sources',
      className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    };
  }
  if (turn.searchOutcome === 'unavailable') {
    return {
      text: 'Internet could not be reached: this is from memory',
      className: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
    };
  }
  return {
    text: 'Search found nothing: this is from memory',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  };
}

function TurnView({ turn }: { turn: ChatTurn }) {
  const [openSources, setOpenSources] = useState(false);
  const sourceRefs = useRef<Record<number, HTMLLIElement | null>>({});
  const sources: Source[] = turn.sources ?? [];

  const openSource = (n: number) => {
    const source = sources.find((item) => item.n === n);
    setOpenSources(true);
    if (source?.kind === 'web' && source.url) {
      window.open(source.url, '_blank', 'noopener,noreferrer');
      return;
    }
    requestAnimationFrame(() => {
      sourceRefs.current[n]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  const bold = (t: string, at: number): React.ReactNode[] => t.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <strong key={'b' + at + '-' + i}>{p}</strong> : p));
  const renderText = (text: string) => {
    if (turn.role !== 'assistant') return text;
    const nodes: React.ReactNode[] = [];
    const regex = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) nodes.push(...bold(text.slice(lastIndex, match.index), lastIndex));
      const n = Number(match[1]);
      if (sources.some((source) => source.n === n)) {
        nodes.push(
          <button
            key={`cite-${match.index}-${n}`}
            type="button"
            onClick={() => openSource(n)}
            aria-label={`Open source ${n}`}
            className="mx-0.5 inline-flex h-5 min-h-0! min-w-[20px]! items-center justify-center rounded bg-teal-100 px-1 align-super text-[10px] font-semibold leading-none text-teal-800 transition hover:bg-teal-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:bg-teal-900/60 dark:text-teal-200 dark:hover:bg-teal-800"
          >
            {n}
          </button>
        );
      } else {
        nodes.push(match[0]);
      }
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) nodes.push(...bold(text.slice(lastIndex), lastIndex));
    return nodes;
  };

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#0f8b8d] px-3 py-2 text-sm text-white shadow-sm">
          <p className="whitespace-pre-wrap break-words">{turn.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div
        className={`w-full max-w-full rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2.5 text-sm dark:bg-slate-800 ${
          turn.error ? 'text-rose-700 dark:text-rose-300' : 'text-slate-800 dark:text-slate-100'
        }`}
      >
        {turn.error ? <p className="whitespace-pre-wrap break-words">{renderText(turn.text)}</p> : <RichAnswer text={turn.text} renderInline={renderText} />}
      </div>

      {!turn.error ? (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${searchBadge(turn).className}`}
        >
          {searchBadge(turn).text}
        </span>
      ) : null}

      {sources.length > 0 ? (
        <div className="w-full max-w-full">
          <button
            type="button"
            onClick={() => setOpenSources((value) => !value)}
            aria-expanded={openSources}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg px-1 text-xs font-medium text-slate-500 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-slate-400 dark:hover:text-slate-200"
          >
            {openSources ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Sources ({sources.length})
          </button>

          {openSources ? (
            <ul className="mt-1.5 space-y-2">
              {sources.map((source) => (
                <li
                  key={source.n}
                  ref={(el) => {
                    sourceRefs.current[source.n] = el;
                  }}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800/60"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-slate-500 dark:text-slate-400">[{source.n}]</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        source.kind === 'book'
                          ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200'
                          : 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200'
                      }`}
                    >
                      {source.kind === 'book' ? 'Book' : 'Web'}
                    </span>
                    <span className="min-w-0 flex-1 text-slate-700 dark:text-slate-200">{source.title}</span>
                    {source.kind === 'web' && source.url ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open source ${source.n} in a new tab`}
                        className="inline-flex min-h-10 items-center gap-1 rounded-lg px-1 text-teal-700 transition hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-teal-300 dark:hover:text-teal-200"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Open
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const GroundedChat: React.FC<{
  bankId: string;
  title: string;
  /** The NEET-PG subject of this plan, when known. It steers the book search and the journal list. */
  subject?: string;
  seed?: { id: number; text: string; context?: string } | null;
  onClose?: () => void;
}> = ({ bankId, title, subject, seed, onClose }) => {
  const [turns, setTurns] = useState<ChatTurn[]>(() => loadChat(bankId));
  const [input, setInput] = useState('');
  // Voice input: records here and turns speech into text on this device (same as the AI tutor).
  const { recording, status: voiceStatus, toggle: toggleVoice } = useVoiceInput((text) => {
    setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
  });
  const [mode, setMode] = useState<GroundMode>('both');
  const [waiting, setWaiting] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const currentBankRef = useRef(bankId);
  const lastSeedIdRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (currentBankRef.current === bankId) return;
    requestIdRef.current += 1;
    currentBankRef.current = bankId;
    abortRef.current?.abort();
    setWaiting(false);
    setTurns(loadChat(bankId));
  }, [bankId]);

  useEffect(() => {
    if (currentBankRef.current !== bankId) return;
    saveChat(bankId, turns);
  }, [bankId, turns]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, waiting]);

  const runAsk = useCallback(
    async (question: string, context?: string) => {
      const text = question.trim();
      if (!text) return;
      const sendBank = currentBankRef.current;
      const userTurn: ChatTurn = { id: makeLocalId(), role: 'user', text };
      const history = [...turns, userTurn].slice(-4);
      setTurns((prev) => [...prev, userTurn].slice(-40));
      setInput('');
      setWaiting(true);

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const answer = await askGrounded({
          question: text,
          topic: title,
          subject: subject || '',
          context,
          history,
          mode,
          signal: controller.signal,
        });
        if (
          !controller.signal.aborted &&
          currentBankRef.current === sendBank &&
          requestIdRef.current === requestId
        ) {
          setTurns((prev) => [...prev, answer].slice(-40));
        }
      } finally {
        if (requestIdRef.current === requestId) {
          if (abortRef.current === controller) abortRef.current = null;
          setWaiting(false);
        }
      }
    },
    [mode, title, subject, turns]
  );

  const send = useCallback(
    (question: string, context?: string) => {
      if (waiting) return;
      void runAsk(question, context);
    },
    [waiting, runAsk]
  );

  useEffect(() => {
    if (!seed) return;
    if (lastSeedIdRef.current === seed.id) return;
    lastSeedIdRef.current = seed.id;
    void runAsk(seed.text, seed.context);
  }, [seed, runAsk]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    send(input);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send(input);
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setWaiting(false);
  };

  const handleClear = () => {
    requestIdRef.current += 1;
    abortRef.current?.abort();
    setWaiting(false);
    clearChat(bankId);
    setTurns([]);
  };

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Ask about this plan</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Searches your books or the internet; each answer shows what the search actually did</p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </header>

      <div className="border-b border-slate-200 p-3 dark:border-slate-700">
        <div role="group" aria-label="Source for answers" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {MODES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setMode(item.value)}
              aria-pressed={mode === item.value}
              className={`min-h-10 rounded-lg px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                mode === item.value
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Ask about this plan</p>
            <p className="max-w-xs text-xs text-slate-500 dark:text-slate-400">
              Pick a question or type your own. Answers are checked against your books and the internet when possible.
            </p>
            <div className="flex w-full max-w-sm flex-col gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => send(example)}
                  className="min-h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm text-slate-700 transition hover:border-teal-300 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:border-teal-700 dark:hover:bg-teal-900/30"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => <TurnView key={turn.id} turn={turn} />)
        )}

        {waiting ? (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Thinking...
            </div>
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            aria-label="Your question"
            placeholder="Ask about this plan..."
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={recording ? 'Stop recording' : 'Speak your question'}
            title={recording ? 'Stop recording' : 'Speak your question'}
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${recording ? 'animate-pulse bg-rose-500 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'}`}
          >
            <Mic className="h-4 w-4" />
          </button>
          {waiting ? (
            <button
              type="button"
              onClick={handleStop}
              aria-label="Stop answer"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send question"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0f8b8d] text-white transition hover:bg-[#0b6b6d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg px-1 text-xs font-medium text-slate-500 transition hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear chat
          </button>
          <span className="text-[11px] text-slate-400 dark:text-slate-500">Enter to send · Shift+Enter for a new line</span>
        </div>
        {voiceStatus && <p role="status" className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{voiceStatus}</p>}
      </form>
    </section>
  );
};
