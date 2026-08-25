import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ApiError, FitMemoryApi } from "./api";
import type {
  Account,
  AuthSession,
  Order,
  Profile,
  StyleBoardItem,
  FavoriteOutfit,
} from "./types";
import { useI18n } from "./i18n";
import {
  clearPendingProfile,
  clearProfileDraft,
  isPendingNewer,
  profileForServerSync,
  readPendingProfile,
  writePendingProfile,
} from "./profilePersistence";

const SESSION_KEY = "fitmemory.session.v1";
const API_URL_KEY = "fitmemory.api-url.v1";
const LAST_EMAIL_KEY = "fitmemory.last-email.v1";
const DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  String(Constants.expoConfig?.extra?.apiBaseUrl || "") ||
  "https://fitmemory-api.onrender.com";

const STORE_OPTIONS = {
  keychainAccessible:
    SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY ??
    SecureStore.AFTER_FIRST_UNLOCK ??
    SecureStore.WHEN_UNLOCKED,
};

type StoredSession = {
  accessToken?: string;
  account?: Account;
  expiresAt?: string;
};

type SessionContextValue = {
  ready: boolean;
  busy: boolean;
  apiBaseUrl: string;
  api: FitMemoryApi;
  token: string | null;
  account: Account | null;
  lastEmail: string;
  profile: Profile | null;
  orders: Order[];
  styleBoard: StyleBoardItem[];
  favoriteOutfits: FavoriteOutfit[];
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  deleteAccount(): Promise<void>;
  setApiBaseUrl(value: string): Promise<void>;
  refresh(): Promise<void>;
  syncPendingProfile(): Promise<void>;
  updateProfile(profile: Profile, pendingSync?: boolean): void;
  updateOrders(orders: Order[]): void;
  updateStyleBoard(items: StyleBoardItem[]): void;
  updateFavoriteOutfits(items: FavoriteOutfit[]): void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

function normalizeApiUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+/i.test(trimmed)) {
    throw new Error("API adresi http:// veya https:// ile başlamalı.");
  }
  return trimmed;
}

async function readLastEmail() {
  const value = await SecureStore.getItemAsync(LAST_EMAIL_KEY);
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function writeLastEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  await SecureStore.setItemAsync(LAST_EMAIL_KEY, normalized, STORE_OPTIONS);
}

