import { GoogleGenAI, Type } from "@google/genai";

import type {
  LedgerAiSummaryResult,
  LedgerAiSummarySnapshot,
  LedgerPurchaseAdviceResult,
  LedgerPurchaseAdviceSnapshot,
} from "~/lib/ledger-ai";

type AiStyle = {
  x: number;
  y: number;
  theme: string;
  animDuration: string;
  scale: number;
};

type GeneratedAiMessage = {
  content: string;
  nickname: string;
  aiStyle: AiStyle;
};

type OptimizedLayout = {
  id: string;
  aiStyle: AiStyle;
};

let geminiClient: GoogleGenAI | null | undefined;

const messageSchema = {
  type: Type.OBJECT,
  properties: {
    messages: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          content: { type: Type.STRING, description: "Message body in Korean." },
          nickname: { type: Type.STRING, description: "Warm Korean nickname." },
          aiStyle: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              theme: { type: Type.STRING },
              animDuration: { type: Type.STRING },
              scale: { type: Type.NUMBER },
            },
            required: ["x", "y", "theme", "animDuration", "scale"],
          },
        },
        required: ["content", "nickname", "aiStyle"],
      },
    },
  },
  required: ["messages"],
} as const;

const layoutSchema = {
  type: Type.OBJECT,
  properties: {
    layouts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          aiStyle: {
            type: Type.OBJECT,
            properties: {
              x: { type: Type.NUMBER },
              y: { type: Type.NUMBER },
              theme: { type: Type.STRING },
              animDuration: { type: Type.STRING },
              scale: { type: Type.NUMBER },
            },
            required: ["x", "y", "theme", "animDuration", "scale"],
          },
        },
        required: ["id", "aiStyle"],
      },
    },
  },
  required: ["layouts"],
} as const;

const ledgerStatsSummarySchema = {
  type: Type.OBJECT,
  properties: {
    overview: { type: Type.STRING },
    insightCards: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          tone: {
            type: Type.STRING,
            enum: ["POSITIVE", "CAUTION", "NEUTRAL"],
          },
        },
        required: ["title", "detail", "tone"],
      },
    },
    dailyNotes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          dateToken: { type: Type.STRING },
          note: { type: Type.STRING },
        },
        required: ["dateToken", "note"],
      },
    },
    categoryNotes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          typeLabel: { type: Type.STRING },
          categoryName: { type: Type.STRING },
          note: { type: Type.STRING },
        },
        required: ["typeLabel", "categoryName", "note"],
      },
    },
    actions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    closing: { type: Type.STRING },
  },
  required: ["overview", "insightCards", "dailyNotes", "categoryNotes", "actions", "closing"],
} as const;

const ledgerPurchaseAdviceSchema = {
  type: Type.OBJECT,
  properties: {
    verdict: {
      type: Type.STRING,
      enum: ["BUY", "WAIT", "ADJUST", "UNKNOWN"],
    },
    title: { type: Type.STRING },
    summary: { type: Type.STRING },
    matchedCategoryName: { type: Type.STRING },
    priceEstimate: { type: Type.NUMBER },
    budgetImpact: { type: Type.STRING },
    reasons: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    suggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    closing: { type: Type.STRING },
  },
  required: [
    "verdict",
    "title",
    "summary",
    "matchedCategoryName",
    "priceEstimate",
    "budgetImpact",
    "reasons",
    "suggestions",
    "closing",
  ],
} as const;

export function hasGeminiApiKey() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function getGeminiClient() {
  if (geminiClient !== undefined) {
    return geminiClient;
  }

  geminiClient = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
  return geminiClient;
}

function extractJsonText(text: string | undefined) {
  return (text ?? "{}").replace(/```json|```/g, "").trim();
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function sanitizeAiStyle(value: unknown): AiStyle | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<AiStyle>;
  if (
    typeof candidate.x !== "number" ||
    typeof candidate.y !== "number" ||
    typeof candidate.theme !== "string" ||
    typeof candidate.animDuration !== "string" ||
    typeof candidate.scale !== "number"
  ) {
    return null;
  }

  return {
    x: candidate.x,
    y: candidate.y,
    theme: candidate.theme.trim(),
    animDuration: candidate.animDuration.trim(),
    scale: candidate.scale,
  };
}

function sanitizeGeneratedMessages(value: unknown) {
  if (!value || typeof value !== "object" || !Array.isArray((value as { messages?: unknown[] }).messages)) {
    return [];
  }

  return (value as { messages: unknown[] }).messages
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as Partial<GeneratedAiMessage>;
      const aiStyle = sanitizeAiStyle(candidate.aiStyle);
      if (typeof candidate.content !== "string" || typeof candidate.nickname !== "string" || !aiStyle) {
        return null;
      }

      return {
        content: candidate.content.trim(),
        nickname: candidate.nickname.trim(),
        aiStyle,
      };
    })
    .filter((item): item is GeneratedAiMessage => item !== null);
}

