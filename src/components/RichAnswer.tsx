import React from 'react';

/* ------------------------------------------------------------------ */
/* Internal types                                                      */
/* ------------------------------------------------------------------ */
type Inline = (text: string) => React.ReactNode;

type FlowStep = { kind: 'step' | 'decision' | 'branch'; text: string; label?: string };

type Block =
  | { kind: 'answer'; text: string }
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'callout'; variant: 'pearl' | 'trap' | 'note'; text: string }
  | { kind: 'flow'; steps: FlowStep[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'hr' }
  | { kind: 'para'; text: string };

/* ------------------------------------------------------------------ */
/* Tiny line helpers (no exotic regex, no backtracking risk)           */
/* ------------------------------------------------------------------ */
const splitRow = (line: string): string[] => {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
};

const isSeparatorRow = (line: string): boolean => {
  const s = line.trim();
  return s.includes('|') && s.includes('-') && /^[|\s:-]+$/.test(s);
};

const isTableStart = (lines: string[], i: number): boolean =>
  lines[i].includes('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1]);

/* strip a leading "Pearl:" / "Trap:" / "Warning:" keyword */
const matchPrefix = (text: string, word: string): string | null => {
  if (!text.toLowerCase().startsWith(word.toLowerCase())) return null;
  const rest = text.slice(word.length);
  const colon = /^\s*:/.exec(rest);
  if (!colon) return null;
  return rest.slice(colon[0].length).trim();
};

const buildCallout = (quoteLines: string[]): Block => {
  const text = quoteLines.map((l) => l.replace(/^>\s?/, '')).join(' ').trim();
  const pearl = matchPrefix(text, 'Pearl');
  if (pearl !== null) return { kind: 'callout', variant: 'pearl', text: pearl };
  const trap = matchPrefix(text, 'Trap');
  if (trap !== null) return { kind: 'callout', variant: 'trap', text: trap };
  const warning = matchPrefix(text, 'Warning');
  if (warning !== null) return { kind: 'callout', variant: 'trap', text: warning };
  return { kind: 'callout', variant: 'note', text };
};

/* bold answer line: drop the leading "**Answer" and the closing "**" */
const answerText = (line: string): string => {
  let rest = line.slice(2);
  if (rest.toLowerCase().startsWith('answer')) rest = rest.slice(6);
  // The box is already bold, so every ** marker goes (the closing one may be followed by a [1] citation).
  return rest.replace(/\*\*/g, '').replace(/^[\s:*]+/, '').replace(/[\s*]+$/, '').trim();
};

/* one flow step per non-empty line; "? " = decision, "cond -> box" = branch */
const parseFlow = (inner: string[]): FlowStep[] => {
  const steps: FlowStep[] = [];
  for (const raw of inner) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('? ')) {
      steps.push({ kind: 'decision', text: line.slice(2).trim() });
      continue;
    }
    const arrow = line.indexOf(' -> ');
    if (arrow > 0) {
      steps.push({
        kind: 'branch',
        label: line.slice(0, arrow).trim(),
        text: line.slice(arrow + 4).trim(),
      });
      continue;
    }
    steps.push({ kind: 'step', text: line });
  }
  return steps;
};

const isBlockStart = (lines: string[], i: number): boolean => {
  const s = lines[i].trim();
  if (!s) return true;
  return (
    s.startsWith('```') ||
    s.startsWith('>') ||
    s.startsWith('### ') ||
    s.startsWith('## ') ||
    s === '---' ||
    s.startsWith('- ') ||
    s.startsWith('* ') ||
    /^\d+\.\s/.test(s) ||
    isTableStart(lines, i)
  );
};

