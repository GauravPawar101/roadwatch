export type ComplaintTextLanguage = 'en' | 'hi' | 'ta' | 'te' | 'kn' | 'bn' | 'mr' | 'mixed' | 'unknown';
export type ComplaintTextSentiment = 'negative' | 'neutral' | 'positive';
export type ComplaintTextIntel = {
    hasText: boolean;
    language: ComplaintTextLanguage;
    normalizedText: string;
    sentimentScore: number;
    sentimentLabel: ComplaintTextSentiment;
    urgencyScore: number;
    recommendedSeverity: number;
    signals: string[];
    urgencySignals: string[];
    sentimentSignals: string[];
};
export type ComplaintTextIntelSample = ComplaintTextIntel & {
    reportCount?: number;
};
export type RoadSegmentTextIntelSummary = {
    totalReportCount: number;
    analyzedCount: number;
    negativeReportCount: number;
    urgentReportCount: number;
    averageSentimentScore: number;
    priorityFlag: boolean;
    priorityScore: number;
    languages: ComplaintTextLanguage[];
    signals: string[];
};
export declare function analyzeComplaintText(description?: string | null): ComplaintTextIntel;
export declare function summarizeRoadTextIntel(samples: ComplaintTextIntelSample[]): RoadSegmentTextIntelSummary;
//# sourceMappingURL=complaintTextIntel.d.ts.map