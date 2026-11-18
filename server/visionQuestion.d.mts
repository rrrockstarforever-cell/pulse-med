// Type declarations for server/visionQuestion.mjs (image-first question generation).
export interface VisionQuestionSpec {
  stem: string;
  questionText: string;
  options: Record<string, string>;
  correctOption: string;
  explanation: string;
  boardPearl: string;
  citations: string[];
}

export interface GenerateFromImageOptions {
  imageUrl: string;
  groundTruth: string;
  modality?: string;
  subject?: string;
  bodyPart?: string;
  exam?: 'NEET_PG' | 'INI_CET';
  difficultyTier?: 'LOW' | 'MEDIUM' | 'HIGH' | 'ALL';
  optionCount?: number;
  /** OpenAI-compatible chat completions URL of the provider that writes the question. */
  url: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  /** For ChatGPT, Claude and Grok: returns the model's reply text for one picture; used instead of url and apiKey. */
  complete?: (input: { system: string; instruction: string; dataUrl: string }) => Promise<string>;
}

export declare function buildImageQuestionInstruction(input: {
  groundTruth: string;
  modality?: string;
  subject?: string;
  bodyPart?: string;
  examLabel: string;
  optionCount: 4 | 5;
}): string;

export declare function generateQuestionFromImage(opts: GenerateFromImageOptions): Promise<VisionQuestionSpec>;

export declare function parseLooseJson(text: string): any | null;
