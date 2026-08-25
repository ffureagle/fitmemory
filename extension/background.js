import { localApiFetch } from "./local-backend.js";

const DEFAULT_API_BASE_URL = "http://localhost:8788";
const SUPABASE_PROJECT_HOST = "wouetdktjqvusvsxgsyk.supabase.co";
const IDENTITY_KEY = "fitMemoryUserId";
const SETTINGS_KEY = "fitMemorySettings";
const AUTH_KEY = "fitMemoryAuth";
const LAST_EMAIL_KEY = "fitMemoryLastEmail";
const TARGET_TAB_KEY = "fitMemoryTargetTabId";
const tabStateQueues = new Map();

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.storage.session.clear();
    await getLegacyIdentity();
    const { [SETTINGS_KEY]: existing } = await chrome.storage.local.get(SETTINGS_KEY);
    await chrome.storage.local.set({
      [SETTINGS_KEY]: {
        ...existing,
        apiBaseUrl: DEFAULT_API_BASE_URL,
        autoAnalyze: existing?.autoAnalyze ?? true
      }
    });
    await configureSidePanel();
    await clearLegacyPageCards();
  } catch (error) {
    console.error("FitMemory kurulum hatası", error);
  }
});

chrome.runtime.onStartup.addListener(() => {
  enforceProductionApiUrl().catch((error) => {
    console.error("FitMemory API address could not be enforced.", error);
  });
  configureSidePanel().catch(console.error);
  clearLegacyPageCards().catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([
    snapshotKey(tabId),
    recommendationKey(tabId),
    fingerprintKey(tabId),
    analysisKey(tabId)
  ]);
  tabStateQueues.delete(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isScannableWebUrl(tab.url)) {
      await chrome.storage.session.set({
        [TARGET_TAB_KEY]: tabId
      });
    }
  } catch {
    // A tab can disappear while Chrome is switching windows.
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) {
    return;
  }
  invalidateTabStateForNavigation(tabId, changeInfo.url).catch((error) => {
    console.info("FitMemory could not invalidate navigation state.", error);
  });
});

async function configureSidePanel() {
  await chrome.sidePanel.setPanelBehavior({
    openPanelOnActionClick: true
  });
}

async function clearLegacyPageCards() {
  const tabs = await chrome.tabs.query({
    url: ["http://*/*", "https://*/*"]
  });
  await Promise.allSettled(tabs.map((tab) =>
    tab.id === undefined
      ? Promise.resolve()
      : chrome.tabs.sendMessage(tab.id, {
          type: "CLEAR_FITMEMORY_RECOMMENDATION"
        })));
}

function isScannableWebUrl(value) {
  return /^https?:/i.test(value || "") &&
    !isProtectedWebStoreUrl(value);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "FITMEMORY_PAGE_SNAPSHOT" && sender.tab?.id !== undefined) {
    receivePageSnapshot(sender.tab.id, message.payload, sender.tab.url)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
    return true;
  }

  handlePopupMessage(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
  return true;
});

async function handlePopupMessage(message) {
  switch (message?.type) {
    case "GET_BOOTSTRAP":
      return getBootstrap(message.payload?.tabId);
    case "SET_TARGET_TAB":
      return setTargetTab(message.payload?.tabId);
    case "GET_FIT_PROGRESS": {
      const userId = await getIdentity();
      return apiFetch(
        `/api/profiles/${encodeURIComponent(userId)}/progress`);
    }
    case "REGISTER_ACCOUNT":
      return registerAccount(message.payload);
    case "LOGIN_ACCOUNT":
      return loginAccount(message.payload);
    case "LOGOUT_ACCOUNT":
      return logoutAccount();
    case "GET_ACTIVE_PRODUCT_STATE":
      return getActiveProductState(message.payload?.tabId);
    case "RESCAN_ACTIVE_TAB":
      return rescanActiveTab(message.payload?.tabId);
    case "ANALYZE_CURRENT_PRODUCT":
      return analyzeActiveProduct(
        false,
        message.payload?.userAdjustmentNote,
        message.payload?.isReconsideration === true,
        message.payload?.tabId);
    case "SAVE_CURRENT_PRODUCT_TO_STYLE_BOARD":
      return saveCurrentProductToStyleBoard(message.payload?.tabId);
    case "DELETE_STYLE_BOARD_ITEM":
      return deleteStyleBoardItem(message.payload?.id);
    case "SELECT_STYLE_BOARD_ITEM":
      return selectStyleBoardItem(message.payload?.id);
    case "CLEAR_STYLE_BOARD":
      return clearStyleBoard();
    case "ANALYZE_STYLE_BOARD":
      return analyzeStyleBoard();
    case "SCAN_ORDER_HISTORY":
      return scanOrderHistory(message.payload?.tabId);
    case "SAVE_PROFILE":
      return saveProfile(message.payload);
    case "SAVE_ORDER":
      return saveOrder(message.payload);
    case "DELETE_ORDER":
      return deleteOrder(message.payload);
    case "SET_ORDER_OUTCOME":
    case "SET_ORDER_FEEDBACK":
      return setOrderFeedback(message.payload);
    case "SET_API_BASE_URL":
      return setApiBaseUrl(message.payload?.apiBaseUrl);
    default:
      throw new Error("Desteklenmeyen uzantı işlemi.");
  }
}

