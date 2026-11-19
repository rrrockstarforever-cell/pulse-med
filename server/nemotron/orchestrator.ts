// Nemotron Super orchestrator — chief orchestrator (Nemotron 3 Super 120B-A12B).
// Implements the 8-phase execution pipeline: understanding, decomposition,
// specialist selection, parallel execution, result collection, quality control,
// disagreement resolution, final synthesis.

import { NEMOTRON_CONFIG, NemotronModelConfig, nemotronApiKey } from './config.ts';
import { nemotronClient } from './client.ts';
import { routeRequest, TaskCategory, RoutingDecision, specialistKeysForText } from './routing.ts';
import { TaskContext, buildTaskContext, specialistMessages, compressContext } from './context.ts';
import { ParallelExecutionEngine, SubTask, SubTaskResult } from './parallel.ts';
import { resultAggregator, TaskRecord, AggregatedResult } from './results.ts';
import { VerificationModule, QualityControlResult } from './verify.ts';
import { executionLogger, ExecutionLogEntry, RequestSummary } from './logger.ts';
import { eventBus } from './events.ts';

export interface OrchestrationRequest {
  requestId: string;
  userRequest: string;
  conversationHistory?: string[];
}

export interface OrchestrationResult {
  requestId: string;
  originalRequest: string;
  category: TaskCategory;
  complexity: string;
  routingDecision: RoutingDecision;
  tasks: SubTask[];
  taskResults: SubTaskResult[];
  qualityControl: QualityControlResult;
  finalAnswer: string;
  status: 'completed' | 'partial' | 'failed';
  durationMs: number;
  executionLog: ExecutionLogEntry[];
}

const SUPER_SYSTEM = `You are Nemotron 3 Super 120B-A12B, the Chief Orchestrator of a multi-agent Nemotron system.

Your job: interpret the user's request, decompose it into subtasks, delegate to Nemotron
specialists, verify their results, resolve disagreements, and synthesize a final answer.

Available Nemotron specialists:
- Nemotron 3 Nano 30B-A3B: general reasoning, document processing, information extraction, summarization, classification, RAG, routine coding.
- Nemotron 3.5 Lightning 30B-A3B: high-throughput, fast repetitive operations, data transformation, background processing.
- Nemotron 3.5 Bolt: simple coding changes, routine development, basic debugging, tool orchestration, small tasks.
- Nemotron 3 Nano Omni: image, video, audio understanding, OCR, multimodal QA.
- Nemotron 3 Ultra 550B-A55B: advanced reasoning, hard math, complex science, difficult programming, long-horizon planning (optional escalation only).

Rules:
- Only Nemotron models participate as agents. Never use DeepSeek, Claude, GPT, Qwen, GLM, or any non-Nemotron model.
- You control all delegation. Specialists must not independently create recursive agent chains.
- Prefer parallel execution for independent tasks.
- Ultra is optional escalation — only for exceptionally difficult tasks.
- Do not blindly trust specialist outputs; verify accuracy, completeness, consistency, relevance.
- When models disagree: identify the disagreement, compare evidence, ask a specialist to reconsider, get an independent assessment, escalate to Ultra if available, then you decide.
- Do not use majority voting as the only verification method.
- Return structured JSON only when asked.
`;

// Role-specific instructions appended to each specialist's system prompt.
const ROLE_INSTRUCTIONS: Record<string, string> = {
  'general-reasoning': 'Perform general reasoning: extract key facts, reason step by step, summarize, classify, and produce structured insights. Be accurate and cite reasoning.',
  'high-throughput': 'Process high-volume data efficiently: transform, filter, aggregate, and summarize large inputs quickly. Prioritize speed and throughput.',
  'lightweight-autonomous': 'Handle simple, routine tasks autonomously: small code changes, basic debugging, tool orchestration, lightweight planning. Act decisively.',
  multimodal: 'Analyze images, video, audio, and documents. Perform OCR, visual QA, and multimodal information extraction. Describe what you observe precisely.',
  'advanced-reasoning-escalation': 'Tackle extremely difficult reasoning: advanced mathematics, complex scientific analysis, hard programming problems, long-horizon planning. Show deep, step-by-step reasoning.',
};

