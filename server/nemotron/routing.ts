// Intelligent routing engine controlled by Nemotron Super.
// Classifies incoming requests into one of 15 task categories and maps them to
// preferred Nemotron models per the default routing policy. Super can override.

import { NemotronModelConfig, NEMOTRON_CONFIG } from './config.ts';

export type TaskCategory =
  | 'general-conversation'
  | 'reasoning'
  | 'mathematics'
  | 'coding'
  | 'debugging'
  | 'software-architecture'
  | 'research'
  | 'document-analysis'
  | 'data-analysis'
  | 'image-analysis'
  | 'video-understanding'
  | 'audio-understanding'
  | 'tool-execution'
  | 'multi-step-automation'
  | 'complex-interdisciplinary';

export interface RoutingDecision {
  category: TaskCategory;
  complexity: 'low' | 'medium' | 'high' | 'extreme';
  preferredModel: NemotronModelConfig;
  fallbackModels: NemotronModelConfig[];
  rationale: string;
  needsParallel: boolean;
  needsUltra: boolean;
}

// Keyword heuristics for classification (Super can override with its own reasoning).
const CATEGORY_KEYWORDS: Record<TaskCategory, string[]> = {
  'general-conversation': ['hello', 'hi', 'hey', 'how are you', 'thanks', 'chat', 'talk'],
  'reasoning': ['reason', 'logic', 'deduce', 'infer', 'conclusion', 'therefore', 'because'],
  'mathematics': ['calculate', 'equation', 'solve', 'math', 'algebra', 'calculus', 'derivative', 'integral'],
  'coding': ['code', 'function', 'class', 'script', 'program', 'bug', 'debug', 'refactor', 'api', 'typescript', 'javascript', 'python'],
  'debugging': ['error', 'exception', 'stack trace', 'crash', 'fix', 'broken', 'not working'],
  'software-architecture': ['architecture', 'design', 'system design', 'structure', 'pattern', 'microservice', 'scalability'],
  'research': ['research', 'find', 'search', 'survey', 'literature', 'study', 'investigate'],
  'document-analysis': ['document', 'pdf', 'text', 'summarize', 'extract', 'read file'],
  'data-analysis': ['data', 'dataset', 'analyze', 'statistics', 'chart', 'graph', 'csv', 'excel'],
  'image-analysis': ['image', 'photo', 'picture', 'screenshot', 'visual', 'ocr', 'view'],
  'video-understanding': ['video', 'clip', 'motion', 'frame', 'timeline'],
  'audio-understanding': ['audio', 'sound', 'voice', 'speech', 'transcribe', 'listen'],
  'tool-execution': ['tool', 'run', 'execute', 'command', 'script', 'automation'],
  'multi-step-automation': ['workflow', 'pipeline', 'step by step', 'automate', 'orchestrate'],
  'complex-interdisciplinary': ['interdisciplinary', 'complex', 'multi-domain', 'research and code', 'deep'],
};

function classifyCategory(text: string): TaskCategory {
  const lower = text.toLowerCase();
  let best: TaskCategory = 'general-conversation';
  let bestScore = 0;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = category as TaskCategory;
    }
  }
  return best;
}