async function getBootstrap(preferredTabId) {
  await enforceProductionApiUrl();
  const [legacyUserId, settings, activeTab, storedAuth] = await Promise.all([
    getLegacyIdentity(),
    getSettings(),
    getActiveTab(preferredTabId),
    getAuth()
  ]);

  let snapshot = null;
  let recommendation = null;
  let snapshotIdentity = null;
  let recommendationIdentity = null;
  if (activeTab?.id !== undefined) {
    try {
      snapshot = await getFreshSnapshot(activeTab.id);
      const productState = await getRecommendationForSnapshot(activeTab.id, snapshot);
      recommendation = productState.recommendation;
      snapshotIdentity = productState.snapshotIdentity;
      recommendationIdentity = productState.recommendationIdentity;
    } catch (error) {
      console.info("FitMemory sayfa taraması atlandı.", error);
    }
  }

  let apiHealthy = false;
  let profile = null;
  let orders = [];
  let styleBoardItems = [];
  let progress = null;
  let apiError = null;
  let auth = storedAuth;
  let account = storedAuth?.account ?? null;
  let sessionVerified = false;

  try {
    await apiFetch("/health", { anonymous: true });
    apiHealthy = true;
    if (auth?.accessToken || auth?.account?.userId || auth?.account?.email) {
      try {
        account = await apiFetch("/api/auth/me", { keepAuthOn401: true });
        auth = {
          ...auth,
          account
        };
        await chrome.storage.local.set({ [AUTH_KEY]: auth });
        sessionVerified = Boolean(auth?.accessToken && account);
      } catch {
        try {
          const restored = await restoreLocalSession(auth);
          auth = {
            accessToken: restored.accessToken,
            expiresAt: restored.expiresAt,
            account: restored.account
          };
          account = restored.account;
          sessionVerified = Boolean(auth?.accessToken && account);
        } catch {
          account = auth?.account ?? null;
          if (!account) {
            await chrome.storage.local.remove(AUTH_KEY);
            auth = null;
          }
        }
      }
    }
    if (!sessionVerified) {
      try {
        const restored = await restoreLocalSession(auth || {});
        auth = {
          accessToken: restored.accessToken,
          expiresAt: restored.expiresAt,
          account: restored.account
        };
        account = restored.account;
        sessionVerified = Boolean(auth?.accessToken && account);
      } catch {
        // Yerelde hesap yoksa giriş ekranı açılır; e-posta hatırlanır.
      }
    }
    if (sessionVerified && auth?.accessToken && account) {
      profile = await apiFetch(
        `/api/profiles/${encodeURIComponent(account.userId)}`,
        { allowNotFound: true });
      if (profile) {
        [orders, styleBoardItems, progress] = await Promise.all([
          apiFetch(
            `/api/orders?userId=${encodeURIComponent(account.userId)}`),
          apiFetch(
            `/api/style-board?userId=${encodeURIComponent(account.userId)}`),
          apiFetch(
            `/api/profiles/${encodeURIComponent(account.userId)}/progress`)
        ]);
      }
    }
  } catch (error) {
    apiError = normalizeError(error);
    auth = await getAuth();
    account = auth?.account ?? null;
    sessionVerified = Boolean(auth?.accessToken && account);
    apiHealthy = true;
  }

  return {
    userId: account?.userId ?? null,
    legacyUserId,
    account,
    lastEmail: (await getLastEmail()) || String(account?.email || "").trim(),
    authenticated: Boolean(sessionVerified && auth?.accessToken && account),
    settings,
    apiHealthy,
    apiError,
    profile,
    orders,
    styleBoardItems,
    progress,
    activeTabId: activeTab?.id ?? null,
    snapshot,
    recommendation,
    snapshotIdentity,
    recommendationIdentity,
    analysisStatus: activeTab?.id === undefined
      ? null
      : await getAnalysisStatus(activeTab.id)
  };
}

async function registerAccount(payload) {
  const displayName = String(payload?.displayName || "").trim();
  const email = String(payload?.email || "").trim();
  const password = String(payload?.password || "");
  if (displayName.length < 2) {
    throw new Error("Adınız en az 2 karakter olmalıdır.");
  }
  if (!email.includes("@")) {
    throw new Error("Geçerli bir e-posta adresi girin.");
  }
  if (password.length < 8) {
    throw new Error("Şifreniz en az 8 karakter olmalıdır.");
  }

  const legacyUserId = await getLegacyIdentity();
  const session = await apiFetch("/api/auth/register", {
    method: "POST",
    anonymous: true,
    body: {
      displayName,
      email,
      password,
      legacyUserId
    }
  });
  await storeAuth(session);
  const bootstrap = await getBootstrap(payload?.tabId);
  return {
    ...bootstrap,
    migratedLegacyData: session.migratedLegacyData === true
  };
}

async function loginAccount(payload) {
  const email = String(payload?.email || "").trim();
  const password = String(payload?.password || "");
  if (!email || !password) {
    throw new Error("E-posta adresinizi ve şifrenizi girin.");
  }

  const session = await apiFetch("/api/auth/login", {
    method: "POST",
    anonymous: true,
    body: {
      email,
      password
    }
  });
  await storeAuth(session);
  return getBootstrap(payload?.tabId);
}

async function logoutAccount() {
  try {
    const auth = await getAuth();
    const email = String(auth?.account?.email || "").trim().toLowerCase();
    if (email) {
      await chrome.storage.local.set({ [LAST_EMAIL_KEY]: email });
    }
    if (auth?.accessToken) {
      await apiFetch("/api/auth/logout", {
        method: "POST",
        expectNoContent: true,
        keepAuthOn401: true
      });
    }
  } finally {
    await chrome.storage.local.remove(AUTH_KEY);
    await chrome.action.setBadgeText({ text: "" });
  }
  return getBootstrap();
}

async function storeAuth(session) {
  if (!session?.accessToken || !session?.account?.userId) {
    throw new Error("FitMemory güvenli oturumu oluşturulamadı.");
  }

  const email = String(session.account.email || "").trim().toLowerCase();
  const payload = {
    [AUTH_KEY]: {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      account: session.account
    }
  };
  if (email) {
    payload[LAST_EMAIL_KEY] = email;
  }
  await chrome.storage.local.set(payload);
  await chrome.action.setBadgeText({ text: "" });
}

async function getActiveProductState(preferredTabId) {
  const activeTab = await getActiveTab(preferredTabId);
  if (activeTab?.id === undefined) {
    return {
      activeTabId: null,
      snapshot: null,
      recommendation: null,
      snapshotIdentity: null,
      recommendationIdentity: null,
      analysisStatus: null
    };
  }

  const stored = await chrome.storage.session.get(snapshotKey(activeTab.id));
  const snapshot = stored[snapshotKey(activeTab.id)] ?? null;
  return {
    activeTabId: activeTab.id,
    snapshot,
    ...(await getRecommendationForSnapshot(activeTab.id, snapshot)),
    analysisStatus: await getAnalysisStatus(activeTab.id)
  };
}

async function invalidateTabStateForNavigation(tabId, nextUrl) {
  return withTabStateLock(tabId, async () => {
    const currentSnapshotKey = snapshotKey(tabId);
    const stored = await chrome.storage.session.get(currentSnapshotKey);
    const snapshot = stored[currentSnapshotKey] ?? null;
    if (snapshot && snapshotMatchesTabUrl(snapshot, nextUrl)) {
      return false;
    }

    await chrome.storage.session.remove([
      currentSnapshotKey,
      recommendationKey(tabId),
      fingerprintKey(tabId),
      analysisKey(tabId)
    ]);
    await chrome.action.setBadgeText({ text: "", tabId });
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "CLEAR_FITMEMORY_RECOMMENDATION"
      });
    } catch {
      // Expected while Chrome is replacing the document during navigation.
    }
    return true;
  });
}

