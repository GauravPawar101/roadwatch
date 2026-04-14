import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface SLAAnalysisInput {
  complaints: any[];
  authority: any;
  adapter: any;
}

export interface SLAAnalysisOutput {
  summary: string;
  approachingBreach: string[];
  breached: string[];
  recommendations: string[];
}

export const slaAnalysisPrompt: PromptTemplate<SLAAnalysisInput, SLAAnalysisOutput> = {
  id: 'sla-analysis-v1',
  version: '1.0.0',
  role: 'authority',
  network: 'both',
  model: 'any',
  maxTokens: 512,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'Authority', networkState: 'unknown' })}\nAnalyze SLA status for an authority using only the provided complaints list and adapter rules.\nComplaints (provided): ${JSON.stringify(input.complaints)}\nAuthority (provided): ${JSON.stringify(input.authority)}\nAdapter (provided): ${JSON.stringify(input.adapter)}\n\nRespond in JSON: { summary, approachingBreach, breached, recommendations }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.summary === 'string', errors: [] })
};
