import { analyzeRecommendation, clothingSlot, emptyStyle, isVerifiedChart } from "./engine.js";
import { completeOrderFields } from "./order-parse.js";

const STORE_KEY = "fitMemoryLocalDb";
const SESSION_DAYS = 30;

const memory = { db: null };

function emptyDb() {
  return {
    accounts: [],
    orders: [],
    recommendations: [],
    styleItems: [],
    sessions: [],
    nextOrderId: 1,
    nextRecId: 1,
    nextStyleId: 1
  };
}

async function loadDb() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    const stored = await chrome.storage.local.get(STORE_KEY);
    return stored[STORE_KEY] || emptyDb();
  }
  memory.db ||= emptyDb();
  return memory.db;
}

async function saveDb(db) {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    const stored = await chrome.storage.local.get(STORE_KEY);
    const previous = stored[STORE_KEY];
    if (previous?.accounts?.length && !(db.accounts && db.accounts.length)) {
      console.error("FitMemory boş hesap deposunu kaydetmeyi reddetti.");
      return;
    }
    await chrome.storage.local.set({ [STORE_KEY]: db });
    return;
  }
  memory.db = db;
}

let dbChain = Promise.resolve();

class ApiProblem extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

export async function localApiFetch(path, options = {}) {
  const run = async () => {
    const url = new URL(path, "https://fitmemory.local");
    const method = (options.method || "GET").toUpperCase();
    const body = options.body || {};
    const db = await loadDb();

    try {
      const result = await route(db, method, url.pathname, url.searchParams, body, options.accessToken);
      await saveDb(db);
      if (result && result.__noContent) {
        return null;
      }
      return result;
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 404 && options.allowNotFound) {
        return null;
      }
      if (error instanceof ApiProblem && error.status === 204 && options.expectNoContent) {
        return null;
      }
      throw error;
    }
  };
  const queued = dbChain.then(run, run);
  dbChain = queued.then(() => undefined, () => undefined);
  return queued;
}