async function saveProfile(payload) {
  const userId = await getIdentity();
  const profile = await apiFetch(`/api/profiles/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: {
      age: payload.age,
      heightCm: payload.heightCm,
      weightKg: payload.weightKg,
      shoulderWidthCm: payload.shoulderWidthCm,
      chestCircumferenceCm: payload.chestCircumferenceCm,
      waistCircumferenceCm: payload.waistCircumferenceCm,
      footLengthCm: payload.footLengthCm,
      usualShoeSizeEu: payload.usualShoeSizeEu,
      fitPreference: payload.fitPreference
    }
  });

  return {
    profile,
    orders: await apiFetch(`/api/orders?userId=${encodeURIComponent(userId)}`)
  };
}

async function saveCurrentProductToStyleBoard(preferredTabId) {
  const tab = await getActiveTab(preferredTabId);
  if (tab?.id === undefined) {
    throw new Error("Kombine ayrılacak aktif ürün sekmesi bulunamadı.");
  }
  const snapshot = await getFreshSnapshot(tab.id);
  if (!snapshot?.product?.url) {
    throw new Error("Önce normal bir ürün sayfasını açıp tarayın.");
  }
  const userId = await getIdentity();
  const productState = await getRecommendationForSnapshot(
    tab.id,
    snapshot);
  await apiFetch("/api/style-board/items", {
    method: "POST",
    body: {
      userId,
      product: snapshot.product,
      recommendedSize:
        productState.recommendation?.recommendedSize || "",
      recommendationConfidence:
        productState.recommendation?.confidence || 0
    }
  });
  return {
    items: await apiFetch(
      `/api/style-board?userId=${encodeURIComponent(userId)}`)
  };
}

async function deleteStyleBoardItem(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error("Silinecek kombin parçası bulunamadı.");
  }
  const userId = await getIdentity();
  await apiFetch(
    `/api/style-board/items/${numericId}?userId=${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      expectNoContent: true
    });
  return {
    items: await apiFetch(
      `/api/style-board?userId=${encodeURIComponent(userId)}`)
  };
}

async function selectStyleBoardItem(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error("Kombinde kullanılacak parça bulunamadı.");
  }
  const userId = await getIdentity();
  await apiFetch(
    `/api/style-board/items/${numericId}/select?userId=${encodeURIComponent(userId)}`,
    { method: "PATCH" });
  return {
    items: await apiFetch(
      `/api/style-board?userId=${encodeURIComponent(userId)}`)
  };
}

