// Nemotron orchestration Express routes.
// Mounted in server.ts as /api/nemotron/* . Additive — existing routes untouched.

import express, { Request, Response } from 'express';
import { nemotronOrchestrator, OrchestrationRequest } from './orchestrator.ts';
import { executionLogger } from './logger.ts';
import { resultAggregator } from './results.ts';
import { listNemotronModels, isNemotronModelId, nemotronRoleForModel } from './registry.ts';
import { NEMOTRON_CONFIG } from './config.ts';
import { eventBus } from './events.ts';

const router = express.Router();
router.use(express.json());

// POST /api/nemotron/orchestrate — run a full multi-agent orchestration.
router.post('/orchestrate', async (req: Request, res: Response) => {
  const { requestId, userRequest, conversationHistory } = req.body || {};
  if (!userRequest || typeof userRequest !== 'string') {
    return res.status(400).json({ error: 'userRequest is required.' });
  }
  const id = requestId || `nemotron_${Date.now()}`;
  try {
    const result = await nemotronOrchestrator.orchestrate({
      requestId: id,
      userRequest,
      conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Orchestration failed.', requestId: id });
  }
});

// GET /api/nemotron/models — list configured Nemotron models and availability.
router.get('/models', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    models: listNemotronModels(),
    orchestrator: NEMOTRON_CONFIG.orchestrator.modelId,
  });
});

// GET /api/nemotron/logs/:requestId — execution log for a request.
router.get('/logs/:requestId', (req: Request, res: Response) => {
  const logs = executionLogger.getRequestLogs(req.params.requestId);
  return res.json({ success: true, requestId: req.params.requestId, logs });
});

// GET /api/nemotron/stream/:executionId — SSE real-time execution stream
router.get('/stream/:executionId', (req: Request, res: Response) => {
  const executionId = req.params.executionId;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const unsubscribe = eventBus.subscribe(executionId, (event) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  // Keep-alive ping
  const ping = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

// GET /api/nemotron/stream-all — SSE feed of events from every execution (Control Center).
router.get('/stream-all', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const unsubscribe = eventBus.subscribeAll((event) => {
    res.write(`data: ${JSON.stringify(event)}

`);
  });
  const ping = setInterval(() => res.write(`: ping

`), 15000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

// GET /api/nemotron/events?limit=300 — recent events across all executions.
router.get('/events', (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 300;
  return res.json({ success: true, events: eventBus.recent(limit) });
});

// GET /api/nemotron/executions — list all execution IDs
router.get('/executions', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    executions: eventBus.listExecutions(),
  });
});

// GET /api/nemotron/executions/:id — get execution details + history
router.get('/executions/:id', (req: Request, res: Response) => {
  const history = eventBus.getHistory(req.params.id);
  return res.json({
    success: true,
    executionId: req.params.id,
    events: history,
    summary: executionLogger.getSummary(req.params.id),
  });
});

// GET /api/nemotron/models/status — model health status
router.get('/models/status', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    orchestrator: {
      model: NEMOTRON_CONFIG.orchestrator.modelId,
      role: NEMOTRON_CONFIG.orchestrator.role,
      enabled: NEMOTRON_CONFIG.orchestrator.enabled,
      hasApiKey: Boolean(process.env.NEMOTRON_API_KEY),
      contextWindow: NEMOTRON_CONFIG.orchestrator.contextWindow,
      maxOutputTokens: NEMOTRON_CONFIG.orchestrator.maxOutputTokens,
    },
    specialists: listNemotronModels().map((m) => ({
      role: m.role,
      label: m.label,
      model: m.config.modelId,
      available: m.available,
      enabled: m.config.enabled,
      contextWindow: m.config.contextWindow,
      maxOutputTokens: m.config.maxOutputTokens,
      concurrencyLimit: m.config.concurrencyLimit,
    })),
  });
});

// GET /api/nemotron/metrics — execution metrics
router.get('/metrics', (_req: Request, res: Response) => {
  const summaries = executionLogger.allSummaries();
  const totalRequests = summaries.length;
  const completed = summaries.filter((s) => s.status === 'completed').length;
  const partial = summaries.filter((s) => s.status === 'partial').length;
  const failed = summaries.filter((s) => s.status === 'failed').length;
  const totalTokens = summaries.reduce(
    (acc, s) => ({
      input: acc.input + (s.totalTokens?.input ?? 0),
      output: acc.output + (s.totalTokens?.output ?? 0),
      total: acc.total + (s.totalTokens?.total ?? 0),
    }),
    { input: 0, output: 0, total: 0 },
  );
  const avgDuration = totalRequests > 0
    ? Math.round(summaries.reduce((acc, s) => acc + (s.durationMs ?? 0), 0) / totalRequests)
    : 0;
  return res.json({
    success: true,
    metrics: {
      totalRequests,
      completed,
      partial,
      failed,
      totalTokens,
      averageDurationMs: avgDuration,
      modelsUsed: [...new Set(summaries.flatMap((s) => s.modelsUsed))],
    },
  });
});

// GET /api/nemotron/logs — list recent request summaries.
router.get('/logs', (_req: Request, res: Response) => {
  return res.json({ success: true, requests: executionLogger.allSummaries() });
});

// GET /api/nemotron/status — orchestrator health / config status.
router.get('/status', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    orchestrator: {
      model: NEMOTRON_CONFIG.orchestrator.modelId,
      enabled: NEMOTRON_CONFIG.orchestrator.enabled,
      hasApiKey: Boolean(process.env.NEMOTRON_API_KEY),
    },
    specialists: listNemotronModels().map((m) => ({
      role: m.role,
      model: m.config.modelId,
      available: m.available,
    })),
    maxExecutionMs: NEMOTRON_CONFIG.maxExecutionMs,
    executionLogEnabled: NEMOTRON_CONFIG.enableExecutionLog,
  });
});

export const nemotronRouter = router;
