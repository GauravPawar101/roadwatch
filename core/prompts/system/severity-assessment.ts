import { PromptTemplate } from '../types';
import { buildRoadWatchAgentPreamble } from './roadwatch-agent';

export interface SeverityAssessmentInput {
  citizenSeverity: number;
  aiSeverity: number;
  damageTypes: string[];
  roadType: string;
  trafficLevel: string | null;
}

export interface SeverityAssessmentOutput {
  finalSeverity: number;
  adjustmentReason: string | null;
  safetyFlag: boolean;
}

export const severityAssessmentPrompt: PromptTemplate<SeverityAssessmentInput, SeverityAssessmentOutput> = {
  id: 'severity-assessment-v1',
  version: '1.0.0',
  role: 'system',
  network: 'both',
  model: 'any',
  maxTokens: 256,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'System', networkState: 'unknown' })}\nAssess severity of road damage. If adjusting severity, explain the reason briefly and conservatively.\nCitizen severity: ${input.citizenSeverity}\nAI severity: ${input.aiSeverity}\nDamage types: ${input.damageTypes.join(', ')}\nRoad type: ${input.roadType}\nTraffic level: ${input.trafficLevel}\n\nRespond in JSON: { finalSeverity, adjustmentReason, safetyFlag }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.finalSeverity === 'number', errors: [] })
};
