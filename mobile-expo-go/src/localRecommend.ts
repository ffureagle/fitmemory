import type { Order, ProductSnapshot, Profile, Recommendation } from "./types";
import { analyzeRecommendation } from "./localFitEngine";

export function recommendFromSnapshot(
  profile: Profile,
  orders: Order[],
  snapshot: ProductSnapshot,
): Recommendation {
  const result = analyzeRecommendation(profile, orders, {
    product: snapshot.product,
    sizeChart: snapshot.sizeChart,
  }) as Omit<Recommendation, "id" | "createdAt">;
  return {
    id: 0,
    recommendedSize: String(result.recommendedSize || "").toUpperCase(),
    confidence: Number(result.confidence) || 0,
    verdict: result.verdict || "",
    explanation: result.explanation || "",
    fitNotes: result.fitNotes || [],
    comparisons: result.comparisons || [],
    evidenceSummary: result.evidenceSummary || "Yerel ölçü taslağı",
    dataSource: "local-draft",
    style: result.style,
    createdAt: new Date().toISOString(),
  };
}