async function route(db, method, pathname, query, body, accessToken) {
  if (method === "GET" && pathname === "/health") {
    return {
      status: "healthy",
      service: "FitMemory.Api",
      ready: true,
      database: "Extension",
      supabaseUrl: "https://wouetdktjqvusvsxgsyk.supabase.co",
      supabaseProject: "wouetdktjqvusvsxgsyk",
      databaseHealthy: true,
      utcTime: new Date().toISOString()
    };
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    return register(db, body);
  }
  if (method === "POST" && pathname === "/api/auth/login") {
    return login(db, body);
  }
  if (method === "POST" && pathname === "/api/auth/restore") {
    return restoreSession(db, body);
  }

  const account = await requireAccount(db, accessToken);
  const userId = () => requireOwner(account, query.get("userId") || body.userId || "");

  if (method === "GET" && pathname === "/api/auth/me") {
    return toAccountResponse(account, listOrders(db, account.userId).length);
  }
  if (method === "POST" && pathname === "/api/auth/logout") {
    db.sessions = db.sessions.filter((session) => session.token !== accessToken);
    return { __noContent: true };
  }

  const profileMatch = pathname.match(/^\/api\/profiles\/([^/]+)$/);
  if (profileMatch && method === "GET") {
    requireOwner(account, decodeURIComponent(profileMatch[1]));
    const profile = getProfile(account);
    if (!profile) {
      throw new ApiProblem(404, "Profil bulunamadı.");
    }
    return profile;
  }
  if (profileMatch && method === "PUT") {
    requireOwner(account, decodeURIComponent(profileMatch[1]));
    return upsertProfile(account, body);
  }

  const progressMatch = pathname.match(/^\/api\/profiles\/([^/]+)\/progress$/);
  if (progressMatch && method === "GET") {
    requireOwner(account, decodeURIComponent(progressMatch[1]));
    return progress(db, account.userId);
  }

  if (pathname === "/api/orders" && method === "GET") {
    userId();
    return listOrders(db, account.userId);
  }
  if (pathname === "/api/orders" && method === "POST") {
    userId();
    if (!getProfile(account)) {
      throw new ApiProblem(404, "Sipariş geçmişi eklenmeden önce beden profilini oluşturun.");
    }
    return createOrder(db, account.userId, body);
  }

  const orderMatch = pathname.match(/^\/api\/orders\/(\d+)$/);
  if (orderMatch && method === "PUT") {
    userId();
    const order = updateOrder(db, account.userId, Number(orderMatch[1]), body);
    if (!order) {
      throw new ApiProblem(404, "Sipariş bulunamadı.");
    }
    return order;
  }
  if (orderMatch && method === "DELETE") {
    userId();
    const deleted = deleteOrder(db, account.userId, Number(orderMatch[1]));
    if (!deleted) {
      throw new ApiProblem(404, "Sipariş bulunamadı.");
    }
    return { __noContent: true };
  }

  const feedbackMatch = pathname.match(/^\/api\/orders\/(\d+)\/feedback$/);
  if (feedbackMatch && method === "PATCH") {
    userId();
    const order = updateOrderFeedback(db, account.userId, Number(feedbackMatch[1]), body);
    if (!order) {
      throw new ApiProblem(404, "Sipariş bulunamadı.");
    }
    return order;
  }

  if (pathname === "/api/recommendations/analyze" && method === "POST") {
    userId();
    if (!isVerifiedChart(body.product, body.sizeChart)) {
      throw new ApiProblem(422, "Bu ürün için bedenle eşleşen sayısal ürün ölçüleri doğrulanamadı.");
    }
    const profile = getProfile(account);
    if (!profile) {
      throw new ApiProblem(404, "Beden önerisi istemeden önce profilinizi kaydedin.");
    }
    const analyzed = analyzeRecommendation(profile, listOrders(db, account.userId), body);
    return saveRecommendation(db, account.userId, {
      productUrl: body.product?.url || "",
      brand: body.product?.brand || "",
      productName: body.product?.name || "",
      ...analyzed,
      createdAt: new Date().toISOString()
    });
  }

  if (pathname === "/api/style-board" && method === "GET") {
    userId();
    return listStyleBoard(db, account.userId);
  }
  if (pathname === "/api/style-board" && method === "DELETE") {
    userId();
    clearStyleBoard(db, account.userId);
    return { __noContent: true };
  }
  if (pathname === "/api/style-board/items" && method === "POST") {
    userId();
    if (!getProfile(account)) {
      throw new ApiProblem(404, "Kombin Stüdyosu'na parça eklemeden önce profilini kaydet.");
    }
    return saveStyleBoardItem(db, account.userId, body);
  }

  const styleItemMatch = pathname.match(/^\/api\/style-board\/items\/(\d+)$/);
  if (styleItemMatch && method === "DELETE") {
    userId();
    const deleted = deleteStyleItem(db, account.userId, Number(styleItemMatch[1]));
    if (!deleted) {
      throw new ApiProblem(404, "Parça bulunamadı.");
    }
    return { __noContent: true };
  }

  const selectMatch = pathname.match(/^\/api\/style-board\/items\/(\d+)\/select$/);
  if (selectMatch && method === "POST") {
    userId();
    const item = selectStyleItem(db, account.userId, Number(selectMatch[1]));
    if (!item) {
      throw new ApiProblem(404, "Parça bulunamadı.");
    }
    return item;
  }

  if (pathname === "/api/style-board/analyze" && method === "POST") {
    userId();
    const items = listStyleBoard(db, account.userId).filter((item) => item.isInStudio && item.isSelected);
    if (items.length < 2) {
      throw new ApiProblem(422, "AI'ın bir ilişki değerlendirebilmesi için farklı kategorilerden en az iki aktif parça seç.");
    }
    return {
      verdict: "Uyumlu kombin",
      score: 72,
      headline: `${items.length} parça birlikte okunabilir bir siluet kuruyor.`,
      explanation: items.map((item) => item.productName).join(" · "),
      notes: ["Yerel stil motoru kullanıldı."],
      seasonContext: currentSeason(),
      createdAt: new Date().toISOString()
    };
  }

  if (pathname === "/api/order-imports/analyze" && method === "POST") {
    userId();
    if (!getProfile(account)) {
      throw new ApiProblem(404, "Sipariş geçmişini taramadan önce profilinizi kaydedin.");
    }
    return importOrders(db, account.userId, body);
  }

  throw new ApiProblem(404, "İstek bulunamadı.");
}

