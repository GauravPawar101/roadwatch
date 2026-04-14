import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface StatusQueryInput {
  complaint: any;
  escalationHistory: any[];
  authorityContact: any;
  daysOpen: number;
  slaStatus: any;
}

export interface StatusQueryOutput {
  statusSummary: string;
  nextExpectedAction: string;
  recommendation: string;
  escalationAdvice: string | null;
}

export const statusQueryPrompt: PromptTemplate<StatusQueryInput, StatusQueryOutput> = {
  id: 'status-query-v1',
  version: '1.0.0',
  role: 'citizen',
  network: 'both',
  model: 'any',
  maxTokens: 256,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'Citizen', networkState: 'unknown' })}\nSummarize the status of this complaint for a citizen in plain language.\nComplaint (provided): ${JSON.stringify(input.complaint)}\nDays open: ${input.daysOpen}\nSLA status (provided): ${JSON.stringify(input.slaStatus)}\nEscalation history (provided): ${JSON.stringify(input.escalationHistory)}\n\nIf the SLA appears breached (from provided slaStatus/daysOpen), bias toward escalation and cite the relevant deadline in escalationAdvice.\n\nRespond in JSON: { statusSummary, nextExpectedAction, recommendation, escalationAdvice }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.statusSummary === 'string', errors: [] })
};
