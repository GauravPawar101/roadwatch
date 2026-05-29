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

type TextPattern = {
  signal: string;
  re: RegExp;
  severity: number;
  sentiment: number;
};

const CRITICAL_PATTERNS: TextPattern[] = [
  { signal: 'accident', re: /accident happened here|road accident|collision|crash|accident|दुर्घटना|हादसा|விபத்து|ವಿಪತ್ತು|দুর্ঘটনা|ప్రమాదం|अपघात/i, severity: 5, sentiment: -0.85 },
  { signal: 'truck-fell', re: /truck fell|truck overturned|truck toppled|lorry fell|lorry overturned|truck गिर|truck पड|truck బడి|truck ಬಿದ್ದ|truck পড়ে|ट्रक गिर|ಟ್ರಕ್ ಬಿದ್ದ|ట్రక్ పడ|ট্রাক পড়ে|லாரி விழுந்த/i, severity: 5, sentiment: -0.85 },
  { signal: 'bleeding', re: /bleeding|blood(?: is)? flowing|blood coming|blood|खून|रक्तस्त्राव|रक्त|ರಕ್ತ|రక్తం|রক্ত|இரத்தம்/i, severity: 5, sentiment: -0.95 },
  { signal: 'injury', re: /injured|injury|hurt|casualty|जखमी|चोट|காயம்|గాయం|ಗಾಯ|আঘাত|আহত/i, severity: 5, sentiment: -0.8 },
  { signal: 'blocked-by-accident', re: /road blocked|blocked by accident|road closed|sudden blockage|सड़क बंद|रस्ता बंद|ರಸ್ತೆ ಮುಚ್ಚಿ|রাস্তা বন্ধ|రోడ్ మూసి|சாலை மூட/i, severity: 4, sentiment: -0.7 },
  { signal: 'fire', re: /fire|burning|आग|ಬೆಂಕಿ|আগুন|అగ్ని|தீ/i, severity: 5, sentiment: -0.9 }
];

const MODERATE_PATTERNS: TextPattern[] = [
  { signal: 'fallen-tree', re: /fallen tree|tree fell|tree has fallen|broken branch|गिरा हुआ पेड़|पेड़ गिर|ವೃಕ್ಷ ಬಿದ್ದ|গাছ পড়ে|చెట్టు పడ|மரம் விழுந்த/i, severity: 4, sentiment: -0.45 },
  { signal: 'open-manhole', re: /open manhole|missing cover|drain cover open|manhole खुला|मॅनहोल उघडा|ಮ್ಯಾನ್‌ಹೋಲ್ ತೆರೆದ|ম্যানহোল খোলা|మ్యాన్హోల్ తెరిచి|மேன் ஹோல் திற/i, severity: 4, sentiment: -0.4 },
  { signal: 'sinkhole', re: /sinkhole|ground collapsed|road collapsed|surface collapse|मिट्टी धँस|रस्ता खच|ರಸ್ತೆ ಕುಸಿತ|রাস্তায় ধস|రోడ్ కూలి|சாலை சரிவு/i, severity: 4, sentiment: -0.45 },
  { signal: 'slippery', re: /slippery|oil spill|waterlogged|flooded|water on road|road is wet|फिसलन|पाणी साच|ನೀರು ನಿಂತ|জল জমে|రోడ్డు తడి|சாலை ஈர/i, severity: 3, sentiment: -0.3 },
  { signal: 'dangerous', re: /dangerous|unsafe|risk of accident|severe crack|deep pothole|major crack|खतरनाक|असुरक्षित|ಅಪಾಯಕಾರ|ঝুঁকিপূর্ণ|అపాయకర|அபாயகர/i, severity: 4, sentiment: -0.35 }
];

const NEGATIVE_SENTIMENT_PATTERNS: TextPattern[] = [
  { signal: 'negative-tone', re: /worst|terrible|bad|awful|unusable|damaged|broken|blocked|unsafe|dangerous|horrible|neglected|neglect|poor|severe|urgent|खराब|बहुत बुरा|ಕೆಟ್ಟ|খারাপ|খুব খারাপ|చెడు|చాలా చెడు|மோசம்|மிகவும் மோச/i, severity: 0, sentiment: -0.18 },
  { signal: 'complaint-tone', re: /urgent|emergency|please help|help needed|as soon as possible|asap|तात्काळ|ತುರ್ತು|জরুরি|అత్యవసరం|അത്യാവശ്യ/i, severity: 0, sentiment: -0.12 }
];

