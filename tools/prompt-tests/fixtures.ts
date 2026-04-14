import type { PromptTemplate } from '../../core/prompts/types';

export type PromptFixture = {
  input: unknown;
  validResponseJson: string;
};

// Minimal fixtures for prompt regression checks.
// Add new entries as prompts become user-facing or safety-critical.
export const fixturesByPromptId: Record<string, PromptFixture> = {
  'complaint-filing-v1': {
    input: {
      userMessage: 'There is a deep pothole near the signal; two bikes almost fell.',
      roadContext: { roadType: 'NH', contractor: 'ABC Infra', lastRepaired: '2025-12-01' },
      location: '{"lat":18.52,"lng":73.85}',
      priorComplaints: 3
    },
    validResponseJson: JSON.stringify({
      suggestedDamageTypes: ['pothole'],
      suggestedSeverity: 4,
      draftDescription: 'Pothole reported near the signal causing safety risk.',
      missingInfo: ['exact landmark'],
      confidence: 0.8
    })
  },

  'complaint-summary-v1': {
    input: {
      complaint: { id: 'c1', severity: 4 },
      mediaAnalysis: null,
      roadHistory: { prior: 2 },
      citizenHistory: { complaintsOnRoad: 5, resolvedBefore: 2 },
      slaStatus: { breached: false },
      contractorRecord: { contractor: 'ABC Infra' }
    },
    validResponseJson: JSON.stringify({
      executiveSummary: 'Summary',
      keyFacts: ['fact1'],
      recommendedAction: 'Inspect',
      urgencyReason: 'Severity',
      precedents: null
    })
  }
};

export function isPromptTemplate(value: unknown): value is PromptTemplate<any, any> {
  if (!value || typeof value !== 'object') return false;
  const v: any = value;
  return (
    typeof v.id === 'string' &&
    typeof v.version === 'string' &&
    typeof v.build === 'function' &&
    typeof v.parse === 'function' &&
    typeof v.validate === 'function'
  );
}