export class NemotronOrchestrator {
  private engine = new ParallelExecutionEngine();
  private verifier: VerificationModule;

  constructor() {
    this.verifier = new VerificationModule(NEMOTRON_CONFIG.orchestrator, NEMOTRON_CONFIG.specialists.ultra);
  }

  async orchestrate(req: OrchestrationRequest): Promise<OrchestrationResult> {
    const startedAt = Date.now();
    const { requestId, userRequest, conversationHistory = [] } = req;

    const log = (event: ExecutionLogEntry['event'], message: string, data?: Record<string, any>) => {
      executionLogger.log({ requestId, event, message, data });
    };

    log('request', `Received request: ${userRequest.slice(0, 120)}...`, { requestId, userRequestLength: userRequest.length });
    eventBus.emit({ executionId: requestId, type: 'execution_started', message: 'Orchestration started' });

    // Check API keys are configured for at least the orchestrator.
    if (!nemotronApiKey(NEMOTRON_CONFIG.orchestrator)) {
      eventBus.emit({ executionId: requestId, type: 'error', message: 'Nemotron Super API key not configured' });
      throw new Error('Nemotron Super API key not configured. Set NEMOTRON_API_KEY (or NEMOTRON_SUPER_API_KEY).');
    }

    // PHASE 1: Request Understanding
    log('classify', 'Phase 1: Understanding the request.');
    const routing = await routeRequest(userRequest);
    log('classify', routing.rationale, { category: routing.category, complexity: routing.complexity });

    // PHASE 2: Task Decomposition (Super decides subtasks)
    log('decompose', 'Phase 2: Decomposing into subtasks.');
    const usage = { input: 0, output: 0, total: 0 };
    const addUsage = (t?: { input?: number; output?: number; total?: number }) => {
      if (!t) return;
      usage.input += t.input ?? 0;
      usage.output += t.output ?? 0;
      usage.total += t.total ?? ((t.input ?? 0) + (t.output ?? 0));
    };
    const tasks = await this.decompose(userRequest, routing, conversationHistory, log, addUsage);
    log('decompose', `Decomposed into ${tasks.length} subtask(s).`, { taskCount: tasks.length, taskIds: tasks.map((t) => t.id) });
    for (const t of tasks) {
      eventBus.emit({ executionId: requestId, type: 'task_created', taskId: t.id, modelId: t.preferredModel.modelId, message: `Task: ${t.objective.slice(0, 80)}` });
    }

    // PHASE 3 & 4: Specialist selection + parallel execution
    log('delegate', 'Phase 3-4: Selecting specialists and executing in parallel.');
    for (const t of tasks) {
      eventBus.emit({ executionId: requestId, type: 'agent_assigned', taskId: t.id, modelId: t.preferredModel.modelId, message: `Assigned ${t.preferredModel.role} to ${t.id}` });
    }
    const taskResults = await this.engine.execute(tasks, {
      concurrency: Math.min(5, tasks.length),
      timeoutMs: NEMOTRON_CONFIG.defaultTimeoutMs,
      maxRetries: 2,
    });
    for (const r of taskResults) {
      eventBus.emit({
        executionId: requestId,
        type: r.status === 'completed' ? 'agent_completed' : 'agent_failed',
        taskId: r.taskId,
        modelId: r.modelId,
        status: r.status,
        message: `${r.modelRole}: ${r.status}${r.error ? ' - ' + r.error : ''}`,
        metrics: { latencyMs: r.durationMs, inputTokens: r.tokens?.input, outputTokens: r.tokens?.output },
      });
    }
    log('execute', `Executed ${taskResults.length} task(s): ${taskResults.filter((r) => r.status === 'completed').length} completed, ${taskResults.filter((r) => r.status === 'failed').length} failed.`, {
      completed: taskResults.filter((r) => r.status === 'completed').length,
      failed: taskResults.filter((r) => r.status === 'failed').length,
    });

    // Build TaskRecord list from SubTaskResult for aggregation/verification.
    const records: TaskRecord[] = taskResults.map((r) => ({
      taskId: r.taskId,
      modelId: r.modelId,
      modelRole: r.modelRole,
      category: routing.category,
      response: r.response,
      durationMs: r.durationMs,
      tokens: r.tokens,
      costUsd: undefined,
      status: r.status,
      error: r.error,
      retries: r.retries,
    }));
    records.forEach((r) => resultAggregator.add(r));
    taskResults.forEach((r) => addUsage(r.tokens));

    // PHASE 5: Result Collection (already aggregated above)

    // PHASE 6: Quality Control
    log('verify', 'Phase 6: Quality control — verifying specialist results.');
    eventBus.emit({ executionId: requestId, type: 'verification_started', message: 'Quality control started' });
    const taskSpecs = tasks.map((t) => ({
      taskId: t.id,
      objective: t.objective,
      inputContext: t.inputContext,
      expectedOutput: t.expectedOutput,
    }));
    const qc = await this.verifier.runQualityControl(taskSpecs, records);
    eventBus.emit({ executionId: requestId, type: 'verification_completed', message: qc.finalAssessment, status: qc.needsRevision ? 'needs_revision' : 'verified' });
    log('verify', qc.finalAssessment, { verified: qc.verified.length, disagreements: qc.disagreements.length, needsRevision: qc.needsRevision });

    // PHASE 7: Disagreement Resolution
    log('resolve', 'Phase 7: Disagreement resolution.');
    if (qc.disagreements.length) {
      for (const d of qc.disagreements) {
        const escalated = await this.verifier.escalateToUltra(
          { taskId: d.taskId, objective: tasks.find((t) => t.id === d.taskId)?.objective ?? '' },
          d,
        );
        d.resolved = true;
        d.resolution = escalated.assessment;
        log('resolve', `Resolved disagreement via ${escalated.usedUltra ? 'Ultra' : 'Super'}: ${d.taskId}`, { model: escalated.model, usedUltra: escalated.usedUltra });
      }
    }

    // PHASE 8: Final Synthesis by Super
    log('synthesize', 'Phase 8: Final synthesis by Nemotron Super.');
    const synthesis = await this.synthesize(userRequest, tasks, taskResults, qc, routing);
    addUsage(synthesis.tokens);
    const finalAnswer = synthesis.text;
    if (synthesis.ok) {
      log('synthesize', 'Final answer synthesized.');
    } else {
      log('error', `Final synthesis failed; returning raw specialist results. ${synthesis.error ?? ''}`.trim());
    }

    const anyFailed = taskResults.some((r) => r.status !== 'completed');
    const allFailed = taskResults.length > 0 && taskResults.every((r) => r.status !== 'completed');
    const status: OrchestrationResult['status'] = allFailed && !synthesis.ok
      ? 'failed'
      : anyFailed || !synthesis.ok ? 'partial' : 'completed';

    const durationMs = Date.now() - startedAt;
    executionLogger.setSummary({
      requestId,
      originalRequest: userRequest,
      category: routing.category,
      complexity: routing.complexity,
      status,
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs,
      modelsUsed: [...new Set(taskResults.map((r) => r.modelId))],
      totalTokens: usage,
    });

    eventBus.emit({
      executionId: requestId,
      type: 'execution_completed',
      status,
      message: status === 'completed' ? 'Orchestration completed' : `Orchestration ${status}`,
      metrics: { latencyMs: durationMs, inputTokens: usage.input, outputTokens: usage.output },
    });

    return {
      requestId,
      originalRequest: userRequest,
      category: routing.category,
      complexity: routing.complexity,
      routingDecision: routing,
      tasks,
      taskResults,
      qualityControl: qc,
      finalAnswer,
      status,
      durationMs,
      executionLog: executionLogger.getRequestLogs(requestId),
    };
  }

