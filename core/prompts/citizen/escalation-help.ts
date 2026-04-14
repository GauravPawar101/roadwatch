import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface EscalationHelpInput {
  complaint: any;
  daysOpen: number;
  currentAuthority: any;
  nextAuthority: any;
  slaBreachDays: number;
  countryAdapter: any;
  rtiAvailable: boolean;
}

export interface EscalationHelpOutput {
  situation: string;
  immediateAction: string;
  escalationDraft: string;
  rtiDraft: string | null;
  legalRights: string;
}

export const escalationHelpPrompt: PromptTemplate<EscalationHelpInput, EscalationHelpOutput> = {
  id: 'escalation-help-v1',
  version: '1.0.0',
  role: 'citizen',
  network: 'both',
  model: 'any',
  maxTokens: 512,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'Citizen', networkState: 'unknown' })}\nA citizen needs escalation help for an unresolved complaint.\nComplaint (provided): ${JSON.stringify(input.complaint)}\nDays open: ${input.daysOpen}\nCurrent authority (provided): ${JSON.stringify(input.currentAuthority)}\nNext authority (provided): ${JSON.stringify(input.nextAuthority)}\nSLA breach days: ${input.slaBreachDays}\nRTI available: ${input.rtiAvailable}\nCountry adapter (provided): ${JSON.stringify(input.countryAdapter)}\n\nRespond in JSON: { situation, immediateAction, escalationDraft, rtiDraft, legalRights }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.situation === 'string', errors: [] })
};
