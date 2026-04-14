import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface RoadInfoQueryInput {
  query: string;
  road: any;
  contractor: any;
  authority: any;
  budget: any;
  chainVerified: boolean;
}

export interface RoadInfoQueryOutput {
  answer: string;
  sourceNote: string;
  confidence: number;
  relatedFacts: string[];
}

export const roadInfoQueryPrompt: PromptTemplate<RoadInfoQueryInput, RoadInfoQueryOutput> = {
  id: 'road-info-query-v1',
  version: '1.0.0',
  role: 'citizen',
  network: 'both',
  model: 'any',
  maxTokens: 256,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'Citizen', networkState: input.chainVerified ? 'online' : 'unknown' })}\nAnswer the citizen's road info query using ONLY the provided road/contractor/authority/budget objects.\nQuery: ${input.query}\nRoad (provided): ${JSON.stringify(input.road)}\nContractor (provided): ${JSON.stringify(input.contractor)}\nAuthority (provided): ${JSON.stringify(input.authority)}\nBudget (provided): ${JSON.stringify(input.budget)}\nChain verified: ${input.chainVerified}\n\nIn 'sourceNote', explicitly state whether the answer is based on chain-verified data or local cached context (as indicated by chainVerified).\n\nRespond in JSON: { answer, sourceNote, confidence, relatedFacts }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.answer === 'string', errors: [] })
};
