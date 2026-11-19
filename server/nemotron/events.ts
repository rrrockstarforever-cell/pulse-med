// Real-time SSE event system for Nemotron orchestration.
// Pushes execution updates to browser clients as they happen.
// Events are buffered per executionId so reconnecting clients can recover.

export type OrchestrationEventType =
  | "execution_started"
  | "task_created"
  | "agent_assigned"
  | "agent_started"
  | "agent_progress"
  | "agent_completed"
  | "agent_failed"
  | "verification_started"
  | "verification_completed"
  | "execution_completed"
  | "error";

export interface OrchestrationEvent {
  executionId: string;
  eventId: string;
  timestamp: string;
  type: OrchestrationEventType;
  modelId?: string;
  taskId?: string;
  status?: string;
  message?: string;
  metrics?: {
    latencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    failedTasks?: number;
    totalTasks?: number;
  };
}

type ClientCallback = (event: OrchestrationEvent) => void;

class OrchestrationEventBus {
  private buffers = new Map<string, OrchestrationEvent[]>();
  private clients = new Map<string, Set<ClientCallback>>();
  private maxBuffer = 500;
  // Subscribers to every execution (Control Center live feed) + a global ring buffer.
  private globalClients = new Set<ClientCallback>();
  private recentEvents: OrchestrationEvent[] = [];
  private maxRecent = 1000;

  emit(event: Omit<OrchestrationEvent, "eventId" | "timestamp">): OrchestrationEvent {
    const full: OrchestrationEvent = {
      ...event,
      eventId: `${event.executionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };

    // Buffer for reconnection recovery
    const buf = this.buffers.get(event.executionId) ?? [];
    buf.push(full);
    if (buf.length > this.maxBuffer) buf.shift();
    this.buffers.set(event.executionId, buf);

    this.recentEvents.push(full);
    if (this.recentEvents.length > this.maxRecent) this.recentEvents.shift();
    for (const cb of this.globalClients) {
      try { cb(full); } catch { /* client disconnected */ }
    }

    // Push to connected clients
    const subs = this.clients.get(event.executionId);
    if (subs) {
      for (const cb of subs) {
        try { cb(full); } catch { /* client disconnected */ }
      }
    }

    return full;
  }

  subscribe(executionId: string, cb: ClientCallback): () => void {
    const subs = this.clients.get(executionId) ?? new Set();
    subs.add(cb);
    this.clients.set(executionId, subs);

    // Replay buffered events to new subscriber
    const buf = this.buffers.get(executionId);
    if (buf) {
      for (const ev of buf) cb(ev);
    }

    return () => {
      const s = this.clients.get(executionId);
      if (s) {
        s.delete(cb);
        if (s.size === 0) this.clients.delete(executionId);
      }
    };
  }

  /** Subscribe to events from every execution. */
  subscribeAll(cb: ClientCallback): () => void {
    this.globalClients.add(cb);
    return () => { this.globalClients.delete(cb); };
  }

  /** Most recent events across all executions, oldest first. */
  recent(limit = 300): OrchestrationEvent[] {
    return this.recentEvents.slice(-Math.max(1, Math.min(limit, this.maxRecent)));
  }

  getHistory(executionId: string): OrchestrationEvent[] {
    return this.buffers.get(executionId) ?? [];
  }

  listExecutions(): string[] {
    return [...this.buffers.keys()];
  }

  clear(executionId?: string): void {
    if (executionId) {
      this.buffers.delete(executionId);
      this.clients.delete(executionId);
    } else {
      this.buffers.clear();
      this.clients.clear();
    }
  }
}

export const eventBus = new OrchestrationEventBus();
