// Anthropic Messages API–compatible front end for the Nemotron orchestrator.
//
// Lets Claude Desktop / Claude Code (via CC Switch) use the orchestrator as an
// agentic model: point ANTHROPIC_BASE_URL at the gateway and it serves
// POST /v1/messages (streaming and non-streaming), /v1/messages/count_tokens
// and GET /v1/models.
//
// How a turn works:
//   - Nemotron Super is the agent. It sees the client's system prompt, history
//     and tools (Bash, Read, Edit, ...), translated to OpenAI chat format.
//   - It also gets one internal tool, `nemotron_delegate`. Calls to it never
//     reach the client: the gateway runs those subtasks on the Nemotron
//     specialists in parallel and feeds the results back to Super.
//   - When Super calls a client tool, the gateway returns Anthropic `tool_use`
//     blocks; the client runs the tool and sends `tool_result` next turn.
//
// The NVIDIA key comes from the request (Authorization: Bearer / x-api-key),
// falling back to NEMOTRON_API_KEY. It is never logged or echoed.

import express, { Request, Response, Router } from 'express';
import { randomUUID } from 'node:crypto';
import { NEMOTRON_CONFIG, NemotronModelConfig, nemotronApiKey, runWithNemotronApiKey } from './config.ts';
import { ParallelExecutionEngine, SubTask } from './parallel.ts';
import { estimateTokens } from './context.ts';
import { routeRequest, specialistKeysForText } from './routing.ts';
import { sleep, retryDelayMs } from './client.ts';
import { eventBus } from './events.ts';
import { executionLogger } from './logger.ts';

export const GATEWAY_MODEL_ID = 'nemotron-orchestrator';
const DELEGATE_TOOL = 'nemotron_delegate';

const ENV_NUM = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return process.env[name] && Number.isFinite(n) ? n : fallback;
};

// Max delegation rounds per client turn, output cap, upstream timeout.
const MAX_DELEGATION_ROUNDS = ENV_NUM('NEMOTRON_GATEWAY_MAX_DELEGATIONS', 3);
const MAX_OUTPUT_TOKENS = ENV_NUM('NEMOTRON_GATEWAY_MAX_OUTPUT', 16384);
const UPSTREAM_TIMEOUT_MS = ENV_NUM('NEMOTRON_GATEWAY_TIMEOUT_MS', 600_000);
const SPECIALIST_RESULT_CHARS = 12_000;
const RATE_LIMIT_RETRIES = ENV_NUM('NEMOTRON_RATE_LIMIT_RETRIES', 4);

// ---------------------------------------------------------------------------
// Types (only the fields we use)
// ---------------------------------------------------------------------------
type AnyBlock = Record<string, any>;
interface AnthropicMessage { role: 'user' | 'assistant'; content: string | AnyBlock[] }
interface AnthropicTool { name: string; description?: string; input_schema?: any; type?: string }
interface AnthropicRequest {
  model?: string;
  system?: string | AnyBlock[];
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  tool_choice?: { type: 'auto' | 'any' | 'tool' | 'none'; name?: string };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
}

type OAMessage = Record<string, any>;
type OATool = { type: 'function'; function: { name: string; description?: string; parameters: any } };

export interface AnthropicContentOut {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: any;
}

export interface GatewayTurnResult {
  content: AnthropicContentOut[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: { input_tokens: number; output_tokens: number };
  delegations: number;
  specialistFailures: number;
  specialistTasks: number;
}

class GatewayError extends Error {
  status: number;
  type: string;
  constructor(message: string, status = 500, type = 'api_error') {
    super(message);
    this.status = status;
    this.type = type;
  }
}

// ---------------------------------------------------------------------------
// Anthropic -> OpenAI chat translation
// ---------------------------------------------------------------------------
function blockText(content: any): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (b?.type === 'text') return b.text ?? '';
        if (b?.type === 'image') return '[image]';
        if (b?.type === 'document') return '[document]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(content);
}

function imagePart(block: AnyBlock): AnyBlock | null {
  const src = block?.source;
  if (!src) return null;
  if (src.type === 'base64' && src.data) {
    return { type: 'image_url', image_url: { url: `data:${src.media_type || 'image/png'};base64,${src.data}` } };
  }
  if (src.type === 'url' && src.url) return { type: 'image_url', image_url: { url: src.url } };
  return null;
}

