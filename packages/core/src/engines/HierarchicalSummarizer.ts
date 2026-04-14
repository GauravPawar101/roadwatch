export interface BudgetRecord {
  id: string;
  department: string;
  amount: number;
  dateTimestamp: number;
  description: string;
}

export interface ChunkSummary {
  year: number;
  month: number; // 0-11
  totalExpenditure: number;
  recordCount: number;
  // A highly compressed text representation (simulating an LLM-generated summary output)
  compressedInsight: string;
}

export interface ContextRetrievalResult {
  // Low-resolution context for the entire 5 year history
  globalSummary: ChunkSummary[];
  // High-resolution context exclusively for the narrowed timeline
  rawFocusRecords: BudgetRecord[];
}

export class HierarchicalSummarizer {
  
  /**
   * Step 1 & 2: Map/Reduce
   * Chunk a massive array of records by time window (monthly) and 
   * simulate generating a compressed semantic summary for each chunk.
   * Optimized for fast on-device processing.
   */
  public generateCompressedSummaries(records: BudgetRecord[]): Map<string, ChunkSummary> {
    const chunkMap = new Map<string, BudgetRecord[]>();

    // Chunk records into O(1) accessible monthly buckets
    for (const record of records) {
      const date = new Date(record.dateTimestamp);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      
      if (!chunkMap.has(key)) {
        chunkMap.set(key, []);
      }
      chunkMap.get(key)!.push(record);
    }

    const summaries = new Map<string, ChunkSummary>();

    // Compress chunks into dense metadata pointers
    for (const [key, monthlyRecords] of chunkMap.entries()) {
      const [yearStr, monthStr] = key.split('-');
      
      const totalAmount = monthlyRecords.reduce((sum, r) => sum + r.amount, 0);
      
      // Simulate an LLM or logic engine evaluating the chunk and dropping 
      // raw text in favor of a compressed sentence/embedding.
      const insight = `In ${Number(monthStr) + 1}/${yearStr}, ${monthlyRecords.length} public projects executed totaling ₹${totalAmount}. Major dept: ${monthlyRecords[0]?.department ?? 'Mixed'}.`;

      summaries.set(key, {
        year: Number(yearStr),
        month: Number(monthStr),
        totalExpenditure: totalAmount,
        recordCount: monthlyRecords.length,
        compressedInsight: insight
      });
    }

    return summaries;
  }

  /**
   * Step 3: Retrieval
   * Reconstructs a context window that prevents LLM token-overflow limits.
   * Returns the compressed 5-year timeline + the raw granular records ONLY for the requested timeframe.
   */
  public retrieveContext(
    targetYear: number, 
    targetMonth: number, 
    allRecords: BudgetRecord[], 
    precomputedSummaries: Map<string, ChunkSummary>
  ): ContextRetrievalResult {
    
    // Pass the compressed global state (massive time span, minimal tokens)
    const globalSummary = Array.from(precomputedSummaries.values());
    
    // Isolate and pass raw data (high token density) strictly for the semantic focal point
    const rawFocusRecords = allRecords.filter(record => {
      const date = new Date(record.dateTimestamp);
      return date.getFullYear() === targetYear && date.getMonth() === targetMonth;
    });

    return {
      globalSummary,
      rawFocusRecords
    };
  }

  /**
   * Lightweight Regex util simulating a semantic trap.
   * Converts 'What happened in March 2022?' -> { targetYear: 2022, targetMonth: 2 }
   */
  public parseQueryTemporalTarget(query: string): { targetYear: number, targetMonth: number } | null {
    const lower = query.toLowerCase();
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    
    let foundMonth = -1;
    for (let i = 0; i < months.length; i++) {
      const month = months[i];
      if (month && lower.includes(month)) {
        foundMonth = i;
        break;
      }
    }

    const yearMatch = lower.match(/\\b(20\\d{2})\\b/);
    const foundYear = yearMatch?.[1] ? parseInt(yearMatch[1], 10) : -1;

    if (foundMonth !== -1 && foundYear !== -1) {
      return { targetYear: foundYear, targetMonth: foundMonth };
    }

    return null;
  }
}
