// Quality control and disagreement resolution module.
// Nemotron Super evaluates specialist results, detects contradictions, asks
// specialists to reconsider, requests independent assessment, and escalates to
// Ultra when needed. Super makes the final decision. No majority voting alone.

import { NemotronModelConfig } from './config.ts';
import { nemotronClient } from './client.ts';
import { TaskRecord } from './results.ts';

export interface VerificationVerdict {
  taskId: string;
  accurate: boolean;
  complete: boolean;
  consistent: boolean;
  relevant: boolean;
  issues: string[];
  confidence: number; // 0-1
}

export interface Disagreement {
  taskId: string;
  modelA: string;
  modelB: string;
  issue: string;
  evidenceA: string;
  evidenceB: string;
  resolved: boolean;
  resolution: string;
}

export interface QualityControlResult {
  verified: VerificationVerdict[];
  disagreements: Disagreement[];
  needsRevision: boolean;
  finalAssessment: string;
}

export class VerificationModule {
  private orchestrator: NemotronModelConfig;
  private ultra?: NemotronModelConfig;

  constructor(orchestrator: NemotronModelConfig, ultra?: NemotronModelConfig) {
    this.orchestrator = orchestrator;
    this.ultra = ultra;
  }

  /**
   * Verify a single specialist result against the task objective using Super.
   */
  async verifyTask(
    task: { taskId: string; objective: string; inputContext: string; expectedOutput: string },
    record: TaskRecord,
  ): Promise<VerificationVerdict> {
    const system = `You are Nemotron Super, the chief orchestrator. Verify a specialist's result.

Task objective: ${task.objective}
Task input context: ${task.inputContext}
Expected output shape: ${task.expectedOutput}
Specialist model: ${record.modelRole} (${record.modelId})

Review the specialist's response below and judge:
1. Accuracy - are the claims factually correct given the context?
2. Completeness - does it fully address the objective?
3. Logical consistency - no internal contradictions?
4. Relevance - is it on-topic for the request?

Respond ONLY with a JSON object:
{"accurate": boolean, "complete": boolean, "consistent": boolean, "relevant": boolean, "issues": [string], "confidence": 0-1}
`;
    const user = `Specialist response:\n${record.response}`;

    let raw = '';
    try {
      const res = await nemotronClient.chat({
        model: this.orchestrator,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        json: true,
      });
      raw = res.text;
    } catch (err: any) {
      return {
        taskId: record.taskId,
        accurate: false,
        complete: false,
        consistent: false,
        relevant: false,
        issues: [`Verification failed: ${err?.message || 'unknown error'}`],
        confidence: 0,
      };
    }

    const parsed = parseJson<VerdictShape>(raw);
    if (!parsed) {
      return {
        taskId: record.taskId,
        accurate: false,
        complete: false,
        consistent: false,
        relevant: false,
        issues: ['Verification response was not parseable JSON.'],
        confidence: 0.5,
      };
    }

    return {
      taskId: record.taskId,
      accurate: Boolean(parsed.accurate),
      complete: Boolean(parsed.complete),
      consistent: Boolean(parsed.consistent),
      relevant: Boolean(parsed.relevant),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    };
  }

  /**
   * Detect disagreements between two specialist results on the same task.
   */
  detectDisagreement(
    taskId: string,
    recordA: TaskRecord,
    recordB: TaskRecord,
  ): Disagreement | null {
    // Simple heuristic disagreement detection: if both completed but responses
    // differ significantly and neither is empty, flag for Super review.
    if (recordA.status !== 'completed' || recordB.status !== 'completed') return null;
    if (recordA.response === recordB.response) return null;
    const aLower = recordA.response.toLowerCase();
    const bLower = recordB.response.toLowerCase();
    const shared = aLower.split(' ').filter((w) => w.length > 4 && bLower.includes(w)).length;
    if (shared === 0 && recordA.response.length > 100 && recordB.response.length > 100) {
      return {
        taskId,
        modelA: recordA.modelRole,
        modelB: recordB.modelRole,
        issue: 'Specialist responses diverge significantly with little shared terminology.',
        evidenceA: recordA.response.slice(0, 300),
        evidenceB: recordB.response.slice(0, 300),
        resolved: false,
        resolution: '',
      };
    }
    return null;
  }