export function systemText(system: AnthropicRequest['system']): string {
  return blockText(system as any);
}

export function toOpenAIMessages(messages: AnthropicMessage[]): OAMessage[] {
  const out: OAMessage[] = [];
  for (const m of messages || []) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const blocks = Array.isArray(m.content) ? m.content : [];

    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      const toolCalls = blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }));
      const msg: OAMessage = { role: 'assistant', content: text || (toolCalls.length ? null : '') };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
      continue;
    }

    // User turn: tool results become `tool` messages (must directly follow the
    // assistant tool_calls), the rest becomes one user message.
    for (const b of blocks) {
      if (b.type !== 'tool_result') continue;
      let text = blockText(b.content);
      if (b.is_error) text = `ERROR: ${text}`;
      out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: text || '(no output)' });
    }
    const parts: AnyBlock[] = [];
    for (const b of blocks) {
      if (b.type === 'text' && b.text) parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') {
        const p = imagePart(b);
        if (p) parts.push(p);
      } else if (b.type === 'document') {
        parts.push({ type: 'text', text: blockText(b.source?.data ? `[document: ${b.title || 'attachment'}]` : '[document]') });
      }
    }
    if (parts.length) {
      const allText = parts.every((p) => p.type === 'text');
      out.push({ role: 'user', content: allText ? parts.map((p) => p.text).join('\n') : parts });
    }
  }
  return out;
}

export function toOpenAITools(tools: AnthropicTool[] = []): OATool[] {
  return tools
    .filter((t) => t && t.name && t.input_schema) // skip server-side tools (web_search_*, etc.)
    .map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description || '', parameters: t.input_schema },
    }));
}

function toOpenAIToolChoice(choice: AnthropicRequest['tool_choice'], hasTools: boolean): any {
  if (!hasTools || !choice) return undefined;
  if (choice.type === 'any') return 'required';
  if (choice.type === 'none') return 'none';
  if (choice.type === 'tool' && choice.name) return { type: 'function', function: { name: choice.name } };
  return 'auto';
}

// ---------------------------------------------------------------------------
// Delegation tool (handled inside the gateway)
// ---------------------------------------------------------------------------
function enabledSpecialists(): [string, NemotronModelConfig][] {
  return Object.entries(NEMOTRON_CONFIG.specialists).filter(([, cfg]) => cfg.enabled);
}

function delegateTool(): OATool {
  const roles = enabledSpecialists().map(([key]) => key);
  return {
    type: 'function',
    function: {
      name: DELEGATE_TOOL,
      description:
        'Delegate self-contained thinking subtasks to Nemotron specialist models, which run them in parallel and return their answers to you. ' +
        'Specialists CANNOT see this conversation, the files, or any tools: put every fact, code snippet and file excerpt they need into "context". ' +
        'Good uses: several independent sub-problems at once, a hard reasoning/maths/design question, a second opinion on a plan or a diff, ' +
        'summarising or analysing text you already have. Do not delegate simple steps, and never delegate anything that needs to run a tool — do that yourself. ' +
        'Specialists: nano = general reasoning, summaries, routine coding; lightning = fast bulk transformation; bolt = small simple coding tasks; ' +
        'nano-omni = multimodal/OCR; ultra (if listed) = very hard reasoning only.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: {
              type: 'object',
              properties: {
                objective: { type: 'string', description: 'What the specialist must produce.' },
                specialist: { type: 'string', enum: roles },
                context: { type: 'string', description: 'All information the specialist needs. It sees nothing else.' },
              },
              required: ['objective', 'specialist', 'context'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  };
}

const GATEWAY_SYSTEM_NOTE = `

# Nemotron orchestrator
You are Nemotron Super, the chief orchestrator. You do NOT do specialist work yourself.
On any real user question, your FIRST action must be \`${DELEGATE_TOOL}\`. Call only the specialists that fit:
nano = text reasoning and summaries, lightning = data or bulk text, bolt = a small code fix only, nano-omni = an image, chart, audio, or video only, ultra = extremely hard math or reasoning only.
Do not call bolt, nano-omni, or ultra for an ordinary question.
Put every fact they need in "context". After their answers come back, you verify them and write the final reply or call the user's tools.
Do not answer a real question before the specialists have replied. Do not mention this mechanism unless the user asks.`;

function resolveSpecialist(key: string): NemotronModelConfig {
  const spec = (NEMOTRON_CONFIG.specialists as Record<string, NemotronModelConfig>)[key];
  if (spec?.enabled) return spec;
  const byRole = Object.values(NEMOTRON_CONFIG.specialists).find((s) => s.role === key && s.enabled);
  return byRole ?? enabledSpecialists()[0]?.[1] ?? NEMOTRON_CONFIG.orchestrator;
}

const ROLE_KEY: Record<string, string> = {
  'general-reasoning': 'nano',
  'high-throughput': 'lightning',
  'lightweight-autonomous': 'bolt',
  multimodal: 'nano-omni',
  'advanced-reasoning-escalation': 'ultra',
};

function latestUserText(req: AnthropicRequest): string {
  const msgs = req.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== 'user') continue;
    return blockText(msgs[i].content).trim();
  }
  return '';
}