/* ------------------------------------------------------------------ */
/* Block parser (line by line, unknown syntax -> paragraph)            */
/* ------------------------------------------------------------------ */
const parseBlocks = (text: string): Block[] => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
      continue;
    }

    /* fenced block: flow chart or plain code */
    if (t.startsWith('```')) {
      const lang = t.slice(3).trim().toLowerCase();
      const inner: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        inner.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(lang === 'flow' ? { kind: 'flow', steps: parseFlow(inner) } : { kind: 'code', lines: inner });
      continue;
    }

    /* highlighted answer box (only as the very first block) */
    if (blocks.length === 0 && t.startsWith('**Answer')) {
      blocks.push({ kind: 'answer', text: answerText(t) });
      i++;
      continue;
    }

    /* headings */
    if (t.startsWith('### ')) {
      blocks.push({ kind: 'heading', level: 3, text: t.slice(4).trim() });
      i++;
      continue;
    }
    if (t.startsWith('## ')) {
      blocks.push({ kind: 'heading', level: 2, text: t.slice(3).trim() });
      i++;
      continue;
    }

    /* horizontal rule */
    if (t === '---') {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    /* callout: consecutive "> " lines */
    if (t.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        // A new Pearl / Trap / Warning line starts its own callout box.
        if (quote.length && /^>\s*(pearl|trap|warning)\s*:/i.test(lines[i].trim())) break;
        quote.push(lines[i].trim());
        i++;
      }
      blocks.push(buildCallout(quote));
      continue;
    }

    /* bullet list */
    if (t.startsWith('- ') || t.startsWith('* ')) {
      const items: string[] = [];
      while (i < lines.length) {
        const lt = lines[i].trim();
        if (!lt.startsWith('- ') && !lt.startsWith('* ')) break;
        items.push(lt.slice(2).trim());
        i++;
      }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    /* numbered list */
    if (/^\d+\.\s/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, '').trim());
        i++;
      }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    /* pipe table */
    if (isTableStart(lines, i)) {
      const header = splitRow(lines[i]);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length) {
        const rt = lines[j].trim();
        if (!rt || !rt.includes('|') || isSeparatorRow(lines[j])) break;
        rows.push(splitRow(lines[j]));
        j++;
      }
      blocks.push({ kind: 'table', header, rows });
      i = j;
      continue;
    }

    /* paragraph: merge consecutive plain lines, soft breaks -> space */
    const parts: string[] = [t];
    let j = i + 1;
    while (j < lines.length && !isBlockStart(lines, j)) {
      parts.push(lines[j].trim());
      j++;
    }
    blocks.push({ kind: 'para', text: parts.join(' ') });
    i = j;
  }

  return blocks;
};

/* ------------------------------------------------------------------ */
/* Rendering helpers                                                   */
/* ------------------------------------------------------------------ */
const ACCENT = 'text-[#0f8b8d] dark:text-teal-300';

const CALLOUT: Record<'pearl' | 'trap' | 'note', { box: string; badge: string; label: string }> = {
  pearl: {
    box: 'border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30',
    badge: 'bg-amber-200/80 text-amber-900 dark:bg-amber-800/70 dark:text-amber-100',
    label: 'Pearl',
  },
  trap: {
    box: 'border-rose-300 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-950/30',
    badge: 'bg-rose-200/80 text-rose-900 dark:bg-rose-800/70 dark:text-rose-100',
    label: 'Trap',
  },
  note: {
    box: 'border-slate-300 bg-slate-50 dark:border-slate-600/60 dark:bg-slate-800/40',
    badge: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
    label: 'Note',
  },
};

const STEP_BOX =
  'rounded-lg border border-[#0f8b8d]/40 bg-white px-2.5 py-2 text-[13px] leading-relaxed text-slate-700 dark:border-teal-400/40 dark:bg-slate-900 dark:text-slate-200';

const FlowArrow: React.FC = () => (
  <div className="flex justify-center py-1 text-[#0f8b8d] dark:text-teal-400" aria-hidden="true">
    <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
      <path d="M5 0v11m0 0 3.5-3.5M5 11 1.5 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>
);

