import { captureRef } from "react-native-view-shot";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import {
  Button,
  Card,
  ErrorNotice,
  SectionTitle,
} from "../components/Ui";
import { createScanScript } from "../injectedScanner";
import { useSession } from "../session";
import { colors, shadow } from "../theme";
import { useFeedback } from "../feedback";
import { Text, useI18n } from "../i18n";
import { agentResultToSnapshot, hasVerifiedNumericChart as hasVerifiedSnapshot } from "../scanValidation";
import { isCurrentScanResponse, normalizeScanUrl, SCAN_TIMEOUT_MS } from "../scanLifecycle";
import type {
  ProductSnapshot,
  Recommendation,
  ScanStage,
  ScanTraceStep,
  ScannerMessage,
  WardrobeOutfit,
} from "../types";

const shops = [
  { name: "Pull&Bear", logo: "PULL&BEAR", url: "https://www.pullandbear.com/tr/" },
  { name: "Bershka", logo: "BERSHKA", url: "https://www.bershka.com/tr/" },
  { name: "Zara", logo: "ZARA", url: "https://www.zara.com/tr/" },
];

const allowedShopDomains = [
  "pullandbear.com",
  "bershka.com",
  "zara.com",
  "inditex.com",
];

function visibleTextChart(pageText: string): ProductSnapshot["sizeChart"] | null {
  const selected = pageText.match(/\[selected\]\s*(XXXL|XXL|XL|L|M|S|XS|XXS|\d{2,3})\b/i)?.[1]?.toUpperCase();
  if (!selected) return null;
  const metrics: Array<[RegExp, string]> = [
    [/(?:göğüs|gogus|chest|bust)(?:\s+(?:çevresi|cevresi|eni))?\s*[:.-]?\s*(\d{1,3}(?:[.,]\d+)?)/i, "Göğüs"],
    [/(?:omuz|shoulder)(?:\s+(?:genişliği|genisligi|width))?\s*[:.-]?\s*(\d{1,3}(?:[.,]\d+)?)/i, "Omuz"],
    [/(?:bel|waist)(?:\s+(?:çevresi|cevresi|eni))?\s*[:.-]?\s*(\d{1,3}(?:[.,]\d+)?)/i, "Bel"],
    [/(?:kalça|kalca|basen|hip)(?:\s+(?:çevresi|cevresi|eni))?\s*[:.-]?\s*(\d{1,3}(?:[.,]\d+)?)/i, "Kalça"],
    [/(?:ön uzunluk|on uzunluk|front length)\s*[:.-]?\s*(\d{1,3}(?:[.,]\d+)?)/i, "Ön uzunluk"],
    [/(?:kol uzunluğu|kol uzunlugu|sleeve length)\s*[:.-]?\s*(\d{1,3}(?:[.,]\d+)?)/i, "Kol uzunluğu"],
  ];
  const found = metrics.map(([pattern, label]) => [label, pageText.match(pattern)?.[1]?.replace(",", ".")] as const)
    .filter((item): item is readonly [string, string] => Boolean(item[1]));
  if (!found.length) return null;
  return {
    found: true,
    title: "Ekranda okunan ürün ölçüleri",
    unit: /\bcm\b/i.test(pageText) ? "Centimeters" : "Unknown",
    headers: ["Beden", ...found.map(([label]) => label)],
    rows: [{ cells: [selected, ...found.map(([, value]) => value)] }],
    rawText: pageText.slice(0, 12000),
  };
}

function hasVerifiedNumericChart(chart: ProductSnapshot["sizeChart"] | null | undefined) {
  if (!chart?.found || chart.headers.length < 2 || chart.rows.length < 1) return false;
  return chart.rows.some((row) => {
    const size = String(row.cells[0] ?? "").trim();
    const validSize = /^(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|\d{1,3}(?:[/-]\d{1,3})?)$/i.test(size);
    const numericMeasurements = row.cells.slice(1).filter((value) =>
      /^\s*\d{1,3}(?:[.,]\d+)?\s*(?:cm|in|inç)?\s*$/i.test(String(value ?? "")),
    );
    const numericSize = /^\d/.test(size) ? Number(size.replace(",", ".")) : null;
    const sizeIsMeasurement = numericSize !== null && numericMeasurements.some((value) =>
      Math.abs(Number(String(value).replace(/[^\d.,]/g, "").replace(",", ".")) - numericSize) < 0.01,
    );
    return validSize && numericMeasurements.length > 0 && !sizeIsMeasurement;
  });
}

function isAllowedShopUrl(value: string) {
  if (value === "about:blank") return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      allowedShopDomains.some(
        (domain) =>
          url.hostname === domain || url.hostname.endsWith(`.${domain}`),
      )
    );
  } catch (reason) {
    void reason;
    return false;
  }
}

type ScanScreenProps = {
  openProfile(): void;
  openStudio(): void;
};

