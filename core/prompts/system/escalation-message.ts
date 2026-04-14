import { PromptTemplate } from '../types';
import { buildRoadWatchAgentPreamble } from './roadwatch-agent';

export interface EscalationMessageInput {
  complaint: any;
  escalationTier: number;
  fromAuthority: any;
  toAuthority: any;
  reason: string;
}

export interface EscalationMessageOutput {
  message: string;
}

export const escalationMessagePrompt: PromptTemplate<EscalationMessageInput, EscalationMessageOutput> = {
  id: 'escalation-message-v1',
  version: '1.0.0',
  role: 'system',
  network: 'both',
  model: 'any',
  maxTokens: 256,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'System', networkState: 'unknown' })}\nGenerate a concise escalation message using ONLY the provided complaint and authority details.\nComplaint (provided): ${JSON.stringify(input.complaint)}\nEscalation tier: ${input.escalationTier}\nFrom (provided): ${JSON.stringify(input.fromAuthority)}\nTo (provided): ${JSON.stringify(input.toAuthority)}\nReason: ${input.reason}\n\nRespond in JSON: { message }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.message === 'string', errors: [] })
};
