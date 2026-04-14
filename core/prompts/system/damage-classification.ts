import { PromptTemplate } from '../types';
import { buildRoadWatchAgentPreamble } from './roadwatch-agent';

export interface DamageClassificationInput {
  imageFrames: any[];
  roadType: string;
  locationContext: string;
}

export interface DamageClassificationOutput {
  damageTypes: string[];
  severity: number;
  estimatedAreaM2: number | null;
  confidence: number;
  locationConsistent: boolean;
  notes: string | null;
}

export const damageClassificationPrompt: PromptTemplate<DamageClassificationInput, DamageClassificationOutput> = {
  id: 'damage-classification-v1',
  version: '1.0.0',
  role: 'system',
  network: 'both',
  model: 'any',
  maxTokens: 512,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'System', networkState: 'unknown' })}\nClassify road damage from image(s) using only visual evidence and the provided context.\nFrames: ${input.imageFrames.length}\nRoad type: ${input.roadType}\nLocation context: ${input.locationContext}\n\nRespond in JSON: { damageTypes, severity, estimatedAreaM2, confidence, locationConsistent, notes }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: Array.isArray(output.damageTypes), errors: [] })
};
