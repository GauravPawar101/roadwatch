export interface BudgetUtilization {
  sanctioned: number;
  released: number;
  spent: number;
}

export interface DefectLiabilityRule {
  roadId: string;
  contractorId: string;
  liabilityEndDateUnix: number; // DLP Period end timestamp
}

export interface BudgetAnomaly {
  type: 'FUNDS_MISMATCH' | 'DLP_BREACH' | 'ABNORMAL_SPEND';
  severity: 'WARNING' | 'CRITICAL';
  description: string;
}

export class BudgetEngine {
  
  /**
   * Pure functional reduction calculating utilization phases natively enforcing transparency.
   */
  public calculateUtilization(utilizationRecords: BudgetUtilization[]): {
    totalSanctioned: number;
    totalReleased: number;
    totalSpent: number;
    releasePercentage: number;
    spendPercentage: number;
  } {
    let sanctioned = 0;
    let released = 0;
    let spent = 0;

    for (const record of utilizationRecords) {
      sanctioned += record.sanctioned;
      released += record.released;
      spent += record.spent;
    }

    const releasePercentage = sanctioned > 0 ? (released / sanctioned) * 100 : 0;
    const spendPercentage = released > 0 ? (spent / released) * 100 : 0;

    return {
      totalSanctioned: sanctioned,
      totalReleased: released,
      totalSpent: spent,
      releasePercentage,
      spendPercentage
    };
  }

  /**
   * Formats raw chronological allocation metadata structurally for mapping components.
   */
  public buildTimeline(budgets: Array<{ amount: number, timestamp: number, note: string }>): Array<Record<string, unknown>> {
    return budgets
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(entry => ({
        date: new Date(entry.timestamp).toISOString(),
        expenditure: entry.amount,
        context: entry.note
      }));
  }

  /**
   * Highly rigid business rules flagging systematic anomalies or mathematical corruption indicators locally without remote cloud calls.
   */
  public detectAnomalies(
    currentSpend: BudgetUtilization, 
    repairs: Array<{ roadId: string, timestamp: number }>, 
    dlpActiveContracts: DefectLiabilityRule[]
  ): BudgetAnomaly[] {
    const anomalies: BudgetAnomaly[] = [];

    // 1. Auditing structural budget mismatches (Releasing or spending mathematically un-sanctioned funds)
    if (currentSpend.spent > currentSpend.released) {
      anomalies.push({
        type: 'FUNDS_MISMATCH',
        severity: 'CRITICAL',
        description: `Funds mathematically over-drafted: Spent (₹${currentSpend.spent}) exceeds limits of Released state (₹${currentSpend.released}).`
      });
    }

    if (currentSpend.released > currentSpend.sanctioned) {
      anomalies.push({
        type: 'FUNDS_MISMATCH',
        severity: 'WARNING',
        description: `Administrative Error: Released funds locally (₹${currentSpend.released}) exceed overarching total sanctioned cap.`
      });
    }

    // 2. DLP (Defect Liability Period) Breaches. 
    // In India, contractors are responsible for free repairs within 1-3 years post-construction (DLP limits).
    // Utilizing government budget locally for road repairs within this window is an anomaly.
    for (const contract of dlpActiveContracts) {
      const illegalRepairs = repairs.filter(r => 
        r.roadId === contract.roadId && r.timestamp < contract.liabilityEndDateUnix
      );

      if (illegalRepairs.length > 0) {
        anomalies.push({
          type: 'DLP_BREACH',
          severity: 'CRITICAL',
          description: `Contract DLP Violation: Public funds utilized for repairs on Road [${contract.roadId}] while still securely under Contractor DLP guarantee timeframe!`
        });
      }
    }

    return anomalies;
  }
}
