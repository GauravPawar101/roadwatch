import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface ComplaintFilingInput {
  userMessage: string;
  roadContext: any;
  location: any;
  priorComplaints: number;
}

export interface ComplaintFilingOutput {
  suggestedDamageTypes: string[];
  suggestedSeverity: number;
  draftDescription: string;
  missingInfo: string[];
  confidence: number;
}

export const complaintFilingPrompt: PromptTemplate<ComplaintFilingInput, ComplaintFilingOutput> = {
  id: 'complaint-filing-v1',
  version: '1.0.0',
  role: 'citizen',
  network: 'both',
  model: 'any',
  maxTokens: 512,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'Citizen', networkState: 'unknown' })}\nYou are helping a citizen draft a road-issue complaint.\nTask:\n1) Identify damage type(s) from their description\n2) Assess severity (1=minor to 5=dangerous)\n3) Draft a clear complaint description they can submit (plain language)\n4) List missing info that would strengthen the complaint\n\nUse only the provided context; if a detail is not provided, do not invent it.\n\nRoad context (provided):\n- Type: ${input.roadContext.roadType} | Contractor: ${input.roadContext.contractor}\n- Last repaired: ${input.roadContext.lastRepaired} | Prior complaints: ${input.priorComplaints}\n- Location: ${input.location}\n\nCitizen description: "${input.userMessage}"\n\nRespond in JSON matching this schema: { suggestedDamageTypes, suggestedSeverity, draftDescription, missingInfo, confidence }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: Array.isArray(output.suggestedDamageTypes) && typeof output.draftDescription === 'string', errors: [] })
};