async function clearStyleBoard() {
  const userId = await getIdentity();
  await apiFetch(
    `/api/style-board?userId=${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      expectNoContent: true
    });
  return { items: [] };
}

async function analyzeStyleBoard() {
  const userId = await getIdentity();
  return apiFetch("/api/style-board/analyze", {
    method: "POST",
    body: { userId }
  });
}

async function saveOrder(payload) {
  const userId = await getIdentity();
  const body = {
    userId,
    brand: payload.brand,
    productName: payload.productName,
    category: payload.category,
    purchasedSize: payload.purchasedSize,
    outcome: payload.outcome,
    returnConfirmedByUser:
      payload.returnConfirmedByUser === true,
    fitNotes: payload.fitNotes || null,
    chestWidthCm: payload.chestWidthCm,
    shoulderWidthCm: payload.shoulderWidthCm,
    waistWidthCm: payload.waistWidthCm,
    lengthCm: payload.lengthCm,
    sleeveLengthCm: payload.sleeveLengthCm,
    inseamCm: payload.inseamCm,
    imageUrl: payload.imageUrl || null
  };

  const order = payload.id
    ? await apiFetch(`/api/orders/${payload.id}`, { method: "PUT", body })
    : await apiFetch("/api/orders", { method: "POST", body });

  return {
    order,
    orders: await apiFetch(`/api/orders?userId=${encodeURIComponent(userId)}`)
  };
}

async function scanOrderHistory(preferredTabId) {
  const tab = await getActiveTab(preferredTabId);
  if (tab?.id === undefined || tab.windowId === undefined) {
    throw new Error("Taranacak aktif sekme bulunamadı.");
  }
  if (!/^https?:/i.test(tab.url || "")) {
    throw new Error("Sipariş geçmişini normal bir HTTP veya HTTPS sayfasında açın.");
  }

  const frameIds = await listTabFrameIds(tab.id);
  const histories = [];
  for (const frameId of frameIds) {
    try {
      const response = await sendContentMessageToFrame(
        tab.id,
        frameId,
        { type: "SCAN_FITMEMORY_ORDERS_V120" },
        (candidate) => Boolean(candidate?.history)
      );
      if (response?.history) {
        histories.push(response.history);
      }
    } catch (error) {
      console.info("FitMemory sipariş taraması bir çerçeveyi atladı.", frameId, error);
    }
  }

  const history = mergeOrderHistories(histories, tab.url || "");
  if (!history?.orderCards?.length) {
    throw new Error(
      "Görünür sipariş ürünü bulunamadı. Siparişlerim, sipariş detayı veya alışveriş özeti sayfasını açın; ürün adı, beden ve fiyat görünsün, sonra Tara’ya basın."
    );
  }

  let screenshotDataUrl = "";
  try {
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 82
    });
    if (history.cropRect && history.cropRect.width >= 20 && history.cropRect.height >= 20) {
      screenshotDataUrl = await cropScreenshot(
        screenshot,
        history.cropRect,
        history.viewport,
        history.redactionRects || []
      );
    }
  } catch (error) {
    console.info("FitMemory ekran görüntüsü alınamadı; sipariş kartları sayfadan okunacak.", error);
  }

  const userId = await getIdentity();
  const productPageResearch = await researchOfficialProductPages(
    history.orderCards,
    tab.url
  );

  return apiFetch("/api/order-imports/analyze", {
    method: "POST",
    body: {
      userId,
      pageUrl: history.pageUrl,
      pageTitle: history.pageTitle,
      retailer: history.retailer,
      sanitizedText: history.sanitizedText,
      orderCards: history.orderCards,
      productPageResearch,
      screenshotDataUrl
    }
  });
}

function mergeOrderHistories(histories, tabUrl) {
  const usable = histories.filter((history) => Array.isArray(history?.orderCards));
  if (!usable.length) {
    return null;
  }

  const keyOf = (card) =>
    `${String(card.productName || "").trim().toLocaleLowerCase("tr")}|${String(card.purchasedSize || "").trim().toUpperCase()}|${String(card.text || "").slice(0, 48)}`;
  const cards = [];
  const seen = new Set();
  let best = usable[0];
  for (const history of usable) {
    if ((history.orderCards?.length || 0) > (best.orderCards?.length || 0)) {
      best = history;
    }
    for (const card of history.orderCards || []) {
      const key = keyOf(card);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      cards.push(card);
    }
  }

  return {
    ...best,
    pageUrl: (best.pageUrl || tabUrl || "").slice(0, 1_000),
    orderCards: cards.slice(0, 25),
    sanitizedText: cards.map((card, index) =>
      `KART ${index + 1}: ${card.text || ""}`).join("\n\n").slice(0, 30_000)
  };
}

async function researchOfficialProductPages(orderCards, orderPageUrl) {
  let orderHost;
  try {
    orderHost = new URL(orderPageUrl).hostname.toLowerCase();
  } catch {
    return [];
  }

  const urls = [...new Set(
    orderCards
      .flatMap((card) => card.productLinks || [])
      .filter((value) => {
        try {
          const url = new URL(value);
          const host = url.hostname.toLowerCase();
          return ["http:", "https:"].includes(url.protocol) &&
            (host === orderHost ||
              host.endsWith(`.${orderHost}`) ||
              orderHost.endsWith(`.${host}`));
        } catch {
          return false;
        }
      })
  )].slice(0, 6);

  const research = [];
  for (const url of urls) {
    let productTab = null;
    try {
      productTab = await chrome.tabs.create({ url, active: false });
      await waitForTabComplete(productTab.id, 12_000);
      const response = await sendContentMessageWithRecovery(
        productTab.id,
        { type: "SCRAPE_FITMEMORY_PRODUCT_RESEARCH_V160" },
        (candidate) => Boolean(candidate?.research?.product),
        "resmi ürün sayfası"
      );
      if (response.research?.product) {
        research.push(response.research);
      }
    } catch (error) {
      console.info("FitMemory resmi ürün sayfasını okuyamadı.", url, error);
    } finally {
      if (productTab?.id !== undefined) {
        await chrome.tabs.remove(productTab.id).catch(() => undefined);
      }
    }
  }
  return research;
}

async function waitForTabComplete(tabId, timeoutMs) {
  const initial = await chrome.tabs.get(tabId);
  if (initial.status === "complete") {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Resmi ürün sayfası zamanında yüklenmedi."));
    }, timeoutMs);
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function cropScreenshot(dataUrl, cropRect, viewport, redactionRects) {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") {
    throw new Error("Chrome bu ekran görüntüsünü güvenli biçimde kıramadı. Tarayıcıyı güncelleyin.");
  }

  const sourceBlob = await fetch(dataUrl).then((response) => response.blob());
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const viewportWidth = Math.max(1, Number(viewport?.width) || bitmap.width);
    const viewportHeight = Math.max(1, Number(viewport?.height) || bitmap.height);
    const scaleX = bitmap.width / viewportWidth;
    const scaleY = bitmap.height / viewportHeight;
    const sourceX = clamp(Math.floor(cropRect.left * scaleX), 0, bitmap.width - 1);
    const sourceY = clamp(Math.floor(cropRect.top * scaleY), 0, bitmap.height - 1);
    const sourceWidth = clamp(
      Math.ceil(cropRect.width * scaleX),
      1,
      bitmap.width - sourceX
    );
    const sourceHeight = clamp(
      Math.ceil(cropRect.height * scaleY),
      1,
      bitmap.height - sourceY
    );
    const maxEdge = 1_800;
    const outputScale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const outputWidth = Math.max(1, Math.round(sourceWidth * outputScale));
    const outputHeight = Math.max(1, Math.round(sourceHeight * outputScale));
    const canvas = new OffscreenCanvas(outputWidth, outputHeight);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("Ekran görüntüsü işlenemedi.");
    }
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      outputWidth,
      outputHeight
    );
    context.fillStyle = "#070809";
    for (const rect of redactionRects) {
      const redactionX = (rect.left * scaleX - sourceX) * outputScale;
      const redactionY = (rect.top * scaleY - sourceY) * outputScale;
      const redactionWidth = rect.width * scaleX * outputScale;
      const redactionHeight = rect.height * scaleY * outputScale;
      context.fillRect(
        Math.max(0, redactionX),
        Math.max(0, redactionY),
        Math.max(1, redactionWidth),
        Math.max(1, redactionHeight)
      );
    }
    const croppedBlob = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.82
    });
    return blobToDataUrl(croppedBlob);
  } finally {
    bitmap.close();
  }
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

async function deleteOrder(payload) {
  const userId = await getIdentity();
  await apiFetch(`/api/orders/${payload.id}?userId=${encodeURIComponent(userId)}`, {
    method: "DELETE",
    expectNoContent: true
  });

  return {
    orders: await apiFetch(`/api/orders?userId=${encodeURIComponent(userId)}`)
  };
}

async function setOrderFeedback(payload) {
  const allowed = [
    "PurchasedUnknownFit",
    "KeptGoodFit",
    "KeptTooBaggy",
    "KeptTooTight",
    "ReturnedTooBaggy",
    "ReturnedTooTight"
  ];
  if (!Number.isInteger(payload?.id) || !allowed.includes(payload?.outcome)) {
    throw new Error("Geçerli bir arşiv ürünü ve uyum sonucu seçin.");
  }

  const userId = await getIdentity();
  const order = await apiFetch(
    `/api/orders/${payload.id}/feedback?userId=${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      body: {
        outcome: payload.outcome,
        userFitNotes: typeof payload.userFitNotes === "string"
          ? payload.userFitNotes.trim().slice(0, 500)
          : "",
        returnConfirmedByUser:
          payload.returnConfirmedByUser === true
      }
    }
  );

  return {
    order,
    orders: await apiFetch(`/api/orders?userId=${encodeURIComponent(userId)}`)
  };
}

async function setApiBaseUrl(value) {
  const settings = await getSettings();
  settings.apiBaseUrl = resolveApiBaseUrl(value) || DEFAULT_API_BASE_URL;
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  return settings;
}

