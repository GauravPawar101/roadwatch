import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface ComplaintSummaryInput {
  complaint: any;
  mediaAnalysis: any | null;
  roadHistory: any;
  citizenHistory: { complaintsOnRoad: number; resolvedBefore: number };
  slaStatus: any;
  contractorRecord: any;
}

export interface ComplaintSummaryOutput {
  executiveSummary: string;
  keyFacts: string[];
  recommendedAction: string;
  urgencyReason: string;
  precedents: string | null;
}

export const complaintSummaryPrompt: PromptTemplate<ComplaintSummaryInput, ComplaintSummaryOutput> = {
  id: 'complaint-summary-v1',
  version: '1.0.0',
  role: 'authority',
  network: 'both',
  model: 'any',
  maxTokens: 512,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'Authority', networkState: 'unknown' })}\nSummarize this complaint for an authority operator. Be direct and action-oriented.\nComplaint (provided): ${JSON.stringify(input.complaint)}\nMedia analysis (provided): ${JSON.stringify(input.mediaAnalysis)}\nRoad history (provided): ${JSON.stringify(input.roadHistory)}\nCitizen history (provided): ${JSON.stringify(input.citizenHistory)}\nSLA status (provided): ${JSON.stringify(input.slaStatus)}\nContractor record (provided): ${JSON.stringify(input.contractorRecord)}\n\nRespond in JSON: { executiveSummary, keyFacts, recommendedAction, urgencyReason, precedents }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.executiveSummary === 'string', errors: [] })
};