  // ------------------------------------------------------------------
  // Phase 2: Task Decomposition — Super decides subtasks and assignments.
  // ------------------------------------------------------------------
  private async decompose(
    userRequest: string,
    routing: RoutingDecision,
    history: string[],
    log: (event: ExecutionLogEntry['event'], message: string, data?: Record<string, any>) => void = () => {},
    addUsage: (t?: { input?: number; output?: number; total?: number }) => void = () => {},
  ): Promise<SubTask[]> {
    // For simple requests, avoid unnecessary decomposition — Super handles it directly.
    if (routing.complexity === 'low' && !routing.needsParallel && !routing.needsUltra) {
      return [
        {
          id: 'task-1',
          objective: `Answer the user's request directly: ${userRequest}`,
          requiredExpertise: routing.preferredModel.role,
          preferredModel: routing.preferredModel,
          fallbackModels: routing.fallbackModels,
          inputContext: userRequest,
          expectedOutput: 'A complete, accurate answer to the user\'s request.',
          completionCriteria: ['Fully addresses the user request', 'Accurate and relevant'],
          dependencies: [],
          roleSpecificInstructions: ROLE_INSTRUCTIONS[routing.preferredModel.role] ?? 'Answer the user request accurately.',
        },
      ];
    }

    // For complex requests, ask Super to decompose into subtasks.
    const decomposePrompt = [
      SUPER_SYSTEM,
      '',
      'User request:',
      userRequest,
      '',
      `Routing decision: category=${routing.category}, complexity=${routing.complexity}`,
      `Rationale: ${routing.rationale}`,
      '',
      'Available Nemotron specialist models (choose appropriate ones):',
      ...NEMOTRON_CONFIG.specialists && Object.entries(NEMOTRON_CONFIG.specialists).map(([role, cfg]) => `- ${role}: ${cfg.modelId} (${cfg.contextWindow} token context)`),
      '',
      'Decompose this request into independent subtasks. For each subtask specify:',
      '1. task id',
      '2. objective',
      '3. required expertise (match a specialist role)',
      '4. preferred model (orchestrator / general-reasoning / high-throughput / lightweight-autonomous / multimodal / advanced-reasoning-escalation)',
      '5. input context (what the specialist needs)',
      '6. expected output',
      '7. completion criteria',
      '8. dependencies (task ids this depends on, or none)',
      '',
      'Return ONLY a JSON object: {"tasks":[{...}]}',
    ].join('\n');

    let raw = '';
    try {
      const res = await nemotronClient.chat({
        model: NEMOTRON_CONFIG.orchestrator,
        messages: [{ role: 'user', content: decomposePrompt }],
        temperature: 0.3,
        json: true,
      });
      raw = res.text;
      addUsage(res.tokens);
    } catch (err: any) {
      // Fallback: single task to the preferred model.
      log('error', `Decomposition call failed, using a single task: ${err?.message || 'unknown error'}`);
      return [this.fallbackTask(userRequest, routing.needsUltra ? this.ultraIfEnabled() ?? routing.preferredModel : routing.preferredModel)];
    }

    const parsed = this.parseDecomposition(raw);
    if (!parsed || parsed.length === 0) {
      log('error', 'Decomposition reply had no usable task list, using a single task.', { rawPreview: raw.slice(0, 300) });
      return [this.fallbackTask(userRequest, routing.needsUltra ? this.ultraIfEnabled() ?? routing.preferredModel : routing.preferredModel)];
    }

    const tasks = parsed.map((t, i) => ({
      id: t.id || `task-${i + 1}`,
      objective: t.objective ?? userRequest,
      requiredExpertise: t.requiredExpertise ?? routing.preferredModel.role,
      preferredModel: this.resolveModel(t.preferredModel ?? routing.preferredModel.role),
      fallbackModels: routing.fallbackModels,
      inputContext: t.inputContext ?? userRequest,
      expectedOutput: t.expectedOutput ?? 'A complete answer to the subtask objective.',
      completionCriteria: Array.isArray(t.completionCriteria) ? t.completionCriteria : ['Addresses the objective'],
      dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
      roleSpecificInstructions: ROLE_INSTRUCTIONS[t.requiredExpertise ?? routing.preferredModel.role] ?? 'Complete the subtask accurately.',
    }));
    return this.ensureUltraTask(this.spreadIfAllOrchestrator(tasks, routing), userRequest, routing);
  }