async function receivePageSnapshot(tabId, snapshot, senderUrl = "") {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }

  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }

  const found = Boolean(snapshot.sizeChart?.found);
  const matchesTab = snapshotMatchesTabUrl(snapshot, tab?.url);
  const matchesSender = snapshotMatchesTabUrl(snapshot, senderUrl);
  if (!found && !matchesTab && !matchesSender) {
    return;
  }

  const stored = await chrome.storage.session.get(snapshotKey(tabId));
  const existing = stored[snapshotKey(tabId)] ?? null;
  if (existing?.sizeChart?.found && !found) {
    return;
  }
  if (
    existing?.sizeChart?.found &&
    sizeChartRowCount(existing.sizeChart) > 0 &&
    snapshot.sizeChart?.requiresInteraction &&
    sizeChartRowCount(snapshot.sizeChart) === 0
  ) {
    return;
  }

  const aligned = found && !matchesTab
    ? alignSnapshotToTab(snapshot, tab)
    : snapshot;

  await commitPageSnapshot(tabId, aligned);
  if (aligned.sizeChart?.found && !aligned.sizeChart.requiresInteraction) {
    await maybeAutoAnalyze(tabId, aligned);
  }
}

async function commitPageSnapshot(tabId, snapshot) {
  return withTabStateLock(tabId, async () => {
    const currentSnapshotKey = snapshotKey(tabId);
    const currentRecommendationKey = recommendationKey(tabId);
    const stored = await chrome.storage.session.get([
      currentSnapshotKey,
      currentRecommendationKey
    ]);
    const previousSnapshot = stored[currentSnapshotKey] ?? null;
    const previousIdentity = createProductIdentity(previousSnapshot);
    const productIdentity = createProductIdentity(snapshot);
    const productChanged = Boolean(
      previousIdentity &&
      productIdentity &&
      previousIdentity !== productIdentity
    );
    const cachedRecord = unpackRecommendationRecord(
      stored[currentRecommendationKey]);
    const recommendationMatches = Boolean(
      cachedRecord &&
      cachedRecord.productIdentity === productIdentity
    );

    if (productChanged || (stored[currentRecommendationKey] && !recommendationMatches)) {
      await chrome.storage.session.remove([
        currentRecommendationKey,
        fingerprintKey(tabId)
      ]);
    }

    await chrome.storage.session.set({ [currentSnapshotKey]: snapshot });

    if (recommendationMatches) {
      await setRecommendationBadge(tabId, cachedRecord.recommendation);
    } else if (snapshot.sizeChart?.found) {
      await chrome.action.setBadgeBackgroundColor({ color: "#D7FF3F", tabId });
      await chrome.action.setBadgeTextColor({ color: "#070809", tabId });
      await chrome.action.setBadgeText({ text: "SIZE", tabId });
    } else {
      await chrome.action.setBadgeText({ text: "", tabId });
    }

    if (productChanged) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: "CLEAR_FITMEMORY_RECOMMENDATION"
        });
      } catch {
        // The page may still be navigating; storage and badge state are already safe.
      }
    }

    return { productIdentity, productChanged };
  });
}

async function maybeAutoAnalyze(tabId, snapshot) {
  const settings = await getSettings();
  if (!settings.autoAnalyze) {
    return;
  }

  const fingerprint = createFingerprint(snapshot);
  const stored = await chrome.storage.session.get(fingerprintKey(tabId));
  if (stored[fingerprintKey(tabId)] === fingerprint) {
    return;
  }

  await chrome.storage.session.set({ [fingerprintKey(tabId)]: fingerprint });

  try {
    const userId = await getIdentity();
    const profile = await apiFetch(`/api/profiles/${encodeURIComponent(userId)}`, { allowNotFound: true });
    if (!profile) {
      return;
    }

    await beginAnalysis(
      tabId,
      snapshot,
      "Beden tablosu ve kalıplar karşılaştırılıyor");
    try {
      const recommendation = await requestRecommendation(userId, snapshot);
      await storeAndDisplayRecommendation(tabId, recommendation, snapshot);
    } finally {
      await endAnalysis(tabId);
    }
  } catch (error) {
    console.info("FitMemory automatic analysis is waiting for a reachable API and profile.", error);
  }
}

async function analyzeActiveProduct(
  forceRescan,
  userAdjustmentNote = "",
  isReconsideration = false,
  preferredTabId) {
  const tab = await getActiveTab(preferredTabId);
  if (tab?.id === undefined) {
      throw new Error("Aktif tarayıcı sekmesi bulunamadı.");
  }

  const snapshot = forceRescan ? await rescanTab(tab.id) : await getFreshSnapshot(tab.id);
  if (!snapshot?.sizeChart?.found) {
    throw new Error("Aktif beden tablosu algılanmadı. Ürünün beden rehberini açıp yeniden deneyin.");
  }

  const userId = await getIdentity();
  const normalizedNote =
    typeof userAdjustmentNote === "string"
      ? userAdjustmentNote.trim().slice(0, 500)
      : "";
  if (isReconsideration && normalizedNote.length < 3) {
    throw new Error(
      "Yeniden değerlendirmek için gözden kaçan detayı yazın.");
  }
  await beginAnalysis(
    tab.id,
    snapshot,
    isReconsideration
      ? "Notunla birlikte öneri yeniden düşünülüyor"
      : "Beden tablosu ve kalıplar karşılaştırılıyor");
  try {
    const recommendation = await requestRecommendation(
      userId,
      snapshot,
      normalizedNote,
      isReconsideration);
    const stored = await storeAndDisplayRecommendation(
      tab.id,
      recommendation,
      snapshot);
    if (!stored) {
      throw new Error("Ürün sayfası analiz sırasında değişti. Yeni ürünü yeniden tarayın.");
    }

    const snapshotIdentity = createProductIdentity(snapshot);
    return {
      snapshot,
      recommendation,
      snapshotIdentity,
      recommendationIdentity: snapshotIdentity,
      analysisStatus: null,
      activeTabId: tab.id
    };
  } finally {
    await endAnalysis(tab.id);
  }
}

async function beginAnalysis(tabId, snapshot, label) {
  await chrome.storage.session.set({
    [analysisKey(tabId)]: {
      status: "analyzing",
      productIdentity: createProductIdentity(snapshot),
      label,
      startedAt: Date.now()
    }
  });
}

