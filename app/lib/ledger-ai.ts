export type LedgerAiAnalysisMode =
  | "OVERVIEW"
  | "SAVING_POINTS"
  | "BUDGET_COMPARE"
  | "LIFE_PATTERN"
  | "CASH_FLOW"
  | "CATEGORY_REPORT";

export type LedgerAiInsightTone = "POSITIVE" | "CAUTION" | "NEUTRAL";

export type LedgerAiSummarySnapshot = {
  analysisMode: LedgerAiAnalysisMode;
  analysisModeLabel: string;
  focusLabel: string;
  periodLabel: string;
  periodStartDate: string;
  periodEndDate: string;
  periodDayCount: number;
  entryCount: number;
  totals: {
    income: number;
    expense: number;
    saving: number;
    net: number;
    savingRatePercent: number;
    expenseRatePercent: number;
  };
  dailyRows: Array<{
    dateToken: string;
    dateLabel: string;
    weekdayLabel: string;
    periodSegment: string;
    dayIndex: number;
    income: number;
    expense: number;
    saving: number;
    net: number;
    cumulativeNet: number;
    categories: Array<{
      typeLabel: string;
      categoryName: string;
      amount: number;
      count: number;
    }>;
  }>;
  categorySections: Array<{
    type: "INCOME" | "EXPENSE" | "SAVING";
    typeLabel: string;
    totalAmount: number;
    items: Array<{
      categoryName: string;
      amount: number;
      percent: number;
      count: number;
    }>;
  }>;
  budgetCategorySections: Array<{
    type: "INCOME" | "EXPENSE" | "SAVING";
    typeLabel: string;
    items: Array<{
      categoryName: string;
      plannedAmount: number;
      actualAmount: number;
      remainingAmount: number;
      progressPercent: number;
      isFixed: boolean;
      hasBudget: boolean;
    }>;
  }>;
  weekdaySummary: Array<{
    weekdayLabel: string;
    income: number;
    expense: number;
    saving: number;
    net: number;
    entryCount: number;
  }>;
  periodSegments: Array<{
    segmentLabel: string;
    income: number;
    expense: number;
    saving: number;
    net: number;
    entryCount: number;
  }>;
  recurringExpenseCandidates: Array<{
    categoryName: string;
    amount: number;
    count: number;
  }>;
  notableDays: Array<{
    dateToken: string;
    dateLabel: string;
    reason: string;
    amount: number;
  }>;
};

export type LedgerAiSummaryResult = {
  overview: string;
  insightCards: Array<{
    title: string;
    detail: string;
    tone: LedgerAiInsightTone;
  }>;
  dailyNotes: Array<{
    dateToken: string;
    note: string;
  }>;
  categoryNotes: Array<{
    typeLabel: string;
    categoryName: string;
    note: string;
  }>;
  actions: string[];
  closing: string;
};

export type LedgerPurchaseAdviceSnapshot = {
  question: string;
  periodLabel: string;
  periodStartDate: string;
  periodEndDate: string;
  focusLabel: string;
  totals: {
    income: number;
    expense: number;
    saving: number;
    net: number;
  };
  budgetCategories: Array<{
    type: "INCOME" | "EXPENSE" | "SAVING";
    typeLabel: string;
    categoryName: string;
    plannedAmount: number;
    actualAmount: number;
    remainingAmount: number;
    progressPercent: number;
    isFixed: boolean;
  }>;
};

export type LedgerPurchaseAdviceResult = {
  verdict: "BUY" | "WAIT" | "ADJUST" | "UNKNOWN";
  title: string;
  summary: string;
  matchedCategoryName: string;
  priceEstimate: number;
  budgetImpact: string;
  reasons: string[];
  suggestions: string[];
  closing: string;
};

export type LedgerGeneralQuestionSnapshot = {
  question: string;
  report: LedgerAiSummarySnapshot;
};

export type LedgerGeneralQuestionResult = {
  title: string;
  answer: string;
  highlights: string[];
  actions: string[];
  caution: string;
  closing: string;
};
