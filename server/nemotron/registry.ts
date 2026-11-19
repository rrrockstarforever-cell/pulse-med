// Nemotron-only model registry.
// Every entry is an NVIDIA Nemotron model. No non-Nemotron model may be registered here.

import { NemotronModelConfig, NEMOTRON_CONFIG, modelByRole, enabledModels } from './config.ts';

export type NemotronRole = 'orchestrator' | 'general-reasoning' | 'high-throughput' | 'lightweight-autonomous' | 'multimodal' | 'advanced-reasoning-escalation';

export interface NemotronModelEntry {
  role: NemotronRole;
  label: string;
  config: NemotronModelConfig;
  available: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  orchestrator: 'Nemotron 3 Super 120B-A12B (Chief Orchestrator)',
  'general-reasoning': 'Nemotron 3 Nano 30B-A3B (General Reasoning)',
  'high-throughput': 'Nemotron 3.5 Lightning 30B-A3B (High-Throughput)',
  'lightweight-autonomous': 'Nemotron 3.5 Bolt (Lightweight Autonomous)',
  multimodal: 'Nemotron 3 Nano Omni (Multimodal)',
  'advanced-reasoning-escalation': 'Nemotron 3 Ultra 550B-A55B (Advanced Reasoning / Escalation)',
};

export function listNemotronModels(): NemotronModelEntry[] {
  const entries: NemotronModelEntry[] = [
    {
      role: NEMOTRON_CONFIG.orchestrator.role as NemotronRole,
      label: ROLE_LABELS.orchestrator,
      config: NEMOTRON_CONFIG.orchestrator,
      available: NEMOTRON_CONFIG.orchestrator.enabled,
    },
  ];
  for (const [roleKey, config] of Object.entries(NEMOTRON_CONFIG.specialists)) {
    entries.push({
      role: config.role as NemotronRole,
      label: ROLE_LABELS[roleKey] ?? roleKey,
      config,
      available: config.enabled,
    });
  }
  return entries;
}

export function getNemotronModel(role: NemotronRole): NemotronModelConfig | undefined {
  return modelByRole(role);
}

export function isNemotronAvailable(role: NemotronRole): boolean {
  const cfg = modelByRole(role);
  return Boolean(cfg?.enabled);
}

export function listEnabledNemotronModels(): NemotronModelConfig[] {
  return enabledModels();
}

export function isNemotronModelId(modelId: string): boolean {
  const all = listNemotronModels();
  return all.some((e) => e.config.modelId === modelId);
}

export function nemotronRoleForModel(modelId: string): NemotronRole | undefined {
  const entry = listNemotronModels().find((e) => e.config.modelId === modelId);
  return entry?.role;
}
