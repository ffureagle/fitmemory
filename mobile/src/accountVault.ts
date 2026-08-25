import * as SecureStore from "expo-secure-store";
import type { Order, Product, Profile, StyleBoardItem } from "./types";

const STORE_OPTIONS = {
  keychainAccessible:
    SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY ??
    SecureStore.AFTER_FIRST_UNLOCK ??
    SecureStore.WHEN_UNLOCKED,
};

const VAULT_KEY = "fitmemory.account-vault.v2";

export type VaultOrder = {
  brand: string;
  productName: string;
  category: string;
  purchasedSize: string;
  outcome: Order["outcome"];
  returnConfirmedByUser: boolean;
  fitNotes: string | null;
  userFitNotes: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  fitLabel: string | null;
};

export type VaultStyleItem = {
  product: Product;
  recommendedSize: string;
  recommendationConfidence: number;
  isInStudio: boolean;
  isSaved: boolean;
};

export type AccountVault = {
  email: string;
  displayName: string;
  profile: Omit<Profile, "userId" | "createdAt" | "updatedAt"> | null;
  orders: VaultOrder[];
  styleBoard: VaultStyleItem[];
  savedAt: number;
};

type VaultMap = Record<string, AccountVault>;

function emailKey(email: string) {
  return email.trim().toLowerCase();
}

async function readMap(): Promise<VaultMap> {
  try {
    const raw = await SecureStore.getItemAsync(VAULT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as VaultMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMap(map: VaultMap) {
  const compact: VaultMap = {};
  for (const [key, vault] of Object.entries(map)) {
    compact[key] = {
      ...vault,
      orders: vault.orders.slice(0, 40),
      styleBoard: vault.styleBoard.slice(0, 24),
    };
  }
  try {
    await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(compact), STORE_OPTIONS);
  } catch {
    for (const [key, vault] of Object.entries(compact)) {
      compact[key] = {
        ...vault,
        orders: vault.orders.slice(0, 8),
        styleBoard: vault.styleBoard.slice(0, 6),
      };
    }
    await SecureStore.setItemAsync(VAULT_KEY, JSON.stringify(compact), STORE_OPTIONS).catch(
      () => undefined,
    );
  }
}

export async function readAccountVault(email?: string | null) {
  const key = emailKey(email || "");
  if (!key) return null;
  const map = await readMap();
  return map[key] ?? null;
}

export async function writeAccountVault(vault: AccountVault) {
  const key = emailKey(vault.email);
  if (!key) return;
  const map = await readMap();
  map[key] = { ...vault, email: key, savedAt: Date.now() };
  await writeMap(map);
}

export async function persistSessionVault(input: {
  email?: string | null;
  displayName?: string | null;
  profile: Profile | null;
  orders: Order[];
  styleBoard: StyleBoardItem[];
}) {
  const email = emailKey(input.email || "");
  if (!email) return;
  await writeAccountVault(
    vaultFromState({
      email,
      displayName: input.displayName || "",
      profile: input.profile,
      orders: input.orders,
      styleBoard: input.styleBoard,
    }),
  );
}

export async function clearAccountVault(email?: string | null) {
  const key = emailKey(email || "");
  if (!key) return;
  const map = await readMap();
  if (!(key in map)) return;
  delete map[key];
  await writeMap(map);
}

export function profileFromVault(
  vault: AccountVault,
  userId: string,
): Profile | null {
  if (!vault.profile) return null;
  const now = new Date().toISOString();
  return {
    userId,
    ...vault.profile,
    createdAt: now,
    updatedAt: now,
  };
}

export function ordersFromVault(vault: AccountVault, userId: string): Order[] {
  const now = new Date().toISOString();
  return vault.orders.map((order, index) => ({
    id: -(index + 1),
    userId,
    brand: order.brand,
    productName: order.productName,
    category: order.category,
    purchasedSize: order.purchasedSize,
    outcome: order.outcome,
    returnConfirmedByUser: order.returnConfirmedByUser,
    fitNotes: order.fitNotes,
    userFitNotes: order.userFitNotes,
    chestWidthCm: null,
    shoulderWidthCm: null,
    waistWidthCm: null,
    lengthCm: null,
    sleeveLengthCm: null,
    inseamCm: null,
    productUrl: order.productUrl,
    imageUrl: order.imageUrl,
    productFamilyKey: null,
    researchSourceUrl: null,
    fitLabel: order.fitLabel,
    sizeEvidence: null,
    materialSummary: null,
    materialEvidence: null,
    researchConfidence: 0,
    fitScore: null,
    fitAssessment: null,
    fitAssessmentConfidence: 0,
    createdAt: now,
    updatedAt: now,
  }));
}

export function vaultFromState(input: {
  email: string;
  displayName: string;
  profile: Profile | null;
  orders: Order[];
  styleBoard: StyleBoardItem[];
}): AccountVault {
  return {
    email: emailKey(input.email),
    displayName: input.displayName.trim() || input.email.split("@")[0] || "Kullanıcı",
    profile: input.profile
      ? {
          age: input.profile.age,
          heightCm: input.profile.heightCm,
          weightKg: input.profile.weightKg,
          shoulderWidthCm: input.profile.shoulderWidthCm,
          chestCircumferenceCm: input.profile.chestCircumferenceCm,
          waistCircumferenceCm: input.profile.waistCircumferenceCm,
          footLengthCm: input.profile.footLengthCm,
          usualShoeSizeEu: input.profile.usualShoeSizeEu,
          fitPreference: input.profile.fitPreference,
        }
      : null,
    orders: input.orders.map((order) => ({
      brand: order.brand,
      productName: order.productName,
      category: order.category,
      purchasedSize: order.purchasedSize,
      outcome: order.outcome,
      returnConfirmedByUser: order.returnConfirmedByUser,
      fitNotes: order.fitNotes,
      userFitNotes: order.userFitNotes,
      productUrl: order.productUrl,
      imageUrl: order.imageUrl,
      fitLabel: order.fitLabel,
    })),
    styleBoard: input.styleBoard.map((item) => ({
      product: {
        url: item.productUrl,
        brand: item.brand,
        name: item.productName,
        category: item.category,
        price: item.price,
        imageUrl: item.imageUrl,
        productReference: item.productReference,
        fitLabel: item.fitLabel,
        fitEvidence: item.fitEvidence,
        merchantFitAdvice: "",
        description: item.description,
        materialSummary: item.materialSummary,
        materialEvidence: item.materialEvidence,
        modelHeightCm: null,
        modelWornSize: "",
        modelEvidence: "",
      },
      recommendedSize: item.recommendedSize,
      recommendationConfidence: item.recommendationConfidence,
      isInStudio: item.isInStudio,
      isSaved: item.isSaved,
    })),
    savedAt: Date.now(),
  };
}