async function endAnalysis(tabId) {
  await chrome.storage.session.remove(analysisKey(tabId));
}

async function getAnalysisStatus(tabId) {
  const stored = await chrome.storage.session.get(analysisKey(tabId));
  return stored[analysisKey(tabId)] ?? null;
}

async function requestRecommendation(
  userId,
  snapshot,
  userAdjustmentNote = "",
  isReconsideration = false) {
  return apiFetch("/api/recommendations/analyze", {
    method: "POST",
    body: {
      userId,
      product: snapshot.product,
      sizeChart: snapshot.sizeChart,
      userAdjustmentNote:
        typeof userAdjustmentNote === "string"
          ? userAdjustmentNote.trim().slice(0, 500)
          : "",
      isReconsideration
    }
  });
}

async function storeAndDisplayRecommendation(tabId, recommendation, analyzedSnapshot) {
  const stored = await withTabStateLock(tabId, async () => {
    const currentSnapshotKey = snapshotKey(tabId);
    const current = await chrome.storage.session.get(currentSnapshotKey);
    const currentSnapshot = current[currentSnapshotKey] ?? null;
    const currentIdentity = createProductIdentity(currentSnapshot);
    const analyzedIdentity = createProductIdentity(analyzedSnapshot);

    if (!currentIdentity || currentIdentity !== analyzedIdentity) {
      return false;
    }

    await chrome.storage.session.set({
      [recommendationKey(tabId)]: {
        schemaVersion: 1,
        productIdentity: analyzedIdentity,
        recommendation
      }
    });
    await setRecommendationBadge(tabId, recommendation);
    return true;
  });

  if (!stored) {
    return false;
  }

  return true;
}

async function setRecommendationBadge(tabId, recommendation) {
  await chrome.action.setBadgeBackgroundColor({ color: "#1746D1", tabId });
  await chrome.action.setBadgeTextColor({ color: "#FFFFFF", tabId });
  await chrome.action.setBadgeText({
    text: String(recommendation?.recommendedSize || "").slice(0, 4),
    tabId
  });
}

async function rescanActiveTab(preferredTabId) {
  const tab = await getActiveTab(preferredTabId);
  if (tab?.id === undefined) {
    throw new Error("Aktif tarayıcı sekmesi bulunamadı.");
  }

  const snapshot = await rescanTab(tab.id);
  const productState = await getRecommendationForSnapshot(tab.id, snapshot);
  return {
    snapshot,
    recommendation: productState.recommendation,
    snapshotIdentity: productState.snapshotIdentity,
    recommendationIdentity: productState.recommendationIdentity,
    activeTabId: tab.id
  };
}

async function rescanTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  assertScannableTab(tab, "ürün");

  const frameIds = await listTabFrameIds(tabId);
  const snapshots = [];
  for (const frameId of frameIds) {
    try {
      const response = await sendContentMessageToFrame(
        tabId,
        frameId,
        { type: "SCRAPE_FITMEMORY_PAGE_V120" },
        (candidate) => Boolean(candidate?.snapshot)
      );
      if (response?.snapshot) {
        snapshots.push(response.snapshot);
      }
    } catch {
      // Ads, sandboxed frames, and chrome:// subframes are expected to fail.
    }
  }

  const snapshot = pickBestSnapshot(snapshots);
  if (!snapshot) {
    throw new Error(
      "Bu sekmede FitMemory tarayıcısı çalışmıyor. Sayfayı yenileyip tekrar dene."
    );
  }

  const aligned = alignSnapshotToTab(snapshot, tab);
  await commitPageSnapshot(tabId, aligned);
  return aligned;
}

async function listTabFrameIds(tabId) {
  const ids = new Set([0]);
  try {
    const frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => true
    });
    for (const frame of frames) {
      if (Number.isInteger(frame.frameId)) {
        ids.add(frame.frameId);
      }
    }
  } catch {
    // Restricted frames are skipped; the top frame is still scanned.
  }
  return [...ids];
}

async function sendContentMessageToFrame(
  tabId,
  frameId,
  message,
  isExpectedResponse
) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message, { frameId });
    if (isExpectedResponse(response)) {
      return response;
    }
  } catch {
    // Content script may not be injected into this frame yet.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["content.js"]
    });
  } catch (error) {
    const tab = await chrome.tabs.get(tabId);
    throw new Error(buildInjectionError(tab, "ürün", error?.message || ""));
  }

  const response = await chrome.tabs.sendMessage(tabId, message, { frameId });
  if (!isExpectedResponse(response)) {
    throw new Error("FitMemory bu çerçeveden ürün verisini okuyamadı.");
  }
  return response;
}

async function sendContentMessageWithRecovery(
  tabId,
  message,
  isExpectedResponse,
  purpose
) {
  let firstError = null;
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (isExpectedResponse(response)) {
      return response;
    }
  } catch (error) {
    firstError = error;
  }

  const tab = await chrome.tabs.get(tabId);
  assertScannableTab(tab, purpose);

  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["content.js"]
    });
  } catch (error) {
    const detail = error?.message || firstError?.message || "";
    throw new Error(buildInjectionError(tab, purpose, detail));
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    if (isExpectedResponse(response)) {
      return response;
    }
  } catch (error) {
    const detail = error?.message || firstError?.message || "";
    throw new Error(buildInjectionError(tab, purpose, detail));
  }

  throw new Error(
    `FitMemory ${purpose} verisini okuyamadı. Sayfadaki ürün kartlarını görünür hale getirip yeniden deneyin.`
  );
}

function assertScannableTab(tab, purpose) {
  const url = tab?.url || "";
  if (/^https?:/i.test(url) && !isProtectedWebStoreUrl(url)) {
    return;
  }

  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(url) ||
      isProtectedWebStoreUrl(url)) {
    throw new Error(
      `Chrome'un kendi sayfaları taranamaz. ${purpose === "ürün" ? "Mağazanın ürün sayfasına" : "Mağazanın Siparişlerim sayfasına"} geçin.`
    );
  }

  throw new Error(
    `${purpose === "ürün" ? "Ürünü" : "Sipariş geçmişini"} normal bir HTTP veya HTTPS sayfasında açın.`
  );
}

function isProtectedWebStoreUrl(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === "chromewebstore.google.com" ||
      hostname === "chrome.google.com";
  } catch {
    return false;
  }
}

