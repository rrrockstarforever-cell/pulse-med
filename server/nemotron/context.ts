// Context manager.
// Prepares task-specific context for each specialist instead of sending the full
// conversation history to every model. Respects per-model context-window limits.

import { NemotronModelConfig } from './config.ts';

export interface TaskContext {
  taskId: string;
  objective: string;
  requiredExpertise: string;
  inputContext: string;
  expectedOutput: string;
  completionCriteria: string[];
  dependencies: string[];
  systemPrompt: string;
}

export interface CompressionOptions {
  maxTokens: number;
  preserveFirstN: number;
  preserveLastN: number;
}

const DEFAULT_MAX_TOKENS = 8000;

// Rough token estimate: ~4 chars per token for English text.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const kept = text.slice(0, maxChars);
  const lastNewline = kept.lastIndexOf('\n');
  return lastNewline > 0 ? kept.slice(0, lastNewline) : kept;
}

export function buildTaskContext(
  taskId: string,
  objective: string,
  userRequest: string,
  relevantContext: string,
  model: NemotronModelConfig,
  roleSpecificInstructions: string,
): TaskContext {
  const inputContext = relevantContext ? `Relevant context:\n${relevantContext}\n\n` : '';
  const expectedOutput = 'Return a structured result with: a summary of findings, key evidence, and any caveats or uncertainty.';
  const completionCriteria = [
    'Addresses the objective fully.',
    'All claims supported by the provided context.',
    'No unsupported external facts.',
  ];

  return {
    taskId,
    objective,
    requiredExpertise: model.role,
    inputContext,
    expectedOutput,
    completionCriteria,
    dependencies: [],
    systemPrompt: [
      `You are ${model.role}, a Nemotron specialist AI agent.`,
      `Objective: ${objective}`,
      `User request: ${userRequest}`,
      inputContext,
      roleSpecificInstructions,
      `Expected output: ${expectedOutput}`,
      'Respond concisely and only with task-relevant content.',
    ].filter(Boolean).join('\n\n'),
  };
}

/**
 * Compress a long context string to fit within a model's token budget while
 * preserving the beginning and end (which usually contain the most important
 * framing and the actual request).
 */
export function compressContext(text: string, options: Partial<CompressionOptions> = {}): string {
  const { maxTokens = DEFAULT_MAX_TOKENS, preserveFirstN = 2, preserveLastN = 2 } = options;
  const tokens = estimateTokens(text);
  if (tokens <= maxTokens) return text;

  const lines = text.split('\n');
  const first = lines.slice(0, preserveFirstN).join('\n');
  const last = lines.slice(-preserveLastN).join('\n');

  const reserved = estimateTokens(first) + estimateTokens(last) + 200; // buffer
  const middleBudget = maxTokens - reserved;
  if (middleBudget <= 0) {
    // Just return first + last with an ellipsis.
    return `${first}\n...[context compressed]...\n${last}`;
  }

  const middle = lines.slice(preserveFirstN, -preserveLastN).join('\n');
  const truncatedMiddle = truncateToTokens(middle, middleBudget);
  return `${first}\n...[context compressed]...\n${truncatedMiddle}\n...[context compressed]...\n${last}`;
}

/**
 * Build a per-specialist message set from a task context, compressing to fit
 * the model's context window.
 */
export function specialistMessages(
  context: TaskContext,
  model: NemotronModelConfig,
  conversationHistory: string[] = [],
): { system: string; messages: { role: 'system' | 'user' | 'assistant'; content: string }[] } {
  const budget = Math.floor(model.contextWindow * 0.7); // leave 30% for output
  let combined = `${context.systemPrompt}\n\n`;

  if (conversationHistory.length) {
    combined += `Recent conversation:\n${conversationHistory.slice(-6).join('\n')}\n\n`;
  }

  combined += `Task input:\n${context.inputContext}`;

  const compressed = compressContext(combined, { maxTokens: budget });

  return {
    system: context.systemPrompt,
    messages: [
      { role: 'system', content: context.systemPrompt },
      { role: 'user', content: compressed },
    ],
  };
}
