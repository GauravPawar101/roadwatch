import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface JurisdictionReportInput {
  authority: any;
  complaints: any[];
  roads: any[];
  adapter: any;
}

export interface JurisdictionReportOutput {
  summary: string;
  flaggedRoads: string[];
  chronicComplaints: string[];
  recommendations: string[];
}

export const jurisdictionReportPrompt: PromptTemplate<JurisdictionReportInput, JurisdictionReportOutput> = {
  id: 'jurisdiction-report-v1',
  version: '1.0.0',
  role: 'authority',
  network: 'both',
  model: 'any',
  maxTokens: 512,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'Authority', networkState: 'unknown' })}\nGenerate a jurisdiction report for an authority. Use only the provided complaints/roads lists; do not infer unseen incidents.\nAuthority (provided): ${JSON.stringify(input.authority)}\nComplaints (provided): ${JSON.stringify(input.complaints)}\nRoads (provided): ${JSON.stringify(input.roads)}\nAdapter (provided): ${JSON.stringify(input.adapter)}\n\nRespond in JSON: { summary, flaggedRoads, chronicComplaints, recommendations }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.summary === 'string', errors: [] })
};