function requestedDelegationPasses(text: string): number {
  const match = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:successive|consecutive)\s+)?(?:nemotron\s+)?(?:delegation|specialist|review|critique)\s+(?:passes?|rounds?)\b/i.exec(text);
  if (!match) return 0;
  const prefix = text.slice(0, match.index);
  if (/\b(?:up to|at most|no more than|maximum(?: of)?)\s*$/i.test(prefix)) return 0;
  const count = /^\d+$/.test(match[1]) ? Number(match[1]) : {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  }[match[1].toLowerCase() as 'one' | 'two' | 'three' | 'four' | 'five' | 'six' | 'seven' | 'eight' | 'nine' | 'ten'];
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function isToolResultOnlyTurn(req: AnthropicRequest): boolean {
  const last = req.messages?.[req.messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.content === 'string') return false;
  const blocks = Array.isArray(last.content) ? last.content : [];
  const hasTool = blocks.some((b) => b.type === 'tool_result');
  const hasText = blocks.some((b) => b.type === 'text' && String(b.text || '').trim());
  return hasTool && !hasText;
}

/** Real questions must reach specialists. Tool-result continuations and tiny chat stay with Super. */
export function shouldDispatchSpecialists(req: AnthropicRequest): boolean {
  if (req.tool_choice?.type === 'none' || req.tool_choice?.type === 'tool') return false;
  if (isToolResultOnlyTurn(req)) return false;
  const text = latestUserText(req);
  if (text.length < 24) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(text) && text.length < 48) return false;
  return enabledSpecialists().length > 0;
}

export async function specialistsForRequest(userText: string): Promise<string[]> {
  const routing = await routeRequest(userText);
  const enabled = new Set(enabledSpecialists().map(([key]) => key));
  return specialistKeysForText(userText, routing).filter((key) => enabled.has(key));
}

export async function autoDelegateArgs(userText: string, pass = 1, priorResults = ''): Promise<string> {
  const keys = await specialistsForRequest(userText);
  const clip = userText.slice(0, 4000);
  const reviewInstruction = pass > 1
    ? `Delegation pass ${pass}: critique and improve the prior specialist findings. Identify errors, omissions, and unresolved conflicts.`
    : '';
  const previous = pass > 1 && priorResults ? `Prior specialist results:\n${priorResults.slice(-4000)}` : '';
  return JSON.stringify({
    tasks: keys.map((specialist) => ({
      objective: pass === 1
        ? `Answer the part of this request that fits the ${specialist} specialist. Reply in a short paragraph.`
        : `Critique prior findings and answer the part of this request that fits the ${specialist} specialist. Reply in a short paragraph.`,
      specialist,
      context: [clip, reviewInstruction, previous].filter(Boolean).join('\n\n'),
    })),
  });
}

