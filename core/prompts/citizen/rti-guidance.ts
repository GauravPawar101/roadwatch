import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface RTIGuidanceInput {
  complaint: any;
  authority: any;
  daysOpen: number;
  escalationTrail: any[];
  adapter: any;
}

export interface RTIGuidanceOutput {
  rtiApplication: string;
  filingAddress: string;
  expectedTimeline: string;
  tipsForFollowup: string[];
}

export const rtiGuidancePrompt: PromptTemplate<RTIGuidanceInput, RTIGuidanceOutput> = {
  id: 'rti-guidance-v1',
  version: '1.0.0',
  role: 'citizen',
  network: 'both',
  model: 'any',
  maxTokens: 512,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'Citizen', networkState: 'unknown' })}\nGenerate an RTI application draft for a citizen based ONLY on the provided complaint and escalation trail.\nComplaint (provided): ${JSON.stringify(input.complaint)}\nAuthority (provided): ${JSON.stringify(input.authority)}\nDays open: ${input.daysOpen}\nEscalation trail (provided): ${JSON.stringify(input.escalationTrail)}\nAdapter (provided): ${JSON.stringify(input.adapter)}\n\nRespond in JSON: { rtiApplication, filingAddress, expectedTimeline, tipsForFollowup }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.rtiApplication === 'string', errors: [] })
};