  /** If Super keeps every subtask for itself, spread them across the specialists. */
  private spreadIfAllOrchestrator(tasks: SubTask[], routing: RoutingDecision): SubTask[] {
    if (!routing.needsParallel || tasks.length === 0) return tasks;
    const superId = NEMOTRON_CONFIG.orchestrator.modelId;
    const allSuper = tasks.every((t) => t.preferredModel.role === 'orchestrator' || t.preferredModel.modelId === superId);
    if (!allSuper) return tasks;
    const specs = specialistKeysForText(tasks[0]?.inputContext || tasks[0]?.objective || '', routing)
      .map((key) => NEMOTRON_CONFIG.specialists[key])
      .filter((s) => s?.enabled && s.role !== 'advanced-reasoning-escalation');
    if (!specs.length) return tasks;
    return tasks.map((t, i) => {
      const model = specs[i % specs.length];
      return { ...t, preferredModel: model, requiredExpertise: model.role, fallbackModels: [], roleSpecificInstructions: ROLE_INSTRUCTIONS[model.role] ?? t.roleSpecificInstructions };
    });
  }

  /** Hard problems must actually reach Ultra, not only set a flag that nothing reads. */
  private ultraIfEnabled(): NemotronModelConfig | undefined {
    const ultra = NEMOTRON_CONFIG.specialists.ultra;
    return ultra?.enabled ? ultra : undefined;
  }