function keepNeededTasks(argsJson: string, allowed: string[]): string {
  let args: any;
  try { args = JSON.parse(argsJson || '{}'); } catch { return argsJson; }
  const list = Array.isArray(args?.tasks) ? args.tasks : [];
  const kept = list.filter((t: any) => allowed.includes(String(t?.specialist || '')));
  if (!kept.length) return argsJson;
  return JSON.stringify({ ...args, tasks: kept });
}

interface DelegationResult {
  text: string;
  failedTasks: number;
  totalTasks: number;
}

async function runDelegation(executionId: string, round: number, argsJson: string): Promise<DelegationResult> {
  let args: any;
  try {
    args = JSON.parse(argsJson || '{}');
  } catch {
    return { text: 'ERROR: arguments were not valid JSON. Call nemotron_delegate again with {"tasks":[{objective, specialist, context}]} .', failedTasks: 1, totalTasks: 1 };
  }
  const list: any[] = Array.isArray(args?.tasks) ? args.tasks.slice(0, 6) : [];
  if (!list.length) return { text: 'ERROR: no tasks given.', failedTasks: 1, totalTasks: 1 };

  const tasks: SubTask[] = list.map((t, i) => {
    const model = resolveSpecialist(String(t?.specialist || 'nano'));
    const cap = model.role === 'advanced-reasoning-escalation' ? 45_000 : model.timeoutMs;
    const bounded = { ...model, timeoutMs: Math.min(model.timeoutMs, cap) };
    const objective = String(t?.objective || '').trim() || 'Answer the task.';
    const context = String(t?.context || '').trim();
    return {
      id: `r${round}-t${i + 1}`,
      objective,
      requiredExpertise: model.role,
      preferredModel: bounded,
      fallbackModels: [],
      // The parallel engine only sends inputContext to the model, so the
      // objective and expectations must be inside it.
      inputContext: [
        `You are a Nemotron specialist (${model.role}). Complete this subtask for the orchestrator.`,
        `Objective: ${objective}`,
        context ? `Context:\n${context}` : '',
        'Answer directly and completely. State any assumptions or uncertainty.',
      ].filter(Boolean).join('\n\n'),
      expectedOutput: 'A complete answer to the objective.',
      completionCriteria: ['Addresses the objective fully.'],
      dependencies: [],
      roleSpecificInstructions: '',
    };
  });

  for (const t of tasks) {
    eventBus.emit({ executionId, type: 'task_created', taskId: t.id, modelId: t.preferredModel.modelId, message: `Task: ${t.objective.slice(0, 80)}` });
    eventBus.emit({ executionId, type: 'agent_assigned', taskId: t.id, modelId: t.preferredModel.modelId, message: `Assigned ${t.preferredModel.role} to ${t.id}` });
  }
  executionLogger.log({ requestId: executionId, event: 'delegate', message: `Delegation round ${round}: ${tasks.length} subtask(s).`, data: { taskIds: tasks.map((t) => t.id) } });

  for (const t of tasks) {
    eventBus.emit({ executionId, type: 'agent_started', taskId: t.id, modelId: t.preferredModel.modelId, message: `${t.preferredModel.role} is working on ${t.id}` });
  }
  const engine = new ParallelExecutionEngine();
  const results = await engine.execute(tasks, {
    concurrency: Math.min(6, tasks.length),
    timeoutMs: NEMOTRON_CONFIG.defaultTimeoutMs,
    maxRetries: 1,
  });

  for (const r of results) {
    eventBus.emit({
      executionId,
      type: r.status === 'completed' ? 'agent_completed' : 'agent_failed',
      taskId: r.taskId,
      modelId: r.modelId,
      status: r.status,
      message: `${r.modelRole}: ${r.status}${r.error ? ' - ' + r.error : ''}`,
      metrics: { latencyMs: r.durationMs, inputTokens: r.tokens?.input, outputTokens: r.tokens?.output },
    });
  }
  executionLogger.log({
    requestId: executionId,
    event: 'execute',
    message: `Round ${round}: ${results.filter((r) => r.status === 'completed').length}/${results.length} subtask(s) completed.`,
  });

  const text = results
    .map((r, i) => {
      const head = `### ${r.taskId} — ${r.modelRole} (${r.modelId}) — ${r.status}`;
      const obj = `Objective: ${tasks[i].objective}`;
      const body = r.status === 'completed'
        ? r.response.length > SPECIALIST_RESULT_CHARS ? r.response.slice(0, SPECIALIST_RESULT_CHARS) + '\n[truncated]' : r.response
        : `FAILED: ${r.error || 'unknown error'}`;
      return `${head}\n${obj}\n\n${body}`;
    })
    .join('\n\n---\n\n');
  return { text, failedTasks: results.filter((r) => r.status !== 'completed').length, totalTasks: results.length };
}

