// Type declarations for server/searchPlanner.mjs (pure plan-chat search helpers).
export interface ResearchPlan {
  question: string;
  topic: string;
  subject: string;
  terms: string[];
  searchVariant: string;
}

export declare function questionTerms(text: string): string[];
export declare function planResearchQuery(input: { question?: string; topic?: string; subject?: string; query?: string }): ResearchPlan;
export declare function rankWebHits<T extends { title?: string; snippet?: string; url?: string }>(
  hits: T[],
  plan: { terms?: string[]; question?: string } | null | undefined,
  isTrusted?: (url: unknown) => boolean,
): (T & { overlap: number; trusted: number; score: number; index: number })[];
export declare function termHits(text: string, terms: string[]): number;
export declare function passageWindow(text: string, terms: string[], limit?: number): string;
export declare function passagesCoverQuestion(texts: string[], questionOrTerms: string | string[]): boolean;
