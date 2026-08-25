const state = {
  userId: null,
  legacyUserId: null,
  account: null,
  authenticated: false,
  settings: null,
  profile: null,
  orders: [],
  styleBoardItems: [],
  progress: null,
  styleBoardAnalysis: null,
  activeTabId: null,
  snapshot: null,
  snapshotIdentity: null,
  recommendation: null,
  recommendationIdentity: null,
  analysisStatus: null,
  lastImport: null,
  apiHealthy: false,
  activePage: "fit"
};

const elements = {};
let toastTimer = null;
let productStateRefreshTimer = null;
let activeClosetGroupKey = null;
let activeStudioGroupKey = null;
let expandedClosetOrderId = null;
let selectedOutfitIndex = 0;
let renderedOutfits = [];

document.addEventListener("DOMContentLoaded", initialize);

function displayShoulderCircumference(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  return String(value >= 70 ? value : value * 2);
}

async function initialize() {
  cacheElements();
  bindEvents();
  bindTabWatchers();
  showLoadingState();
  if (elements.extensionVersion) {
    elements.extensionVersion.textContent =
      `v${chrome.runtime.getManifest().version}`;
    elements.extensionVersion.addEventListener("click", () => {
      chrome.runtime.reload();
    });
  }

  try {
    const hostTabId = await resolveHostTabId();
    const bootstrap = await sendMessage("GET_BOOTSTRAP", { tabId: hostTabId });
    Object.assign(state, bootstrap);
    state.apiHealthy = true;
    renderApiStatus(true);
    renderAuthState();
    if (!state.authenticated) {
      return;
    }
    hydrateProfileForm();
    renderFit();
    renderProgress();
    renderOrders();
    renderStudio();
    if (!state.profile || !state.profile.age) {
      navigate("profile");
      showToast(state.profile
        ? "Kombinleri kişiselleştirmek için yaş bilgini ekle."
        : "Başlamak için beden profilini oluştur.");
    }
  } catch (error) {
    state.apiHealthy = true;
    renderApiStatus(true);
    renderAuthState();
    renderFit();
    renderOrders();
    showToast(error.message, true);
  }
}

function cacheElements() {
  [
    "auth-gate",
    "auth-login-tab",
    "auth-register-tab",
    "login-form",
    "login-email",
    "login-password",
    "login-button",
    "register-form",
    "register-name",
    "register-email",
    "register-password",
    "register-password-confirm",
    "register-legal-consent",
    "register-button",
    "api-status-dot",
    "api-status-text",
    "extension-version",
    "refresh-page",
    "empty-rescan",
    "fit-loading",
    "fit-progress",
    "fit-progress-headline",
    "fit-progress-detail",
    "fit-empty",
    "fit-ready",
    "size-orb",
    "product-brand",
    "product-title",
    "product-image",
    "product-image-fallback",
    "recommendation-copy",
    "recommendation-verdict",
    "recommendation-explanation",
    "recommendation-feedback",
    "recommendation-note",
    "reconsider-button",
    "confidence-label",
    "confidence-fill",
    "analyze-button",
    "analysis-progress",
    "analysis-progress-title",
    "analysis-progress-label",
    "save-to-studio-button",
    "style-match-panel",
    "style-match-headline",
    "style-season-label",
    "style-empty",
    "open-style-button",
    "outfit-tabs",
    "outfit-list",
    "evidence-panel",
    "comparison-list",
    "studio-count",
    "clear-studio-button",
    "studio-empty",
    "studio-selection-summary",
    "studio-tabs",
    "studio-list",
    "analyze-studio-button",
    "studio-analysis",
    "studio-verdict",
    "studio-score",
    "studio-season",
    "studio-analysis-headline",
    "studio-analysis-copy",
    "studio-analysis-notes",
    "scan-orders-button",
    "import-status",
    "import-status-title",
    "import-status-count",
    "order-count",
    "closet-summary",
    "closet-tabs",
    "orders-loading",
    "orders-empty",
    "orders-list",
    "profile-form",
    "profile-summary",
    "profile-summary-title",
    "profile-summary-values",
    "edit-profile-button",
    "account-avatar",
    "account-name",
    "account-email",
    "logout-button",
    "age",
    "height-cm",
    "weight-kg",
    "shoulder-width-cm",
    "chest-cm",
    "waist-cm",
    "foot-length-cm",
    "shoe-size-eu",
    "fit-preference",
    "api-base-url",
    "save-profile-button",
    "toast"
  ].forEach((id) => {
    elements[toCamelCase(id)] = document.getElementById(id);
  });
}

function bindEvents() {
  elements.authLoginTab.addEventListener(
    "click",
    () => switchAuthMode("login"));
  elements.authRegisterTab.addEventListener(
    "click",
    () => switchAuthMode("register"));
  elements.loginForm.addEventListener("submit", login);
  elements.registerForm.addEventListener("submit", register);
  elements.logoutButton.addEventListener("click", logout);

  const navButtons = [...document.querySelectorAll(".nav-button")];
  navButtons.forEach((button, index) => {
    button.addEventListener("click", () => navigate(button.dataset.target));
    button.addEventListener("keydown", (event) => {
      const lastIndex = navButtons.length - 1;
      let nextIndex = index;
      if (event.key === "ArrowRight") {
        nextIndex = index === lastIndex ? 0 : index + 1;
      } else if (event.key === "ArrowLeft") {
        nextIndex = index === 0 ? lastIndex : index - 1;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = lastIndex;
      } else {
        return;
      }
      event.preventDefault();
      const nextButton = navButtons[nextIndex];
      navigate(nextButton.dataset.target);
      nextButton.focus();
    });
  });
  elements.refreshPage.addEventListener("click", rescanPage);
  elements.emptyRescan.addEventListener("click", rescanPage);
  elements.analyzeButton.addEventListener("click", analyzeProduct);
  elements.reconsiderButton.addEventListener(
    "click",
    reconsiderRecommendation);
  elements.recommendationNote.addEventListener(
    "input",
    syncReconsiderButton);
  elements.openStyleButton.addEventListener(
    "click",
    () => navigate("style"));
  elements.saveToStudioButton.addEventListener(
    "click",
    saveCurrentProductToStudio);
  elements.analyzeStudioButton.addEventListener(
    "click",
    analyzeStudio);
  elements.clearStudioButton.addEventListener(
    "click",
    clearStudio);
  elements.scanOrdersButton.addEventListener("click", scanOrderHistory);
  elements.profileForm.addEventListener("submit", saveProfile);
  elements.editProfileButton.addEventListener("click", () => {
    elements.profileSummary.classList.add("hidden");
    elements.profileForm.classList.remove("hidden");
    elements.age.focus();
  });
  chrome.storage.onChanged.addListener(handleStorageChanges);
}

function renderAuthState() {
  const locked = !state.authenticated || !state.account;
  document
    .querySelector(".app-shell")
    .classList.toggle("is-auth-locked", locked);
  elements.authGate.classList.toggle("hidden", !locked);
  if (locked) {
    const lastEmail = String(state.lastEmail || "").trim();
    if (lastEmail && elements.loginEmail && !elements.loginEmail.value) {
      elements.loginEmail.value = lastEmail;
    }
    return;
  }

  elements.accountName.textContent = state.account.displayName;
  elements.accountEmail.textContent = state.account.email;
  const initials = state.account.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("tr-TR");
  elements.accountAvatar.textContent = initials || "FM";
}

function switchAuthMode(mode) {
  const showLogin = mode === "login";
  elements.authLoginTab.classList.toggle("is-active", showLogin);
  elements.authRegisterTab.classList.toggle("is-active", !showLogin);
  elements.authLoginTab.setAttribute("aria-selected", String(showLogin));
  elements.authRegisterTab.setAttribute("aria-selected", String(!showLogin));
  elements.loginForm.classList.toggle("hidden", !showLogin);
  elements.registerForm.classList.toggle("hidden", showLogin);
  requestAnimationFrame(() => {
    if (showLogin) {
      elements.loginEmail.focus();
    } else {
      elements.registerName.focus();
    }
  });
}