const SCRIPT_PATTERNS = [
  { language: 'ta' as const, re: /[\u0B80-\u0BFF]/ },
  { language: 'te' as const, re: /[\u0C00-\u0C7F]/ },
  { language: 'kn' as const, re: /[\u0C80-\u0CFF]/ },
  { language: 'bn' as const, re: /[\u0980-\u09FF]/ },
  { language: 'mr' as const, re: /[\u0900-\u097F]/ }
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function hasLatinText(text: string): boolean {
  return /[a-z]/i.test(text);
}

function detectLanguage(text: string): ComplaintTextLanguage {
  const matches = SCRIPT_PATTERNS.filter((pattern) => pattern.re.test(text));

  if (matches.length === 0) {
    return hasLatinText(text) ? 'en' : 'unknown';
  }

  if (matches.length > 1) {
    return 'mixed';
  }

  const language = matches[0]?.language ?? 'unknown';
  if (language !== 'mr') {
    return language;
  }

  if (/\b(माझा|रस्ता|जखमी|अपघात|तातडी|ट्रक|रक्तस्त्राव|सुरक्षा)\b/.test(text)) {
    return 'mr';
  }

  return 'hi';
}

function collectMatches(patterns: TextPattern[], normalizedText: string): { signals: string[]; severityFloor: number; sentimentScore: number } {
  const signals: string[] = [];
  let severityFloor = 0;
  let sentimentScore = 0;

  for (const pattern of patterns) {
    if (!pattern.re.test(normalizedText)) {
      continue;
    }

    signals.push(pattern.signal);
    severityFloor = Math.max(severityFloor, pattern.severity);
    sentimentScore += pattern.sentiment;
  }

  return { signals, severityFloor, sentimentScore };
}

export function analyzeComplaintText(description?: string | null): ComplaintTextIntel {
  const normalizedText = normalizeText(description ?? '');
  if (!normalizedText) {
    return {
      hasText: false,
      language: 'unknown',
      normalizedText: '',
      sentimentScore: 0,
      sentimentLabel: 'neutral',
      urgencyScore: 0,
      recommendedSeverity: 0,
      signals: [],
      urgencySignals: [],
      sentimentSignals: []
    };
  }

  const language = detectLanguage(normalizedText);
  const urgencyMatches = collectMatches(CRITICAL_PATTERNS, normalizedText);
  const moderateMatches = collectMatches(MODERATE_PATTERNS, normalizedText);
  const sentimentMatches = collectMatches(NEGATIVE_SENTIMENT_PATTERNS, normalizedText);

  const urgencySignals = [...urgencyMatches.signals, ...moderateMatches.signals];
  const severityFloor = Math.max(urgencyMatches.severityFloor, moderateMatches.severityFloor);
  const urgencyScore = urgencyMatches.signals.length * 2 + moderateMatches.signals.length;

  const sentimentScore = clamp(urgencyMatches.sentimentScore + moderateMatches.sentimentScore + sentimentMatches.sentimentScore, -1, 1);
  const sentimentLabel: ComplaintTextSentiment = sentimentScore <= -0.2 ? 'negative' : sentimentScore >= 0.2 ? 'positive' : 'neutral';

  const recommendedSeverity = severityFloor > 0 ? severityFloor : urgencyScore >= 3 ? 4 : urgencyScore >= 1 ? 3 : 0;
  const signals = Array.from(new Set([...urgencySignals, ...sentimentMatches.signals]));

  return {
    hasText: true,
    language,
    normalizedText,
    sentimentScore,
    sentimentLabel,
    urgencyScore,
    recommendedSeverity,
    signals,
    urgencySignals,
    sentimentSignals: sentimentMatches.signals
  };
}

export function summarizeRoadTextIntel(samples: ComplaintTextIntelSample[]): RoadSegmentTextIntelSummary {
  if (samples.length === 0) {
    return {
      totalReportCount: 0,
      analyzedCount: 0,
      negativeReportCount: 0,
      urgentReportCount: 0,
      averageSentimentScore: 0,
      priorityFlag: false,
      priorityScore: 0,
      languages: [],
      signals: []
    };
  }

  let totalReportCount = 0;
  let analyzedCount = 0;
  let negativeReportCount = 0;
  let urgentReportCount = 0;
  let sentimentSum = 0;
  const languages = new Set<ComplaintTextLanguage>();
  const signals = new Set<string>();

  for (const sample of samples) {
    const weight = Math.max(1, Math.floor(sample.reportCount ?? 1));
    totalReportCount += weight;
    analyzedCount += 1;
    sentimentSum += sample.sentimentScore * weight;

    if (sample.sentimentLabel === 'negative') {
      negativeReportCount += weight;
    }
    if (sample.recommendedSeverity >= 4) {
      urgentReportCount += weight;
    }
    if (sample.language !== 'unknown') {
      languages.add(sample.language);
    }

    for (const signal of sample.signals) {
      signals.add(signal);
    }
  }

  const averageSentimentScore = totalReportCount > 0 ? sentimentSum / totalReportCount : 0;
  const priorityFlag = negativeReportCount >= 2 || urgentReportCount >= 1 || averageSentimentScore <= -0.35;
  const priorityScore = clamp(
    Math.round(negativeReportCount * 25 + urgentReportCount * 35 + Math.abs(averageSentimentScore) * 30),
    0,
    100
  );

  return {
    totalReportCount,
    analyzedCount,
    negativeReportCount,
    urgentReportCount,
    averageSentimentScore,
    priorityFlag,
    priorityScore,
    languages: [...languages.values()],
    signals: [...signals.values()]
  };
}