  private ensureUltraTask(tasks: SubTask[], userRequest: string, routing: RoutingDecision): SubTask[] {
    const ultra = this.ultraIfEnabled();
    if (!routing.needsUltra || !ultra) return tasks;
    if (tasks.some((t) => t.preferredModel.role === ultra.role || t.preferredModel.modelId === ultra.modelId)) return tasks;
    tasks.push({
      id: 'task-ultra',
      objective: `Solve the hardest part of the request with deep reasoning: ${userRequest}`,
      requiredExpertise: ultra.role,
      preferredModel: ultra,
      fallbackModels: [],
      inputContext: userRequest,
      expectedOutput: 'A careful, step-by-step answer to the hardest part of the request.',
      completionCriteria: ['Addresses the hardest part', 'Shows the reasoning'],
      dependencies: [],
      roleSpecificInstructions: ROLE_INSTRUCTIONS[ultra.role],
    });
    return tasks;
  }

  private fallbackTask(userRequest: string, model: NemotronModelConfig): SubTask {
    return {
      id: 'task-1',
      objective: userRequest,
      requiredExpertise: model.role,
      preferredModel: model,
      fallbackModels: [],
      inputContext: userRequest,
      expectedOutput: 'A complete, accurate answer.',
      completionCriteria: ['Fully addresses the request'],
      dependencies: [],
      roleSpecificInstructions: ROLE_INSTRUCTIONS[model.role] ?? 'Complete the task accurately.',
    };
  }

  private resolveModel(role: string): NemotronModelConfig {
    // Look up by role first (e.g. 'general-reasoning' -> nano config).
    const byRole = Object.values(NEMOTRON_CONFIG.specialists).find((s) => s.role === role && s.enabled);
    if (byRole) return byRole;
    // Allow a short key (e.g. 'nano') to resolve directly.
    const byKey = NEMOTRON_CONFIG.specialists[role as keyof typeof NEMOTRON_CONFIG.specialists];
    if (byKey && byKey.enabled) return byKey;
    if (NEMOTRON_CONFIG.orchestrator.role === role) return NEMOTRON_CONFIG.orchestrator;
    // Fall back to the orchestrator if the requested specialist is disabled/inaccessible.
    return NEMOTRON_CONFIG.orchestrator;
  }

