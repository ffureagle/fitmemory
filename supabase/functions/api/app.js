import { Hono } from "hono";
import { cors } from "hono/cors";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, createRemoteJWKSet } from "jose";
import { analyzeRecommendation, clothingSlot, emptyStyle, isVerifiedChart } from "./engine.js";
import {
  supabaseUrl as configuredSupabaseUrl,
  supabaseProjectRef
} from "./config.js";

const SESSION_DAYS = 30;
const HOSTED_FUNCTION_URL = "https://wouetdktjqvusvsxgsyk.supabase.co/functions/v1/api";

export async function createApp(options = {}) {
  if (!options.store) {
    throw new Error("FitMemory store is required");
  }
  const store = options.store;
  const usingSupabase = options.usingSupabase === true;
  const supabaseUrl = (options.supabaseUrl || configuredSupabaseUrl()).replace(/\/$/, "");
  const jwtSecret = new TextEncoder().encode(
    (typeof process !== "undefined" && process.env?.FITMEMORY_JWT_SECRET) ||
      "fitmemory-dev-secret-change-me"
  );
  let supabaseJwks = null;
  try {
    supabaseJwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  } catch {
    supabaseJwks = null;
  }

  const app = new Hono();
  app.use("*", cors({
    origin: (origin) => origin || "*",
    allowHeaders: ["Authorization", "Content-Type", "apikey", "x-client-info"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400
  }));

  app.get("/", (context) => context.html(`<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FitMemory API</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f4f3ef; color: #111; }
      main { max-width: 640px; margin: 0 auto; padding: 48px 20px; }
      h1 { font-size: 28px; margin: 0 0 8px; }
      p { line-height: 1.5; color: #333; }
      code { background: #fff; padding: 2px 6px; border: 1px solid #ddd; }
    </style>
  </head>
  <body>
    <main>
      <p>FitMemory</p>
      <h1>API ayakta</h1>
      <p>Supabase proje: <code>${supabaseProjectRef() || supabaseUrl}</code></p>
      <p>Durum: <strong>bağlı ve kullanıma hazır</strong></p>
      <p>Kayıt yeri: <strong>${usingSupabase ? "bu Supabase Postgres" : "FitMemory API (yerel, hemen çalışır)"}</strong></p>
      <p>Chrome uzantısındaki API adresi otomatik olarak <code>http://localhost:8788</code> yapılır. Dashboard’da anahtar araman gerekmez.</p>
      <p>Sağlık: <a href="/health">/health</a></p>
    </main>
  </body>
</html>`));

  app.get("/health", async (context) => {
    let databaseHealthy = true;
    let databaseDetail = "";
    if (typeof store.ping === "function") {
      try {
        const ping = await store.ping();
        databaseHealthy = ping.ok !== false;
        databaseDetail = ping.detail || "";
      } catch (error) {
        databaseHealthy = false;
        databaseDetail = error.message || "Supabase ping başarısız";
      }
    }
    return context.json({
      status: databaseHealthy ? "healthy" : "degraded",
      service: "FitMemory.Api",
      ready: true,
      extensionApi: "http://localhost:8788",
      database: usingSupabase ? "Supabase" : "SQLite",
      supabaseUrl,
      supabaseProject: supabaseProjectRef(),
      supabaseConfigured: usingSupabase,
      hostedApi: HOSTED_FUNCTION_URL,
      databaseHealthy,
      databaseDetail: databaseDetail || undefined,
      aiProvider: "local",
      aiConfigured: false,
      utcTime: new Date().toISOString()
    });
  });

  app.post("/api/auth/register", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    const displayName = String(body.displayName || "").trim();
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    if (displayName.length < 2) {
      return problem(context, 400, "Adınız en az 2 karakter olmalıdır.");
    }
    if (!email.includes("@")) {
      return problem(context, 400, "Geçerli bir e-posta adresi girin.");
    }
    if (password.length < 8 || !/\p{L}/u.test(password) || !/\d/.test(password)) {
      return problem(context, 400, "Şifreniz en az 8 karakter olmalı ve harf ile rakam içermelidir.");
    }
    if (await store.getAccountByEmail(email)) {
      return problem(context, 409, "Bu e-posta adresiyle daha önce bir FitMemory hesabı oluşturulmuş. Giriş yapmayı deneyin.");
    }
    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    let account;
    try {
      account = await store.createAccount({
        userId,
        email,
        displayName,
        password,
        passwordHash: await bcrypt.hash(password, 10),
        createdAt: now,
        updatedAt: now
      });
    } catch (error) {
      if (error.code === "23505" || /unique|duplicate/i.test(error.message || "")) {
        return problem(context, 409, "Bu e-posta adresiyle daha önce bir FitMemory hesabı oluşturulmuş. Giriş yapmayı deneyin.");
      }
      throw error;
    }
    return context.json(await issueSession(account, password));
  });

  app.post("/api/auth/login", async (context) => {
    const body = await context.req.json().catch(() => ({}));
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    if (store.authenticate) {
      const authed = await store.authenticate(email, password);
      if (!authed) {
        return problem(context, 401, "E-posta veya şifre hatalı.");
      }
      return context.json(await issueSession(authed.account));
    }
    const account = await store.getAccountByEmail(email);
    if (!account || !await bcrypt.compare(password, account.passwordHash || "")) {
      return problem(context, 401, "E-posta veya şifre hatalı.");
    }
    return context.json(await issueSession(account, password));
  });

  app.get("/api/auth/me", async (context) => {
    const account = await requireAccount(context);
    if (account instanceof Response) return account;
    const orders = await store.listOrders(account.userId);
    return context.json(toAccountResponse(account, orders.length));
  });

  app.post("/api/auth/logout", async (context) => {
    const account = await requireAccount(context);
    if (account instanceof Response) return account;
    return context.body(null, 204);
  });

  app.get("/api/profiles/:userId", async (context) => {
    const account = await requireOwner(context, context.req.param("userId"));
    if (account instanceof Response) return account;
    const profile = await store.getProfile(account.userId);
    return profile ? context.json(profile) : context.body(null, 404);
  });

  app.put("/api/profiles/:userId", async (context) => {
    const account = await requireOwner(context, context.req.param("userId"));
    if (account instanceof Response) return account;
    const body = await context.req.json();
    const profile = await store.upsertProfile(account.userId, body);
    return context.json(profile);
  });

  app.get("/api/profiles/:userId/progress", async (context) => {
    const account = await requireOwner(context, context.req.param("userId"));
    if (account instanceof Response) return account;
    const stats = await store.progress(account.userId);
    const avoided = Math.floor(stats.confident * 0.2);
    return context.json({
      analyzedProducts: stats.analyzed,
      wardrobePieces: stats.wardrobe,
      personalFitSignals: stats.signals,
      estimatedAvoidedReturns: avoided,
      headline: stats.analyzed === 0
        ? "İlk doğru beden kararın burada başlayacak."
        : `${stats.analyzed} ürün kararını FitMemory ile netleştirdin.`,
      detail: avoided > 0
        ? `Kişisel uyum kanıtlarına göre yaklaşık ${avoided} gereksiz iade süreci yaşamama potansiyeli oluşturdun.`
        : `${stats.signals} kişisel uyum sinyali, sıradaki öneriyi daha isabetli hale getiriyor.`
    });
  });

  app.get("/api/orders", async (context) => {
    const account = await requireOwner(context, context.req.query("userId"));
    if (account instanceof Response) return account;
    return context.json(await store.listOrders(account.userId));
  });

  app.post("/api/orders", async (context) => {
    const body = await context.req.json();
    const account = await requireOwner(context, body.userId);
    if (account instanceof Response) return account;
    if (!await store.getProfile(account.userId)) {
      return problem(context, 404, "Sipariş geçmişi eklenmeden önce beden profilini oluşturun.");
    }
    const now = new Date().toISOString();
    const order = await store.createOrder(account.userId, {
      ...normalizeOrder(body),
      createdAt: now,
      updatedAt: now
    });
    return context.json(order, 201);
  });

  app.put("/api/orders/:id", async (context) => {
    const body = await context.req.json();
    const account = await requireOwner(context, body.userId);
    if (account instanceof Response) return account;
    const order = await store.updateOrder(account.userId, Number(context.req.param("id")), {
      ...normalizeOrder(body),
      updatedAt: new Date().toISOString()
    });
    return order ? context.json(order) : context.body(null, 404);
  });

  app.delete("/api/orders/:id", async (context) => {
    const account = await requireOwner(context, context.req.query("userId"));
    if (account instanceof Response) return account;
    const deleted = await store.deleteOrder(account.userId, Number(context.req.param("id")));
    return deleted ? context.body(null, 204) : context.body(null, 404);
  });

  app.patch("/api/orders/:id/feedback", async (context) => {
    const account = await requireOwner(context, context.req.query("userId"));
    if (account instanceof Response) return account;
    const body = await context.req.json();
    const order = await store.updateOrderFeedback(account.userId, Number(context.req.param("id")), body);
    return order ? context.json(order) : context.body(null, 404);
  });

  app.post("/api/recommendations/analyze", async (context) => {
    const body = await context.req.json();
    const account = await requireOwner(context, body.userId);
    if (account instanceof Response) return account;
    if (!isVerifiedChart(body.product, body.sizeChart)) {
      return problem(context, 422, "Bu ürün için bedenle eşleşen sayısal ürün ölçüleri doğrulanamadı.");
    }
    const profile = await store.getProfile(account.userId);
    if (!profile) {
      return problem(context, 404, "Beden önerisi istemeden önce profilinizi kaydedin.");
    }
    const orders = await store.listOrders(account.userId);
    const analyzed = analyzeRecommendation(profile, orders, body);
    const saved = await store.saveRecommendation(account.userId, {
      productUrl: body.product?.url || "",
      brand: body.product?.brand || "",
      productName: body.product?.name || "",
      ...analyzed,
      createdAt: new Date().toISOString()
    });
    return context.json(saved);
  });

  app.get("/api/style-board", async (context) => {
    const account = await requireOwner(context, context.req.query("userId"));
    if (account instanceof Response) return account;
    return context.json(await store.listStyleBoard(account.userId));
  });

  app.post("/api/style-board/items", async (context) => {
    const body = await context.req.json();
    const account = await requireOwner(context, body.userId);
    if (account instanceof Response) return account;
    if (!await store.getProfile(account.userId)) {
      return problem(context, 404, "Kombin Stüdyosu'na parça eklemeden önce profilini kaydet.");
    }
    const product = body.product || {};
    const now = new Date().toISOString();
    const items = await store.listStyleBoard(account.userId);
    const existing = items.find((item) => item.productUrl === String(product.url || "").trim());
    if (body.saveToStudio !== false && !existing && items.filter((item) => item.isInStudio).length >= 12) {
      return problem(context, 409, "Bir kombinde en fazla 12 aday parça tutulabilir.");
    }
    const saved = await store.saveStyleBoardItem(account.userId, {
      productUrl: String(product.url || "").trim(),
      brand: String(product.brand || "").slice(0, 120),
      productName: String(product.name || "Adsız ürün").slice(0, 240),
      category: String(product.category || clothingSlot(product)).slice(0, 120),
      price: String(product.price || "").slice(0, 80),
      imageUrl: String(product.imageUrl || "").slice(0, 2000),
      productReference: String(product.productReference || "").slice(0, 120),
      fitLabel: String(product.fitLabel || "").slice(0, 80),
      fitEvidence: String(product.fitEvidence || "").slice(0, 300),
      description: String(product.description || "").slice(0, 1200),
      materialSummary: String(product.materialSummary || "").slice(0, 240),
      materialEvidence: String(product.materialEvidence || "").slice(0, 1600),
      recommendedSize: String(body.recommendedSize || "").toUpperCase().slice(0, 30),
      recommendationConfidence: Number(body.recommendationConfidence) || 0,
      isSelected: existing?.isSelected || false,
      isInStudio: (existing?.isInStudio || false) || body.saveToStudio !== false,
      isSaved: (existing?.isSaved || false) || body.saveToCloset === true,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    return context.json(saved, existing ? 200 : 201);
  });

  app.delete("/api/style-board/items/:id", async (context) => {
    const account = await requireOwner(context, context.req.query("userId"));
    if (account instanceof Response) return account;
    const deleted = await store.deleteStyleItem(account.userId, Number(context.req.param("id")));
    return deleted ? context.body(null, 204) : context.body(null, 404);
  });

  app.post("/api/style-board/items/:id/select", async (context) => {
    const account = await requireOwner(context, context.req.query("userId"));
    if (account instanceof Response) return account;
    const item = await store.selectStyleItem(account.userId, Number(context.req.param("id")));
    return item ? context.json(item) : context.body(null, 404);
  });

  app.delete("/api/style-board", async (context) => {
    const account = await requireOwner(context, context.req.query("userId"));
    if (account instanceof Response) return account;
    await store.clearStyleBoard(account.userId);
    return context.body(null, 204);
  });

  app.post("/api/style-board/analyze", async (context) => {
    const body = await context.req.json();
    const account = await requireOwner(context, body.userId);
    if (account instanceof Response) return account;
    const items = (await store.listStyleBoard(account.userId)).filter((item) => item.isInStudio && item.isSelected);
    if (items.length < 2) {
      return problem(context, 422, "AI'ın bir ilişki değerlendirebilmesi için farklı kategorilerden en az iki aktif parça seç.");
    }
    return context.json({
      verdict: "Uyumlu kombin",
      score: 72,
      headline: `${items.length} parça birlikte okunabilir bir siluet kuruyor.`,
      explanation: items.map((item) => item.productName).join(" · "),
      notes: ["Yerel stil motoru kullanıldı.", "Renk ve kumaş için dolap notlarını ekleyebilirsin."],
      seasonContext: currentSeason(),
      createdAt: new Date().toISOString()
    });
  });

  app.post("/api/order-imports/analyze", async (context) => {
    const body = await context.req.json();
    const account = await requireOwner(context, body.userId);
    if (account instanceof Response) return account;
    if (!await store.getProfile(account.userId)) {
      return problem(context, 404, "Sipariş geçmişini taramadan önce profilinizi kaydedin.");
    }
    const cards = Array.isArray(body.orderCards) ? body.orderCards : [];
    const existing = await store.listOrders(account.userId);
    const items = [];
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const now = new Date().toISOString();
    for (const card of cards) {
      const brand = String(card.brand || "").trim();
      const productName = String(card.productName || "").trim();
      const purchasedSize = String(card.purchasedSize || "").trim().toUpperCase();
      if (!brand || !productName || !purchasedSize) {
        skipped += 1;
        items.push({
          brand, productName, purchasedSize,
          outcome: "PurchasedUnknownFit",
          researchConfidence: 20,
          researchSourceUrl: body.pageUrl || "",
          added: false,
          updated: false,
          note: "Kartta marka, ürün veya beden eksik."
        });
        continue;
      }
      const fingerprint = `${brand}|${productName}|${purchasedSize}`.toLowerCase();
      const found = existing.find((order) =>
        `${order.brand}|${order.productName}|${order.purchasedSize}`.toLowerCase() === fingerprint);
      if (found) {
        updated += 1;
        items.push({
          brand, productName, purchasedSize,
          outcome: found.outcome,
          researchConfidence: found.researchConfidence,
          researchSourceUrl: found.researchSourceUrl || "",
          added: false,
          updated: true,
          note: "Mevcut arşiv kaydı güncellendi."
        });
        continue;
      }
      await store.createOrder(account.userId, {
        brand,
        productName,
        category: "Unspecified",
        purchasedSize,
        outcome: "PurchasedUnknownFit",
        returnConfirmedByUser: false,
        fitNotes: String(card.text || "").slice(0, 500),
        productUrl: card.productLinks?.[0] || null,
        imageUrl: card.imageUrl || card.images?.[0]?.url || null,
        importFingerprint: fingerprint,
        researchConfidence: 40,
        createdAt: now,
        updatedAt: now
      });
      imported += 1;
      items.push({
        brand, productName, purchasedSize,
        outcome: "PurchasedUnknownFit",
        researchConfidence: 40,
        researchSourceUrl: body.pageUrl || "",
        added: true,
        updated: false,
        note: "Arşive eklendi."
      });
    }
    const orders = await store.listOrders(account.userId);
    return context.json({
      detectedCount: cards.length,
      importedCount: imported,
      updatedCount: updated,
      skippedCount: skipped,
      summary: `${imported} yeni parça arşive alındı.`,
      dataSource: "local-order-cards",
      items,
      orders
    });
  });

  app.onError((error, context) => {
    console.error(error);
    const detail = /setup\.sql|Supabase tabloları|service_role/i.test(error.message || "")
      ? error.message
      : "Tarama işlenirken sunucu hatası oluştu";
    return problem(context, 500, detail);
  });

  return app;

  function problem(context, status, detail) {
    return context.json({ title: detail, detail, status }, status);
  }

  function toAccountResponse(account, wardrobeItemCount) {
    return {
      userId: account.userId,
      email: account.email,
      displayName: account.displayName,
      hasProfile: Boolean(account.hasProfile),
      wardrobeItemCount
    };
  }

  async function issueSession(account, _password) {
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    const accessToken = await new SignJWT({ email: account.email })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(account.userId)
      .setExpirationTime(expiresAt)
      .sign(jwtSecret);
    const orders = await store.listOrders(account.userId);
    return {
      account: toAccountResponse(account, orders.length),
      accessToken,
      expiresAt: expiresAt.toISOString(),
      migratedLegacyData: false
    };
  }

  async function readAccount(context) {
    const header = context.req.header("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) {
      return null;
    }
    try {
      if (typeof store.resolveToken === "function") {
        const fromSupabase = await store.resolveToken(token);
        if (fromSupabase) {
          return fromSupabase;
        }
      }
      if (supabaseJwks) {
        try {
          const { payload } = await jwtVerify(token, supabaseJwks, {
            issuer: `${supabaseUrl}/auth/v1`
          });
          const userId = String(payload.sub || "");
          return userId ? await store.getAccountById(userId) : null;
        } catch {
          // Fall through to local HS256 tokens.
        }
      }
      const { payload } = await jwtVerify(token, jwtSecret);
      const userId = String(payload.sub || "");
      return userId ? await store.getAccountById(userId) : null;
    } catch {
      return null;
    }
  }

  async function requireAccount(context) {
    const account = await readAccount(context);
    if (!account) {
      return problem(context, 401, "Oturumunuz sona erdi. FitMemory hesabınıza yeniden giriş yapın.");
    }
    return account;
  }

  async function requireOwner(context, userId) {
    const account = await requireAccount(context);
    if (account instanceof Response) {
      return account;
    }
    if (!userId || account.userId !== String(userId)) {
      return problem(context, 403, "Bu kayda erişim yetkiniz yok.");
    }
    return account;
  }
}

function normalizeOrder(body) {
  return {
    brand: String(body.brand || "").trim(),
    productName: String(body.productName || "").trim(),
    category: String(body.category || "Unspecified").trim(),
    purchasedSize: String(body.purchasedSize || "").trim().toUpperCase(),
    outcome: body.outcome || "PurchasedUnknownFit",
    returnConfirmedByUser: body.returnConfirmedByUser === true,
    fitNotes: body.fitNotes || null,
    userFitNotes: body.userFitNotes || null,
    chestWidthCm: body.chestWidthCm ?? null,
    shoulderWidthCm: body.shoulderWidthCm ?? null,
    waistWidthCm: body.waistWidthCm ?? null,
    lengthCm: body.lengthCm ?? null,
    sleeveLengthCm: body.sleeveLengthCm ?? null,
    inseamCm: body.inseamCm ?? null,
    productUrl: body.productUrl || null,
    imageUrl: body.imageUrl || null,
    productFamilyKey: `${String(body.brand || "").toLowerCase()}|${String(body.productName || "").toLowerCase()}`,
    researchSourceUrl: body.researchSourceUrl || null,
    fitLabel: body.fitLabel || null,
    sizeEvidence: body.sizeEvidence || null,
    researchConfidence: Number(body.researchConfidence) || 0
  };
}

function currentSeason() {
  const month = new Date().toLocaleDateString("tr-TR", { month: "long" });
  const m = new Date().getMonth();
  const season = m >= 2 && m <= 4 ? "İlkbahar" : m >= 5 && m <= 7 ? "Yaz" : m >= 8 && m <= 10 ? "Sonbahar" : "Kış";
  return `${month} · ${season}`;
}

export { emptyStyle };