export function ScanScreen({
  openProfile,
  openStudio,
}: ScanScreenProps) {
  const session = useSession();
  const feedback = useFeedback();
  const { translate } = useI18n();
  const webViewRef = useRef<WebView>(null);
  const captureViewRef = useRef<View>(null);
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanOriginRef = useRef<string | null>(null);
  const activeScanRef = useRef<{ scanId: string; url: string; controller: AbortController } | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [browserUrl, setBrowserUrl] = useState(shops[0]?.url ?? "");
  const [address, setAddress] = useState(browserUrl);
  const [pageLoading, setPageLoading] = useState(false);
  const [scanMode, setScanMode] = useState<"product" | "orders" | null>(
    null,
  );
  const [snapshot, setSnapshot] = useState<ProductSnapshot | null>(null);
  const [recommendation, setRecommendation] =
    useState<Recommendation | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [studioBusy, setStudioBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [scanStage, setScanStage] = useState<ScanStage>("idle");
  const [scanTrace, setScanTrace] = useState<ScanTraceStep[]>([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [outfitPrompt, setOutfitPrompt] = useState("");
  const [outfitBusy, setOutfitBusy] = useState(false);
  const [outfitError, setOutfitError] = useState("");
  const [wardrobeFavoriteBusy, setWardrobeFavoriteBusy] = useState(false);
  const [wardrobeOutfit, setWardrobeOutfit] = useState<WardrobeOutfit | null>(null);

  const createWardrobeOutfit = async () => {
    if (!session.token || !session.account) {
      setOutfitError(translate("Kombin oluşturmak için hesabına giriş yapmalısın."));
      return;
    }
    const prompt = outfitPrompt.trim();
    if (prompt.length < 3) return;
    setOutfitBusy(true);
    setOutfitError("");
    setWardrobeOutfit(null);
    try {
      setWardrobeOutfit(await session.api.createWardrobeOutfit(session.account.userId, session.token, prompt));
      feedback.success();
    } catch (reason) {
      setOutfitError(reason instanceof Error ? reason.message : translate("Kombin oluşturulamadı."));
    } finally {
      setOutfitBusy(false);
    }
  };

  const saveWardrobeFavorite = async () => {
    if (!wardrobeOutfit || !session.token || !session.account) return;
    setWardrobeFavoriteBusy(true);
    setError("");
    try {
      const favorite = await session.api.saveWardrobeFavorite(
        session.account.userId,
        session.token,
        wardrobeOutfit.analysis.headline || "Dolabımdan kombin",
        wardrobeOutfit.analysis,
        wardrobeOutfit.pieces.map((piece) => piece.orderId),
      );
      session.updateFavoriteOutfits([favorite, ...session.favoriteOutfits]);
      feedback.success();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kombin kaydedilemedi.");
    } finally {
      setWardrobeFavoriteBusy(false);
    }
  };

  const canScan = Boolean(session.profile?.age && session.token);
  const currentProductUrl = snapshot?.product.url ?? "";

  const stopScan = () => {
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    scanOriginRef.current = null;
    activeScanRef.current?.controller.abort();
    activeScanRef.current = null;
    setScanMode(null);
    setScanStage("idle");
    setStatus("");
  };

  const closeBrowser = () => {
    stopScan();
    setSnapshot(null);
    setRecommendation(null);
    setNote("");
    setError("");
    setPageLoading(false);
    setBrowserOpen(false);
  };

  const openBrowser = (url = shops[0]?.url ?? "") => {
    if (!canScan) {
      openProfile();
      return;
    }
    setBrowserUrl(url);
    setAddress(url);
    setCanGoBack(false);
    setBrowserOpen(true);
    setError("");
    setStatus("");
    // Render'in ucretsiz servisi uykuya girebilir. Kullanici magazada gezerken
    // API'yi arka planda uyandir; tarama tusu bekleme suresini tasimasin.
    void session.api.health(60_000).catch((reason: unknown) => {
      setScanTrace((steps) => [...steps, {
        stage: "server-agent",
        status: "failed",
        message: reason instanceof Error ? reason.message : "Sunucu ön ısıtması tamamlanamadı",
      }]);
    });
  };

  const goBackInBrowser = () => {
    stopScan();
    setSnapshot(null);
    setRecommendation(null);
    setNote("");
    if (canGoBack) {
      webViewRef.current?.goBack();
    }
  };

  useEffect(() => {
    if (!browserOpen) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        goBackInBrowser();
        return true;
      },
    );
    return () => subscription.remove();
  }, [browserOpen, canGoBack]);

  const navigate = () => {
    Keyboard.dismiss();
    const value = address.trim();
    const normalized = /^https?:\/\//i.test(value)
      ? value
      : `https://${value}`;
    if (!isAllowedShopUrl(normalized)) {
      setError(
        "Mobil beta şu anda yalnızca Pull&Bear, Bershka ve Zara mağazalarını destekliyor.",
      );
      return;
    }
    setError("");
    setBrowserUrl(normalized);
    setAddress(normalized);
  };

  const startScan = (mode: "product" | "orders") => {
    if (!canScan) {
      setBrowserOpen(false);
      openProfile();
      return;
    }
    setError("");
    activeScanRef.current?.controller.abort();
    const scanId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const normalizedUrl = normalizeScanUrl(address);
    activeScanRef.current = { scanId, url: normalizedUrl, controller: new AbortController() };
    setScanStage("webview");
    setScanTrace([{ stage: "webview", status: "started", message: "Mağaza sayfası hazırlanıyor" }]);
    setStatus(
      mode === "product"
        ? "Beden tablosu ve kalıp okunuyor"
        : "Görünür siparişler hazırlanıyor",
    );
    setScanMode(mode);
    scanOriginRef.current = normalizedUrl;
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    scanTimeoutRef.current = setTimeout(() => {
      scanTimeoutRef.current = null;
      setScanMode(null);
      scanOriginRef.current = null;
      activeScanRef.current?.controller.abort();
      activeScanRef.current = null;
      setScanStage("failed");
      setStatus("");
      setError(
        "Tarama zaman aşımına uğradı. Sayfanın yüklenmesi tamamlandıktan sonra yeniden deneyin.",
      );
    }, SCAN_TIMEOUT_MS);
    webViewRef.current?.injectJavaScript(createScanScript(mode));
  };

  const analyzeSnapshot = async (nextSnapshot: ProductSnapshot) => {
    if (!session.token || !session.account) return;
    if (!hasVerifiedSnapshot(nextSnapshot)) {
      throw new Error("Bu ürün için bedenle eşleşen sayısal ürün ölçüleri doğrulanamadı. Yanlış beden önermek yerine sonuç üretilmedi.");
    }
    const scanId = activeScanRef.current?.scanId;
    setSnapshot(nextSnapshot);
    setRecommendation(null);
    setScanStage("recommending");
    setStatus("Ölçüler ve dolabın karşılaştırılıyor");
    const result = await session.api.analyzeProduct(
      session.account.userId,
      session.token,
      nextSnapshot,
    );
    if (scanId && activeScanRef.current?.scanId !== scanId) return;
    setRecommendation(result);
    setScanStage("completed");
    setScanTrace((steps) => [...steps, { stage: "recommendation", status: "success", message: "Ölçüler profil ile karşılaştırıldı" }]);
    setStatus("");
    feedback.success();
  };

  const importOrderSnapshot = async (
    orderSnapshot: Extract<
      ScannerMessage,
      { type: "fitmemory-orders" }
    >["snapshot"],
  ) => {
    if (!session.token || !session.account) return;
    setStatus("Siparişler araştırılıyor ve dolabına ekleniyor");
    let base64 = "";
    try {
      base64 = await captureRef(captureViewRef, {
        format: "jpg",
        quality: 0.58,
        result: "base64",
      });
    } finally {
      webViewRef.current?.injectJavaScript(
        "window.__fitmemoryRestoreRedactions?.();true;",
      );
    }
    const result = await session.api.importOrders(
      session.account.userId,
      session.token,
      orderSnapshot,
      `data:image/jpeg;base64,${base64}`,
    );
    session.updateOrders(result.orders);
    feedback.success();
    setStatus(
      `${result.importedCount} yeni parça eklendi, ${result.updatedCount} parça güncellendi.`,
    );
    setTimeout(() => setStatus(""), 5000);
  };

  const analyzeVisualFallback = async (
    fallback: Extract<ScannerMessage, { type: "fitmemory-product-fallback" }>["snapshot"],
  ) => {
    if (!session.token || !session.account) return;
    const active = activeScanRef.current;
      if (!active || !isCurrentScanResponse(active, active.scanId, fallback.product.url)) return;
    const localChart = visibleTextChart(fallback.pageText);
    const localSnapshot: ProductSnapshot | null = localChart ? {
      product: fallback.product,
      sizeChart: localChart,
      capturedAt: new Date().toISOString(),
    } : null;
    if (localSnapshot && hasVerifiedSnapshot(localSnapshot)) {
      setStatus("Ekrandaki ölçüler okundu, dolabınla karşılaştırılıyor");
      await analyzeSnapshot(localSnapshot);
      return;
    }
    setScanTrace((steps) => [...steps, { stage: "webview", status: "failed", message: "Beden tablosu görünür DOM'da doğrulanamadı" }]);
    if (/^https:\/\/(?:[^/]+\.)?(?:pullandbear|zara)\.com(?:\/|$)/i.test(fallback.product.url)) {
      try {
        setScanStage("warming-api");
        setStatus("Sunucu hazırlanıyor");
        await session.api.health(60_000);
        if (activeScanRef.current?.scanId !== active.scanId) return;
        setScanStage("server-agent");
        setStatus("Ürün bilgileri ve beden paneli okunuyor");
        setScanTrace((steps) => [...steps, { stage: "server-agent", status: "started", message: "Marka adaptörü ürün ve beden panelini okuyor" }]);
        const agent = await session.api.extractProductWithAgent(
          session.token!,
          fallback.product.url,
          active!.scanId,
          active!.controller.signal,
        );
        if (!isCurrentScanResponse(activeScanRef.current, active.scanId, fallback.product.url, agent.requestId)) return;
        const agentSnapshot = agentResultToSnapshot(agent, fallback.product);
        if (agentSnapshot) {
          setScanTrace((steps) => [...steps, ...(agent.trace?.steps ?? []), {
            stage: "server-agent",
            status: "success",
            message: `${agentSnapshot.sizeChart.rows.length} geçerli beden ölçü satırı bulundu`,
          }]);
          await analyzeSnapshot(agentSnapshot);
          return;
        }
        setScanTrace((steps) => [...steps, ...(agent.trace?.steps ?? []), {
          stage: "server-agent",
          status: "failed",
          message: "Sunucu ajanı doğrulanmış ölçü tablosu döndürmedi",
          details: agent.notes,
        }]);
      } catch (reason) {
        if (active.controller.signal.aborted) return;
        setScanTrace((steps) => [...steps, {
          stage: "server-agent",
          status: "failed",
          message: reason instanceof Error ? reason.message : "Sunucu ajanı başarısız",
        }]);
      }
    }
    if (activeScanRef.current?.scanId !== active.scanId) return;
    setScanStage("vision");

    // Marka akisi tabloyu uygulamanin kendi WebView'i icinde acti. Once tam bu
    // ekrani oku; Render'daki basliksiz tarayicilar Inditex tarafindan zaman
    // zaman Access Denied ile engellendigi icin sunucu ajani son yedektir.
    setStatus("Görsel ölçü okuyucu açık tabloyu doğruluyor");
    let visualFailure: unknown = null;
    try {
      const base64 = await captureRef(captureViewRef, {
        format: "jpg",
        quality: 0.82,
        result: "base64",
      });
      const extracted = await session.api.extractProductMeasurements(
        session.account.userId,
        session.token,
        fallback.product,
        fallback.pageText,
        `data:image/jpeg;base64,${base64}`,
      );
      if (hasVerifiedSnapshot(extracted)) {
        await analyzeSnapshot(extracted);
        return;
      }
      visualFailure = new Error(
        "Açık ölçü tablosunda bedenle eşleşen sayısal ürün ölçüleri doğrulanamadı.",
      );
    } catch (reason) {
      visualFailure = reason;
    }

    if (visualFailure instanceof Error) throw visualFailure;
    throw new Error(
      "Bu ürün için bedenle eşleşen sayısal ürün ölçüleri doğrulanamadı. Yanlış beden önermek yerine sonuç üretilmedi.",
    );
  };

  const handleMessage = async (event: WebViewMessageEvent) => {
    let message: ScannerMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as ScannerMessage;
    } catch (reason) {
      setScanMode(null);
      setScanTrace((steps) => [...steps, {
        stage: "webview",
        status: "failed",
        message: reason instanceof Error ? reason.message : "Tarama yanıtı ayrıştırılamadı",
      }]);
      setError("Sayfa tarama sonucunu okunamayan biçimde döndürdü.");
      return;
    }
    if (message.type === "fitmemory-progress") {
      setStatus(message.message);
      return;
    }
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    if (message.type === "fitmemory-error") {
      setScanMode(null);
      activeScanRef.current?.controller.abort();
      activeScanRef.current = null;
      setScanStage("failed");
      setStatus("");
      setError(message.message);
      return;
    }
    try {
      if (message.type === "fitmemory-product") {
        if (hasVerifiedSnapshot(message.snapshot)) {
          await analyzeSnapshot(message.snapshot);
        } else {
          await analyzeVisualFallback({
            fallback: true,
            reason: "WebView ölçü tablosu doğrulanamadı",
            pageText: message.snapshot.sizeChart.rawText,
            product: message.snapshot.product,
          });
        }
      } else if (message.type === "fitmemory-product-fallback") {
        await analyzeVisualFallback(message.snapshot);
      } else {
        await importOrderSnapshot(message.snapshot);
      }
    } catch (reason) {
      setScanStage("failed");
      setError(
        reason instanceof Error ? reason.message : "Tarama tamamlanamadı.",
      );
      setStatus("");
    } finally {
      setScanMode(null);
      scanOriginRef.current = null;
      activeScanRef.current = null;
    }
  };

  useEffect(() => () => {
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    activeScanRef.current?.controller.abort();
  }, []);

  const reconsider = async () => {
    if (
      !snapshot ||
      !session.token ||
      !session.account ||
      note.trim().length < 3
    ) {
      setError("Yeniden değerlendirme için kısa bir detay yaz.");
      return;
    }
    setScanMode("product");
    setStatus("Notunla birlikte yeniden düşünüyor");
    setError("");
    try {
      const result = await session.api.analyzeProduct(
        session.account.userId,
        session.token,
        snapshot,
        note.trim(),
        true,
      );
      setRecommendation(result);
      setNote("");
      setStatus("");
      feedback.success();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Öneri yeniden değerlendirilemedi.",
      );
    } finally {
      setScanMode(null);
    }
  };

  const saveToStudio = async () => {
    if (!snapshot || !session.token || !session.account) return;
    setStudioBusy(true);
    setError("");
    try {
      await session.api.saveStyleBoardItem(
        session.account.userId,
        session.token,
        snapshot,
        recommendation,
      );
      await session.refresh();
      setSnapshot(null);
      setRecommendation(null);
      setNote("");
      setStatus("");
      feedback.success();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Parça stüdyoya eklenemedi.",
      );
    } finally {
      setStudioBusy(false);
    }
  };

  const saveProduct = async () => {
    if (!snapshot || !session.token || !session.account) return;
    setSaveBusy(true);
    setError("");
    try {
      await session.api.saveStyleBoardItem(
        session.account.userId,
        session.token,
        snapshot,
        recommendation,
        "saved",
      );
      await session.refresh();
      feedback.success();
      setSnapshot(null);
      setRecommendation(null);
      setNote("");
      setStatus("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ürün kaydedilemedi.");
    } finally {
      setSaveBusy(false);
    }
  };

  const alreadyInStudio = useMemo(
    () =>
      Boolean(currentProductUrl) &&
      session.styleBoard.some(
        (item) => item.productUrl === currentProductUrl && item.isInStudio,
      ),
    [currentProductUrl, session.styleBoard],
  );
  const alreadySaved = useMemo(
    () => Boolean(currentProductUrl) && session.styleBoard.some(
      (item) => item.productUrl === currentProductUrl && item.isSaved,
    ),
    [currentProductUrl, session.styleBoard],
  );

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <SectionTitle
          eyebrow="Mağazalar"
          title="Bedenini bul."
        />
        <View style={styles.shopGrid}>
          {shops.map((shop) => (
            <Pressable
              accessibilityLabel={`${shop.name} mağazasını aç`}
              key={shop.name}
              onPress={() => openBrowser(shop.url)}
              style={({ pressed }) => [
                styles.shop,
                pressed && styles.pressed,
              ]}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[
                  styles.shopLogo,
                  shop.name === "Zara" && styles.shopLogoZara,
                  shop.name === "Pull&Bear" && styles.shopLogoPullBear,
                ]}
              >
                {shop.logo}
              </Text>
            </Pressable>
          ))}
        </View>
        <Card style={styles.outfitMaker}>
          <Text style={styles.outfitMakerEyebrow}>AI KOMBİN ASİSTANI</Text>
          <Text style={styles.outfitMakerTitle}>Bugün nasıl görünmek istiyorsun?</Text>
          <TextInput
            maxLength={500}
            multiline
            onChangeText={(value) => {
              setOutfitPrompt(value);
              if (outfitError) setOutfitError("");
            }}
            placeholder={translate("Örn. Akşam yemeği için sade, rahat ve yaşımı yansıtan bir kombin.")}
            placeholderTextColor="#918E85"
            style={styles.outfitPrompt}
            value={outfitPrompt}
          />
          <Button busy={outfitBusy} disabled={outfitPrompt.trim().length < 3} label="Dolabımla kombin oluştur" onPress={() => void createWardrobeOutfit()} small tone="blue" />
          {outfitError ? (
            <ErrorNotice message={outfitError} onDismiss={() => setOutfitError("")} />
          ) : null}
          {wardrobeOutfit ? (
            <View style={styles.outfitResult}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {wardrobeOutfit.pieces.map((piece) => piece.imageUrl ? (
                  <Image key={piece.orderId} source={{ uri: piece.imageUrl }} style={styles.outfitImage} />
                ) : (
                  <View key={piece.orderId} style={styles.outfitFallback}><Text style={styles.resultImageFallbackText}>FM</Text></View>
                ))}
              </ScrollView>
              <Text style={styles.outfitHeadline}>{wardrobeOutfit.analysis.headline}</Text>
              <Text style={styles.outfitExplanation}>{wardrobeOutfit.analysis.explanation}</Text>
              {wardrobeOutfit.analysis.notes.slice(0, 3).map((item) => <Text key={item} style={styles.outfitNote}>• {item}</Text>)}
              <Button
                busy={wardrobeFavoriteBusy}
                label="Kombini kaydet"
                onPress={() => void saveWardrobeFavorite()}
                small
              />
            </View>
          ) : null}
        </Card>
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={closeBrowser}
        visible={browserOpen}
      >
        <View style={styles.browser}>
          <View style={styles.browserTop}>
            <Pressable
              accessibilityLabel="Tarayıcıyı kapat"
              onPress={closeBrowser}
              style={styles.roundAction}
            >
              <Text style={styles.roundActionText}>×</Text>
            </Pressable>
            <View style={styles.addressWrap}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onChangeText={setAddress}
                onSubmitEditing={navigate}
                returnKeyType="go"
                selectTextOnFocus
                style={styles.address}
                value={address}
              />
            </View>
            <Pressable
              accessibilityLabel="Sayfaya git"
              onPress={navigate}
              style={styles.go}
            >
              <Text style={styles.goText}>Git</Text>
            </Pressable>
          </View>

          <View
            collapsable={false}
            ref={captureViewRef}
            style={styles.webViewWrap}
          >
            <WebView
              allowsBackForwardNavigationGestures
              javaScriptEnabled
              onShouldStartLoadWithRequest={(request) => {
                if (request.isTopFrame === false) return true;
                const allowed = isAllowedShopUrl(request.url);
                if (!allowed) {
                  if (/^https?:/i.test(request.url)) {
                    setError(
                      "Bu bağlantı desteklenen mağazaların dışına çıkıyor ve güvenlik için açılmadı.",
                    );
                  }
                }
                return allowed;
              }}
              originWhitelist={["https://*"]}
              onLoadEnd={() => setPageLoading(false)}
              onLoadStart={(event) => {
                setPageLoading(true);
                const nextUrl = event.nativeEvent.url;
                setAddress(nextUrl);
                if (snapshot?.product.url !== nextUrl) {
                  setSnapshot(null);
                  setRecommendation(null);
                  setNote("");
                }
              }}
              onMessage={(event) => void handleMessage(event)}
              onNavigationStateChange={(state) => {
                const nextUrl = normalizeScanUrl(state.url);
                if (scanOriginRef.current && nextUrl !== scanOriginRef.current) {
                  stopScan();
                  setSnapshot(null);
                  setRecommendation(null);
                  setNote("");
                }
                setAddress(state.url);
                setCanGoBack(state.canGoBack);
              }}
              pullToRefreshEnabled
              ref={webViewRef}
              setSupportMultipleWindows={false}
              sharedCookiesEnabled
              source={{ uri: browserUrl }}
              startInLoadingState
              thirdPartyCookiesEnabled
            />
            {pageLoading && (
              <View pointerEvents="none" style={styles.pageLoader}>
                <ActivityIndicator color={colors.blue} />
              </View>
            )}
          </View>

          {error ? (
            <View style={styles.browserError}>
              <ErrorNotice message={error} onDismiss={() => setError("")} />
            </View>
          ) : null}

          {recommendation && snapshot ? (
            <View style={styles.result}>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={styles.resultProduct}>
                  {snapshot.product.imageUrl ? (
                    <Image
                      source={{ uri: snapshot.product.imageUrl }}
                      style={styles.resultImage}
                    />
                  ) : (
                    <View style={styles.resultImageFallback}>
                      <Text style={styles.resultImageFallbackText}>FM</Text>
                    </View>
                  )}
                  <View style={styles.resultProductCopy}>
                    <Text style={styles.resultBrand}>
                      {snapshot.product.brand}
                    </Text>
                    <Text numberOfLines={2} style={styles.resultName}>
                      {snapshot.product.name}
                    </Text>
                    {snapshot.product.fitLabel ? (
                      <Text style={styles.fitChip}>
                        {snapshot.product.fitLabel}
                      </Text>
                    ) : null}
                    {snapshot.product.materialSummary ? (
                      <Text numberOfLines={1} style={styles.fitChip}>
                        ◇ {snapshot.product.materialSummary}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.sizeBox}>
                    <Text style={styles.sizeBoxLabel}>BEDEN</Text>
                    <Text style={styles.sizeBoxValue}>
                      {recommendation.recommendedSize}
                    </Text>
                  </View>
                </View>
                <Text style={styles.verdict}>{recommendation.verdict}</Text>
                <Text style={styles.explanation}>
                  {recommendation.explanation}
                </Text>
                <View style={styles.confidenceRow}>
                  <Text style={styles.confidenceLabel}>KANIT GÜVENİ</Text>
                  <Text style={styles.confidenceValue}>
                    %{recommendation.confidence}
                  </Text>
                </View>
                <View style={styles.progress}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${Math.min(
                          95,
                          Math.max(10, recommendation.confidence),
                        )}%`,
                      },
                    ]}
                  />
                </View>
                <TextInput
                  maxLength={500}
                  multiline
                  onChangeText={setNote}
                  placeholder={translate("AI'ın yeniden tartmasını istediğin detay…")}
                  placeholderTextColor="#918E85"
                  style={styles.note}
                  value={note}
                />
                <View style={styles.resultActions}>
                  <Button
                    disabled={note.trim().length < 3}
                    label="Yeniden düşün"
                    onPress={() => void reconsider()}
                    small
                    tone="light"
                  />
                  <Button
                    busy={studioBusy}
                    label={alreadyInStudio ? "Stüdyoda" : "Kombin için ayır"}
                    onPress={() =>
                      alreadyInStudio ? openStudio() : void saveToStudio()
                    }
                    small
                    tone="blue"
                  />
                </View>
                <Button
                  busy={saveBusy}
                  disabled={alreadySaved}
                  label={alreadySaved ? "Kaydedildi" : "Ürünü kaydet"}
                  onPress={() => void saveProduct()}
                  small
                  tone="light"
                />
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.browserBottom}>
            <Pressable
              disabled={!canGoBack}
              onPress={goBackInBrowser}
              style={styles.browserTool}
            >
              <Text style={styles.browserToolText}>‹</Text>
              <Text style={styles.browserToolLabel}>Geri</Text>
            </Pressable>
            <Pressable
              disabled={Boolean(scanMode)}
              onPress={() => startScan("product")}
              style={[
                styles.scanPrimary,
                scanMode && styles.scanDisabled,
              ]}
            >
              {scanMode === "product" ? (
                <ActivityIndicator color={colors.card} size="small" />
              ) : (
                <Text style={styles.scanSpark}>✦</Text>
              )}
              <Text style={styles.scanPrimaryText}>Ürünü tara</Text>
            </Pressable>
            <Pressable
              disabled={Boolean(scanMode)}
              onPress={() => startScan("orders")}
              style={[styles.browserTool, styles.orderScanTool]}
            >
              {scanMode === "orders" ? (
                <ActivityIndicator color={colors.ink} size="small" />
              ) : (
                <View style={styles.orderScanIcon}>
                  <View style={[styles.scanCorner, styles.scanCornerTopLeft]} />
                  <View style={[styles.scanCorner, styles.scanCornerTopRight]} />
                  <View style={[styles.scanCorner, styles.scanCornerBottomLeft]} />
                  <View style={[styles.scanCorner, styles.scanCornerBottomRight]} />
                  <View style={styles.scanCenterDot} />
                </View>
              )}
              <Text style={styles.browserToolLabel}>Siparişi tara</Text>
            </Pressable>
          </View>
          {scanMode || status ? (
            <View style={styles.scanStatus}>
              {scanMode ? (
                <ActivityIndicator color={colors.blue} size="small" />
              ) : null}
              <Text style={styles.scanStatusText}>{status}</Text>
            </View>
          ) : null}
          {scanTrace.length ? (
            <View style={styles.diagnostics}>
              <Pressable onPress={() => setShowDiagnostics((value) => !value)}>
                <Text style={styles.diagnosticsTitle}>Tarama tanısı · {scanStage}</Text>
              </Pressable>
              {showDiagnostics ? scanTrace.slice(-8).map((step, index) => (
                <Text key={`${step.stage}-${index}`} style={styles.diagnosticsLine}>
                  [{step.stage}] {step.status}: {step.message}
                </Text>
              )) : null}
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  diagnostics: {
    backgroundColor: "#F4F2ED",
    borderTopColor: "#D8D4CC",
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  diagnosticsTitle: { color: colors.ink, fontSize: 11, fontWeight: "800" },
  diagnosticsLine: { color: "#5E5A52", fontSize: 10, lineHeight: 15, marginTop: 3 },
  content: {
    gap: 18,
    paddingBottom: 110,
    paddingHorizontal: 20,
    paddingTop: 26,
  },
  heroCard: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
    gap: 14,
    padding: 22,
  },
  heroEyebrow: {
    color: "#AFC1FF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  heroTitle: {
    color: colors.card,
    fontSize: 25,
    fontWeight: "900",
    letterSpacing: -1,
    lineHeight: 29,
  },
  heroCopy: {
    color: "#C8C7C2",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 2,
  },
  quickTitle: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.7,
    marginTop: 4,
  },
  shopGrid: {
    flexDirection: "row",
    gap: 9,
  },
  shop: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 78,
    paddingHorizontal: 8,
  },
  pressed: {
    opacity: 0.68,
  },
  shopLogo: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: -0.6,
    textAlign: "center",
  },
  shopLogoPullBear: {
    fontSize: 12,
    letterSpacing: -0.9,
  },
  shopLogoZara: {
    fontFamily: Platform.OS === "ios" ? "Times New Roman" : "serif",
    fontSize: 21,
    fontWeight: "600",
    letterSpacing: -1.8,
  },
  outfitMaker: {
    gap: 11,
    padding: 17,
  },
  outfitMakerEyebrow: {
    color: colors.blue,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  outfitMakerTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900",
  },
  outfitPrompt: {
    backgroundColor: "#F2F0EA",
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 12,
    minHeight: 76,
    padding: 12,
    textAlignVertical: "top",
  },
  outfitResult: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: 8,
    paddingTop: 12,
  },
  outfitImage: {
    backgroundColor: "#ECEAE4",
    borderRadius: 10,
    height: 132,
    marginRight: 8,
    resizeMode: "cover",
    width: 96,
  },
  outfitFallback: {
    alignItems: "center",
    backgroundColor: "#ECEAE4",
    borderRadius: 10,
    height: 132,
    justifyContent: "center",
    marginRight: 8,
    width: 96,
  },
  outfitHeadline: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  outfitExplanation: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  outfitNote: {
    color: colors.ink,
    fontSize: 11,
    lineHeight: 17,
  },
  memoryCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
  },
  memoryCount: {
    color: colors.blue,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -1.5,
  },
  memoryLabel: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  memoryDivider: {
    backgroundColor: colors.line,
    height: 48,
    width: 1,
  },
  memoryCopy: {
    color: colors.muted,
    flex: 1,
    fontSize: 11.5,
    lineHeight: 18,
  },
  browser: {
    backgroundColor: colors.paper,
    flex: 1,
    paddingTop:
      Platform.OS === "ios" ? 52 : (NativeStatusBar.currentHeight ?? 24) + 4,
  },
  browserTop: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  roundAction: {
    alignItems: "center",
    backgroundColor: "#ECEAE4",
    borderRadius: 20,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  roundActionText: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "300",
    lineHeight: 26,
  },
  addressWrap: {
    backgroundColor: "#EFEEE9",
    borderRadius: 10,
    flex: 1,
  },
  address: {
    color: colors.ink,
    fontSize: 12,
    height: 40,
    paddingHorizontal: 12,
  },
  go: {
    alignItems: "center",
    height: 38,
    justifyContent: "center",
    width: 36,
  },
  goText: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: "800",
  },
  webViewWrap: {
    flex: 1,
  },
  pageLoader: {
    alignItems: "center",
    backgroundColor: "#FFFFFFD9",
    height: 44,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  browserError: {
    left: 12,
    position: "absolute",
    right: 12,
    top: Platform.OS === "ios" ? 110 : 86,
    zIndex: 20,
  },
  browserBottom: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 9,
    paddingBottom: Platform.OS === "ios" ? 8 : 8,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  browserTool: {
    alignItems: "center",
    gap: 1,
    justifyContent: "center",
    minHeight: 48,
    width: 54,
  },
  orderScanTool: {
    width: 82,
  },
  orderScanIcon: {
    height: 20,
    position: "relative",
    width: 20,
  },
  scanCorner: {
    borderColor: colors.ink,
    height: 7,
    position: "absolute",
    width: 7,
  },
  scanCornerTopLeft: {
    borderLeftWidth: 1.5,
    borderTopWidth: 1.5,
    left: 1,
    top: 1,
  },
  scanCornerTopRight: {
    borderRightWidth: 1.5,
    borderTopWidth: 1.5,
    right: 1,
    top: 1,
  },
  scanCornerBottomLeft: {
    borderBottomWidth: 1.5,
    borderLeftWidth: 1.5,
    bottom: 1,
    left: 1,
  },
  scanCornerBottomRight: {
    borderBottomWidth: 1.5,
    borderRightWidth: 1.5,
    bottom: 1,
    right: 1,
  },
  scanCenterDot: {
    backgroundColor: colors.blue,
    borderRadius: 2,
    height: 4,
    left: 8,
    position: "absolute",
    top: 8,
    width: 4,
  },
  browserToolText: {
    color: colors.ink,
    fontSize: 21,
    fontWeight: "500",
  },
  browserToolLabel: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  scanPrimary: {
    alignItems: "center",
    backgroundColor: colors.blue,
    borderRadius: 12,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 52,
  },
  scanDisabled: {
    opacity: 0.58,
  },
  scanSpark: {
    color: colors.card,
    fontSize: 15,
  },
  scanPrimaryText: {
    color: colors.card,
    fontSize: 13,
    fontWeight: "900",
  },
  scanStatus: {
    alignItems: "center",
    backgroundColor: colors.blueSoft,
    borderTopColor: "#C8D5FF",
    borderTopWidth: 1,
    bottom: Platform.OS === "ios" ? 70 : 66,
    flexDirection: "row",
    gap: 9,
    left: 0,
    paddingHorizontal: 15,
    paddingVertical: 10,
    position: "absolute",
    right: 0,
  },
  scanStatusText: {
    color: "#173A9D",
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  result: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 18,
    bottom: Platform.OS === "ios" ? 76 : 72,
    left: 12,
    maxHeight: "60%",
    padding: 17,
    position: "absolute",
    right: 12,
    ...shadow,
  },
  resultProduct: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  resultImage: {
    backgroundColor: "#EFEDE7",
    borderRadius: 9,
    height: 74,
    resizeMode: "cover",
    width: 58,
  },
  resultImageFallback: {
    alignItems: "center",
    backgroundColor: "#EEECE6",
    borderRadius: 9,
    height: 74,
    justifyContent: "center",
    width: 58,
  },
  resultImageFallbackText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  resultProductCopy: {
    flex: 1,
  },
  resultBrand: {
    color: colors.blue,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  resultName: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 4,
  },
  fitChip: {
    alignSelf: "flex-start",
    backgroundColor: colors.blueSoft,
    borderRadius: 20,
    color: colors.blue,
    fontSize: 9,
    fontWeight: "700",
    marginTop: 6,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sizeBox: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 64,
    minWidth: 62,
    paddingHorizontal: 8,
  },
  sizeBoxLabel: {
    color: "#A9A8A3",
    fontSize: 7,
    fontWeight: "800",
    letterSpacing: 1,
  },
  sizeBoxValue: {
    color: colors.card,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -1,
    marginTop: 1,
  },
  verdict: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 21,
    marginTop: 16,
  },
  explanation: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 7,
  },
  confidenceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 15,
  },
  confidenceLabel: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  confidenceValue: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: "800",
  },
  progress: {
    backgroundColor: "#DEDCD5",
    borderRadius: 3,
    height: 5,
    marginTop: 6,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: colors.blue,
    borderRadius: 3,
    height: 5,
  },
  note: {
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 15,
    minHeight: 62,
    padding: 11,
    textAlignVertical: "top",
  },
  resultActions: {
    flexDirection: "row",
    gap: 9,
    marginBottom: 12,
    marginTop: 10,
  },
});
