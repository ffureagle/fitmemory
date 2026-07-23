import * as SecureStore from "expo-secure-store";
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

const SESSION_KEY = "fitmemory.session.v1";
const API_URL_KEY = "fitmemory.api-url.v1";
const DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  "https://fitmemory-api.onrender.com";

type SessionContextValue = {
  ready: boolean;
  busy: boolean;
  apiBaseUrl: string;
  api: FitMemoryApi;
  token: string | null;
  account: Account | null;
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
  updateProfile(profile: Profile): void;
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

export function SessionProvider({ children }: PropsWithChildren) {
  const { language } = useI18n();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiBaseUrl, setApiBaseUrlState] = useState(DEFAULT_API_URL);
  const [token, setToken] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
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
      const [nextProfile, nextOrders, nextStyleBoard, nextFavorites] = await Promise.all([
        currentApi.getProfile(currentAccount.userId, currentToken),
        currentApi.getOrders(currentAccount.userId, currentToken),
        currentApi.getStyleBoard(currentAccount.userId, currentToken),
        currentApi.getFavoriteOutfits(currentAccount.userId, currentToken),
      ]);
      setProfile(nextProfile);
      setOrders(nextOrders);
      setStyleBoard(nextStyleBoard);
      setFavoriteOutfits(nextFavorites);
    },
    [],
  );

  const acceptSession = useCallback(
    async (
      session: AuthSession,
      currentApi: FitMemoryApi = api,
    ) => {
      await SecureStore.setItemAsync(
        SESSION_KEY,
        JSON.stringify({
          accessToken: session.accessToken,
          account: session.account,
          expiresAt: session.expiresAt,
        }),
        { keychainAccessible: SecureStore.WHEN_UNLOCKED },
      );
      setToken(session.accessToken);
      setAccount(session.account);
      await loadAccountData(
        currentApi,
        session.accessToken,
        session.account,
      );
    },
    [api, loadAccountData],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [storedUrl, storedSession] = await Promise.all([
          SecureStore.getItemAsync(API_URL_KEY),
          SecureStore.getItemAsync(SESSION_KEY),
        ]);
        const resolvedUrl = storedUrl
          ? normalizeApiUrl(storedUrl)
          : DEFAULT_API_URL;
        const currentApi = new FitMemoryApi(resolvedUrl, language);
        if (!active) return;
        setApiBaseUrlState(resolvedUrl);
        if (!storedSession) return;
        const parsed = JSON.parse(storedSession) as {
          accessToken?: string;
          account?: Account;
          expiresAt?: string;
        };
        if (
          !parsed.accessToken ||
          !parsed.account ||
          !parsed.expiresAt ||
          Date.parse(parsed.expiresAt) <= Date.now()
        ) {
          await clearSession();
          return;
        }
        const verifiedAccount = await currentApi.me(parsed.accessToken);
        if (!active) return;
        setToken(parsed.accessToken);
        setAccount(verifiedAccount);
        await loadAccountData(
          currentApi,
          parsed.accessToken,
          verifiedAccount,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await clearSession();
        }
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [clearSession, language, loadAccountData]);

  const login = useCallback(
    async (email: string, password: string) => {
      setBusy(true);
      try {
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
      if (token) {
        await api.logout(token).catch(() => undefined);
      }
      await clearSession();
    } finally {
      setBusy(false);
    }
  }, [api, clearSession, token]);

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
      await SecureStore.setItemAsync(API_URL_KEY, normalized);
      setApiBaseUrlState(normalized);
      if (token && account) {
        const verified = await candidate.me(token);
        setAccount(verified);
        await loadAccountData(candidate, token, verified);
      }
    },
    [account, loadAccountData, token],
  );

  const refresh = useCallback(async () => {
    if (!token || !account) return;
    await loadAccountData(api, token, account);
  }, [account, api, loadAccountData, token]);

  const value = useMemo<SessionContextValue>(
    () => ({
      ready,
      busy,
      apiBaseUrl,
      api,
      token,
      account,
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
      updateProfile: setProfile,
      updateOrders: setOrders,
      updateStyleBoard: setStyleBoard,
      updateFavoriteOutfits: setFavoriteOutfits,
    }),
    [
      account,
      api,
      apiBaseUrl,
      busy,
      login,
      logout,
      deleteAccount,
      orders,
      profile,
      ready,
      refresh,
      register,
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
