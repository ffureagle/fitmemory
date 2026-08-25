export function analyzeRecommendation(
  profile: unknown,
  orders: unknown,
  request: unknown,
): {
  recommendedSize: string;
  confidence: number;
  verdict: string;
  explanation: string;
  fitNotes: string[];
  comparisons: { label: string; detail: string }[];
  evidenceSummary: string;
  dataSource: string;
  style: {
    compatibleItemCount: number;
    outfitCount: number;
    confidence: number;
    headline: string;
    summary: string;
    ageContext: string;
    outfits: unknown[];
  };
};
export function emptyStyle(): unknown;
export function isVerifiedChart(product: unknown, chart: unknown): boolean;
export function clothingSlot(product: unknown): string;