const renderBlock = (block: Block, index: number, renderInline: Inline): React.ReactNode => {
  switch (block.kind) {
    /* highlighted answer box */
    case 'answer':
      return (
        <div className="rounded-r-lg border-l-4 border-[#0f8b8d] bg-teal-50 px-3 py-2.5 dark:border-teal-400 dark:bg-teal-950/40">
          <div className={`mb-0.5 text-[10px] font-bold uppercase tracking-wider ${ACCENT}`}>Answer</div>
          <div className="text-[15px] font-semibold leading-relaxed text-slate-900 dark:text-teal-50">
            {renderInline(block.text)}
          </div>
        </div>
      );

    /* teal section heading with a divider above (except the first block) */
    case 'heading':
      return (
        <div className={index === 0 ? '' : 'border-t border-slate-200 pt-2.5 dark:border-slate-700'}>
          <h3
            className={`${block.level === 2 ? 'text-[13px]' : 'text-[12px]'} font-semibold uppercase tracking-wide ${ACCENT}`}
          >
            {renderInline(block.text)}
          </h3>
        </div>
      );

    /* bullet list with teal dots */
    case 'ul':
      return (
        <ul className="space-y-1.5 pl-0.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-slate-700 dark:text-slate-300">
              <span
                className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#0f8b8d] dark:bg-teal-400"
                aria-hidden="true"
              />
              <span className="min-w-0">{renderInline(item)}</span>
            </li>
          ))}
        </ul>
      );

    /* numbered list with teal number badges */
    case 'ol':
      return (
        <ol className="space-y-1.5 pl-0.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed text-slate-700 dark:text-slate-300">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-50 text-[11px] font-semibold text-[#0f8b8d] ring-1 ring-teal-200 dark:bg-teal-950 dark:text-teal-300 dark:ring-teal-800">
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5">{renderInline(item)}</span>
            </li>
          ))}
        </ol>
      );

    /* pipe table: scrolls sideways on phones, zebra rows */
    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-teal-50/80 dark:bg-teal-950/40">
                {block.header.map((cell, ci) => (
                  <th
                    key={ci}
                    scope="col"
                    className={`whitespace-nowrap px-2.5 py-2 text-[12px] font-semibold ${ACCENT}`}
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri} className="even:bg-slate-50 dark:even:bg-slate-800/40">
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-2.5 py-2 align-top text-[12.5px] leading-snug text-slate-700 dark:text-slate-200"
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    /* callout: pearl / trap / neutral note */
    case 'callout': {
      const style = CALLOUT[block.variant];
      return (
        <div role="note" className={`rounded-lg border px-3 py-2.5 ${style.box}`}>
          <span
            className={`mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${style.badge}`}
          >
            {style.label}
          </span>
          <p className="text-[13.5px] leading-relaxed text-slate-700 dark:text-slate-200">
            {renderInline(block.text)}
          </p>
        </div>
      );
    }

    /* vertical flow chart: boxes + arrows, branches indented, decisions amber */
    case 'flow':
      return (
        <ol aria-label="Flow chart" className="space-y-0">
          {block.steps.map((step, si) => (
            <li key={si} className={step.kind === 'branch' ? 'ml-4 sm:ml-6' : ''}>
              {si > 0 && <FlowArrow />}
              {step.kind === 'branch' ? (
                <div className="flex flex-col items-start gap-1">
                  <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-[#0f8b8d] ring-1 ring-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:ring-teal-800">
                    {renderInline(step.label ?? '')}
                  </span>
                  <div className={`w-full min-w-0 ${STEP_BOX}`}>{renderInline(step.text)}</div>
                </div>
              ) : step.kind === 'decision' ? (
                <div className="flex items-start gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-2.5 py-2 text-[13px] font-medium leading-relaxed text-amber-900 dark:border-amber-600 dark:bg-amber-950/30 dark:text-amber-100">
                  <span
                    className="mt-[5px] h-2.5 w-2.5 shrink-0 rotate-45 rounded-[2px] border border-amber-500 dark:border-amber-400"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">{renderInline(step.text)}</span>
                </div>
              ) : (
                <div className={STEP_BOX}>{renderInline(step.text)}</div>
              )}
            </li>
          ))}
        </ol>
      );

    /* plain fenced code (literal, scrollable) */
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2.5 text-[12px] leading-relaxed text-slate-100 dark:bg-slate-950 dark:ring-1 dark:ring-slate-800">
          <code>{block.lines.join('\n')}</code>
        </pre>
      );

    /* thin divider */
    case 'hr':
      return <hr className="border-0 border-t border-slate-200 dark:border-slate-700" />;

    /* paragraph */
    case 'para':
      return (
        <p className="text-[13.5px] leading-relaxed text-slate-700 dark:text-slate-300">
          {renderInline(block.text)}
        </p>
      );

    default:
      return null;
  }
};

/* ------------------------------------------------------------------ */
/* Public component                                                    */
/* ------------------------------------------------------------------ */
export const RichAnswer: React.FC<{ text: string; renderInline: (text: string) => React.ReactNode }> = ({
  text,
  renderInline,
}) => {
  if (!text || !text.trim()) return null;

  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <React.Fragment key={index}>{renderBlock(block, index, renderInline)}</React.Fragment>
      ))}
    </div>
  );
};