// ---------------------------------------------------------------------------
// Upstream call to Nemotron Super (OpenAI-compatible chat/completions)
// ---------------------------------------------------------------------------
async function callSuper(body: Record<string, any>): Promise<any> {
  const model = NEMOTRON_CONFIG.orchestrator;
  const apiKey = nemotronApiKey(model);
  if (!apiKey) {
    throw new GatewayError(
      'No NVIDIA API key. Put your NVIDIA key in the CC Switch provider token (sent as Authorization: Bearer) or set NEMOTRON_API_KEY.',
      401,
      'authentication_error',
    );
  }
  let res: globalThis.Response;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(model.timeoutMs, UPSTREAM_TIMEOUT_MS));
    try {
      res = await fetch(`${model.endpoint}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: model.modelId, stream: false, ...body }),
        signal: controller.signal,
      });
    } catch (err: any) {
      const message = `Network error calling Nemotron Super (${model.modelId}): ${err?.message || 'request failed'}`;
      if (attempt >= RATE_LIMIT_RETRIES || err?.name === 'AbortError') throw new GatewayError(message, 502);
      await sleep(retryDelayMs({ headers: { get: () => null } }, attempt));
      continue;
    } finally {
      clearTimeout(timer);
    }
    // Retry rate limits and transient upstream overloads before failing the turn.
    if (![429, 502, 503, 504].includes(res.status) || attempt >= RATE_LIMIT_RETRIES) break;
    await sleep(retryDelayMs(res, attempt));
  }
  const raw = await res.text();
  let data: any = null;
  try { data = JSON.parse(raw); } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = data?.error?.message || data?.detail || data?.error || raw.slice(0, 400) || `HTTP ${res.status}`;
    const status = res.status === 401 || res.status === 403 ? res.status : res.status === 429 ? 429 : res.status >= 500 ? 502 : 400;
    const type = status === 429 ? 'rate_limit_error' : status === 401 || status === 403 ? 'authentication_error' : status === 400 ? 'invalid_request_error' : 'api_error';
    throw new GatewayError(`Nemotron Super (${model.modelId}): ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, status, type);
  }
  if (!data?.choices?.[0]) throw new GatewayError(`Nemotron Super (${model.modelId}) returned no choices.`, 502);
  return data;
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}

function parseArgs(raw: any): any {
  if (raw && typeof raw === 'object') return raw;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { _raw_arguments: String(raw) }; }
}