async function register(db, body) {
  const displayName = String(body.displayName || "").trim();
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  if (displayName.length < 2) {
    throw new ApiProblem(400, "Adınız en az 2 karakter olmalıdır.");
  }
  if (!email.includes("@")) {
    throw new ApiProblem(400, "Geçerli bir e-posta adresi girin.");
  }
  if (password.length < 8 || !/\p{L}/u.test(password) || !/\d/.test(password)) {
    throw new ApiProblem(400, "Şifreniz en az 8 karakter olmalı ve harf ile rakam içermelidir.");
  }
  if (getAccountByEmail(db, email)) {
    throw new ApiProblem(409, "Bu e-posta adresiyle daha önce bir FitMemory hesabı oluşturulmuş. Giriş yapmayı deneyin.");
  }
  const now = new Date().toISOString();
  const account = {
    userId: crypto.randomUUID(),
    email,
    displayName,
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now
  };
  db.accounts.push(account);
  return issueSession(db, account);
}

async function login(db, body) {
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const account = getAccountByEmail(db, email);
  if (!account || !await verifyPassword(password, account.passwordHash || "")) {
    throw new ApiProblem(401, "E-posta veya şifre hatalı.");
  }
  return issueSession(db, account);
}

function restoreSession(db, body) {
  const token = String(body.accessToken || "").trim();
  const userId = String(body.userId || "").trim();
  const email = String(body.email || "").trim();
  let account = null;
  if (token) {
    const session = db.sessions.find((entry) => entry.token === token);
    if (session) {
      account = db.accounts.find((entry) => entry.userId === session.userId) || null;
    }
  }
  if (!account && userId) {
    account = db.accounts.find((entry) => entry.userId === userId) || null;
  }
  if (!account && email) {
    account = getAccountByEmail(db, email);
  }
  if (!account && db.accounts.length === 1) {
    account = db.accounts[0];
  }
  if (!account) {
    throw new ApiProblem(401, "Kayıtlı oturum bulunamadı. Aynı Chrome profilinde yeniden giriş yap.");
  }
  return issueSession(db, account);
}

async function issueSession(db, account) {
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const accessToken = randomToken();
  db.sessions = db.sessions.filter((session) => session.userId !== account.userId);
  db.sessions.push({
    token: accessToken,
    userId: account.userId,
    expiresAt: expiresAt.toISOString()
  });
  return {
    account: toAccountResponse(account, listOrders(db, account.userId).length),
    accessToken,
    expiresAt: expiresAt.toISOString(),
    migratedLegacyData: false
  };
}

function requireAccount(db, token) {
  if (!token) {
    throw new ApiProblem(401, "Oturumunuz sona erdi. FitMemory hesabınıza yeniden giriş yapın.");
  }
  const session = db.sessions.find((entry) => entry.token === token);
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    throw new ApiProblem(401, "Oturumunuz sona erdi. FitMemory hesabınıza yeniden giriş yapın.");
  }
  const account = db.accounts.find((entry) => entry.userId === session.userId);
  if (!account) {
    throw new ApiProblem(401, "Oturumunuz sona erdi. FitMemory hesabınıza yeniden giriş yapın.");
  }
  return account;
}

function requireOwner(account, userId) {
  if (!userId || account.userId !== String(userId)) {
    throw new ApiProblem(403, "Bu kayda erişim yetkiniz yok.");
  }
  return account;
}

function getAccountByEmail(db, email) {
  return db.accounts.find((account) => account.email.toLowerCase() === String(email).toLowerCase()) || null;
}

