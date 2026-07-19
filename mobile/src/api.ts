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
};

export class FitMemoryApi {
  constructor(private readonly baseUrl: string) {}

  async request<T>(path: string, options: ApiOptions = {}): Promise<T> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}${path}`,
      {
        method: options.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.token
            ? { Authorization: `Bearer ${options.token}` }
            : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      },
    );

    if (options.allowNotFound && response.status === 404) {
      return null as T;
    }
    if (response.status === 204) {
      return undefined as T;
    }
    if (!response.ok) {
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
      } catch {
        message = (await response.text().catch(() => "")) || fallback;
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as T;
  }

  health() {
    return this.request<{ status: string; databaseHealthy: boolean }>(
      "/health",
    );
  }

  login(email: string, password: string) {
    return this.request<AuthSession>("/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
  }

  register(displayName: string, email: string, password: string) {
    return this.request<AuthSession>("/api/auth/register", {
      method: "POST",
      body: { displayName, email, password },
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
      { method: "PUT", token, body: profile },
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
  ) {
    return this.request<StyleBoardItem>("/api/style-board/items", {
      method: "POST",
      token,
      body: {
        userId,
        product: snapshot.product,
        recommendedSize: recommendation?.recommendedSize ?? "",
        recommendationConfidence: recommendation?.confidence ?? 0,
      },
    });
  }

  selectStyleBoardItem(
    itemId: number,
    userId: string,
    token: string,
  ) {
    return this.request<StyleBoardItem>(
      `/api/style-board/items/${itemId}/select?userId=${encodeURIComponent(userId)}`,
      { method: "PATCH", token },
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
      body: { userId },
    });
  }
}