function buildInjectionError(tab, purpose, technicalDetail) {
  const hostname = safeHostname(tab?.url);
  const target = purpose === "ürün" ? "ürün sayfasına" : "Siparişlerim sayfasına";
  const accessHint = /cannot access|missing host permission|not allowed|extensions gallery/i.test(technicalDetail)
    ? "Chrome bu sayfada uzantı çalıştırılmasına izin vermiyor."
    : "Sayfa FitMemory içerik betiğini engelledi.";
  return `${accessHint} ${target} geçip sayfayı bir kez yenileyin${hostname ? ` (${hostname})` : ""}.`;
}

function safeHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

async function getFreshSnapshot(tabId) {
  try {
    return await rescanTab(tabId);
  } catch {
    const [stored, tab] = await Promise.all([
      chrome.storage.session.get(snapshotKey(tabId)),
      chrome.tabs.get(tabId)
    ]);
    const snapshot = stored[snapshotKey(tabId)] ?? null;
    if (!snapshot?.sizeChart) {
      return null;
    }
    return alignSnapshotToTab(snapshot, tab);
  }
}

async function setTargetTab(tabId) {
  const tab = await getActiveTab(tabId);
  return { activeTabId: tab?.id ?? null };
}

async function getActiveTab(preferredTabId) {
  const requestedId = Number(preferredTabId);
  if (Number.isInteger(requestedId) && requestedId > 0) {
    try {
      const requested = await chrome.tabs.get(requestedId);
      if (isScannableWebUrl(requested.url)) {
        await chrome.storage.session.set({
          [TARGET_TAB_KEY]: requested.id
        });
        return requested;
      }
    } catch {
      // The side panel may pass a tab that was just closed.
    }
  }

  const focusedQueries = [
    { active: true, lastFocusedWindow: true },
    { active: true, currentWindow: true }
  ];
  for (const query of focusedQueries) {
    try {
      const [focused] = await chrome.tabs.query(query);
      if (focused?.id !== undefined && isScannableWebUrl(focused.url)) {
        await chrome.storage.session.set({
          [TARGET_TAB_KEY]: focused.id
        });
        return focused;
      }
    } catch {
      // Service workers have no current window; lastFocusedWindow can also fail.
    }
  }

  const stored = await chrome.storage.session.get(TARGET_TAB_KEY);
  const targetTabId = stored[TARGET_TAB_KEY];
  if (Number.isInteger(targetTabId)) {
    try {
      const target = await chrome.tabs.get(targetTabId);
      if (isScannableWebUrl(target.url)) {
        return target;
      }
    } catch {
      await chrome.storage.session.remove(TARGET_TAB_KEY);
    }
  }

  const activeTabs = await chrome.tabs.query({ active: true });
  const scannable = activeTabs.filter((tab) => isScannableWebUrl(tab.url));
  for (const tab of scannable) {
    if (tab?.id === undefined) {
      continue;
    }
    const storedSnapshot = await chrome.storage.session.get(snapshotKey(tab.id));
    if (storedSnapshot[snapshotKey(tab.id)]?.sizeChart?.found) {
      await chrome.storage.session.set({
        [TARGET_TAB_KEY]: tab.id
      });
      return tab;
    }
  }

  if (scannable[0]?.id !== undefined) {
    await chrome.storage.session.set({
      [TARGET_TAB_KEY]: scannable[0].id
    });
    return scannable[0];
  }

  return null;
}

async function getIdentity() {
  const auth = await getAuth();
  if (auth?.account?.userId) {
    return auth.account.userId;
  }
  throw new Error("Dolabınıza erişmek için FitMemory hesabınıza giriş yapın.");
}

async function getLegacyIdentity() {
  const stored = await chrome.storage.local.get(IDENTITY_KEY);
  if (stored[IDENTITY_KEY]) {
    return stored[IDENTITY_KEY];
  }

  const userId = crypto.randomUUID();
  await chrome.storage.local.set({ [IDENTITY_KEY]: userId });
  return userId;
}

async function getAuth() {
  const stored = await chrome.storage.local.get(AUTH_KEY);
  const auth = stored[AUTH_KEY];
  if (!auth?.account?.userId && !auth?.accessToken) {
    return null;
  }
  const expiresAt = Date.parse(auth.expiresAt || "");
  const valid =
    Boolean(auth?.accessToken && auth?.account?.userId) &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now();
  if (valid) {
    return auth;
  }
  try {
    return await restoreLocalSession(auth);
  } catch {
    return auth?.account?.userId ? auth : null;
  }
}

async function getLastEmail() {
  const stored = await chrome.storage.local.get(LAST_EMAIL_KEY);
  return typeof stored[LAST_EMAIL_KEY] === "string" ? stored[LAST_EMAIL_KEY] : "";
}

async function restoreLocalSession(auth) {
  const session = await localApiFetch("/api/auth/restore", {
    method: "POST",
    body: {
      userId: auth?.account?.userId,
      email: auth?.account?.email || await getLastEmail(),
      accessToken: auth?.accessToken
    }
  });
  await storeAuth(session);
  return session;
}

function normalizeApiBaseUrl(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim().replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "";
  }
  return trimmed;
}

function isUnreachableLegacyApi(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith("onrender.com")) {
      return true;
    }
    if (host === SUPABASE_PROJECT_HOST || host.endsWith(".supabase.co")) {
      return true;
    }
    if ((host === "localhost" || host === "127.0.0.1") && parsed.port === "5158") {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function resolveApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value);
  if (!normalized || isUnreachableLegacyApi(normalized)) {
    return DEFAULT_API_BASE_URL;
  }
  return normalized;
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    apiBaseUrl: resolveApiBaseUrl(stored[SETTINGS_KEY]?.apiBaseUrl),
    autoAnalyze: stored[SETTINGS_KEY]?.autoAnalyze ?? true
  };
}