function sanitizeOptimizedLayouts(value: unknown) {
  if (!value || typeof value !== "object" || !Array.isArray((value as { layouts?: unknown[] }).layouts)) {
    return [];
  }

  return (value as { layouts: unknown[] }).layouts
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as Partial<OptimizedLayout>;
      const aiStyle = sanitizeAiStyle(candidate.aiStyle);
      if (typeof candidate.id !== "string" || !aiStyle) {
        return null;
      }

      return {
        id: candidate.id,
        aiStyle,
      };
    })
    .filter((item): item is OptimizedLayout => item !== null);
}

function sanitizeLedgerAiSummary(value: unknown): LedgerAiSummaryResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LedgerAiSummaryResult>;
  if (
    typeof candidate.overview !== "string" ||
    typeof candidate.closing !== "string" ||
    !Array.isArray(candidate.actions) ||
    !Array.isArray(candidate.insightCards) ||
    !Array.isArray(candidate.dailyNotes) ||
    !Array.isArray(candidate.categoryNotes)
  ) {
    return null;
  }

  const insightCards = candidate.insightCards
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const card = item as { title?: unknown; detail?: unknown; tone?: unknown };
      if (
        typeof card.title !== "string" ||
        typeof card.detail !== "string" ||
        (card.tone !== "POSITIVE" && card.tone !== "CAUTION" && card.tone !== "NEUTRAL")
      ) {
        return null;
      }

      return {
        title: card.title.trim(),
        detail: card.detail.trim(),
        tone: card.tone,
      };
    })
    .filter((item): item is LedgerAiSummaryResult["insightCards"][number] => item !== null)
    .slice(0, 4);

  const dailyNotes = candidate.dailyNotes
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const note = item as { dateToken?: unknown; note?: unknown };
      if (typeof note.dateToken !== "string" || typeof note.note !== "string") {
        return null;
      }

      return {
        dateToken: note.dateToken.trim(),
        note: note.note.trim(),
      };
    })
    .filter((item): item is LedgerAiSummaryResult["dailyNotes"][number] => item !== null)
    .slice(0, 31);

  const categoryNotes = candidate.categoryNotes
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const note = item as { typeLabel?: unknown; categoryName?: unknown; note?: unknown };
      if (typeof note.typeLabel !== "string" || typeof note.categoryName !== "string" || typeof note.note !== "string") {
        return null;
      }

      return {
        typeLabel: note.typeLabel.trim(),
        categoryName: note.categoryName.trim(),
        note: note.note.trim(),
      };
    })
    .filter((item): item is LedgerAiSummaryResult["categoryNotes"][number] => item !== null)
    .slice(0, 24);

  const actions = candidate.actions
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    overview: candidate.overview.trim(),
    insightCards,
    dailyNotes,
    categoryNotes,
    actions,
    closing: candidate.closing.trim(),
  };
}

function sanitizeLedgerPurchaseAdvice(value: unknown): LedgerPurchaseAdviceResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LedgerPurchaseAdviceResult>;
  if (
    (candidate.verdict !== "BUY" &&
      candidate.verdict !== "WAIT" &&
      candidate.verdict !== "ADJUST" &&
      candidate.verdict !== "UNKNOWN") ||
    typeof candidate.title !== "string" ||
    typeof candidate.summary !== "string" ||
    typeof candidate.matchedCategoryName !== "string" ||
    typeof candidate.priceEstimate !== "number" ||
    typeof candidate.budgetImpact !== "string" ||
    !Array.isArray(candidate.reasons) ||
    !Array.isArray(candidate.suggestions) ||
    typeof candidate.closing !== "string"
  ) {
    return null;
  }

  const reasons = candidate.reasons
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
  const suggestions = candidate.suggestions
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    verdict: candidate.verdict,
    title: candidate.title.trim(),
    summary: candidate.summary.trim(),
    matchedCategoryName: candidate.matchedCategoryName.trim(),
    priceEstimate: Math.max(0, Math.round(candidate.priceEstimate)),
    budgetImpact: candidate.budgetImpact.trim(),
    reasons,
    suggestions,
    closing: candidate.closing.trim(),
  };
}