  /**
   * Ask the relevant specialist to reconsider its result given identified issues.
   */
  async askReconsideration(
    task: { taskId: string; objective: string; inputContext: string },
    record: TaskRecord,
    issues: string[],
  ): Promise<{ response: string; durationMs: number; model: string } | null> {
    const system = `You are ${record.modelRole}, a Nemotron specialist. Reconsider your previous answer.

Task: ${task.objective}
Previous answer: ${record.response}
Issues identified: ${issues.join('; ')}

Revise your answer to address the issues. Be concise.`;
    const startedAt = Date.now();
    try {
      const res = await nemotronClient.chat({
        model: { ...this.orchestrator, modelId: record.modelId },
        messages: [{ role: 'user', content: system }],
        temperature: 0.3,
      });
      return { response: res.text, durationMs: Date.now() - startedAt, model: res.model };
    } catch (err: any) {
      return null;
    }
  }

  /**
   * Escalate an unresolved disagreement to Ultra (if available) for independent
   * assessment. Falls back to Super's judgment if Ultra unavailable.
   */
  async escalateToUltra(
    task: { taskId: string; objective: string },
    disagreement: Disagreement,
  ): Promise<{ assessment: string; model: string; usedUltra: boolean }> {
    const model = this.ultra ?? this.orchestrator;
    const usedUltra = Boolean(this.ultra);
    const system = `You are Nemotron ${usedUltra ? 'Ultra' : 'Super'}, providing independent assessment.

Task: ${task.objective}

Two specialists disagreed:
- ${disagreement.modelA}: ${disagreement.evidenceA}
- ${disagreement.modelB}: ${disagreement.evidenceB}

Issue: ${disagreement.issue}

Provide an independent assessment resolving the disagreement. State which side is better supported and why, or propose a synthesis.`;
    try {
      const res = await nemotronClient.chat({
        model,
        messages: [{ role: 'user', content: system }],
        temperature: 0.2,
      });
      return { assessment: res.text, model: res.model, usedUltra };
    } catch (err: any) {
      return { assessment: `Escalation failed: ${err?.message || 'unknown error'}. Super makes final decision.`, model: model.modelId, usedUltra: false };
    }
  }

  /**
   * Full quality control over a set of task records. Returns verdicts, detected
   * disagreements, and whether revision is needed.
   */
  async runQualityControl(
    tasks: { taskId: string; objective: string; inputContext: string; expectedOutput: string }[],
    records: TaskRecord[],
  ): Promise<QualityControlResult> {
    const verified: VerificationVerdict[] = [];
    const disagreements: Disagreement[] = [];
    let needsRevision = false;

    for (const task of tasks) {
      const record = records.find((r) => r.taskId === task.taskId);
      if (!record) continue;
      const verdict = await this.verifyTask(task, record);
      verified.push(verdict);
      if (!verdict.accurate || !verdict.complete || !verdict.consistent || !verdict.relevant) {
        needsRevision = true;
      }
    }

    // Detect pairwise disagreements among completed records for the same task id.
    const completed = records.filter((r) => r.status === 'completed');
    for (let i = 0; i < completed.length; i++) {
      for (let j = i + 1; j < completed.length; j++) {
        const d = this.detectDisagreement(completed[i].taskId, completed[i], completed[j]);
        if (d) disagreements.push(d);
      }
    }

    let finalAssessment = `Verified ${verified.length} task(s). `;
    if (disagreements.length) {
      finalAssessment += `${disagreements.length} disagreement(s) detected and require resolution. `;
      needsRevision = true;
    }
    if (needsRevision) {
      finalAssessment += 'Revision recommended before final synthesis.';
    } else {
      finalAssessment += 'All results verified. Ready for synthesis.';
    }

    return { verified, disagreements, needsRevision, finalAssessment };
  }
}

interface VerdictShape {
  accurate: boolean;
  complete: boolean;
  consistent: boolean;
  relevant: boolean;
  issues: string[];
  confidence: number;
}

export function parseJson<T>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.search(/[[{]/);
  if (start > 0) text = text.slice(start);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end > -1) text = text.slice(0, end + 1);
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
