import * as SecureStore from "expo-secure-store";
import type { FitPreference, Profile } from "./types";

const STORE_OPTIONS = {
  keychainAccessible:
    SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY ??
    SecureStore.AFTER_FIRST_UNLOCK ??
    SecureStore.WHEN_UNLOCKED,
};

export const PROFILE_DRAFT_KEY = "fitmemory.profile-draft.v1";
export const PROFILE_PENDING_KEY = "fitmemory.profile-pending.v1";

export type ProfileFormState = {
  age: string;
  height: string;
  weight: string;
  shoulder: string;
  chest: string;
  waist: string;
  foot: string;
  shoe: string;
  preference: FitPreference;
};

export type ProfileDraft = {
  userId: string;
  form: ProfileFormState;
  savedAt: number;
};

export function shoulderCircumferenceCm(raw: number | null | undefined) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value >= 70 ? value : value * 2;
}

export function formatShoulderCircumference(raw: number | null | undefined) {
  const circ = shoulderCircumferenceCm(raw);
  return circ > 0 ? String(circ) : "";
}

export function initialProfileForm(profile: Profile | null): ProfileFormState {
  return {
    age: profile?.age?.toString() ?? "",
    height: profile?.heightCm?.toString() ?? "",
    weight: profile?.weightKg?.toString() ?? "",
    shoulder: formatShoulderCircumference(profile?.shoulderWidthCm),
    chest: profile?.chestCircumferenceCm?.toString() ?? "",
    waist: profile?.waistCircumferenceCm?.toString() ?? "",
    foot: profile?.footLengthCm?.toString() ?? "",
    shoe: profile?.usualShoeSizeEu?.toString() ?? "",
    preference: profile?.fitPreference ?? "TrueToSize",
  };
}

export async function readProfileDraft(userId?: string | null) {
  if (!userId) return null;
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProfileDraft;
    if (parsed?.userId !== userId || !parsed.form) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeProfileDraft(userId: string, form: ProfileFormState) {
  await SecureStore.setItemAsync(
    PROFILE_DRAFT_KEY,
    JSON.stringify({ userId, form, savedAt: Date.now() } satisfies ProfileDraft),
    STORE_OPTIONS,
  );
}

export async function clearProfileDraft() {
  await SecureStore.deleteItemAsync(PROFILE_DRAFT_KEY);
}

export async function readPendingProfile(userId?: string | null) {
  if (!userId) return null;
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    if (parsed?.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writePendingProfile(profile: Profile) {
  await SecureStore.setItemAsync(
    PROFILE_PENDING_KEY,
    JSON.stringify(profile),
    STORE_OPTIONS,
  );
}

export async function clearPendingProfile() {
  await SecureStore.deleteItemAsync(PROFILE_PENDING_KEY);
}

export function isPendingNewer(pending: Profile, server: Profile | null) {
  if (!server) return true;
  const pendingAt = Date.parse(pending.updatedAt);
  const serverAt = Date.parse(server.updatedAt);
  if (!Number.isFinite(pendingAt)) return false;
  if (!Number.isFinite(serverAt)) return true;
  return pendingAt >= serverAt;
}

export function profileForServerSync(
  profile: Omit<Profile, "userId" | "createdAt" | "updatedAt">,
) {
  const inRange = (value: number | null | undefined, min: number, max: number) =>
    value != null && Number.isFinite(value) && value >= min && value <= max
      ? value
      : null;
  return {
    ...profile,
    chestCircumferenceCm: inRange(profile.chestCircumferenceCm, 60, 180),
    footLengthCm: inRange(profile.footLengthCm, 15, 40),
    usualShoeSizeEu: inRange(profile.usualShoeSizeEu, 20, 55),
  };
}
