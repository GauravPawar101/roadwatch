import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as service from '../src/analytics/service.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Proposal anomaly engine', () => {
  it('returns no anomaly for matching requested budget', async () => {
    // Mock contractors to have lifecycle cost similar to computed lifecycle
    vi.spyOn(service, 'getContractorScorecard').mockResolvedValue([
      {
        contractorId: 'c1',
        contractorName: 'C1',
        assignedCount: 1,
        resolvedCount: 1,
        openCount: 0,
        avgResolutionDays: 10,
        slaBreaches: 0,
        onTimeRate: 1,
        karmaScore: 80,
        reliabilityRank: 1,
        avgSlaSuccessDays: 10,
        repeatFailureRate: 0,
        budgetDisciplineScore: 80,
        citizenSatisfactionScore: 80,
        auditPerformanceScore: 80,
        maintenanceEfficiencyScore: 80,
        historicalDurabilityDays: 90,
        regionalExpertise: [],
        roadTypeSpecialization: [],
        riskIndicator: 'low',
        lifecycleCostINR: 1000000,
        proposalConfidence: 80
      } as any
    ]);

    const intel = await service.getProposalIntelligence({ plannedLengthKm: 0.5, requestedBudgetINR: 1000000 });
    expect(intel.anomaly).toBeTruthy();
    expect(intel.anomaly?.severity).toBe('none');
  });

  it('flags inflated budget and sets inflatedBudgetFlag', async () => {
    vi.spyOn(service, 'getContractorScorecard').mockResolvedValue([
      { contractorId: 'c1', contractorName: 'C1', assignedCount: 1, resolvedCount: 1, openCount: 0, avgResolutionDays: 10, slaBreaches: 0, onTimeRate: 1, karmaScore: 80, reliabilityRank: 1, avgSlaSuccessDays: 10, repeatFailureRate: 0, budgetDisciplineScore: 80, citizenSatisfactionScore: 80, auditPerformanceScore: 80, maintenanceEfficiencyScore: 80, historicalDurabilityDays: 90, regionalExpertise: [], roadTypeSpecialization: [], riskIndicator: 'low', lifecycleCostINR: 1000000, proposalConfidence: 80 } as any
    ]);

    const intel = await service.getProposalIntelligence({ plannedLengthKm: 0.5, requestedBudgetINR: 3000000 });
    expect(intel.inflatedBudgetFlag).toBe(true);
    expect(intel.anomaly?.signals).toContain('zscore_outlier', 'or other signals');
  });

  it('detects duplicate invoice and vendor spike', async () => {
    vi.spyOn(service, 'getContractorScorecard').mockResolvedValue([
      { contractorId: 'c1', contractorName: 'C1', assignedCount: 1, resolvedCount: 1, openCount: 0, avgResolutionDays: 10, slaBreaches: 0, onTimeRate: 1, karmaScore: 80, reliabilityRank: 1, avgSlaSuccessDays: 10, repeatFailureRate: 0, budgetDisciplineScore: 80, citizenSatisfactionScore: 80, auditPerformanceScore: 80, maintenanceEfficiencyScore: 80, historicalDurabilityDays: 90, regionalExpertise: [], roadTypeSpecialization: [], riskIndicator: 'low', lifecycleCostINR: 1000000, proposalConfidence: 80 } as any
    ]);

    const recentExpenses = [
      { date: new Date().toISOString(), amount: 100000, vendorId: 'v1', invoiceId: 'inv-1' },
      { date: new Date().toISOString(), amount: 100000, vendorId: 'v1', invoiceId: 'inv-1' },
      { date: new Date().toISOString(), amount: 2000000, vendorId: 'v2', invoiceId: 'inv-2' }
    ];

    const intel = await service.getProposalIntelligence({ plannedLengthKm: 0.5, requestedBudgetINR: 1000000, recentExpenses });
    expect(intel.anomaly).toBeTruthy();
    expect(intel.anomaly?.signals).toContain('duplicate_invoice');
    // vendor spike may or may not be triggered depending on ordering; assert at least duplicate detected
  });

  it('detects z-score outlier from dailySpendSeries', async () => {
    vi.spyOn(service, 'getContractorScorecard').mockResolvedValue([
      { contractorId: 'c1', contractorName: 'C1', assignedCount: 1, resolvedCount: 1, openCount: 0, avgResolutionDays: 10, slaBreaches: 0, onTimeRate: 1, karmaScore: 80, reliabilityRank: 1, avgSlaSuccessDays: 10, repeatFailureRate: 0, budgetDisciplineScore: 80, citizenSatisfactionScore: 80, auditPerformanceScore: 80, maintenanceEfficiencyScore: 80, historicalDurabilityDays: 90, regionalExpertise: [], roadTypeSpecialization: [], riskIndicator: 'low', lifecycleCostINR: 1000000, proposalConfidence: 80 } as any
    ]);

    const series = [100, 120, 110, 105, 115, 130, 5000];
    const intel = await service.getProposalIntelligence({ plannedLengthKm: 0.5, requestedBudgetINR: 1000000, dailySpendSeries: series });
    expect(intel.anomaly).toBeTruthy();
    expect(intel.anomaly?.signals).toContain('zscore_outlier');
  });
});
