export type Account = {
  userId: string;
  email: string;
  displayName: string;
  hasProfile: boolean;
  wardrobeItemCount: number;
};

export type AuthSession = {
  account: Account;
  accessToken: string;
  expiresAt: string;
  migratedLegacyData: boolean;
};

export type Profile = {
  userId: string;
  age: number | null;
  heightCm: number;
  weightKg: number;
  shoulderWidthCm: number;
  chestCircumferenceCm: number | null;
  waistCircumferenceCm: number;
  footLengthCm: number | null;
  usualShoeSizeEu: number | null;
  fitPreference: FitPreference;
  createdAt: string;
  updatedAt: string;
};

export type FitPreference =
  | "TrueToSize"
  | "Relaxed"
  | "Oversized"
  | "Slim";

export type Product = {
  url: string;
  brand: string;
  name: string;
  category: string;
  price: string;
  imageUrl: string;
  productReference: string;
  fitLabel: string;
  fitEvidence: string;
  description: string;
  modelHeightCm: number | null;
  modelWornSize: string;
  modelEvidence: string;
};

export type SizeChart = {
  found: boolean;
  title: string;
  unit: string;
  headers: string[];
  rows: { cells: string[] }[];
  rawText: string;
};

export type ProductSnapshot = {
  product: Product;
  sizeChart: SizeChart;
  capturedAt: string;
};

export type StylePiece = {
  orderId: number;
  brand: string;
  productName: string;
  category: string;
  purchasedSize: string;
  imageUrl: string | null;
  productUrl: string | null;
  role: string;
  reason: string;
};

export type StyleOutfit = {
  title: string;
  direction: string;
  pieces: StylePiece[];
};

export type Recommendation = {
  id: number;
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
    outfits: StyleOutfit[];
  };
  createdAt: string;
};

export type Order = {
  id: number;
  userId: string;
  brand: string;
  productName: string;
  category: string;
  purchasedSize: string;
  outcome:
    | "PurchasedUnknownFit"
    | "KeptGoodFit"
    | "ReturnedTooBaggy"
    | "ReturnedTooTight"
    | "KeptTooBaggy"
    | "KeptTooTight";
  returnConfirmedByUser: boolean;
  fitNotes: string | null;
  userFitNotes: string | null;
  chestWidthCm: number | null;
  shoulderWidthCm: number | null;
  waistWidthCm: number | null;
  lengthCm: number | null;
  sleeveLengthCm: number | null;
  inseamCm: number | null;
  productUrl: string | null;
  imageUrl: string | null;
  productFamilyKey: string | null;
  researchSourceUrl: string | null;
  fitLabel: string | null;
  sizeEvidence: string | null;
  researchConfidence: number;
  fitScore: number | null;
  fitAssessment: string | null;
  fitAssessmentConfidence: number;
  createdAt: string;
  updatedAt: string;
};

export type StyleBoardItem = {
  id: number;
  userId: string;
  productUrl: string;
  brand: string;
  productName: string;
  category: string;
  price: string;
  imageUrl: string;
  productReference: string;
  fitLabel: string;
  fitEvidence: string;
  description: string;
  recommendedSize: string;
  recommendationConfidence: number;
  isSelected: boolean;
  createdAt: string;
  updatedAt: string;
};

export type StyleBoardAnalysis = {
  verdict: string;
  score: number;
  headline: string;
  explanation: string;
  notes: string[];
  seasonContext: string;
  createdAt: string;
};

export type OrderCardImage = {
  url: string;
  alt: string;
  productUrl: string;
};

export type OrderCard = {
  text: string;
  brand: string;
  productName: string;
  purchasedSize: string;
  productLinks: string[];
  imageAlt: string;
  imageUrl: string;
  images: OrderCardImage[];
};

export type OrderSnapshot = {
  pageUrl: string;
  pageTitle: string;
  retailer: string;
  sanitizedText: string;
  orderCards: OrderCard[];
};

export type OrderImportResponse = {
  detectedCount: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  summary: string;
  dataSource: string;
  items: {
    brand: string;
    productName: string;
    purchasedSize: string;
    outcome: string;
    researchConfidence: number;
    researchSourceUrl: string;
    added: boolean;
    updated: boolean;
    note: string;
  }[];
  orders: Order[];
};

export type ScannerMessage =
  | { type: "fitmemory-product"; snapshot: ProductSnapshot }
  | { type: "fitmemory-orders"; snapshot: OrderSnapshot }
  | { type: "fitmemory-error"; message: string };
