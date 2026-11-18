// Real captured questions for the Mistake Notebook (PARITY sections 8 and 12).
// Persisted in localStorage `pulse.mistakes.v1`. Captures are created by pasting a
// screenshot (Ctrl+V) or choosing an image, optionally OCR'd with tesseract.js, then
// structured with the ACTIVE AI provider — never filled with canned content.
import type { ClinicalQuestion } from '../types.ts';
import { notifyDataChanged } from './dataEvents.ts';

export interface CapturedQuestion {
  id: string;
  createdAt: string;
  /** test / module / book the question came from, typed by the user */
  source: string;
  /** OCR output kept so the user can see what the recogniser read */
  ocrText?: string;
  /** pasted screenshot (data URL) kept with the question */
  imageDataUrl?: string;
  /** unresolved = still a mistake, remediated = the user marked it correct later */
  status: 'unresolved' | 'remediated';
  /** whether the user answered it correctly in the source test */
  markedCorrect?: boolean;
  /** optional AI/user explanation */
  explanation?: string;
  /** captured topic label shown in the notebook */
  topic?: string;
  /** 'test' = added automatically from a submitted test (wrong or skipped answer). */
  origin?: 'test' | 'capture';
  /** How many times this question has been missed in tests, and when last. */
  timesMissed?: number;
  lastMissedAt?: string;
  lastAttemptId?: string;
  reason?: 'wrong' | 'skipped';
  yourAnswer?: string;
  question: ClinicalQuestion;
}

const KEY = 'pulse.mistakes.v1';

function readAll(): CapturedQuestion[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CapturedQuestion[]) : [];
  } catch {
    return [];
  }
}

function writeAll(items: CapturedQuestion[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 1000)));
    notifyDataChanged();
  } catch (err) {
    // Storage full / unavailable — surface via the UI caller
    console.error('Could not save captured questions', err);
    throw new Error('Local storage is full — could not save the captured question.');
  }
}

export function listCapturedQuestions(): CapturedQuestion[] {
  return readAll();
}

export function addCapturedQuestion(input: Omit<CapturedQuestion, 'id' | 'createdAt'> & { id?: string; createdAt?: string }): CapturedQuestion {
  const item: CapturedQuestion = {
    ...input,
    id: input.id || `CAP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: input.createdAt || new Date().toISOString(),
  };
  const items = readAll();
  items.unshift(item);
  writeAll(items);
  return item;
}

export function updateCapturedQuestion(id: string, patch: Partial<CapturedQuestion>): void {
  const items = readAll().map((q) => (q.id === id ? { ...q, ...patch } : q));
  writeAll(items);
}

export function removeCapturedQuestion(id: string): void {
  writeAll(readAll().filter((q) => q.id !== id));
}

export function importCapturedQuestions(records: CapturedQuestion[]): number {
  const items = readAll();
  const existing = new Set(items.map((q) => q.id));
  let added = 0;
  for (const rec of records) {
    if (!rec || typeof rec.id !== 'string' || !rec.question || existing.has(rec.id)) continue;
    items.push(rec);
    existing.add(rec.id);
    added += 1;
  }
  writeAll(items);
  return added;
}

/**
 * Puts every wrong or skipped question of a submitted test into the notebook (once per attempt). A question missed again
 * counts up; a question answered correctly later is marked remediated.
 */
export function recordTestMisses(
  questions: ClinicalQuestion[],
  answers: Record<string, string>,
  source: string,
  attemptId: string,
): { added: number; updated: number; remediated: number } {
  const items = readAll();
  const byId = new Map(items.map((i) => [i.id, i]));
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  let remediated = 0;
  for (const q of questions) {
    const id = `TEST-${q.id}`;
    const chosen = answers[q.id];
    const hit = byId.get(id);
    if (hit && hit.lastAttemptId === attemptId) continue;
    if (chosen && chosen === q.correctOption) {
      if (hit && hit.status === 'unresolved') { hit.status = 'remediated'; hit.markedCorrect = true; hit.lastAttemptId = attemptId; remediated += 1; }
      continue;
    }
    const reason: 'wrong' | 'skipped' = chosen ? 'wrong' : 'skipped';
    if (hit) {
      hit.status = 'unresolved';
      hit.markedCorrect = false;
      hit.timesMissed = (hit.timesMissed ?? 1) + 1;
      hit.lastMissedAt = now;
      hit.lastAttemptId = attemptId;
      hit.reason = reason;
      hit.yourAnswer = chosen;
      updated += 1;
    } else {
      const item: CapturedQuestion = {
        id,
        createdAt: now,
        source,
        status: 'unresolved',
        markedCorrect: false,
        topic: (q.subtopic || q.subject || '').trim(),
        origin: 'test',
        timesMissed: 1,
        lastMissedAt: now,
        lastAttemptId: attemptId,
        reason,
        yourAnswer: chosen,
        question: { ...q, timesFailed: 1 },
      };
      items.unshift(item);
      byId.set(id, item);
      added += 1;
    }
  }
  if (added || updated || remediated) writeAll(items);
  return { added, updated, remediated };
}

/** The notebook renders ordinary ClinicalQuestions; marking maps onto isRemediated. */
export function capturedToClinicalQuestion(c: CapturedQuestion): ClinicalQuestion {
  return {
    ...c.question,
    id: c.id,
    isRemediated: c.status === 'remediated',
    timesFailed: c.status === 'remediated' ? 1 : Math.max(1, c.timesMissed ?? c.question.timesFailed ?? 1),
  };
}