async function enforceProductionApiUrl() {
  const settings = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

async function apiFetch(path, options = {}) {
  const auth = options.anonymous ? null : await getAuth();
  try {
    return await localApiFetch(path, {
      method: options.method || "GET",
      body: options.body,
      accessToken: auth?.accessToken,
      allowNotFound: options.allowNotFound === true,
      expectNoContent: options.expectNoContent === true
    });
  } catch (error) {
    if (error?.status === 401 && !options.anonymous && !options.keepAuthOn401 && !options._didRestore) {
      try {
        const stored = await chrome.storage.local.get(AUTH_KEY);
        await restoreLocalSession(stored[AUTH_KEY]);
        return await apiFetch(path, { ...options, _didRestore: true });
      } catch {
        throw new Error("Oturumunuz sona erdi. FitMemory hesabınıza yeniden giriş yapın.");
      }
    }
    if (error?.status === 401 && !options.anonymous && !options.keepAuthOn401) {
      throw new Error("Oturumunuz sona erdi. FitMemory hesabınıza yeniden giriş yapın.");
    }
    throw new Error(error?.detail || error?.message || "Beklenmeyen bir hata oluştu.");
  }
}

async function getRecommendationForSnapshot(tabId, snapshot) {
  const snapshotIdentity = createProductIdentity(snapshot);
  if (!snapshotIdentity) {
    return {
      recommendation: null,
      snapshotIdentity: null,
      recommendationIdentity: null
    };
  }

  return withTabStateLock(tabId, async () => {
    const currentSnapshotKey = snapshotKey(tabId);
    const currentRecommendationKey = recommendationKey(tabId);
    const stored = await chrome.storage.session.get([
      currentSnapshotKey,
      currentRecommendationKey
    ]);
    const currentIdentity = createProductIdentity(
      stored[currentSnapshotKey] ?? null);
    const record = unpackRecommendationRecord(
      stored[currentRecommendationKey]);

    if (
      currentIdentity === snapshotIdentity &&
      record?.productIdentity === snapshotIdentity
    ) {
      return {
        recommendation: record.recommendation,
        snapshotIdentity,
        recommendationIdentity: record.productIdentity
      };
    }

    if (stored[currentRecommendationKey]) {
      await chrome.storage.session.remove(currentRecommendationKey);
    }

    return {
      recommendation: null,
      snapshotIdentity,
      recommendationIdentity: null
    };
  });
}

function unpackRecommendationRecord(value) {
  if (
    value?.schemaVersion === 1 &&
    typeof value.productIdentity === "string" &&
    value.recommendation &&
    typeof value.recommendation === "object"
  ) {
    return value;
  }
  return null;
}

function createProductIdentity(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return "";
  }

  const product = snapshot.product || {};
  const normalizedUrl = normalizeProductUrl(product.url);
  const source = normalizedUrl
    ? `url:${normalizedUrl}`
    : [
        "fallback",
        String(product.brand || "").trim().toLocaleLowerCase("tr-TR"),
        String(product.productReference || "").trim().toLocaleLowerCase("tr-TR"),
        String(product.name || "").trim().toLocaleLowerCase("tr-TR")
      ].join("|");

  return source.replace(/\|/g, "") === "fallback"
    ? ""
    : `product-${hashText(source)}`;
}

function normalizeProductUrl(value) {
  if (!value || typeof value !== "string") {
    return "";
  }

  try {
    const parsed = new URL(value);
    const ignoredParameters = new Set([
      "_gl",
      "affiliate",
      "campaign",
      "fbclid",
      "gclid",
      "ref",
      "referrer",
      "source"
    ]);
    const parameters = [...parsed.searchParams.entries()]
      .map(([name, parameterValue]) => [
        name.toLocaleLowerCase("en-US"),
        parameterValue
      ])
      .filter(([name]) =>
        !name.startsWith("utm_") &&
        !ignoredParameters.has(name))
      .sort(([leftName, leftValue], [rightName, rightValue]) =>
        leftName.localeCompare(rightName) ||
        leftValue.localeCompare(rightValue));
    const query = new URLSearchParams(parameters).toString();
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${canonicalHostname(parsed.hostname)}${
      parsed.port ? `:${parsed.port}` : ""
    }${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return value.trim().toLocaleLowerCase("en-US");
  }
}

function canonicalHostname(hostname) {
  const host = String(hostname || "").toLocaleLowerCase("en-US");
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
    return "localhost";
  }
  return host.replace(/^www\./, "");
}

function snapshotMatchesTabUrl(snapshot, tabUrl) {
  if (!tabUrl) {
    return true;
  }
  const snapshotUrl = normalizeProductUrl(snapshot?.product?.url);
  const currentUrl = normalizeProductUrl(tabUrl);
  return Boolean(snapshotUrl && currentUrl && snapshotUrl === currentUrl);
}

function alignSnapshotToTab(snapshot, tab) {
  if (!snapshot?.product || !tab?.url) {
    return snapshot;
  }
  if (snapshotMatchesTabUrl(snapshot, tab.url)) {
    return snapshot;
  }
  return {
    ...snapshot,
    product: {
      ...snapshot.product,
      url: tab.url
    }
  };
}

function sizeChartRowCount(sizeChart) {
  return Array.isArray(sizeChart?.rows) ? sizeChart.rows.length : 0;
}

function snapshotChartQuality(snapshot) {
  const chart = snapshot?.sizeChart;
  if (!chart?.found) {
    return 0;
  }
  const rows = sizeChartRowCount(chart);
  const numeric = String(chart.rawText || "").match(/\d/g)?.length || 0;
  const completeBonus = !chart.requiresInteraction && rows > 0 ? 25 : 0;
  return rows * 10 + Math.min(numeric, 20) + completeBonus;
}

function pickBestSnapshot(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return null;
  }
  return [...snapshots].sort(
    (left, right) => snapshotChartQuality(right) - snapshotChartQuality(left)
  )[0];
}

function hashText(source) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}-${hash >>> 0}`;
}

function withTabStateLock(tabId, operation) {
  const previous = tabStateQueues.get(tabId) || Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(operation);
  tabStateQueues.set(tabId, current);
  return current.finally(() => {
    if (tabStateQueues.get(tabId) === current) {
      tabStateQueues.delete(tabId);
    }
  });
}

function createFingerprint(snapshot) {
  const source = `${snapshot.product?.url || ""}|${snapshot.sizeChart?.rawText || ""}`;
  return hashText(source);
}

function snapshotKey(tabId) {
  return `fitMemorySnapshot:${tabId}`;
}

function recommendationKey(tabId) {
  return `fitMemoryRecommendation:${tabId}`;
}

function fingerprintKey(tabId) {
  return `fitMemoryFingerprint:${tabId}`;
}

function analysisKey(tabId) {
  return `fitMemoryAnalysis:${tabId}`;
}

function normalizeError(error) {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return "FitMemory sunucusu şu an yanıt vermiyor. Ücretsiz sunucu uyanırken kısa bir gecikme olabilir; birkaç saniye sonra yeniden deneyin.";
  }
  return error?.message || "Beklenmeyen bir hata oluştu.";
}
