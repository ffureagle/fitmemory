import type {
  Account,
  AuthSession,
  Order,
  OrderImportResponse,
  OrderSnapshot,
  ProductSnapshot,
  Profile,
  Recommendation,
  StyleBoardAnalysis,
  StyleBoardItem,
  FavoriteOutfit,
  WardrobeOutfit,
  ProductAgentResult,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type ApiOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  allowNotFound?: boolean;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
};

export class FitMemoryApi {
  constructor(
    private readonly baseUrl: string,
    private readonly language: "tr" | "en" = "tr",
  ) {}

  async request<T>(path: string, options: ApiOptions = {}): Promise<T> {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
    let response: Response;
    try {
      response = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}${path}`,
      {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          "Accept-Language": this.language,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      },
      );
    } catch (reason) {
      if (options.signal?.aborted) {
        throw reason;
      }
      if ((options.retries ?? 0) > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1400));
        return this.request<T>(path, {
          ...options,
          retries: (options.retries ?? 0) - 1,
        });
      }
      if (reason instanceof Error && reason.name === "AbortError") {
        throw new Error("Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.");
      }
      throw reason;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }

    if (options.allowNotFound && response.status === 404) {
      return null as T;
    }
    if ([502, 503, 504].includes(response.status) && (options.retries ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1400));
      return this.request<T>(path, {
        ...options,
        retries: (options.retries ?? 0) - 1,
      });
    }
    if (response.status === 204) {
      return undefined as T;
    }
    if (!response.ok) {
      const textResponse = response.clone();
      const fallback = `Sunucu isteği başarısız oldu (${response.status}).`;
      let message = fallback;
      try {
        const problem = (await response.json()) as {
          detail?: string;
          title?: string;
          message?: string;
          errors?: Record<string, string[]>;
        };
        message =
          Object.values(problem.errors ?? {}).flat().join(" ") ||
          problem.detail ||
          problem.title ||
          problem.message ||
          fallback;
        if (response.status === 401) {
          message =
            "E-posta veya şifre eşleşmedi. Sunucu yenilenince eski hesap silinmiş olabilir; kayıt ol sekmesinden aynı bilgilerle yeniden hesap aç.";
        } else if (response.status === 429) {
          message = "Çok fazla deneme. Bir dakika bekleyip tekrar dene.";
        } else if (response.status >= 500) {
          message =
            "Sunucu hesabı doğrulayamadı. Biraz bekleyip tekrar dene. Olmazsa kayıt ol ile yeni oturum aç.";
        }
      } catch (parseError) {
        console.warn("API problem response was not JSON", parseError);
        message = (await textResponse.text()) || fallback;
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as T;
  }

  health(timeoutMs = 60_000) {
    return this.request<{ status: string; databaseHealthy: boolean }>(
      "/health", { timeoutMs },
    );
  }

  login(email: string, password: string) {
    return this.request<AuthSession>("/api/auth/login", {
      method: "POST",
      body: { email, password },
      timeoutMs: 90_000,
    });
  }

  register(displayName: string, email: string, password: string) {
    return this.request<AuthSession>("/api/auth/register", {
      method: "POST",
      body: { displayName, email, password },
      timeoutMs: 90_000,
    });
  }

  forgotPassword(email: string) {
    return this.request<{ message: string; expiresInMinutes: number }>(
      "/api/auth/password/forgot",
      { method: "POST", body: { email }, timeoutMs: 25_000 },
    );
  }

  resetPassword(email: string, code: string, newPassword: string) {
    return this.request<void>("/api/auth/password/reset", {
      method: "POST",
      body: { email, code, newPassword },
    });
  }

  me(token: string) {
    return this.request<Account>("/api/auth/me", { token });
  }

  logout(token: string) {
    return this.request<void>("/api/auth/logout", {
      method: "POST",
      token,
    });
  }

  deleteAccount(token: string) {
    return this.request<void>("/api/auth/account", {
      method: "DELETE",
      token,
    });
  }

  createWardrobeOutfit(userId: string, token: string, prompt: string) {
    return this.request<WardrobeOutfit>("/api/style-board/wardrobe-outfit", {
      method: "POST",
      token,
      body: { userId, prompt, language: this.language },
      // Render's free instance can need close to a minute to wake up. Outfit
      // creation also includes an AI pass, so the generic 45 second deadline
      // was aborting otherwise valid requests on mobile.
      timeoutMs: 90_000,
      retries: 1,
    });
  }

  getProfile(userId: string, token: string) {
    return this.request<Profile | null>(
      `/api/profiles/${encodeURIComponent(userId)}`,
      { token, allowNotFound: true },
    );
  }

  saveProfile(
    userId: string,
    token: string,
    profile: Omit<Profile, "userId" | "createdAt" | "updatedAt">,
  ) {
    return this.request<Profile>(
      `/api/profiles/${encodeURIComponent(userId)}`,
      {
        method: "PUT",
        token,
        body: profile,
        timeoutMs: 90_000,
        retries: 1,
      },
    );
  }

  getOrders(userId: string, token: string) {
    return this.request<Order[]>(
      `/api/orders?userId=${encodeURIComponent(userId)}`,
      { token },
    );
  }

  updateOrderFeedback(
    orderId: number,
    userId: string,
    token: string,
    body: Pick<
      Order,
      "outcome" | "returnConfirmedByUser" | "userFitNotes"
    >,
  ) {
    return this.request<Order>(
      `/api/orders/${orderId}/feedback?userId=${encodeURIComponent(userId)}`,
      { method: "PATCH", token, body },
    );
  }

  deleteOrder(orderId: number, userId: string, token: string) {
    return this.request<void>(
      `/api/orders/${orderId}?userId=${encodeURIComponent(userId)}`,
      { method: "DELETE", token },
    );
  }

  analyzeProduct(
    userId: string,
    token: string,
    snapshot: ProductSnapshot,
    userAdjustmentNote = "",
    isReconsideration = false,
    signal?: AbortSignal,
  ) {
    return this.request<Recommendation>("/api/recommendations/analyze", {
      method: "POST",
      token,
      body: {
        userId,
        product: snapshot.product,
        sizeChart: snapshot.sizeChart,
        userAdjustmentNote,
        isReconsideration,
        language: this.language,
      },
      retries: 1,
      timeoutMs: 90_000,
      signal,
    });
  }

  extractProductMeasurements(
    userId: string,
    token: string,
    product: ProductSnapshot["product"],
    pageText: string,
    screenshotDataUrl: string,
  ) {
    return this.request<ProductSnapshot>("/api/product-scans/vision", {
      method: "POST",
      token,
      timeoutMs: 100_000,
      retries: 1,
      body: { userId, product, pageText, screenshotDataUrl, language: this.language },
    });
  }

  extractProductWithAgent(
    token: string,
    url: string,
    requestId: string,
    signal?: AbortSignal,
  ) {
    return this.request<ProductAgentResult>("/api/product-scans/agent", {
      method: "POST",
      token,
      timeoutMs: 190_000,
      retries: 0,
      signal,
      body: {
        url,
        requestId,
        sourcePlatform: "mobile-webview",
        language: this.language,
        maxWaitMs: 110_000,
      },
    });
  }

  importOrders(
    userId: string,
    token: string,
    snapshot: OrderSnapshot,
    screenshotDataUrl: string,
  ) {
    return this.request<OrderImportResponse>("/api/order-imports/analyze", {
      method: "POST",
      token,
      body: {
        userId,
        ...snapshot,
        screenshotDataUrl,
        productPageResearch: [],
        language: this.language,
      },
    });
  }

  getStyleBoard(userId: string, token: string) {
    return this.request<StyleBoardItem[]>(
      `/api/style-board?userId=${encodeURIComponent(userId)}`,
      { token },
    );
  }

  saveStyleBoardItem(
    userId: string,
    token: string,
    snapshot: ProductSnapshot,
    recommendation: Recommendation | null,
    target: "studio" | "saved" = "studio",
  ) {
    return this.request<StyleBoardItem>("/api/style-board/items", {
      method: "POST",
      token,
      body: {
        userId,
        product: snapshot.product,
        recommendedSize: recommendation?.recommendedSize ?? "",
        recommendationConfidence: recommendation?.confidence ?? 0,
        saveToStudio: target === "studio",
        saveToCloset: target === "saved",
      },
      retries: 1,
      timeoutMs: 90_000,
    });
  }

  deleteSavedItem(itemId: number, userId: string, token: string) {
    return this.request<void>(
      `/api/style-board/items/${itemId}/saved?userId=${encodeURIComponent(userId)}`,
      { method: "DELETE", token },
    );
  }

  getFavoriteOutfits(userId: string, token: string) {
    return this.request<FavoriteOutfit[]>(
      `/api/style-board/favorites?userId=${encodeURIComponent(userId)}`,
      { token, allowNotFound: true },
    ).then((items) => items ?? []);
  }

  saveFavoriteOutfit(
    userId: string,
    token: string,
    title: string,
    analysis: StyleBoardAnalysis,
    itemIds: number[],
  ) {
    return this.request<FavoriteOutfit>("/api/style-board/favorites", {
      method: "POST",
      token,
      body: { userId, title, analysis, itemIds },
    });
  }

  saveWardrobeFavorite(
    userId: string,
    token: string,
    title: string,
    analysis: StyleBoardAnalysis,
    orderIds: number[],
  ) {
    return this.request<FavoriteOutfit>("/api/style-board/favorites/wardrobe", {
      method: "POST",
      token,
      body: { userId, title, analysis, orderIds },
    });
  }

  deleteFavoriteOutfit(id: number, userId: string, token: string) {
    return this.request<void>(
      `/api/style-board/favorites/${id}?userId=${encodeURIComponent(userId)}`,
      { method: "DELETE", token },
    );
  }

  selectStyleBoardItem(
    itemId: number,
    userId: string,
    token: string,
    selected: boolean,
  ) {
    return this.request<StyleBoardItem>(
      `/api/style-board/items/${itemId}/select?userId=${encodeURIComponent(userId)}`,
      { method: "PATCH", token, body: { selected } },
    );
  }

  deleteStyleBoardItem(
    itemId: number,
    userId: string,
    token: string,
  ) {
    return this.request<void>(
      `/api/style-board/items/${itemId}?userId=${encodeURIComponent(userId)}`,
      { method: "DELETE", token },
    );
  }

  clearStyleBoard(userId: string, token: string) {
    return this.request<void>(
      `/api/style-board?userId=${encodeURIComponent(userId)}`,
      { method: "DELETE", token },
    );
  }

  analyzeStyleBoard(userId: string, token: string) {
    return this.request<StyleBoardAnalysis>("/api/style-board/analyze", {
      method: "POST",
      token,
      body: { userId, language: this.language },
    });
  }
}