function estimateComplexity(text: string, category: TaskCategory): 'low' | 'medium' | 'high' | 'extreme' {
  const len = text.length;
  const hasCode = /```|function|class|import|const|let|var|def |async|await/i.test(text);
  const hasMultipleSteps = /\b(step|then|after|finally|first|second|next)\b/i.test(text);
  const extremeTerms = ['extremely difficult', 'very complex', 'advanced', 'expert', 'phd', 'research-level'];
  const isExtreme = extremeTerms.some((t) => text.toLowerCase().includes(t));

  if (isExtreme || (len > 2000 && category !== 'general-conversation')) return 'extreme';
  if (len > 800 || hasCode || hasMultipleSteps) return 'high';
  if (len > 200) return 'medium';
  return 'low';
}

// Default routing policy per the spec.
const ROUTING_POLICY: Record<TaskCategory, { preferred: string; fallback: string[]; needsParallel: boolean; needsUltra: boolean }> = {
  'general-conversation': { preferred: 'lightweight-autonomous', fallback: ['high-throughput', 'general-reasoning'], needsParallel: false, needsUltra: false },
  'reasoning': { preferred: 'general-reasoning', fallback: ['orchestrator', 'advanced-reasoning-escalation'], needsParallel: false, needsUltra: false },
  'mathematics': { preferred: 'orchestrator', fallback: ['advanced-reasoning-escalation', 'general-reasoning'], needsParallel: false, needsUltra: true },
  'coding': { preferred: 'orchestrator', fallback: ['general-reasoning', 'lightweight-autonomous'], needsParallel: true, needsUltra: false },
  'debugging': { preferred: 'lightweight-autonomous', fallback: ['general-reasoning', 'orchestrator'], needsParallel: false, needsUltra: false },
  'software-architecture': { preferred: 'orchestrator', fallback: ['general-reasoning', 'advanced-reasoning-escalation'], needsParallel: true, needsUltra: false },
  'research': { preferred: 'general-reasoning', fallback: ['orchestrator', 'high-throughput'], needsParallel: true, needsUltra: false },
  'document-analysis': { preferred: 'general-reasoning', fallback: ['high-throughput', 'orchestrator'], needsParallel: false, needsUltra: false },
  'data-analysis': { preferred: 'high-throughput', fallback: ['general-reasoning', 'orchestrator'], needsParallel: true, needsUltra: false },
  'image-analysis': { preferred: 'multimodal', fallback: ['orchestrator'], needsParallel: false, needsUltra: false },
  'video-understanding': { preferred: 'multimodal', fallback: ['orchestrator'], needsParallel: false, needsUltra: false },
  'audio-understanding': { preferred: 'multimodal', fallback: ['orchestrator'], needsParallel: false, needsUltra: false },
  'tool-execution': { preferred: 'lightweight-autonomous', fallback: ['high-throughput', 'general-reasoning'], needsParallel: false, needsUltra: false },
  'multi-step-automation': { preferred: 'lightweight-autonomous', fallback: ['high-throughput', 'orchestrator'], needsParallel: true, needsUltra: false },
  'complex-interdisciplinary': { preferred: 'orchestrator', fallback: ['advanced-reasoning-escalation', 'general-reasoning'], needsParallel: true, needsUltra: true },
};

export async function routeRequest(text: string, availableRoles: string[] = []): Promise<RoutingDecision> {
  const category = classifyCategory(text);
  const complexity = estimateComplexity(text, category);
  const policy = ROUTING_POLICY[category];

  const { getNemotronModel } = await import('./registry.ts');
  const preferred = await getNemotronModel(policy.preferred as any);
  const fallback = (await Promise.all(policy.fallback.map((r) => getNemotronModel(r as any)))).filter(Boolean) as NemotronModelConfig[];

  // Filter to only enabled/available models.
  const availablePreferred = preferred && preferred.enabled ? preferred : undefined;
  const availableFallback = fallback.filter((f) => f.enabled);

  let rationale = `Classified as "${category}" (complexity: ${complexity}). `;
  if (availablePreferred) {
    rationale += `Routed to preferred ${availablePreferred.role} (${availablePreferred.modelId}).`;
  } else if (availableFallback.length) {
    rationale += `Preferred model unavailable; using fallback ${availableFallback[0].role}.`;
  } else {
    rationale += 'No Nemotron model available for this category.';
  }

  const needsUltra = policy.needsUltra && complexity === 'extreme';

  return {
    category,
    complexity,
    preferredModel: availablePreferred ?? availableFallback[0] ?? NEMOTRON_CONFIG.orchestrator,
    fallbackModels: availableFallback,
    rationale,
    needsParallel: policy.needsParallel,
    needsUltra,
  };
}

export function specialistKeysForText(text: string, routing: RoutingDecision): string[] {
  const keys: string[] = [];
  const add = (key: string) => { if (!keys.includes(key)) keys.push(key); };
  const lower = text.toLowerCase();
  const visual = routing.category === 'image-analysis' || routing.category === 'video-understanding' || routing.category === 'audio-understanding'
    || /\b(image|photo|picture|screenshot|chart|audio|video|ocr|voice|sound)\b/.test(lower);
  const data = routing.category === 'data-analysis' || /\b(dataset|csv|table|rows|aggregate)\b/.test(lower);
  const smallCode = routing.category === 'debugging' || routing.category === 'tool-execution'
    || (routing.category === 'coding' && routing.complexity !== 'extreme');
  if (visual) add('nano-omni');
  if (data || (routing.needsParallel && routing.category === 'research')) add('lightning');
  if (smallCode) add('bolt');
  if (routing.needsUltra) add('ultra');
  if (!visual || /\b(and|also|explain|compare|write|why|how)\b/.test(lower)) add('nano');
  if (!keys.length) add('nano');
  // Drop any specialist that is disabled so the orchestrator never delegates to an
  // inaccessible model (which surfaces as 401/404 errors from the NIM endpoint).
  const filtered = keys.filter((k) => {
    const cfg = NEMOTRON_CONFIG.specialists[k];
    return cfg && cfg.enabled;
  });
  return filtered.length ? filtered : ['lightning'];
}

export function categoryForText(text: string): TaskCategory {
  return classifyCategory(text);
}