function getProfile(account) {
  if (!account.age) {
    return null;
  }
  return {
    userId: account.userId,
    age: account.age,
    heightCm: account.heightCm,
    weightKg: account.weightKg,
    shoulderWidthCm: account.shoulderWidthCm,
    chestCircumferenceCm: account.chestCircumferenceCm ?? null,
    waistCircumferenceCm: account.waistCircumferenceCm,
    footLengthCm: account.footLengthCm ?? null,
    usualShoeSizeEu: account.usualShoeSizeEu ?? null,
    fitPreference: account.fitPreference || "TrueToSize",
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

function upsertProfile(account, payload) {
  const now = new Date().toISOString();
  account.age = payload.age;
  account.heightCm = payload.heightCm;
  account.weightKg = payload.weightKg;
  account.shoulderWidthCm = payload.shoulderWidthCm;
  account.chestCircumferenceCm = payload.chestCircumferenceCm ?? null;
  account.waistCircumferenceCm = payload.waistCircumferenceCm;
  account.footLengthCm = payload.footLengthCm ?? null;
  account.usualShoeSizeEu = payload.usualShoeSizeEu ?? null;
  account.fitPreference = payload.fitPreference || "TrueToSize";
  account.updatedAt = now;
  return getProfile(account);
}

function listOrders(db, userId) {
  return db.orders
    .filter((order) => order.userId === userId)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function createOrder(db, userId, body) {
  const now = new Date().toISOString();
  const order = {
    id: db.nextOrderId++,
    userId,
    ...normalizeOrder(body),
    createdAt: now,
    updatedAt: now
  };
  db.orders.push(order);
  return order;
}

function updateOrder(db, userId, id, body) {
  const order = db.orders.find((entry) => entry.id === id && entry.userId === userId);
  if (!order) {
    return null;
  }
  Object.assign(order, normalizeOrder(body), { updatedAt: new Date().toISOString() });
  return order;
}

function deleteOrder(db, userId, id) {
  const index = db.orders.findIndex((entry) => entry.id === id && entry.userId === userId);
  if (index < 0) {
    return false;
  }
  db.orders.splice(index, 1);
  return true;
}

function updateOrderFeedback(db, userId, id, payload) {
  const order = db.orders.find((entry) => entry.id === id && entry.userId === userId);
  if (!order) {
    return null;
  }
  order.outcome = payload.outcome;
  order.userFitNotes = payload.userFitNotes ?? null;
  order.returnConfirmedByUser = payload.returnConfirmedByUser === true;
  order.updatedAt = new Date().toISOString();
  return order;
}

function saveRecommendation(db, userId, rec) {
  const saved = {
    id: db.nextRecId++,
    userId,
    recommendedSize: rec.recommendedSize,
    confidence: rec.confidence,
    verdict: rec.verdict,
    explanation: rec.explanation,
    fitNotes: rec.fitNotes || [],
    comparisons: rec.comparisons || [],
    evidenceSummary: rec.evidenceSummary,
    dataSource: rec.dataSource,
    style: rec.style || emptyStyle(),
    createdAt: rec.createdAt
  };
  db.recommendations.push({ ...saved, productUrl: rec.productUrl, brand: rec.brand, productName: rec.productName });
  return saved;
}

function listStyleBoard(db, userId) {
  return db.styleItems
    .filter((item) => item.userId === userId)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function saveStyleBoardItem(db, userId, body) {
  const product = body.product || {};
  const now = new Date().toISOString();
  const items = listStyleBoard(db, userId);
  const existing = items.find((item) => item.productUrl === String(product.url || "").trim());
  if (body.saveToStudio !== false && !existing && items.filter((item) => item.isInStudio).length >= 12) {
    throw new ApiProblem(409, "Bir kombinde en fazla 12 aday parça tutulabilir.");
  }
  const saved = {
    id: existing?.id || db.nextStyleId++,
    userId,
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
  };
  if (existing) {
    Object.assign(existing, saved);
    return existing;
  }
  db.styleItems.push(saved);
  return saved;
}

function deleteStyleItem(db, userId, id) {
  const item = db.styleItems.find((entry) => entry.id === id && entry.userId === userId);
  if (!item) {
    return null;
  }
  if (item.isSaved) {
    item.isInStudio = false;
    item.isSelected = false;
    item.updatedAt = new Date().toISOString();
  } else {
    db.styleItems = db.styleItems.filter((entry) => entry !== item);
  }
  return item;
}

function selectStyleItem(db, userId, id) {
  const items = listStyleBoard(db, userId);
  const selected = items.find((item) => item.id === Number(id));
  if (!selected) {
    return null;
  }
  const shouldSelect = !selected.isSelected;
  const now = new Date().toISOString();
  for (const item of items) {
    item.isSelected = shouldSelect && item.id === selected.id;
    item.updatedAt = now;
  }
  return items.find((item) => item.id === selected.id);
}

function clearStyleBoard(db, userId) {
  const now = new Date().toISOString();
  db.styleItems = db.styleItems.filter((item) => {
    if (item.userId !== userId || !item.isInStudio) {
      return true;
    }
    if (item.isSaved) {
      item.isInStudio = false;
      item.isSelected = false;
      item.updatedAt = now;
      return true;
    }
    return false;
  });
}

function progress(db, userId) {
  const recs = db.recommendations.filter((item) => item.userId === userId);
  const orders = listOrders(db, userId);
  const analyzed = new Set(recs.map((item) => item.productUrl)).size;
  const wardrobe = orders.filter((order) => !order.returnConfirmedByUser).length;
  const signals = orders.filter((order) => order.outcome !== "PurchasedUnknownFit").length;
  const confident = new Set(recs.filter((item) => item.confidence >= 55).map((item) => item.productUrl)).size;
  const avoided = Math.floor(confident * 0.2);
  return {
    analyzedProducts: analyzed,
    wardrobePieces: wardrobe,
    personalFitSignals: signals,
    estimatedAvoidedReturns: avoided,
    headline: analyzed === 0
      ? "İlk doğru beden kararın burada başlayacak."
      : `${analyzed} ürün kararını FitMemory ile netleştirdin.`,
    detail: avoided > 0
      ? `Kişisel uyum kanıtlarına göre yaklaşık ${avoided} gereksiz iade süreci yaşamama potansiyeli oluşturdun.`
      : `${signals} kişisel uyum sinyali, sıradaki öneriyi daha isabetli hale getiriyor.`
  };
}

function importOrders(db, userId, body) {
  const cards = Array.isArray(body.orderCards) ? body.orderCards : [];
  const existing = listOrders(db, userId);
  const items = [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  for (const card of cards) {
    const { brand, productName, purchasedSize } = completeOrderFields(
      card,
      body.retailer || ""
    );
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
    createOrder(db, userId, {
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
      researchConfidence: 40
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
  return {
    detectedCount: cards.length,
    importedCount: imported,
    updatedCount: updated,
    skippedCount: skipped,
    summary: `${imported} yeni parça arşive alındı.`,
    dataSource: "local-order-cards",
    items,
    orders: listOrders(db, userId)
  };
}

function toAccountResponse(account, wardrobeItemCount) {
  return {
    userId: account.userId,
    email: account.email,
    displayName: account.displayName,
    hasProfile: Boolean(account.age),
    wardrobeItemCount
  };
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

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt,
    iterations: 100000,
    hash: "SHA-256"
  }, key, 256);
  return `pbkdf2:${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || "").split(":");
  if (scheme !== "pbkdf2" || !saltHex || !hashHex) {
    return false;
  }
  const salt = fromHex(saltHex);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt,
    iterations: 100000,
    hash: "SHA-256"
  }, key, 256);
  return toHex(new Uint8Array(bits)) === hashHex;
}

function toHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function fromHex(value) {
  const pairs = value.match(/.{1,2}/g) || [];
  return new Uint8Array(pairs.map((pair) => Number.parseInt(pair, 16)));
}