  private parseDecomposition(raw: string): any[] | null {
    if (!raw) return null;
    // Reasoning models often write their thinking before the JSON.
    let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();
    // Prefer the object that holds "tasks", even if prose with braces comes first.
    const tasksAt = text.search(/\{\s*"tasks"\s*:/);
    if (tasksAt >= 0) {
      const end = text.lastIndexOf('}');
      for (let e = end; e > tasksAt; e = text.lastIndexOf('}', e - 1)) {
        try {
          const obj = JSON.parse(text.slice(tasksAt, e + 1));
          if (obj && Array.isArray(obj.tasks)) return obj.tasks;
        } catch { /* try a shorter slice */ }
      }
    }
    const start = text.search(/[[{]/);
    if (start < 0) return null;
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (end < 0) return null;
    const slice = text.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (parsed && Array.isArray(parsed.tasks)) return parsed.tasks;
      if (Array.isArray(parsed)) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------
  // Phase 8: Final Synthesis by Super.
  // ------------------------------------------------------------------
  private async synthesize(
    userRequest: string,
    tasks: SubTask[],
    results: SubTaskResult[],
    qc: QualityControlResult,
    routing: RoutingDecision,
  ): Promise<{ text: string; ok: boolean; error?: string; tokens?: { input?: number; output?: number; total?: number } }> {
    const completed = results.filter((r) => r.status === 'completed');
    const failed = results.filter((r) => r.status === 'failed');

    const resultsSummary = completed
      .map((r) => {
        const t = tasks.find((x) => x.id === r.taskId);
        return `## Subtask: ${t?.objective || r.taskId}\nModel: ${r.modelRole} (${r.modelId})\nResult: ${r.response}\n`;
      })
      .join('\n---\n');

    const failedSummary = failed.length
      ? `\nFailed subtasks:\n${failed.map((r) => `- ${r.taskId} (${r.modelRole}): ${r.error || 'unknown error'}`).join('\n')}`
      : '';

    const qcSummary = qc.verified
      .map((v) => `- ${v.taskId}: accurate=${v.accurate}, complete=${v.complete}, consistent=${v.consistent}, relevant=${v.relevant}, confidence=${v.confidence}`)
      .join('\n');

    const system = `${SUPER_SYSTEM}

You are now in the FINAL SYNTHESIS phase. Combine the verified specialist results into ONE final answer for the user.

Guidelines:
- Combine verified findings, remove duplication, resolve contradictions.
- Preserve important technical details.
- Disclose any remaining uncertainty or failed subtasks.
- Speak directly to the user as Nemotron Super.
- Do not expose internal chain-of-thought; give a concise, useful final answer.

Routing context: category=${routing.category}, complexity=${routing.complexity}. ${routing.rationale}

Quality control summary:
${qcSummary}

Specialist results:
${resultsSummary}
${failedSummary}
`;
    const user = `Original user request: ${userRequest}\n\nProduce the final answer now.`;

    try {
      const res = await nemotronClient.chat({
        model: NEMOTRON_CONFIG.orchestrator,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        maxOutputTokens: NEMOTRON_CONFIG.orchestrator.maxOutputTokens,
      });
      return { text: res.text, ok: true, tokens: res.tokens };
    } catch (err: any) {
      // Graceful degradation: if synthesis fails, present the raw results.
      const text = `I encountered an error while synthesizing the final answer (${err?.message || 'unknown error'}).\n\nHere are the specialist results directly:\n\n${resultsSummary}${failedSummary}`;
      return { text, ok: false, error: err?.message || 'unknown error' };
    }
  }
}

export const nemotronOrchestrator = new NemotronOrchestrator();