async function login(event) {
  event.preventDefault();
  if (!elements.loginForm.reportValidity()) {
    return;
  }

  setButtonBusy(elements.loginButton, true, "Giriş yapılıyor");
  try {
    const bootstrap = await sendMessage("LOGIN_ACCOUNT", {
      email: elements.loginEmail.value,
      password: elements.loginPassword.value,
      tabId: await resolveHostTabId()
    });
    elements.loginPassword.value = "";
    activateAuthenticatedSession(bootstrap);
    showToast(`Hoş geldin, ${state.account.displayName}.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setButtonBusy(elements.loginButton, false, "Giriş yapılıyor");
  }
}

async function register(event) {
  event.preventDefault();
  if (!elements.registerForm.reportValidity()) {
    return;
  }

  const password = elements.registerPassword.value;
  if (password !== elements.registerPasswordConfirm.value) {
    elements.registerPasswordConfirm.setCustomValidity(
      "Şifreler aynı olmalıdır.");
    elements.registerPasswordConfirm.reportValidity();
    elements.registerPasswordConfirm.setCustomValidity("");
    return;
  }
  if (!/\p{L}/u.test(password) || !/\d/u.test(password)) {
    showToast("Şifren en az bir harf ve bir rakam içermeli.", true);
    return;
  }

  setButtonBusy(elements.registerButton, true, "Hesap oluşturuluyor");
  try {
    const bootstrap = await sendMessage("REGISTER_ACCOUNT", {
      displayName: elements.registerName.value,
      email: elements.registerEmail.value,
      password,
      tabId: await resolveHostTabId()
    });
    elements.registerPassword.value = "";
    elements.registerPasswordConfirm.value = "";
    activateAuthenticatedSession(bootstrap);
    showToast(bootstrap.migratedLegacyData
      ? "Hesabın oluşturuldu; mevcut profilin ve dolabın korundu."
      : "Hesabın oluşturuldu. Şimdi beden profilini tamamla.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setButtonBusy(elements.registerButton, false, "Hesap oluşturuluyor");
  }
}

async function logout() {
  if (!window.confirm(
    "Bu cihazda FitMemory hesabından çıkış yapmak istiyor musun? Dolabın silinmeyecek."
  )) {
    return;
  }

  setButtonBusy(elements.logoutButton, true, "Çıkılıyor");
  try {
    const bootstrap = await sendMessage("LOGOUT_ACCOUNT");
    Object.assign(state, bootstrap);
    renderApiStatus();
    renderAuthState();
    switchAuthMode("login");
    showToast("Çıkış yapıldı. Dolabın hesabında güvende.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setButtonBusy(elements.logoutButton, false, "Çıkılıyor");
  }
}

function activateAuthenticatedSession(bootstrap) {
  Object.assign(state, bootstrap);
  activeClosetGroupKey = null;
  activeStudioGroupKey = null;
  expandedClosetOrderId = null;
  renderApiStatus();
  renderAuthState();
  hydrateProfileForm();
  renderFit();
  renderOrders();
  renderStudio();
  navigate(state.profile?.age ? "fit" : "profile");
}

function handleStorageChanges(changes, areaName) {
  if (areaName !== "session") {
    return;
  }

  const relevant = Object.keys(changes).some((key) =>
    key === "fitMemoryTargetTabId" ||
    key.startsWith("fitMemorySnapshot:") ||
    key.startsWith("fitMemoryRecommendation:") ||
    key.startsWith("fitMemoryAnalysis:"));
  if (!relevant) {
    return;
  }

  clearTimeout(productStateRefreshTimer);
  productStateRefreshTimer = setTimeout(refreshActiveProductState, 40);
}

async function resolveHostTabId() {
  const queries = [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true }
  ];
  for (const query of queries) {
    try {
      const [tab] = await chrome.tabs.query(query);
      if (isHostProductTab(tab)) {
        return tab.id;
      }
    } catch {
      // Side panel and service-worker windows do not always expose currentWindow.
    }
  }

  try {
    const tabs = await chrome.tabs.query({ active: true });
    const match = tabs.find(isHostProductTab);
    return match?.id ?? null;
  } catch {
    return null;
  }
}

function isHostProductTab(tab) {
  return Boolean(
    tab?.id != null &&
    /^https?:/i.test(tab.url || "") &&
    !/chromewebstore\.google\.com|chrome\.google\.com/i.test(tab.url || "")
  );
}

function bindTabWatchers() {
  const schedule = () => {
    clearTimeout(productStateRefreshTimer);
    productStateRefreshTimer = setTimeout(refreshActiveProductState, 60);
  };
  chrome.tabs.onActivated.addListener(schedule);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete" || changeInfo.url) {
      if (!state.activeTabId || state.activeTabId === tabId) {
        schedule();
      }
    }
  });
}

async function refreshActiveProductState() {
  try {
    const tabId = await resolveHostTabId();
    const productState = await sendMessage("GET_ACTIVE_PRODUCT_STATE", { tabId });
    applyProductState(productState);
    renderFit();
  } catch {
    // A navigation can briefly make the tab unavailable; the next snapshot retries.
  }
}

function applyProductState(productState) {
  const previousIdentity = state.snapshotIdentity;
  state.activeTabId = productState.activeTabId ?? null;
  state.snapshot = productState.snapshot ?? null;
  state.snapshotIdentity = productState.snapshotIdentity ?? null;
  state.recommendation = productState.recommendation ?? null;
  state.recommendationIdentity =
    productState.recommendationIdentity ?? null;
  state.analysisStatus = productState.analysisStatus ?? null;
  if (
    previousIdentity &&
    previousIdentity !== state.snapshotIdentity &&
    elements.recommendationNote
  ) {
    elements.recommendationNote.value = "";
    syncReconsiderButton();
  }
}

function navigate(page) {
  state.activePage = page;
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("is-active", section.dataset.page === page);
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    const isActive = button.dataset.target === page;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });
}

function showLoadingState() {
  elements.fitLoading.classList.remove("hidden");
  elements.fitReady.classList.add("hidden");
  elements.fitEmpty.classList.add("hidden");
  elements.ordersLoading.classList.remove("hidden");
  elements.ordersEmpty.classList.add("hidden");
}

function renderApiStatus(forceValue) {
  const healthy = forceValue ?? state.apiHealthy;
  elements.apiStatusDot.classList.toggle("is-live", healthy);
  elements.apiStatusText.textContent = healthy ? "API açık" : "API kapalı";
}

function renderProgress() {
  const progress = state.progress;
  elements.fitProgress.classList.toggle("hidden", !progress);
  if (!progress) {
    return;
  }
  elements.fitProgressHeadline.textContent = progress.headline;
  elements.fitProgressDetail.textContent = progress.detail;
}

function renderFit() {
  elements.fitLoading.classList.add("hidden");
  const recommendation = getVerifiedRecommendation();
  const chartFound = Boolean(state.snapshot?.sizeChart?.found);
  elements.fitEmpty.classList.toggle("hidden", chartFound);
  elements.fitReady.classList.toggle("hidden", !chartFound);

  if (!chartFound) {
    renderAnalysisProgress(false);
    elements.recommendationFeedback.classList.add("hidden");
    renderStyleRecommendation(null);
    return;
  }

  const analysisIsCurrent =
    state.analysisStatus?.status === "analyzing" &&
    (!state.analysisStatus.productIdentity ||
      !state.snapshotIdentity ||
      state.analysisStatus.productIdentity === state.snapshotIdentity);
  renderAnalysisProgress(
    analysisIsCurrent,
    state.analysisStatus?.label);
  elements.productBrand.textContent = state.snapshot.product?.brand || "Aktif mağaza";
  elements.productTitle.textContent = state.snapshot.product?.name || "Ürün algılandı";
  const productImageUrl = state.snapshot.product?.imageUrl || "";
  const renderedProductIdentity = state.snapshotIdentity || "";
  elements.productImage.dataset.productIdentity = renderedProductIdentity;
  elements.productImage.dataset.imageUrl = productImageUrl;
  elements.productImage.classList.toggle("hidden", !productImageUrl);
  elements.productImageFallback.classList.toggle("hidden", Boolean(productImageUrl));
  if (productImageUrl) {
    elements.productImage.src = productImageUrl;
    elements.productImage.alt =
      `${state.snapshot.product?.name || "Aktif ürün"} ürün görseli`;
    elements.productImage.onerror = () => {
      if (
        elements.productImage.dataset.productIdentity !==
        renderedProductIdentity ||
        elements.productImage.dataset.imageUrl !== productImageUrl
      ) {
        return;
      }
      elements.productImage.classList.add("hidden");
      elements.productImageFallback.classList.remove("hidden");
    };
  } else {
    elements.productImage.removeAttribute("src");
    elements.productImage.alt = "";
  }
  renderStudioSaveButton();
  elements.recommendationCopy.classList.toggle("hidden", !recommendation);
  elements.recommendationFeedback.classList.toggle(
    "hidden",
    !recommendation);
  elements.evidencePanel.classList.toggle("hidden", !recommendation);

  if (!recommendation) {
    renderStyleRecommendation(null);
    elements.sizeOrb.textContent = "?";
    setAnalyzeButton(false, "Beden eşleşmesini başlat");
    return;
  }

  elements.sizeOrb.textContent = recommendation.recommendedSize;
  elements.recommendationVerdict.textContent = recommendation.verdict;
  elements.recommendationExplanation.textContent = recommendation.explanation;
  const strength = recommendationStrength(recommendation);
  elements.confidenceLabel.textContent = strength.label;
  elements.confidenceLabel.title =
    `Teknik kanıt güveni: %${recommendation.confidence}`;
  elements.confidenceFill.style.width = `${strength.width}%`;
  renderStyleRecommendation(recommendation.style);
  const technicalConfidence = createComparisonElement({
    label: "Kanıt güveni",
    detail: `%${recommendation.confidence} · sonuç olasılığı değil`
  });
  elements.comparisonList.replaceChildren(
    technicalConfidence,
    ...(recommendation.comparisons || []).map(createComparisonElement)
  );
  setAnalyzeButton(false, "Yeniden analiz et");
}

function recommendationStrength(recommendation) {
  const source = recommendation?.dataSource || "";
  const confidence = Number(recommendation?.confidence) || 0;
  const size = String(recommendation?.recommendedSize || "")
    .toLocaleLowerCase("tr-TR");
  if (size === "bilinmiyor" || source.includes("insufficient")) {
    return { label: "Ölçü gerekli", width: 30 };
  }
  if (source.includes("category-history") ||
      source.includes("family-match")) {
    return { label: "Dolapta doğrulandı", width: 92 };
  }
  if (source.includes("model-reference")) {
    return { label: "Model referanslı", width: 76 };
  }
  if (source.includes("body-label") ||
      source.includes("footwear-size")) {
    return { label: "Profil eşleşmesi", width: 68 };
  }
  if (confidence >= 78) {
    return { label: "Çok güçlü", width: 94 };
  }
  if (confidence >= 60) {
    return { label: "Güçlü", width: 82 };
  }
  return { label: "Dengeli", width: 66 };
}

function renderAnalysisProgress(visible, label = "") {
  elements.analysisProgress.classList.toggle("hidden", !visible);
  elements.analysisProgressLabel.textContent =
    label || "Beden tablosu ve kalıplar karşılaştırılıyor";
  elements.refreshPage.disabled = visible;
}

function renderStudioSaveButton() {
  const currentUrl = state.snapshot?.product?.url || "";
  const alreadySaved = Boolean(currentUrl) &&
    (state.styleBoardItems || []).some(item =>
      item.productUrl === currentUrl);
  elements.saveToStudioButton.classList.toggle(
    "is-saved",
    alreadySaved);
  elements.saveToStudioButton.querySelector("span").textContent =
    alreadySaved ? "Stüdyoda · Gör" : "Kombin için ayır";
}

function getVerifiedRecommendation() {
  if (!state.recommendation) {
    return null;
  }

  if (
    !state.snapshotIdentity ||
    !state.recommendationIdentity ||
    state.snapshotIdentity !== state.recommendationIdentity
  ) {
    state.recommendation = null;
    state.recommendationIdentity = null;
    return null;
  }

  return state.recommendation;
}

function renderStyleRecommendation(style) {
  const outfits = Array.isArray(style?.outfits)
    ? style.outfits
    : [];
  const season = currentSeasonContext();
  elements.styleSeasonLabel.textContent =
    `${season.month} · ${season.season}`;
  const hasOutfits = outfits.length > 0;
  elements.styleMatchPanel.classList.toggle("hidden", !hasOutfits);
  elements.styleEmpty.classList.toggle("hidden", hasOutfits);
  elements.openStyleButton.classList.toggle("hidden", !hasOutfits);
  if (!hasOutfits) {
    renderedOutfits = [];
    selectedOutfitIndex = 0;
    elements.outfitTabs.replaceChildren();
    elements.outfitList.replaceChildren();
    return;
  }

  renderedOutfits = outfits;
  selectedOutfitIndex = Math.min(
    selectedOutfitIndex,
    outfits.length - 1);
  const compatibleCount = Math.max(
    0,
    Number(style.compatibleItemCount) || 0);
  elements.styleMatchHeadline.textContent =
    `${outfits.length} gerçek kombin${
      compatibleCount > outfits.length
        ? ` · ${compatibleCount} parça incelendi`
        : ""
    }`;

  renderOutfitTabs();
  renderSelectedOutfit();
}

function renderOutfitTabs() {
  elements.outfitTabs.replaceChildren(
    ...renderedOutfits.map((_outfit, index) => {
      const button = document.createElement("button");
      button.className =
        `outfit-tab ${index === selectedOutfitIndex ? "is-active" : ""}`;
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute(
        "aria-selected",
        index === selectedOutfitIndex ? "true" : "false");
      button.textContent = String(index + 1).padStart(2, "0");
      button.title = `${index + 1}. kombini göster`;
      button.addEventListener("click", () => {
        selectedOutfitIndex = index;
        renderOutfitTabs();
        renderSelectedOutfit();
      });
      return button;
    }));
}

function renderSelectedOutfit() {
  const outfit = renderedOutfits[selectedOutfitIndex];
  elements.outfitList.replaceChildren(
    outfit
      ? createStyleOutfit(outfit, selectedOutfitIndex)
      : document.createTextNode(""));
}

function createStyleOutfit(outfit, index) {
  const card = document.createElement("article");
  card.className = "outfit-card";

  const header = document.createElement("div");
  header.className =
    "flex items-center justify-between gap-3 border-b border-line px-3 py-2.5";
  const label = document.createElement("span");
  label.className = "eyebrow text-acid";
  const season = currentSeasonContext();
  label.textContent =
    `${season.month} · Görünüm ${String(index + 1).padStart(2, "0")}`;
  const count = document.createElement("span");
  const pieceCount = Array.isArray(outfit.pieces)
    ? outfit.pieces.length
    : 0;
  count.className = "chip shrink-0";
  count.textContent = `${pieceCount + 1} parça`;
  header.append(label, count);

  const pieces = document.createElement("div");
  pieces.className = "outfit-visual-grid";
  pieces.append(createActiveProductStylePiece());
  (outfit.pieces || []).forEach((piece) => {
    pieces.append(createStylePiece(piece));
  });

  const direction = document.createElement("p");
  direction.className = "outfit-direction";
  direction.textContent =
    outfit.direction ||
    "Parçalar renk ve siluet dengesi birlikte değerlendirilerek seçildi.";

  card.append(header, pieces, direction);
  return card;
}

function currentSeasonContext(now = new Date()) {
  const month = now.getMonth();
  const monthNames = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
  ];
  const season = [11, 0, 1].includes(month)
    ? "Kış"
    : [2, 3, 4].includes(month)
      ? "İlkbahar"
      : [5, 6, 7].includes(month)
        ? "Yaz"
        : "Sonbahar";
  return { month: monthNames[month], season };
}

function createActiveProductStylePiece() {
  const product = state.snapshot?.product || {};
  return createStylePiece({
    brand: product.brand || "Aktif mağaza",
    productName: product.name || "İncelediğin ürün",
    category: product.category || "",
    purchasedSize: getVerifiedRecommendation()?.recommendedSize || "",
    imageUrl: product.imageUrl || "",
    productUrl: product.url || "",
    role: "Ana parça",
    reason: "Şu an bedenini ve kombinlerini incelediğin ürün."
  }, true);
}

function createStylePiece(piece, isActive = false) {
  const container = piece.productUrl
    ? document.createElement("a")
    : document.createElement("div");
  container.className =
    `outfit-look-tile ${isActive ? "is-active-piece" : ""}`;
  if (piece.productUrl) {
    container.href = piece.productUrl;
    container.target = "_blank";
    container.rel = "noreferrer";
    container.setAttribute(
      "aria-label",
      `${piece.productName} ürün sayfasını aç`);
  }

  const fallback = document.createElement("span");
  fallback.className =
    "absolute inset-0 grid place-items-center px-4 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-fog";
  fallback.textContent = isActive ? "Aktif ürün" : "Dolap görseli";
  container.append(fallback);
  if (piece.imageUrl) {
    const image = document.createElement("img");
    image.className = "outfit-look-image";
    image.src = piece.imageUrl;
    image.alt = `${piece.productName} görseli`;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => image.remove(), { once: true });
    container.append(image);
  }

  const role = document.createElement("span");
  role.className = "outfit-look-role";
  role.textContent = piece.role || "Parça";

  const size = document.createElement("span");
  size.className = "outfit-look-size";
  size.textContent = isActive
    ? `Öneri ${piece.purchasedSize || "—"}`
    : `Dolap ${piece.purchasedSize || "—"}`;
  size.title = isActive ? "Önerilen beden" : "Dolabındaki beden";
  container.append(role, size);
  return container;
}

function createComparisonElement(comparison) {
  const item = document.createElement("div");
  item.className = "metric flex items-center justify-between gap-3";
  const label = document.createElement("span");
  label.className = "text-[11px] font-semibold tracking-[0.02em] text-[#3f3f3b]";
  label.textContent = comparison.label;
  const values = document.createElement("span");
  values.className = "text-right text-xs font-semibold text-mango";
  values.textContent = comparison.detail;
  item.append(label, values);
  return item;
}

function renderStudio() {
  const items = Array.isArray(state.styleBoardItems)
    ? state.styleBoardItems
    : [];
  const groups = buildStudioGroups(items);
  const selectedItems = selectedStudioItems(groups);
  const selectedIds = new Set(
    selectedItems.map(item => item.id));
  elements.studioCount.textContent = `${items.length}/12`;
  elements.studioEmpty.classList.toggle("hidden", items.length > 0);
  elements.clearStudioButton.classList.toggle("hidden", items.length === 0);
  elements.studioSelectionSummary.classList.toggle(
    "hidden",
    items.length === 0);
  elements.studioTabs.classList.toggle("hidden", items.length === 0);
  elements.studioList.classList.toggle("hidden", items.length === 0);
  elements.analyzeStudioButton.classList.toggle(
    "hidden",
    selectedIds.size < 2);
  if (!groups.some(group => group.key === activeStudioGroupKey)) {
    activeStudioGroupKey = groups[0]?.key || null;
  }
  elements.studioSelectionSummary.textContent =
    selectedIds.size > 0
      ? `Bu kombinde ${selectedIds.size} aktif parça var. Her kategoriden yalnız seçili kart AI'a gönderilir.`
      : "Kombinde kullanılacak parçaları kategori kartlarından seç.";
  elements.studioTabs.replaceChildren(
    ...groups.map(group => {
      const button = document.createElement("button");
      button.type = "button";
      button.className =
        `studio-tab ${group.key === activeStudioGroupKey ? "is-active" : ""}`;
      button.setAttribute("role", "tab");
      button.setAttribute(
        "aria-selected",
        String(group.key === activeStudioGroupKey));
      button.textContent = `${group.label} · ${group.items.length}`;
      button.addEventListener("click", () => {
        activeStudioGroupKey = group.key;
        renderStudio();
      });
      return button;
    }));
  const visibleItems = groups.find(group =>
    group.key === activeStudioGroupKey)?.items || [];
  elements.studioList.replaceChildren(
    ...visibleItems.map(item =>
      createStudioItem(item, selectedIds.has(item.id))));
  renderStudioAnalysis();
  if (state.snapshot?.sizeChart?.found) {
    renderStudioSaveButton();
  }
}

function createStudioItem(item, isSelected) {
  const card = document.createElement("article");
  card.className =
    `studio-item ${isSelected ? "is-selected" : ""}`;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "studio-remove";
  remove.textContent = "×";
  remove.title = `${item.productName} parçasını çıkar`;
  remove.setAttribute(
    "aria-label",
    `${item.productName} parçasını kombin stüdyosundan çıkar`);
  remove.addEventListener("click", () =>
    deleteStudioItem(item.id, remove));

  const imageWrap = document.createElement("div");
  imageWrap.className = "studio-item-image";
  const fallback = document.createElement("span");
  fallback.className = "studio-item-fallback";
  fallback.textContent = item.brand || "Ürün";
  imageWrap.append(fallback);
  if (item.imageUrl) {
    const image = document.createElement("img");
    image.src = item.imageUrl;
    image.alt = `${item.productName} ürün görseli`;
    image.loading = "lazy";
    image.addEventListener("load", () => {
      fallback.classList.add("hidden");
    });
    image.addEventListener("error", () => {
      image.remove();
      fallback.classList.remove("hidden");
    });
    imageWrap.append(image);
  }

  const copy = document.createElement("div");
  copy.className = "studio-item-copy";
  const brand = document.createElement("p");
  brand.className = "studio-item-brand";
  brand.textContent = item.brand || "Aktif mağaza";
  const title = document.createElement("h2");
  title.className = "studio-item-title";
  title.textContent = item.productName || "Adsız ürün";
  const meta = document.createElement("div");
  meta.className = "studio-item-meta";
  const fit = document.createElement("span");
  fit.className = "truncate";
  fit.textContent = item.fitLabel || categoryLabel(item.category);
  const size = document.createElement("span");
  size.className = "studio-size";
  size.textContent = item.recommendedSize || "—";
  meta.append(fit, size);
  const pick = document.createElement("button");
  pick.type = "button";
  pick.className =
    `studio-pick ${isSelected ? "is-selected" : ""}`;
  pick.textContent = isSelected
    ? "✓ Bu kombinde"
    : "Kombine al";
  pick.disabled = isSelected;
  pick.addEventListener("click", () =>
    selectStudioItem(item.id, pick));
  copy.append(brand, title, meta, pick);
  card.append(remove, imageWrap, copy);
  return card;
}

function buildStudioGroups(items) {
  const labels = {
    upper: "Üst",
    bottom: "Pantolon & etek",
    outerwear: "Ceket",
    footwear: "Ayakkabı",
    onePiece: "Elbise",
    accessory: "Aksesuar",
    other: "Diğer"
  };
  const priority = [
    "upper",
    "bottom",
    "outerwear",
    "footwear",
    "onePiece",
    "accessory",
    "other"
  ];
  const grouped = new Map();
  items.forEach(item => {
    const key = studioGroupKey(item);
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(item);
  });
  return priority
    .filter(key => grouped.has(key))
    .map(key => ({
      key,
      label: labels[key],
      items: grouped.get(key)
    }));
}

function selectedStudioItems(groups) {
  return groups
    .map(group =>
      group.items.find(item => item.isSelected) ||
      group.items[0])
    .filter(Boolean);
}

function studioGroupKey(item) {
  const value =
    ` ${item.category || ""} ${item.productName || ""} `
      .toLocaleLowerCase("tr-TR");
  if (/(ayakkabı|ayakkabi|shoe|footwear|sneaker|loafer|bot|çizme|cizme|sandal|terlik)/u.test(value)) {
    return "footwear";
  }
  if (/(mont|ceket|kaban|parka|coat|jacket|outerwear|blazer|trenç|trenc|trench)/u.test(value)) {
    return "outerwear";
  }
  if (/(pantolon|jean|denim|trouser|pants|bottom|şort|sort|etek|skirt)/u.test(value)) {
    return "bottom";
  }
  if (/(elbise|tulum|dress|jumpsuit)/u.test(value)) {
    return "onePiece";
  }
  if (/(aksesuar|accessory|çanta|canta|bag|kemer|belt|şapka|sapka|hat|atkı|atki|scarf)/u.test(value)) {
    return "accessory";
  }
  if (/(tişört|tisort|t-shirt|tee|gömlek|gomlek|shirt|sweat|hoodie|kazak|triko|knit|hırka|hirka|cardigan|bluz|blouse|tops| top|üst|ust)/u.test(value)) {
    return "upper";
  }
  return "other";
}

function renderStudioAnalysis() {
  const result = state.styleBoardAnalysis;
  elements.studioAnalysis.classList.toggle("hidden", !result);
  if (!result) {
    return;
  }
  elements.studioVerdict.textContent = result.verdict;
  elements.studioScore.textContent = `${result.score}/95`;
  elements.studioSeason.textContent = result.seasonContext;
  elements.studioAnalysisHeadline.textContent = result.headline;
  elements.studioAnalysisCopy.textContent = result.explanation;
  elements.studioAnalysisNotes.replaceChildren(
    ...(result.notes || []).map(note => {
      const item = document.createElement("li");
      item.textContent = note;
      return item;
    }));
}

async function saveCurrentProductToStudio() {
  const currentUrl = state.snapshot?.product?.url || "";
  const alreadySaved = Boolean(currentUrl) &&
    (state.styleBoardItems || []).some(item =>
      item.productUrl === currentUrl);
  if (alreadySaved) {
    navigate("studio");
    return;
  }

  elements.saveToStudioButton.disabled = true;
  elements.saveToStudioButton.querySelector("span").textContent =
    "Stüdyoya ekleniyor";
  try {
    const result = await sendMessage(
      "SAVE_CURRENT_PRODUCT_TO_STYLE_BOARD",
      { tabId: await resolveHostTabId() });
    state.styleBoardItems = result.items || [];
    const savedItem = state.styleBoardItems.find(item =>
      item.productUrl === currentUrl);
    activeStudioGroupKey = savedItem
      ? studioGroupKey(savedItem)
      : activeStudioGroupKey;
    state.styleBoardAnalysis = null;
    renderStudio();
    navigate("studio");
    showToast("Ürün Kombin Stüdyosu'na ayrıldı.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.saveToStudioButton.disabled = false;
    renderStudioSaveButton();
  }
}

async function deleteStudioItem(id, button) {
  button.disabled = true;
  try {
    const result = await sendMessage(
      "DELETE_STYLE_BOARD_ITEM",
      { id });
    state.styleBoardItems = result.items || [];
    state.styleBoardAnalysis = null;
    renderStudio();
    showToast("Parça stüdyodan çıkarıldı.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message, true);
  }
}

async function selectStudioItem(id, button) {
  button.disabled = true;
  try {
    const result = await sendMessage(
      "SELECT_STYLE_BOARD_ITEM",
      { id });
    state.styleBoardItems = result.items || [];
    state.styleBoardAnalysis = null;
    renderStudio();
    showToast("Bu kategoride kullanılacak parça değiştirildi.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message, true);
  }
}

async function clearStudio() {
  if (!window.confirm(
    "Kombin Stüdyosu'ndaki bütün aday ürünler silinsin mi?"
  )) {
    return;
  }
  elements.clearStudioButton.disabled = true;
  try {
    await sendMessage("CLEAR_STYLE_BOARD");
    state.styleBoardItems = [];
    state.styleBoardAnalysis = null;
    activeStudioGroupKey = null;
    renderStudio();
    showToast("Kombin Stüdyosu tamamen boşaltıldı.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.clearStudioButton.disabled = false;
  }
}

async function analyzeStudio() {
  const label = elements.analyzeStudioButton.querySelector(
    "span:last-child");
  const spinner = elements.analyzeStudioButton.querySelector(
    ".analysis-spinner");
  elements.analyzeStudioButton.disabled = true;
  spinner.classList.remove("hidden");
  label.textContent = "AI kombini eleştiriyor";
  try {
    state.styleBoardAnalysis = await sendMessage(
      "ANALYZE_STYLE_BOARD");
    renderStudioAnalysis();
    showToast("Kombin değerlendirmesi hazır.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.analyzeStudioButton.disabled = false;
    spinner.classList.add("hidden");
    label.textContent = "Bu kombini AI'a yorumlat";
  }
}

function renderOrders() {
  elements.ordersLoading.classList.add("hidden");
  const closetOrders = state.orders.filter((order) =>
    !isReturnedOutcome(order.outcome));
  const returnedOrders = state.orders.filter((order) =>
    isReturnedOutcome(order.outcome));
  elements.orderCount.textContent = String(closetOrders.length);
  elements.orderCount.title = `${closetOrders.length} dolap parçası`;
  const groups = groupArchiveOrders(closetOrders);
  if (returnedOrders.length > 0) {
    groups.push({
      key: "returned-fit-memory",
      label: "Fit hafızası",
      priority: 99,
      orders: returnedOrders
    });
  }

  const isEmpty = groups.length === 0;
  elements.ordersEmpty.classList.toggle("hidden", !isEmpty);
  elements.closetTabs.classList.toggle("hidden", isEmpty);
  elements.closetSummary.textContent = isEmpty
    ? "Sipariş geçmişinden parçalarını ekle"
    : `${closetOrders.length} parça · ${groups.length - (returnedOrders.length > 0 ? 1 : 0)} kategori`;

  if (isEmpty) {
    activeClosetGroupKey = null;
    expandedClosetOrderId = null;
    elements.closetTabs.replaceChildren();
    elements.ordersList.replaceChildren();
    elements.ordersList.removeAttribute("aria-labelledby");
    return;
  }

  if (!groups.some((group) => group.key === activeClosetGroupKey)) {
    activeClosetGroupKey = groups[0].key;
    expandedClosetOrderId = null;
  }

  renderClosetTabs(groups);
  const activeGroup = groups.find(
    (group) => group.key === activeClosetGroupKey);
  elements.ordersList.setAttribute(
    "aria-labelledby",
    `closet-tab-${activeGroup.key}`);
  elements.ordersList.replaceChildren(
    ...activeGroup.orders.map(createOrderCard)
  );
}

function groupArchiveOrders(orders) {
  const definitions = [
    { key: "tees", label: "Tişört", priority: 1 },
    { key: "shirts", label: "Gömlek", priority: 2 },
    { key: "bottoms", label: "Pantolon", priority: 3 },
    { key: "outerwear", label: "Dış giyim", priority: 4 },
    { key: "knitwear", label: "Sweat & triko", priority: 5 },
    { key: "dresses", label: "Elbise", priority: 6 },
    { key: "footwear", label: "Ayakkabı", priority: 7 },
    { key: "accessories", label: "Aksesuar", priority: 8 },
    { key: "other", label: "Diğer", priority: 9 }
  ];
  const byKey = new Map(
    definitions.map((definition) => [
      definition.key,
      { ...definition, orders: [] }
    ])
  );
  orders.forEach((order) => {
    byKey.get(archiveGroupKey(order)).orders.push(order);
  });
  return [...byKey.values()]
    .filter((group) => group.orders.length > 0)
    .sort((left, right) => left.priority - right.priority);
}

function archiveGroupKey(order) {
  const text = `${order.category || ""} ${order.productName || ""}`
    .toLocaleLowerCase("tr");
  if (/(tişört|tisort|t-shirt|\btee\b)/i.test(text)) {
    return "tees";
  }
  if (/(gömlek|gomlek|\bshirt\b)/i.test(text)) {
    return "shirts";
  }
  if (/(pantolon|jean|denim|trouser|pants|şort|sort|short|etek|skirt)/i.test(text)) {
    return "bottoms";
  }
  if (/(mont|ceket|kaban|parka|coat|jacket|outerwear|şişme|sisme)/i.test(text)) {
    return "outerwear";
  }
  if (/(sweat|hoodie|kazak|triko|knit|hırka|hirka|cardigan)/i.test(text)) {
    return "knitwear";
  }
  if (/(elbise|tulum|dress|jumpsuit)/i.test(text)) {
    return "dresses";
  }
  if (/(ayakkabı|ayakkabi|sneaker|trainer|loafer|bot|çizme|cizme|shoe|footwear)/i.test(text)) {
    return "footwear";
  }
  if (/(aksesuar|accessory|çanta|canta|\bbag\b|kemer|belt|şapka|sapka|\bhat\b|atkı|atki|scarf)/i.test(text)) {
    return "accessories";
  }
  return "other";
}

function renderClosetTabs(groups) {
  const tabs = groups.map((group) => {
    const tab = document.createElement("button");
    const isActive = group.key === activeClosetGroupKey;
    tab.id = `closet-tab-${group.key}`;
    tab.className = `closet-tab${isActive ? " is-active" : ""}`;
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.tabIndex = isActive ? 0 : -1;
    tab.setAttribute("aria-selected", String(isActive));
    tab.setAttribute("aria-controls", "orders-list");
    tab.dataset.groupKey = group.key;

    const label = document.createElement("span");
    label.textContent = group.label;
    const count = document.createElement("span");
    count.className = "closet-tab-count";
    count.textContent = String(group.orders.length);
    tab.append(label, count);
    tab.addEventListener("click", () => selectClosetGroup(group.key));
    return tab;
  });

  tabs.forEach((tab, index) => {
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "ArrowLeft") {
        nextIndex = index === 0 ? tabs.length - 1 : index - 1;
      } else if (event.key === "ArrowRight") {
        nextIndex = index === tabs.length - 1 ? 0 : index + 1;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else {
        nextIndex = tabs.length - 1;
      }
      selectClosetGroup(tabs[nextIndex].dataset.groupKey);
      requestAnimationFrame(() =>
        document.getElementById(tabs[nextIndex].id)?.focus());
    });
  });

  elements.closetTabs.replaceChildren(...tabs);
  elements.closetTabs.querySelector(".is-active")?.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
    inline: "center"
  });
}

function selectClosetGroup(groupKey) {
  if (groupKey === activeClosetGroupKey) {
    return;
  }
  activeClosetGroupKey = groupKey;
  expandedClosetOrderId = null;
  renderOrders();
}

function createOrderCard(order) {
  const card = document.createElement("details");
  card.className = "closet-product";
  card.dataset.orderId = String(order.id);
  card.open = expandedClosetOrderId === order.id;
  const isReturned = isReturnedOutcome(order.outcome);

  card.addEventListener("toggle", () => {
    if (card.open) {
      expandedClosetOrderId = order.id;
      elements.ordersList
        .querySelectorAll(".closet-product[open]")
        .forEach((otherCard) => {
          if (otherCard !== card) {
            otherCard.open = false;
          }
        });
    } else if (expandedClosetOrderId === order.id) {
      expandedClosetOrderId = null;
    }
  });

  const summary = document.createElement("summary");
  summary.className = "closet-product-summary";
  const thumbnail = createOrderThumbnail(order, false);
  const copy = document.createElement("div");
  copy.className = "closet-product-copy";
  const brand = document.createElement("p");
  brand.className = "closet-product-brand";
  brand.textContent = order.brand;
  const title = document.createElement("h3");
  title.className = "closet-product-title";
  title.textContent = order.productName;

  copy.append(brand, title);

  const trailing = document.createElement("div");
  trailing.className = "closet-product-trailing";
  const size = document.createElement("span");
  size.className = "closet-size";
  size.textContent = order.purchasedSize;
  size.title = "Satın alınan beden";
  trailing.append(size);
  if (Number.isInteger(order.fitScore)) {
    const score = document.createElement("span");
    score.className = "closet-score";
    score.textContent = `%${order.fitScore}`;
    trailing.append(score);
  }
  const chevron = document.createElement("span");
  chevron.className = "closet-product-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "⌄";
  trailing.append(chevron);
  summary.append(thumbnail, copy, trailing);
  card.append(summary);

  const body = document.createElement("div");
  body.className = "closet-product-body";
  const detailMeta = document.createElement("div");
  detailMeta.className = "closet-product-meta";
  const outcome = document.createElement("span");
  outcome.className = `closet-outcome-dot ${outcomeClass(order.outcome)}`;
  outcome.textContent = outcomeLabel(order.outcome);
  detailMeta.append(outcome);
  if (order.fitLabel) {
    const fit = document.createElement("span");
    fit.textContent = order.fitLabel;
    detailMeta.append(fit);
  }
  body.append(detailMeta);
  const fitPanel = document.createElement("section");
  fitPanel.className = "closet-assessment";
  const fitHeader = document.createElement("div");
  fitHeader.className = "flex items-center justify-between gap-3";
  const fitTitle = document.createElement("p");
  fitTitle.className = "text-[11px] font-semibold text-mango";
  fitTitle.textContent = "Kişisel uyum";
  const fitScore = document.createElement("span");
  fitScore.className = "text-xs font-semibold text-acid";
  fitScore.textContent = Number.isInteger(order.fitScore)
    ? `%${order.fitScore}`
    : "Veri bekleniyor";
  fitHeader.append(fitTitle, fitScore);
  fitPanel.append(fitHeader);

  if (Number.isInteger(order.fitScore)) {
    const track = document.createElement("div");
    track.className = "confidence-track mt-2";
    const fill = document.createElement("div");
    fill.className = "confidence-fill";
    fill.style.width = `${Math.max(0, Math.min(100, order.fitScore))}%`;
    track.append(fill);
    fitPanel.append(track);
  }

  const assessment = document.createElement("p");
  assessment.className = "mt-2 text-[11px] leading-[1.5] text-[#454541]";
  assessment.textContent = order.fitAssessment ||
    "Resmi ölçü veya kalıp bilgisi bulunursa kişisel uyum tahmini burada görünür.";
  fitPanel.append(assessment);

  body.append(fitPanel);

  const facts = [
    measurementSummary(order) || categoryLabel(order.category),
    order.sizeEvidence ? `Beden tablosu · ${order.sizeEvidence}` : null
  ].filter(Boolean);
  if (facts.length > 0) {
    const evidence = document.createElement("details");
    evidence.className = "closet-evidence";
    const evidenceSummary = document.createElement("summary");
    evidenceSummary.textContent = "Ürün ve ölçü bilgisi";
    const evidenceBody = document.createElement("div");
    evidenceBody.className = "closet-evidence-body";
    facts.forEach((fact) => {
      const line = document.createElement("p");
      line.textContent = fact;
      evidenceBody.append(line);
    });
    evidence.append(evidenceSummary, evidenceBody);
    body.append(evidence);
  }

  const feedbackTitle = document.createElement("p");
  feedbackTitle.className =
    "text-[11px] font-semibold tracking-[0.02em] text-mango";
  feedbackTitle.textContent = "Sende nasıl oldu?";
  const userNote = document.createElement("textarea");
  userNote.className = "field closet-fit-note mt-2 resize-y text-xs leading-[1.5]";
  userNote.maxLength = 500;
  userNote.placeholder = "Örn. Boydan tam, belden biraz dar; omuzları iyi.";
  userNote.value = order.userFitNotes || "";
  userNote.setAttribute(
    "aria-label",
    `${order.productName} için bölgesel uyum notu`
  );
  const feedback = document.createElement("div");
  feedback.className = "mt-2 grid grid-cols-3 gap-2";
  [
    ["Tam oldu", "KeptGoodFit"],
    ["Bol geldi", "KeptTooBaggy"],
    ["Dar geldi", "KeptTooTight"]
  ].forEach(([label, value]) => {
    const button = document.createElement("button");
    const active =
      order.outcome === value ||
      value === "KeptTooBaggy" && order.outcome === "ReturnedTooBaggy" ||
      value === "KeptTooTight" && order.outcome === "ReturnedTooTight";
    button.className = active
      ? "min-h-9 rounded-[4px] border border-acid/45 bg-acid/10 px-2 py-2 text-[10.5px] font-semibold text-acid"
      : "min-h-9 rounded-[4px] border border-line bg-white px-2 py-2 text-[10.5px] font-semibold text-[#454541] transition hover:border-mango hover:text-mango";
    button.type = "button";
    button.textContent = label;
    button.disabled = active && !isReturned;
    button.addEventListener("click", () =>
      updateOrderFeedback(
        order.id,
        value,
        userNote.value,
        button,
        false));
    feedback.append(button);
  });
  const saveNote = document.createElement("button");
  saveNote.type = "button";
  saveNote.className = "btn-secondary mt-2 w-full";
  saveNote.textContent = "Uyum notunu kaydet";
  saveNote.addEventListener("click", () =>
    updateOrderFeedback(
      order.id,
      order.outcome,
      userNote.value,
      saveNote,
      isReturned));

  const returnControls = createReturnControls(
    order,
    userNote);
  const feedbackEditor = document.createElement("section");
  feedbackEditor.className =
    "feedback-editor closet-feedback-editor";
  feedbackEditor.append(
    feedbackTitle,
    userNote,
    feedback,
    saveNote,
    returnControls);

  const hasAssessment =
    order.outcome !== "PurchasedUnknownFit" ||
    Boolean(order.userFitNotes?.trim());
  feedbackEditor.classList.toggle("hidden", hasAssessment);

  if (hasAssessment && order.userFitNotes?.trim()) {
    const savedNote = document.createElement("p");
    savedNote.className = "closet-saved-note";
    savedNote.textContent = `Senin notun · ${order.userFitNotes.trim()}`;
    body.append(savedNote);
  }

  body.append(feedbackEditor);

  const actions = document.createElement("div");
  actions.className = "closet-product-actions";

  if (order.productUrl || order.researchSourceUrl) {
    const source = document.createElement("a");
    source.className = "closet-text-action";
    source.href = order.researchSourceUrl || order.productUrl;
    source.target = "_blank";
    source.rel = "noreferrer";
    source.textContent = order.researchSourceUrl
      ? "Resmi ölçüler ↗"
      : "Ürün sayfası ↗";
    actions.append(source);
  }

  if (hasAssessment) {
    const editFeedback = document.createElement("button");
    editFeedback.type = "button";
    editFeedback.dataset.action = "edit-feedback";
    editFeedback.className = "closet-text-action";
    editFeedback.textContent = "Düzenle";
    editFeedback.setAttribute("aria-expanded", "false");
    editFeedback.addEventListener("click", () => {
      const expanded =
        editFeedback.getAttribute("aria-expanded") === "true";
      editFeedback.setAttribute("aria-expanded", String(!expanded));
      feedbackEditor.classList.toggle("hidden", expanded);
      editFeedback.textContent = expanded
        ? "Düzenle"
        : "Kapat";
      if (!expanded) {
        userNote.focus();
      }
    });
    actions.append(editFeedback);
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "closet-text-action is-danger";
  deleteButton.textContent = isReturned
    ? "Hafızadan sil"
    : "Sil";
  deleteButton.addEventListener("click", () =>
    deleteArchivedOrder(order, deleteButton));
  actions.append(deleteButton);
  body.append(actions);
  card.append(body);

  return card;
}

function createReturnControls(order, userNote) {
  const wrapper = document.createElement("div");
  wrapper.className = "mt-3";

  if (isReturnedOutcome(order.outcome)) {
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className =
      "w-full rounded-[4px] border border-line bg-white px-3 py-2.5 text-[11px] font-semibold text-mango transition hover:border-mango";
    restore.textContent = "İadeyi geri al · Dolaba koy";
    restore.addEventListener("click", () => {
      const keptOutcome = order.outcome === "ReturnedTooBaggy"
        ? "KeptTooBaggy"
        : "KeptTooTight";
      updateOrderFeedback(
        order.id,
        keptOutcome,
        userNote.value,
        restore,
        false);
    });
    wrapper.append(restore);
    return wrapper;
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className =
    "w-full rounded-[4px] border border-red-300 bg-white px-3 py-2.5 text-[11px] font-semibold text-red-700 transition hover:border-red-500 hover:bg-red-50";
  toggle.textContent = "İade ettim";
  toggle.setAttribute("aria-expanded", "false");

  const reasons = document.createElement("div");
  reasons.className = "mt-2 hidden grid-cols-2 gap-2";
  [
    ["Bol geldiği için", "ReturnedTooBaggy"],
    ["Dar geldiği için", "ReturnedTooTight"]
  ].forEach(([label, outcome]) => {
    const reason = document.createElement("button");
    reason.type = "button";
    reason.className =
      "min-h-9 rounded-[4px] border border-red-300 bg-red-50 px-2 py-2 text-[10.5px] font-semibold text-red-800 transition hover:border-red-500";
    reason.textContent = label;
    reason.addEventListener("click", () =>
      updateOrderFeedback(
        order.id,
        outcome,
        userNote.value,
        reason,
        true));
    reasons.append(reason);
  });
  toggle.addEventListener("click", () => {
    const expanded =
      toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    reasons.classList.toggle("hidden", expanded);
    reasons.classList.toggle("grid", !expanded);
  });
  wrapper.append(toggle, reasons);
  return wrapper;
}

function createOrderThumbnail(order, interactive = true) {
  const container = interactive && order.productUrl
    ? document.createElement("a")
    : document.createElement("div");
  container.className = "closet-thumbnail";
  container.title = `${order.productName} ürün fotoğrafı`;
  if (interactive && order.productUrl) {
    container.href = order.productUrl;
    container.target = "_blank";
    container.rel = "noreferrer";
    container.setAttribute(
      "aria-label",
      `${order.productName} resmi ürün sayfasını aç`
    );
  }

  const fallback = document.createElement("span");
  fallback.className = "closet-thumbnail-fallback";
  fallback.textContent = "Görsel yok";
  container.append(fallback);

  if (!order.imageUrl) {
    return container;
  }

  const image = document.createElement("img");
  image.className = "closet-thumbnail-image";
  image.src = order.imageUrl;
  image.alt = `${order.productName} ürün fotoğrafı`;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => image.remove(), { once: true });
  container.append(image);
  return container;
}

async function deleteArchivedOrder(order, button) {
  const isReturned = isReturnedOutcome(order.outcome);
  const confirmed = window.confirm(
    isReturned
      ? `${order.brand} · ${order.productName} (${order.purchasedSize}) fit hafızasından kalıcı olarak silinsin mi?`
      : `${order.brand} · ${order.productName} (${order.purchasedSize}) dolabından kalıcı olarak çıkarılsın mı?`
  );
  if (!confirmed) {
    return;
  }

  button.disabled = true;
  button.textContent = "Siliniyor";
  try {
    const result = await sendMessage("DELETE_ORDER", { id: order.id });
    state.orders = result.orders || [];
    renderOrders();
    showToast(isReturned
      ? "İade kaydı fit hafızasından silindi."
      : "Parça dolabından çıkarıldı.");
  } catch (error) {
    button.disabled = false;
    button.textContent = isReturned
      ? "Hafızadan sil"
      : "Sil";
    showToast(error.message, true);
  }
}

async function updateOrderFeedback(
  id,
  outcome,
  userFitNotes,
  button,
  returnConfirmedByUser = false) {
  button.disabled = true;
  try {
    const result = await sendMessage("SET_ORDER_FEEDBACK", {
      id,
      outcome,
      userFitNotes,
      returnConfirmedByUser
    });
    state.orders = result.orders || [];
    renderOrders();
    showToast("Bu ürünün kişisel kalıp hafızası güncellendi.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message, true);
  }
}

function renderImportStatus(result) {
  elements.importStatus.classList.remove("hidden");
  elements.importStatusTitle.textContent =
    result.importedCount > 0 || result.updatedCount > 0
    ? "Dolap güncellendi"
    : "Dolaba yeni parça eklenmedi";
  elements.importStatusCount.textContent =
    `${result.importedCount} yeni · ${result.updatedCount || 0} güncel`;
}

function hydrateProfileForm() {
  elements.apiBaseUrl.value =
    state.settings?.apiBaseUrl || "http://localhost:8788";
  if (!state.profile) {
    elements.profileSummary.classList.add("hidden");
    elements.profileForm.classList.remove("hidden");
    return;
  }
  elements.age.value = state.profile.age ?? "";
  elements.heightCm.value = state.profile.heightCm;
  elements.weightKg.value = state.profile.weightKg;
  elements.shoulderWidthCm.value = displayShoulderCircumference(state.profile.shoulderWidthCm);
  elements.chestCm.value = state.profile.chestCircumferenceCm || "";
  elements.waistCm.value = state.profile.waistCircumferenceCm;
  elements.footLengthCm.value = state.profile.footLengthCm || "";
  elements.shoeSizeEu.value = state.profile.usualShoeSizeEu || "";
  elements.fitPreference.value = state.profile.fitPreference;
  renderProfileSummary();
}

function renderProfileSummary() {
  if (!state.profile) {
    return;
  }
  const profile = state.profile;
  const preferenceLabels = {
    TrueToSize: "Standart",
    Relaxed: "Rahat",
    Oversized: "Oversize",
    Slim: "Dar"
  };
  elements.profileSummaryTitle.textContent =
    `${preferenceLabels[profile.fitPreference] || "Standart"} kalıp tercihi`;
  const values = [
    ["Boy", `${profile.heightCm} cm`],
    ["Göğüs", profile.chestCircumferenceCm ? `${profile.chestCircumferenceCm} cm` : "—"],
    ["Bel", `${profile.waistCircumferenceCm} cm`],
    ["Ayakkabı", profile.usualShoeSizeEu ? `EU ${profile.usualShoeSizeEu}` : "—"]
  ];
  elements.profileSummaryValues.replaceChildren(...values.map(([label, value]) => {
    const item = document.createElement("span");
    item.innerHTML = `<small>${label}</small><strong>${value}</strong>`;
    return item;
  }));
  elements.profileForm.classList.add("hidden");
  elements.profileSummary.classList.remove("hidden");
}

async function rescanPage() {
  setButtonBusy(elements.refreshPage, true);
  state.analysisStatus = {
    status: "analyzing",
    productIdentity: state.snapshotIdentity,
    label: "Sayfa, ürün görseli ve beden tablosu taranıyor"
  };
  renderAnalysisProgress(true, state.analysisStatus.label);
  try {
    const result = await sendMessage("RESCAN_ACTIVE_TAB", {
      tabId: await resolveHostTabId()
    });
    applyProductState(result);
    renderFit();
    showToast(state.snapshot?.sizeChart?.found
      ? "Beden tablosu algılandı."
      : "Görünür beden tablosu bulunamadı.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.analysisStatus = null;
    renderAnalysisProgress(false);
    setButtonBusy(elements.refreshPage, false);
  }
}

async function analyzeProduct() {
  return performProductAnalysis("");
}

async function reconsiderRecommendation() {
  const note = elements.recommendationNote.value.trim();
  if (note.length < 3) {
    showToast(
      "AI'ın yeniden tartmasını istediğin detayı yaz.",
      true);
    elements.recommendationNote.focus();
    return;
  }

  setButtonBusy(
    elements.reconsiderButton,
    true,
    "Yeniden düşünüyor");
  try {
    await performProductAnalysis(note, true);
  } finally {
    setButtonBusy(
      elements.reconsiderButton,
      false,
      "Yeniden düşünüyor");
    syncReconsiderButton();
  }
}

function syncReconsiderButton() {
  const hasUsefulNote =
    elements.recommendationNote.value.trim().length >= 3;
  elements.reconsiderButton.disabled = !hasUsefulNote;
  elements.reconsiderButton.title = hasUsefulNote
    ? "Notu aktif beden tablosuyla yeniden değerlendir"
    : "Yeniden değerlendirmek için en az 3 karakter yaz";
}

async function performProductAnalysis(
  userAdjustmentNote,
  isReconsideration = false) {
  if (!state.profile || !state.profile.age) {
    navigate("profile");
    showToast("Ürünü analiz etmeden önce yaş bilgini içeren profilini kaydet.", true);
    return;
  }

  if (!isReconsideration) {
    setAnalyzeButton(true, "AI bedeni denetliyor");
  }
  state.analysisStatus = {
    status: "analyzing",
    productIdentity: state.snapshotIdentity,
    label: isReconsideration
      ? "Notunla birlikte öneri yeniden düşünülüyor"
      : "AI kalıp, dikiş ve etiketleri denetliyor"
  };
  renderAnalysisProgress(true, state.analysisStatus.label);
  try {
    const result = await sendMessage("ANALYZE_CURRENT_PRODUCT", {
      userAdjustmentNote,
      isReconsideration,
      tabId: await resolveHostTabId()
    });
    const currentProductState = await sendMessage("GET_ACTIVE_PRODUCT_STATE", {
      tabId: result.activeTabId ?? await resolveHostTabId()
    });
    if (
      !result.snapshotIdentity ||
      result.snapshotIdentity !== currentProductState.snapshotIdentity
    ) {
      throw new Error("Ürün sayfası analiz sırasında değişti. Yeni ürünü yeniden tarayın.");
    }
    applyProductState(currentProductState);
    state.apiHealthy = true;
    renderApiStatus();
    renderFit();
    const verifiedRecommendation = getVerifiedRecommendation();
    if (verifiedRecommendation) {
      state.progress = await sendMessage("GET_FIT_PROGRESS");
      renderProgress();
      showToast(isReconsideration
        ? `Notunla yeniden düşünüldü: ${verifiedRecommendation.recommendedSize}.`
        : `Önerilen bedeniniz: ${verifiedRecommendation.recommendedSize}.`);
    }
  } catch (error) {
    showToast(error.message, true);
    if (!isReconsideration) {
      setAnalyzeButton(false, "Yeniden dene");
    }
  } finally {
    state.analysisStatus = null;
    renderAnalysisProgress(false);
  }
}

async function scanOrderHistory() {
  if (!state.profile || !state.profile.age) {
    navigate("profile");
    showToast("Dolabını oluşturmadan önce yaş bilgini içeren profilini kaydet.", true);
    return;
  }

  setScanButton(true, "Taranıyor");
  elements.importStatus.classList.remove("hidden");
  elements.importStatusTitle.textContent = "Dolap güncelleniyor";
  elements.importStatusCount.textContent = "Bekleyin";

  try {
    const result = await sendMessage("SCAN_ORDER_HISTORY", {
      tabId: await resolveHostTabId()
    });
    state.lastImport = result;
    state.orders = result.orders || [];
    state.apiHealthy = true;
    renderApiStatus();
    renderOrders();
    renderImportStatus(result);
    if (result.importedCount > 0 || result.updatedCount > 0) {
      showToast(`${result.importedCount} yeni parça dolaba eklendi, ${result.updatedCount || 0} parça güncellendi.`);
    } else if (result.detectedCount > 0) {
      showToast("Sipariş kartları görüldü ama ürün adı veya beden okunamadı. Kartları ekrana kaydırıp yeniden dene.", true);
    } else {
      showToast("Görünür sipariş ürünü bulunamadı. Siparişlerim, sipariş detayı veya alışveriş özeti açıkken Tara'ya bas.", true);
    }
  } catch (error) {
    elements.importStatusTitle.textContent = "Dolap güncellenemedi";
    elements.importStatusCount.textContent = "Hata";
    showToast(friendlyScanError(error), true);
  } finally {
    setScanButton(false, "Tara");
  }
}

async function saveProfile(event) {
  event.preventDefault();
  if (!elements.profileForm.reportValidity()) {
    return;
  }

  setButtonBusy(elements.saveProfileButton, true, "Kaydediliyor");
  try {
    state.settings = await sendMessage("SET_API_BASE_URL", {
      apiBaseUrl: elements.apiBaseUrl.value.trim()
    });
    const result = await sendMessage("SAVE_PROFILE", {
      age: numberValue(elements.age),
      heightCm: numberValue(elements.heightCm),
      weightKg: numberValue(elements.weightKg),
      shoulderWidthCm: numberValue(elements.shoulderWidthCm),
      chestCircumferenceCm: optionalNumberValue(elements.chestCm),
      waistCircumferenceCm: numberValue(elements.waistCm),
      footLengthCm: numberValue(elements.footLengthCm),
      usualShoeSizeEu: numberValue(elements.shoeSizeEu),
      fitPreference: elements.fitPreference.value
    });
    state.profile = result.profile;
    state.orders = result.orders;
    state.apiHealthy = true;
    renderApiStatus();
    renderOrders();
    hydrateProfileForm();
    navigate("fit");
    showToast("Beden profiliniz kaydedildi.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setButtonBusy(elements.saveProfileButton, false, "Profili kaydet");
  }
}

function sendMessage(type, payload) {
  return chrome.runtime.sendMessage({ type, payload }).then((response) => {
    if (!response?.ok) {
      throw new Error(response?.error || "Uzantı bu işlemi tamamlayamadı.");
    }
    return response.data;
  });
}

function setAnalyzeButton(busy, label) {
  elements.analyzeButton.disabled = busy;
  elements.analyzeButton.querySelector("span").textContent = label;
  elements.analyzeButton.classList.toggle("animate-pulse", busy);
}

function setScanButton(busy, label) {
  elements.scanOrdersButton.disabled = busy;
  elements.scanOrdersButton.querySelector("span").textContent = label;
  elements.scanOrdersButton.classList.toggle("animate-pulse", busy);
}

function setButtonBusy(button, busy, busyLabel) {
  button.disabled = busy;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent;
  }
  if (busyLabel) {
    button.textContent = busy ? busyLabel : button.dataset.defaultLabel;
  }
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", isError);
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 4200);
}

function friendlyScanError(error) {
  const message = String(error?.message || error || "");
  if (/all_urls|activeTab/i.test(message)) {
    return "Chrome sipariş sayfasını okuyamadı. chrome://extensions içindeki FitMemory kartında dairesel yenile’ye bas (Kaldır deme), sipariş sayfasını yenile ve Tara’ya bas.";
  }
  return message || "Siparişler okunamadı.";
}

function measurementSummary(order) {
  const values = [
    order.chestWidthCm ? `Göğüs ${formatNumber(order.chestWidthCm)}` : null,
    order.waistWidthCm ? `Bel ${formatNumber(order.waistWidthCm)}` : null,
    order.shoulderWidthCm ? `Omuz ${formatNumber(order.shoulderWidthCm)}` : null
  ].filter(Boolean);
  return values.length ? `${values.join(" · ")} cm` : "";
}

function outcomeLabel(outcome) {
  return {
    PurchasedUnknownFit: "Satın alındı · uyum belirsiz",
    KeptGoodFit: "İyi uyum · tutuldu",
    KeptTooBaggy: "Bol geldi · dolapta",
    KeptTooTight: "Dar geldi · dolapta",
    ReturnedTooBaggy: "İade · bol geldi",
    ReturnedTooTight: "İade · dar geldi"
  }[outcome] || outcome;
}

function outcomeClass(outcome) {
  return {
    PurchasedUnknownFit: "outcome-unknown",
    KeptGoodFit: "outcome-kept",
    KeptTooBaggy: "outcome-baggy",
    KeptTooTight: "outcome-tight",
    ReturnedTooBaggy: "outcome-baggy",
    ReturnedTooTight: "outcome-tight"
  }[outcome] || "";
}

function isReturnedOutcome(outcome) {
  return outcome === "ReturnedTooBaggy" ||
    outcome === "ReturnedTooTight";
}

function categoryLabel(category) {
  return {
    Tops: "Üst / tişört",
    Shirts: "Gömlek",
    Outerwear: "Dış giyim",
    Knitwear: "Triko",
    Bottoms: "Alt giyim",
    Denim: "Denim",
    Dresses: "Elbise",
    Footwear: "Ayakkabı",
    Other: "Diğer"
  }[category] || category;
}

function numberValue(input) {
  return Number.parseFloat(input.value);
}

function optionalNumberValue(input) {
  const value = input.value.trim();
  return value ? Number.parseFloat(value) : null;
}

function formatNumber(value) {
  return Number(value).toLocaleString("tr-TR", { maximumFractionDigits: 1 });
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}
