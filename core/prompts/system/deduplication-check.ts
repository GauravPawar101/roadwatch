import { PromptTemplate } from '../types';
import { buildRoadWatchAgentPreamble } from './roadwatch-agent';

export interface DeduplicationCheckInput {
  newComplaint: any;
  nearbyComplaints: any[];
}

export interface DeduplicationCheckOutput {
  isDuplicate: boolean;
  confidence: number;
  matchedId: string | null;
  reason: string;
  recommendation: 'file_new' | 'join_existing' | 'review';
}

export const deduplicationCheckPrompt: PromptTemplate<DeduplicationCheckInput, DeduplicationCheckOutput> = {
  id: 'deduplication-check-v1',
  version: '1.0.0',
  role: 'system',
  network: 'both',
  model: 'any',
  maxTokens: 256,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'System', networkState: 'unknown' })}\nCheck if a new complaint is a duplicate of nearby complaints using ONLY the provided items.\nNew complaint (provided): ${JSON.stringify(input.newComplaint)}\nNearby complaints (provided): ${JSON.stringify(input.nearbyComplaints)}\n\nRespond in JSON: { isDuplicate, confidence, matchedId, reason, recommendation }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.isDuplicate === 'boolean', errors: [] })
};