export function SessionProvider({ children }: PropsWithChildren) {
  const { language } = useI18n();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiBaseUrl, setApiBaseUrlState] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [lastEmail, setLastEmail] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [styleBoard, setStyleBoard] = useState<StyleBoardItem[]>([]);
  const [favoriteOutfits, setFavoriteOutfits] = useState<FavoriteOutfit[]>([]);
  const api = useMemo(
    () => new FitMemoryApi(apiBaseUrl, language),
    [apiBaseUrl, language],
  );

  const clearSession = useCallback(async () => {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    await clearPendingProfile();
    await clearProfileDraft();
    setToken(null);
    setAccount(null);
    setProfile(null);
    setOrders([]);
    setStyleBoard([]);
    setFavoriteOutfits([]);
  }, []);

  const loadAccountData = useCallback(
    async (
      currentApi: FitMemoryApi,
      currentToken: string,
      currentAccount: Account,
    ) => {
      const [nextProfile, nextOrders, nextStyleBoard, nextFavorites] =
        await Promise.allSettled([
          currentApi.getProfile(currentAccount.userId, currentToken),
          currentApi.getOrders(currentAccount.userId, currentToken),
          currentApi.getStyleBoard(currentAccount.userId, currentToken),
          currentApi.getFavoriteOutfits(currentAccount.userId, currentToken),
        ]);
      const rejected = [nextProfile, nextOrders, nextStyleBoard, nextFavorites]
        .map((result) => (result.status === "rejected" ? result.reason : null))
        .find((reason) => reason instanceof ApiError && reason.status === 401);
      if (rejected) {
        throw rejected;
      }
      if (nextProfile.status === "fulfilled") {
        const serverProfile = nextProfile.value;
        const pending = await readPendingProfile(currentAccount.userId);
        if (pending && isPendingNewer(pending, serverProfile)) {
          setProfile(pending);
          void currentApi
            .saveProfile(
              currentAccount.userId,
              currentToken,
              profileForServerSync({
                age: pending.age,
                heightCm: pending.heightCm,
                weightKg: pending.weightKg,
                shoulderWidthCm: pending.shoulderWidthCm,
                chestCircumferenceCm: pending.chestCircumferenceCm,
                waistCircumferenceCm: pending.waistCircumferenceCm,
                footLengthCm: pending.footLengthCm,
                usualShoeSizeEu: pending.usualShoeSizeEu,
                fitPreference: pending.fitPreference,
              }),
            )
            .then(async (saved) => {
              setProfile(saved);
              await clearPendingProfile();
            })
            .catch(() => undefined);
        } else {
          setProfile(serverProfile);
          if (serverProfile) {
            await clearPendingProfile();
          }
        }
      } else {
        const pending = await readPendingProfile(currentAccount.userId);
        if (pending) {
          setProfile(pending);
        }
      }
      if (nextOrders.status === "fulfilled") {
        setOrders(nextOrders.value ?? []);
      }
      if (nextStyleBoard.status === "fulfilled") {
        setStyleBoard(nextStyleBoard.value ?? []);
      }
      if (nextFavorites.status === "fulfilled") {
        setFavoriteOutfits(nextFavorites.value ?? []);
      }
    },
    [],
  );

  const persistSession = useCallback(async (session: Pick<AuthSession, "accessToken" | "account" | "expiresAt">) => {
    const email = String(session.account?.email || "").trim().toLowerCase();
    await SecureStore.setItemAsync(
      SESSION_KEY,
      JSON.stringify({
        accessToken: session.accessToken,
        account: session.account,
        expiresAt: session.expiresAt,
      }),
      STORE_OPTIONS,
    );
    if (email) {
      await writeLastEmail(email);
      setLastEmail(email);
    }
  }, []);

  const acceptSession = useCallback(
    async (
      session: AuthSession,
      currentApi: FitMemoryApi = api,
    ) => {
      await persistSession(session);
      setToken(session.accessToken);
      setAccount(session.account);
      try {
        await loadAccountData(
          currentApi,
          session.accessToken,
          session.account,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          throw error;
        }
      }
    },
    [api, loadAccountData, persistSession],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [storedUrl, storedSession, storedEmail] = await Promise.all([
          SecureStore.getItemAsync(API_URL_KEY),
          SecureStore.getItemAsync(SESSION_KEY),
          readLastEmail(),
        ]);
        const resolvedUrl = storedUrl
          ? normalizeApiUrl(storedUrl)
          : DEFAULT_API_URL;
        const currentApi = new FitMemoryApi(resolvedUrl, language);
        if (!active) return;
        setApiBaseUrlState(resolvedUrl);
        if (storedEmail) setLastEmail(storedEmail);
        if (!storedSession) return;
        const parsed = JSON.parse(storedSession) as StoredSession;
        const email = String(parsed.account?.email || storedEmail || "")
          .trim()
          .toLowerCase();
        if (email) {
          setLastEmail(email);
          await writeLastEmail(email);
        }
        if (!parsed.accessToken || !parsed.account?.userId) {
          return;
        }
        setToken(parsed.accessToken);
        setAccount(parsed.account);
        const pendingProfile = await readPendingProfile(parsed.account.userId);
        if (pendingProfile && active) {
          setProfile(pendingProfile);
        }
        if (active) setReady(true);
        try {
          await currentApi.health(90_000).catch(() => undefined);
          const verifiedAccount = await currentApi.me(parsed.accessToken);
          if (!active) return;
          setAccount(verifiedAccount);
          await persistSession({
            accessToken: parsed.accessToken,
            account: verifiedAccount,
            expiresAt: parsed.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          });
          await loadAccountData(
            currentApi,
            parsed.accessToken,
            verifiedAccount,
          );
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            await clearSession();
          }
        }
        return;
      } catch {
        // Bozuk kasa kaydı girişi engellemesin; e-posta hatırlanır.
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [clearSession, language, loadAccountData, persistSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      setBusy(true);
      try {
        await writeLastEmail(email);
        setLastEmail(email.trim().toLowerCase());
        await api.health(90_000).catch(() => undefined);
        await acceptSession(await api.login(email.trim(), password));
      } finally {
        setBusy(false);
      }
    },
    [acceptSession, api],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      setBusy(true);
      try {
        await writeLastEmail(email);
        setLastEmail(email.trim().toLowerCase());
        await api.health(90_000).catch(() => undefined);
        await acceptSession(
          await api.register(name.trim(), email.trim(), password),
        );
      } finally {
        setBusy(false);
      }
    },
    [acceptSession, api],
  );

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      if (account?.email) {
        await writeLastEmail(account.email);
        setLastEmail(account.email.trim().toLowerCase());
      }
      if (token) {
        await api.logout(token).catch(() => undefined);
      }
      await clearSession();
    } finally {
      setBusy(false);
    }
  }, [account, api, clearSession, token]);

  const deleteAccount = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    try {
      await api.deleteAccount(token);
      await clearSession();
    } finally {
      setBusy(false);
    }
  }, [api, clearSession, token]);

  const setApiBaseUrl = useCallback(
    async (value: string) => {
      const normalized = normalizeApiUrl(value);
      const candidate = new FitMemoryApi(normalized);
      const health = await candidate.health();
      if (health.status !== "healthy" || !health.databaseHealthy) {
        throw new Error("API açık ancak veritabanı hazır değil.");
      }
      await SecureStore.setItemAsync(API_URL_KEY, normalized, STORE_OPTIONS);
      setApiBaseUrlState(normalized);
      if (token && account) {
        try {
          const verified = await candidate.me(token);
          setAccount(verified);
          await loadAccountData(candidate, token, verified);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            throw error;
          }
        }
      }
    },
    [account, loadAccountData, token],
  );

  const refresh = useCallback(async () => {
    if (!token || !account) return;
    try {
      await loadAccountData(api, token, account);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await clearSession();
      }
    }
  }, [account, api, clearSession, loadAccountData, token]);

  const syncPendingProfile = useCallback(async () => {
    if (!token || !account) return;
    const pending = await readPendingProfile(account.userId);
    if (!pending) return;
    const saved = await api.saveProfile(
      account.userId,
      token,
      profileForServerSync({
        age: pending.age,
        heightCm: pending.heightCm,
        weightKg: pending.weightKg,
        shoulderWidthCm: pending.shoulderWidthCm,
        chestCircumferenceCm: pending.chestCircumferenceCm,
        waistCircumferenceCm: pending.waistCircumferenceCm,
        footLengthCm: pending.footLengthCm,
        usualShoeSizeEu: pending.usualShoeSizeEu,
        fitPreference: pending.fitPreference,
      }),
    );
    setProfile(saved);
    await clearPendingProfile();
  }, [account, api, token]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ready,
      busy,
      apiBaseUrl,
      api,
      token,
      account,
      lastEmail,
      profile,
      orders,
      styleBoard,
      favoriteOutfits,
      login,
      register,
      logout,
      deleteAccount,
      setApiBaseUrl,
      refresh,
      syncPendingProfile,
      updateProfile: (next, pendingSync = false) => {
        setProfile(next);
        if (pendingSync) {
          void writePendingProfile(next);
        } else {
          void clearPendingProfile();
        }
      },
      updateOrders: setOrders,
      updateStyleBoard: setStyleBoard,
      updateFavoriteOutfits: setFavoriteOutfits,
    }),
    [
      account,
      api,
      apiBaseUrl,
      busy,
      lastEmail,
      login,
      logout,
      deleteAccount,
      orders,
      profile,
      ready,
      refresh,
      register,
      syncPendingProfile,
      setApiBaseUrl,
      styleBoard,
      favoriteOutfits,
      token,
    ],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession, SessionProvider içinde kullanılmalıdır.");
  }
  return value;
}