// ---------------------------------------------------------------------------
// One client turn: Super loop with internal delegation
// ---------------------------------------------------------------------------
export async function runGatewayTurn(req: AnthropicRequest, executionId: string): Promise<GatewayTurnResult> {
  if (!Array.isArray(req.messages) || req.messages.length === 0) {
    throw new GatewayError('messages: at least one message is required.', 400, 'invalid_request_error');
  }

  const clientTools = toOpenAITools(req.tools);
  const requestedRounds = requestedDelegationPasses(latestUserText(req));
  const enforcedRounds = Math.min(requestedRounds, MAX_DELEGATION_ROUNDS);
  const multiPassNote = requestedRounds > 0
    ? `\n\nThis request requires ${enforcedRounds} successive Nemotron delegation passes. In pass one, delegate independent analysis; in each later pass, delegate critique and revision using the prior results. Do not provide a final answer until all required passes return.${requestedRounds > enforcedRounds ? ` The request asks for ${requestedRounds} passes, but the configured limit is ${enforcedRounds}.` : ''}`
    : '';
  const system = systemText(req.system) + GATEWAY_SYSTEM_NOTE + multiPassNote;
  const convo: OAMessage[] = [{ role: 'system', content: system }, ...toOpenAIMessages(req.messages)];
  const maxTokens = Math.max(256, Math.min(req.max_tokens || 8192, MAX_OUTPUT_TOKENS));
  const allowDelegation = enabledSpecialists().length > 0 && req.tool_choice?.type !== 'tool' && req.tool_choice?.type !== 'none';

  let inputTokens = 0;
  let outputTokens = 0;
  let delegations = 0;
  let specialistFailures = 0;
  let specialistTasks = 0;

  for (let round = 0; ; round++) {
    const canDelegate = allowDelegation && round < MAX_DELEGATION_ROUNDS && (!requestedRounds || round < enforcedRounds);
    const forceDelegate = canDelegate && (requestedRounds > 0 || (round === 0 && shouldDispatchSpecialists(req)));
    const tools = canDelegate ? [...clientTools, delegateTool()] : clientTools;
    const body: Record<string, any> = {
      messages: convo,
      max_tokens: maxTokens,
      temperature: req.temperature ?? NEMOTRON_CONFIG.orchestrator.temperature ?? 0.2,
    };
    if (req.top_p != null) body.top_p = req.top_p;
    if (req.stop_sequences?.length) body.stop = req.stop_sequences.slice(0, 4);
    if (tools.length) {
      body.tools = tools;
      if (forceDelegate) {
        body.tool_choice = { type: 'function', function: { name: DELEGATE_TOOL } };
      } else {
        const choice = toOpenAIToolChoice(req.tool_choice, clientTools.length > 0);
        if (choice !== undefined) body.tool_choice = choice;
      }
    }

    const superModel = NEMOTRON_CONFIG.orchestrator.modelId;
    const superTask = `super-r${round + 1}`;
    eventBus.emit({ executionId, type: 'agent_started', taskId: superTask, modelId: superModel, message: round === 0 ? 'Super is reading the request' : 'Super is reviewing specialist results' });
    const callStarted = Date.now();
    let data: any;
    try {
      data = await callSuper(body);
    } catch (err: any) {
      if (forceDelegate && body.tool_choice) {
        delete body.tool_choice;
        try {
          data = await callSuper(body);
        } catch (err2: any) {
          eventBus.emit({ executionId, type: 'agent_failed', taskId: superTask, modelId: superModel, status: 'failed', message: `Super: ${err2?.message || 'call failed'}`, metrics: { latencyMs: Date.now() - callStarted } });
          throw err2;
        }
      } else {
        eventBus.emit({ executionId, type: 'agent_failed', taskId: superTask, modelId: superModel, status: 'failed', message: `Super: ${err?.message || 'call failed'}`, metrics: { latencyMs: Date.now() - callStarted } });
        throw err;
      }
    }
    inputTokens += data.usage?.prompt_tokens ?? 0;
    outputTokens += data.usage?.completion_tokens ?? 0;
    const choice = data.choices[0];
    const msg = choice.message || {};
    const calls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    const delegateCalls = calls.filter((c) => c?.function?.name === DELEGATE_TOOL);
    const clientCalls = calls.filter((c) => c?.function?.name !== DELEGATE_TOOL);
    const decision = delegateCalls.length && canDelegate
      ? `Super delegates to specialists`
      : clientCalls.length
        ? `Super asks Claude Desktop to run ${clientCalls.map((c) => c.function?.name).join(', ')}`
        : 'Super wrote the answer';
    eventBus.emit({
      executionId, type: 'agent_completed', taskId: superTask, modelId: superModel, status: 'completed', message: decision,
      metrics: { latencyMs: Date.now() - callStarted, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
    });
    for (const c of clientCalls) {
      const argPreview = String(c.function?.arguments ?? '').replace(/\s+/g, ' ').slice(0, 120);
      eventBus.emit({ executionId, type: 'agent_progress', taskId: superTask, modelId: superModel, message: `Tool → ${c.function?.name} ${argPreview}` });
    }

    if (delegateCalls.length && canDelegate) {
      delegations++;
      // Keep only the delegate calls in history; Super re-issues any client
      // tool calls after it has the specialists' answers.
      const allowed = await specialistsForRequest(latestUserText(req));
      const filtered = delegateCalls.map((c) => ({ ...c, function: { ...c.function, arguments: keepNeededTasks(c.function?.arguments, allowed) } }));
      convo.push({ role: 'assistant', content: msg.content || null, tool_calls: filtered });
      const results = await Promise.all(filtered.map((c) => runDelegation(executionId, round + 1, c.function?.arguments)));
      filtered.forEach((c, i) => {
        specialistFailures += results[i].failedTasks;
        specialistTasks += results[i].totalTasks;
        convo.push({ role: 'tool', tool_call_id: c.id, content: results[i].text });
      });
      continue;
    }

    // Super often answers alone and never calls the delegate tool. Dispatch the
    // specialists ourselves so Claude Desktop turns actually use the other models.
    if (forceDelegate) {
      const priorResults = convo.filter((m) => m.role === 'tool').map((m) => String(m.content ?? '')).join('\n\n').slice(-4000);
      const args = await autoDelegateArgs(latestUserText(req), delegations + 1, priorResults);
      const callId = `call_auto_${executionId.slice(-8)}`;
      eventBus.emit({ executionId, type: 'agent_progress', taskId: superTask, modelId: superModel, message: 'Super did not call specialists; gateway dispatched them' });
      delegations++;
      convo.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: [{ id: callId, type: 'function', function: { name: DELEGATE_TOOL, arguments: args } }],
      });
      const result = await runDelegation(executionId, round + 1, args);
      specialistFailures += result.failedTasks;
      specialistTasks += result.totalTasks;
      convo.push({ role: 'tool', tool_call_id: callId, content: result.text });
      continue;
    }

    const content: AnthropicContentOut[] = [];
    let text = stripThinking(String(msg.content ?? ''));
    if (!text && !clientCalls.length) text = stripThinking(String(msg.reasoning_content ?? msg.reasoning ?? ''));
    if (text) content.push({ type: 'text', text });
    for (const c of clientCalls) {
      content.push({
        type: 'tool_use',
        id: c.id || `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        name: c.function?.name,
        input: parseArgs(c.function?.arguments),
      });
    }
    if (!content.length) content.push({ type: 'text', text: '' });

    const finish = choice.finish_reason;
    const stopReason: GatewayTurnResult['stopReason'] =
      clientCalls.length ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end_turn';
    const warnings: string[] = [];
    if (delegations < requestedRounds) {
      warnings.push(`Requested ${requestedRounds} delegation passes, but the gateway completed ${delegations}${requestedRounds > enforcedRounds ? ` of ${requestedRounds} because the configured cap is ${enforcedRounds}` : ''}.`);
    }
    if (specialistFailures > 0) warnings.push(`${specialistFailures} of ${specialistTasks} specialist tasks failed; the answer may be incomplete.`);
    if (warnings.length) {
      const warning = `Nemotron orchestration warning: ${warnings.join(' ')}`;
      const textBlock = content.find((block) => block.type === 'text');
      if (textBlock) textBlock.text = [textBlock.text, warning].filter(Boolean).join('\n\n');
      else content.push({ type: 'text', text: warning });
    }
    return {
      content,
      stopReason,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
      delegations,
      specialistFailures,
      specialistTasks,
    };
  }
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------
function requestApiKey(req: Request): string | undefined {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const xKey = String(req.headers['x-api-key'] || '').trim();
  const key = bearer || xKey;
  if (!key) return undefined;
  // If the client sent a dummy token and an env key exists, prefer the env key.
  if (!key.startsWith('nvapi-') && process.env.NEMOTRON_API_KEY) return undefined;
  return key;
}

function sendError(res: Response, err: any) {
  const status = err instanceof GatewayError ? err.status : 500;
  const type = err instanceof GatewayError ? err.type : 'api_error';
  res.status(status).json({ type: 'error', error: { type, message: err?.message || 'Gateway error' } });
}

function sse(res: Response, event: string, data: any) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function chunk(text: string, size = 400): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

export function createAnthropicRouter(): Router {
  const api = express.Router();
  api.use(express.json({ limit: '64mb' }));

  api.get('/models', (_req, res) => {
    const created = '2026-11-11T00:00:00Z';
    res.json({
      data: [{ type: 'model', id: GATEWAY_MODEL_ID, display_name: 'Nemotron Orchestrator', created_at: created }],
      has_more: false,
      first_id: GATEWAY_MODEL_ID,
      last_id: GATEWAY_MODEL_ID,
    });
  });

  api.get('/models/:id', (req, res) => {
    res.json({ type: 'model', id: req.params.id, display_name: 'Nemotron Orchestrator', created_at: '2026-11-11T00:00:00Z' });
  });

  api.post('/messages/count_tokens', (req, res) => {
    const body = req.body || {};
    const text = systemText(body.system) + JSON.stringify(body.messages || []) + JSON.stringify(body.tools || []);
    res.json({ input_tokens: estimateTokens(text) });
  });

  api.post('/messages', async (req: Request, res: Response) => {
    const body = (req.body || {}) as AnthropicRequest;
    const model = body.model || GATEWAY_MODEL_ID;
    const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const executionId = `gw_${Date.now()}_${messageId.slice(4, 12)}`;
    const apiKey = requestApiKey(req);
    const startedAt = Date.now();

    eventBus.emit({ executionId, type: 'execution_started', message: `Gateway turn (${(body.tools || []).length} client tools)` });

    const run = () => runWithNemotronApiKey(apiKey, () => runGatewayTurn(body, executionId));

    const finishLog = (r?: GatewayTurnResult) => {
      const status = !r ? 'failed' : r.specialistFailures > 0 ? 'partial' : 'completed';
      eventBus.emit({
        executionId,
        type: status === 'failed' ? 'error' : 'execution_completed',
        status,
        message: status === 'completed'
          ? `Gateway turn done (${r?.stopReason}, ${r?.delegations ?? 0} delegation round(s))`
          : status === 'partial'
            ? `Gateway turn partial (${r?.specialistFailures}/${r?.specialistTasks} specialist task(s) failed, ${r?.delegations ?? 0} delegation round(s))`
            : 'Gateway turn failed',
        metrics: {
          latencyMs: Date.now() - startedAt,
          inputTokens: r?.usage.input_tokens,
          outputTokens: r?.usage.output_tokens,
          failedTasks: r?.specialistFailures,
          totalTasks: r?.specialistTasks,
        },
      });
    };

    if (!body.stream) {
      try {
        const r = await run();
        finishLog(r);
        return res.json({
          id: messageId,
          type: 'message',
          role: 'assistant',
          model,
          content: r.content,
          stop_reason: r.stopReason,
          stop_sequence: null,
          usage: r.usage,
        });
      } catch (err: any) {
        finishLog();
        return sendError(res, err);
      }
    }

    // Streaming: open the stream at once and keep it alive with pings while
    // Super and the specialists work; then replay the result as SSE events.
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    res.on('close', () => { closed = true; });

    const estimatedInput = estimateTokens(systemText(body.system) + JSON.stringify(body.messages || []));
    sse(res, 'message_start', {
      type: 'message_start',
      message: {
        id: messageId, type: 'message', role: 'assistant', model, content: [],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: estimatedInput, output_tokens: 0 },
      },
    });
    const ping = setInterval(() => { if (!closed) sse(res, 'ping', { type: 'ping' }); }, 5000);

    try {
      const r = await run();
      clearInterval(ping);
      finishLog(r);
      if (closed) return;
      r.content.forEach((block, index) => {
        if (block.type === 'text') {
          sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
          for (const piece of chunk(block.text || '')) {
            sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
          }
        } else {
          sse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
          sse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input ?? {}) } });
        }
        sse(res, 'content_block_stop', { type: 'content_block_stop', index });
      });
      sse(res, 'message_delta', {
        type: 'message_delta',
        delta: { stop_reason: r.stopReason, stop_sequence: null },
        usage: { output_tokens: r.usage.output_tokens },
      });
      sse(res, 'message_stop', { type: 'message_stop' });
      res.end();
    } catch (err: any) {
      clearInterval(ping);
      finishLog();
      if (closed) return;
      const type = err instanceof GatewayError ? err.type : 'api_error';
      sse(res, 'error', { type: 'error', error: { type, message: err?.message || 'Gateway error' } });
      res.end();
    }
  });

  return api;
}