export async function generateAiMessages(
  topic: string,
  count: number,
  targetInfo: { name: string; age: string; gender: "male" | "female" },
) {
  const ai = getGeminiClient();
  if (!ai || count <= 0) {
    return [];
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        responseMimeType: "application/json",
        responseSchema: messageSchema,
        temperature: 1.5,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
You write warm Korean memory-space messages.

Target:
- name: ${targetInfo.name}
- age: ${targetInfo.age}
- gender: ${targetInfo.gender}
- topic: ${topic}
- message count: ${count}

Rules:
- Write natural Korean only.
- Do not mention AI, prompts, policies, or system messages.
- Keep the tone affectionate and human.
- Match age and gender naturally without sounding stiff.
- Spread messages across a wide canvas.
- Use varied themes and placements.
- Keep x in -400..400 and y in -300..300.
- Keep scale in 0.8..1.4.
              `,
            },
          ],
        },
      ],
    });

    const parsed = parseJson<{ messages?: unknown[] }>(extractJsonText(response.text));
    return sanitizeGeneratedMessages(parsed);
  } catch (error) {
    console.error("Gemini AI message generation error:", error);
    return [];
  }
}

export async function optimizeLayout(posts: { id: number | string; content: string }[]) {
  const ai = getGeminiClient();
  if (!ai || posts.length === 0) {
    return [];
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
        responseSchema: layoutSchema,
        temperature: 1,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
Arrange these messages like a balanced constellation.

Messages:
${JSON.stringify(posts.map((post) => ({ id: String(post.id), content: post.content.slice(0, 50) })))}

Rules:
- Use the full canvas instead of clustering near the center.
- Keep x in -600..600 and y in -400..400.
- Avoid overlaps whenever possible.
- Vary color themes.
- Keep scale in 0.8..1.5.
              `,
            },
          ],
        },
      ],
    });

    const parsed = parseJson<{ layouts?: unknown[] }>(extractJsonText(response.text));
    return sanitizeOptimizedLayouts(parsed);
  } catch (error) {
    console.error("Gemini AI layout optimization error:", error);
    return [];
  }
}

export async function generateLedgerStatsSummary(snapshot: LedgerAiSummarySnapshot) {
  const ai = getGeminiClient();
  if (!ai) {
    return null;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
        responseSchema: ledgerStatsSummarySchema,
        temperature: 0.4,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
You are a precise Korean household-ledger organizer.
Analyze only the aggregated budget-period data below and never invent transactions or amounts.
The selected analysis mode is "${snapshot.analysisModeLabel}" (${snapshot.analysisMode}).

Output rules:
- overview: 1-2 short Korean sentences about this exact period and selected mode.
- insightCards: 2-4 key findings for the selected mode.
- dailyNotes: short notes for dates that matter to the selected mode. Use exact dateToken from input.
- categoryNotes: short notes for categories that matter to the selected mode. Use exact typeLabel and categoryName from input.
- actions: 2-3 concrete next actions in Korean.
- closing: 1 short encouraging sentence.
- For OVERVIEW: cover totals, category concentration, notable days, and net result.
- For SAVING_POINTS: focus on expense categories, repeated spending, high-spend dates, and realistic reductions.
- For BUDGET_COMPARE: focus on planned vs actual, over/near/under budget, and fixed vs variable categories.
- For LIFE_PATTERN: focus on weekdays, weekends, early/mid/late period, and payday-adjacent behavior.
- For CASH_FLOW: focus on income, expense, saving rate, cumulative net, and period-end cash pressure.
- For CATEGORY_REPORT: focus on category reasons, priority, categories to keep, and categories to review.
- If the data is limited, say so naturally instead of guessing.

Snapshot:
${JSON.stringify(snapshot, null, 2)}
              `,
            },
          ],
        },
      ],
    });

    const parsed = parseJson<LedgerAiSummaryResult>(extractJsonText(response.text));
    return sanitizeLedgerAiSummary(parsed);
  } catch (error) {
    console.error("Gemini ledger summary error:", error);
    return null;
  }
}

export async function generateLedgerPurchaseAdvice(snapshot: LedgerPurchaseAdviceSnapshot) {
  const ai = getGeminiClient();
  if (!ai) {
    return null;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
        responseSchema: ledgerPurchaseAdviceSchema,
        temperature: 0.35,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `
You are a practical Korean household-budget purchase advisor.
Answer only from the user's question and the current budget-period data below.
Never invent transactions, budgets, or remaining amounts.

User purchase question:
${snapshot.question}

Output rules:
- verdict: BUY if it clearly fits the remaining budget, WAIT if it likely harms the budget, ADJUST if a cheaper/timed option is better, UNKNOWN if price/category is too unclear.
- title: a short Korean verdict headline.
- summary: 1-2 short Korean sentences comparing the possible purchase with remaining budget.
- matchedCategoryName: the closest category name from budgetCategories, or "확인 필요" if unclear.
- priceEstimate: numeric KRW price inferred from the user question, or 0 if unclear.
- budgetImpact: short Korean phrase about remaining budget impact.
- reasons: 2-4 concrete reasons in Korean using exact amounts from the data when relevant.
- suggestions: 2-4 practical next choices in Korean.
- closing: 1 short friendly sentence.
- If the price is missing, ask the user to include the expected price instead of pretending to know it.
- If no category matches, recommend checking the closest likely category without pretending certainty.

Budget snapshot:
${JSON.stringify(snapshot, null, 2)}
              `,
            },
          ],
        },
      ],
    });

    const parsed = parseJson<LedgerPurchaseAdviceResult>(extractJsonText(response.text));
    return sanitizeLedgerPurchaseAdvice(parsed);
  } catch (error) {
    console.error("Gemini ledger purchase advice error:", error);
    return null;
  }
}
