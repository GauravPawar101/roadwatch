import { buildRoadWatchAgentPreamble } from '../system/roadwatch-agent';
import { PromptTemplate } from '../types';

export interface BudgetQueryInput {
  authority: any;
  budget: any;
  adapter: any;
}

export interface BudgetQueryOutput {
  summary: string;
  availableFunds: number;
  warnings: string[];
}

export const budgetQueryPrompt: PromptTemplate<BudgetQueryInput, BudgetQueryOutput> = {
  id: 'budget-query-v1',
  version: '1.0.0',
  role: 'authority',
  network: 'both',
  model: 'any',
  maxTokens: 256,
  temperature: 0.2,
  build: (input) => `${buildRoadWatchAgentPreamble({ persona: 'Authority', networkState: 'unknown' })}\nSummarize budget for an authority using ONLY the provided budget object. Do not estimate missing figures.\nAuthority (provided): ${JSON.stringify(input.authority)}\nBudget (provided): ${JSON.stringify(input.budget)}\nAdapter (provided): ${JSON.stringify(input.adapter)}\n\nRespond in JSON: { summary, availableFunds, warnings }`,
  parse: (raw) => { try { return { ok: true, value: JSON.parse(raw) }; } catch (e) { return { ok: false, error: { message: 'Parse error' } }; } },
  validate: (output) => ({ valid: typeof output.summary === 'string', errors: [] })
};
