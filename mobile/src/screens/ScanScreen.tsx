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
import { createScannerInstallScript, createScanScript } from "../injectedScanner";
import { hasVerifiedNumericChart } from "../scanValidation";
import { recommendFromSnapshot } from "../localRecommend";
import { isCurrentScanResponse, isSameShopPage, normalizeScanUrl, SCAN_TIMEOUT_MS } from "../scanLifecycle";
import {
  chartFromRecognizedText,
  collectNativeScanEvidence,
  nativeSizeOptions,
  selectNativeSize,
  snapshotWithChart,
} from "../nativeScanner";
import { useSession } from "../session";
import { colors, shadow } from "../theme";
import { useFeedback } from "../feedback";
import { Text, useI18n } from "../i18n";
import type {
  ProductSnapshot,
  OrderSnapshot,
  Recommendation,
  ScannerMessage,
  WardrobeOutfit,
  ScanStage,
  ScanTraceStep,
} from "../types";

const shops = [
  { name: "Pull&Bear", logo: "PULL&BEAR", url: "https://www.pullandbear.com/tr/" },
  { name: "Bershka", logo: "BERSHKA", url: "https://www.bershka.com/tr/" },
  { name: "Zara", logo: "ZARA", url: "https://www.zara.com/tr/" },
];

const iosSafariUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

const allowedShopDomains = [
  "pullandbear.com",
  "bershka.com",
  "zara.com",
  "inditex.com",
];

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
  const aiReviewRef = useRef<{ id: string; controller: AbortController } | null>(null);
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
  const [outfitPrompt, setOutfitPrompt] = useState("");
  const [outfitBusy, setOutfitBusy] = useState(false);
  const [wardrobeFavoriteBusy, setWardrobeFavoriteBusy] = useState(false);
  const [wardrobeOutfit, setWardrobeOutfit] = useState<WardrobeOutfit | null>(null);
  const [pendingOrders, setPendingOrders] = useState<OrderSnapshot | null>(null);
  const [orderImportBusy, setOrderImportBusy] = useState(false);
  const [aiReviewing, setAiReviewing] = useState(false);

  const createWardrobeOutfit = async () => {
    if (!session.token || !session.account || outfitPrompt.trim().length < 3) return;
    setOutfitBusy(true);
    setError("");
    try {
      setWardrobeOutfit(await session.api.createWardrobeOutfit(session.account.userId, session.token, outfitPrompt.trim()));
      feedback.success();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kombin oluşturulamadı.");
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

  const abortAiReview = () => {
    aiReviewRef.current?.controller.abort();
    aiReviewRef.current = null;
    setAiReviewing(false);
  };

  const stopScan = () => {
    activeScanRef.current?.controller.abort();
    activeScanRef.current = null;
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    scanOriginRef.current = null;
    abortAiReview();
    setScanMode(null);
    setStatus("");
    setScanStage("idle");
  };

  const closeBrowser = () => {
    stopScan();
    setPendingOrders(null);
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
    abortAiReview();
    activeScanRef.current?.controller.abort();
    const scanId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeScanRef.current = {
      scanId,
      url: normalizeScanUrl(address),
      controller: new AbortController(),
    };
    setScanStage("webview");
    setScanTrace([{ stage: "webview", status: "started", message: "Mağaza sayfası hazırlanıyor" }]);
    setStatus(
      mode === "product"
        ? "Açık ölçü tablosu okunuyor"
        : "Görünür siparişler hazırlanıyor",
    );
    setScanMode(mode);
    scanOriginRef.current = normalizeScanUrl(address);
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
    webViewRef.current?.injectJavaScript(createScanScript(mode, mode === "product"));
  };

  const analyzeSnapshot = async (nextSnapshot: ProductSnapshot) => {
    if (!session.token || !session.account) return;
    if (!hasVerifiedNumericChart(nextSnapshot)) {
      throw new Error("Bu ürün için bedenle eşleşen sayısal ürün ölçüleri doğrulanamadı. Yanlış beden önermek yerine sonuç üretilmedi.");
    }
    if (!session.profile) {
      throw new Error("Beden önerisi için önce profilini kaydet.");
    }
    abortAiReview();
    const reviewId = `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    aiReviewRef.current = { id: reviewId, controller };
    const userId = session.account.userId;
    const token = session.token;
    setSnapshot(nextSnapshot);
    setScanMode(null);
    const local = recommendFromSnapshot(
      session.profile,
      session.orders,
      nextSnapshot,
    );
    setRecommendation(local);
    setScanStage("completed");
    setAiReviewing(true);
    setStatus("AI kalıp, dikiş ve etiketleri denetliyor");
    feedback.success();

    void (async () => {
      try {
        try {
          await session.syncPendingProfile();
        } catch {
          // Profil henüz sunucuda değilse analiz 404 verebilir; yerel taslak durur.
        }
        if (aiReviewRef.current?.id !== reviewId) return;
        const result = await session.api.analyzeProduct(
          userId,
          token,
          nextSnapshot,
          "",
          false,
          controller.signal,
        );
        if (aiReviewRef.current?.id !== reviewId) return;
        setRecommendation(result);
        setAiReviewing(false);
        setStatus("AI denetimi tamamlandı");
        feedback.success();
        setTimeout(() => {
          if (aiReviewRef.current?.id === reviewId) {
            setStatus("");
            aiReviewRef.current = null;
          }
        }, 2200);
      } catch {
        if (aiReviewRef.current?.id !== reviewId || controller.signal.aborted) {
          return;
        }
        setAiReviewing(false);
        setRecommendation((current) =>
          current
            ? {
                ...current,
                fitNotes: [
                  "AI kalıp denetimine ulaşılamadı; gösterilen beden yerel ölçü taslağıdır.",
                  ...current.fitNotes,
                ].slice(0, 6),
              }
            : current,
        );
        setStatus("AI'ya ulaşılamadı; yerel taslak korundu");
        setTimeout(() => {
          if (aiReviewRef.current?.id === reviewId) {
            setStatus("");
            aiReviewRef.current = null;
          }
        }, 4000);
      }
    })();
  };

  const importOrderSnapshot = async (
    orderSnapshot: Extract<
      ScannerMessage,
      { type: "fitmemory-orders" }
    >["snapshot"],
  ) => {
    if (!session.token || !session.account) return;
    setOrderImportBusy(true);
    setStatus("Onayladığın siparişler arşive ekleniyor");
    try {
      const result = await session.api.importOrders(session.account.userId, session.token, orderSnapshot, "");
      session.updateOrders(result.orders);
      feedback.success();
      setStatus(`${result.importedCount} yeni parça eklendi, ${result.updatedCount} parça güncellendi.`);
      setTimeout(() => setStatus(""), 5000);
      setPendingOrders(null);
    } finally {
      setOrderImportBusy(false);
    }
  };

  const updatePendingOrder = (clientKey: string, field: "productName" | "purchasedSize", value: string) => {
    setPendingOrders((current) => current ? {
      ...current,
      orderCards: current.orderCards.map((card) => card.clientKey === clientKey ? { ...card, [field]: value } : card),
    } : current);
  };

  const removePendingOrder = (clientKey: string) => {
    setPendingOrders((current) => current ? {
      ...current,
      orderCards: current.orderCards.filter((card) => card.clientKey !== clientKey),
    } : current);
  };

  const analyzeVisualFallback = async (
    fallback: Extract<ScannerMessage, { type: "fitmemory-product-fallback" }>["snapshot"],
  ) => {
    if (!session.token || !session.account) return;
      const active = activeScanRef.current;
      if (!active || !isCurrentScanResponse(active, active.scanId, fallback.product.url)) return;
    setScanTrace((steps) => [...steps, {
      stage: "webview",
      status: "failed",
      message: "Açık ölçü tablosu görünür DOM'da doğrulanamadı; ekran okuyucuya geçiliyor",
    }]);
    if (activeScanRef.current?.scanId !== active.scanId) return;
    setScanStage("native-ocr");
    setStatus("Görsel ölçü okuyucu tabloyu doğruluyor");
    const options = await nativeSizeOptions();
    const nativeRows: ProductSnapshot["sizeChart"]["rows"] = [];
    let nativeHeaders: string[] = [];
    for (const option of options.slice(0, 10)) {
      if (!(await selectNativeSize(option))) continue;
      await new Promise((resolve) => setTimeout(resolve, 320));
      const optionBase64 = await captureRef(captureViewRef, {
        format: "jpg",
        quality: 0.74,
        result: "base64",
      });
      const optionEvidence = await collectNativeScanEvidence(`data:image/jpeg;base64,${optionBase64}`);
      const optionChart = chartFromRecognizedText(
        optionEvidence.ocrText,
        `[selected] ${option}\n${optionEvidence.accessibilityText}\n${fallback.pageText}`,
        optionEvidence.ocrLines,
      );
      const row = optionChart?.rows[0];
      if (!row) continue;
      if (!nativeHeaders.length) nativeHeaders = optionChart.headers;
      const values = new Map(optionChart.headers.map((header, index) => [header, row.cells[index] ?? ""]));
      nativeRows.push({ cells: nativeHeaders.map((header) => values.get(header) ?? "") });
    }
    if (nativeRows.length) {
      await analyzeSnapshot(snapshotWithChart(fallback.product, {
        found: true,
        title: "Cihazda okunan ürün ölçüleri",
        unit: "Centimeters",
        headers: nativeHeaders,
        rows: nativeRows,
        rawText: nativeRows.map((row) => row.cells.join(" | ")).join("\n"),
      }));
      return;
    }

    const base64 = await captureRef(captureViewRef, {
      format: "jpg",
      quality: 0.72,
      result: "base64",
    });
    const imageDataUrl = `data:image/jpeg;base64,${base64}`;
    const nativeEvidence = await collectNativeScanEvidence(imageDataUrl);
    const localChart = chartFromRecognizedText(
      nativeEvidence.ocrText,
      `${nativeEvidence.accessibilityText}\n${fallback.pageText}`,
      nativeEvidence.ocrLines,
    );
    if (localChart) {
      setStatus("Ölçüler cihazda okundu, dolabınla karşılaştırılıyor");
      await analyzeSnapshot(snapshotWithChart(fallback.product, localChart));
      return;
    }
    setScanStage("vision");
    setStatus("Cihaz kanıtı yetmedi, Vision AI tabloyu doğruluyor");
    const extracted = await session.api.extractProductMeasurements(
      session.account.userId,
      session.token,
      fallback.product,
      fallback.pageText,
      imageDataUrl,
      nativeEvidence.accessibilityText,
      nativeEvidence.ocrText,
    );
    if (!hasVerifiedNumericChart(extracted)) {
      setScanStage("failed");
      throw new Error("Ölçü tablosu okunamadı. Mağazada ölçü ekranını açık bırakıp tekrar Açık ölçüleri oku düğmesine bas.");
    }
    await analyzeSnapshot(extracted);
  };

  const handleMessage = async (event: WebViewMessageEvent) => {
    let message: ScannerMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as ScannerMessage;
    } catch (reason) {
      setScanMode(null);
      setError("Sayfa tarama sonucunu okunamayan biçimde döndürdü.");
      setScanTrace((steps) => [...steps, {
        stage: "webview",
        status: "failed",
        message: "WebView tarama mesajı ayrıştırılamadı.",
        details: [String(reason)],
      }]);
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
        if (hasVerifiedNumericChart(message.snapshot)) await analyzeSnapshot(message.snapshot);
        else await analyzeVisualFallback({
          fallback: true,
          reason: "WebView ölçü tablosu doğrulanamadı",
          pageText: message.snapshot.sizeChart.rawText,
          product: message.snapshot.product,
        });
      } else if (message.type === "fitmemory-product-fallback") {
        await analyzeVisualFallback(message.snapshot);
      } else {
        setPendingOrders(message.snapshot);
        setStatus("");
        setScanStage("completed");
        webViewRef.current?.injectJavaScript("window.__fitmemoryRestoreRedactions?.();true;");
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
    aiReviewRef.current?.controller.abort();
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
            onChangeText={setOutfitPrompt}
            placeholder={translate("Örn. Akşam yemeği için sade, rahat ve yaşımı yansıtan bir kombin.")}
            placeholderTextColor="#918E85"
            style={styles.outfitPrompt}
            value={outfitPrompt}
          />
          <Button busy={outfitBusy} disabled={outfitPrompt.trim().length < 3} label="Dolabımla kombin oluştur" onPress={() => void createWardrobeOutfit()} small tone="blue" />
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
              allowsInlineMediaPlayback
              decelerationRate="normal"
              domStorageEnabled
              injectedJavaScript={createScannerInstallScript()}
              injectedJavaScriptBeforeContentLoaded={createScannerInstallScript()}
              javaScriptEnabled
              mediaPlaybackRequiresUserAction={false}
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
              originWhitelist={["https://*", "about:blank", "about:srcdoc"]}
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
                if (scanOriginRef.current && !isSameShopPage(scanOriginRef.current, state.url)) {
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
              userAgent={Platform.OS === "ios" ? iosSafariUserAgent : undefined}
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

          {pendingOrders ? (
            <View style={styles.orderReview}>
              <View style={styles.orderReviewHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderReviewEyebrow}>SİPARİŞ ONAYI</Text>
                  <Text style={styles.orderReviewTitle}>Bulunan: {pendingOrders.orderCards.length} ürün</Text>
                </View>
                <Pressable onPress={() => setPendingOrders(null)} style={styles.orderReviewClose}>
                  <Text style={styles.orderReviewCloseText}>×</Text>
                </Pressable>
              </View>
              <Text style={styles.orderReviewCopy}>Ürün adını ve satın aldığın bedeni kontrol et. Yanlış kaydı düzenleyebilir veya silebilirsin.</Text>
              <ScrollView style={styles.orderReviewList} keyboardShouldPersistTaps="handled">
                {pendingOrders.orderCards.map((card) => (
                  <View key={card.clientKey} style={styles.orderReviewCard}>
                    {card.imageUrl ? <Image source={{ uri: card.imageUrl }} style={styles.orderReviewImage} /> : null}
                    <View style={styles.orderReviewFields}>
                      <Text style={styles.orderReviewBrand}>{card.brand}</Text>
                      <TextInput value={card.productName} onChangeText={(value) => updatePendingOrder(card.clientKey, "productName", value)} style={styles.orderReviewInput} />
                      <TextInput autoCapitalize="characters" value={card.purchasedSize} onChangeText={(value) => updatePendingOrder(card.clientKey, "purchasedSize", value.toUpperCase())} placeholder="Beden" style={styles.orderReviewSize} />
                    </View>
                    <Pressable onPress={() => removePendingOrder(card.clientKey)} style={styles.orderReviewDelete}>
                      <Text style={styles.orderReviewDeleteText}>Sil</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
              <Button busy={orderImportBusy} disabled={!pendingOrders.orderCards.length || pendingOrders.orderCards.some((card) => !card.productName.trim() || !card.purchasedSize.trim())} label="Arşive ekle" onPress={() => void importOrderSnapshot(pendingOrders)} tone="blue" />
            </View>
          ) : null}

          {status ? (
            <View style={styles.scanStatus}>
              {scanMode || aiReviewing ? (
                <ActivityIndicator color={colors.blue} size="small" />
              ) : null}
              <Text style={styles.scanStatusText}>{status}</Text>
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
              <Text style={styles.scanPrimaryText}>Açık ölçüleri oku</Text>
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
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  orderReview: { backgroundColor: colors.card, marginHorizontal: 10, marginBottom: 8, maxHeight: "48%", padding: 16, zIndex: 30, ...shadow },
  orderReviewHeader: { alignItems: "center", flexDirection: "row", gap: 10 },
  orderReviewEyebrow: { color: colors.blue, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  orderReviewTitle: { color: colors.ink, fontSize: 21, fontWeight: "900", marginTop: 3 },
  orderReviewCopy: { color: colors.muted, fontSize: 11, lineHeight: 17, marginVertical: 10 },
  orderReviewClose: { alignItems: "center", backgroundColor: "#EEECE6", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  orderReviewCloseText: { color: colors.ink, fontSize: 22 },
  orderReviewList: { marginBottom: 12 },
  orderReviewCard: { alignItems: "center", borderTopColor: colors.line, borderTopWidth: 1, flexDirection: "row", gap: 9, paddingVertical: 10 },
  orderReviewImage: { backgroundColor: "#EEECE6", borderRadius: 8, height: 64, width: 48 },
  orderReviewFields: { flex: 1, gap: 5 },
  orderReviewBrand: { color: colors.blue, fontSize: 8, fontWeight: "900", textTransform: "uppercase" },
  orderReviewInput: { borderColor: colors.line, borderRadius: 7, borderWidth: 1, color: colors.ink, fontSize: 11, paddingHorizontal: 8, paddingVertical: 6 },
  orderReviewSize: { borderColor: colors.line, borderRadius: 7, borderWidth: 1, color: colors.ink, fontSize: 11, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 6, width: 82 },
  orderReviewDelete: { padding: 8 },
  orderReviewDeleteText: { color: "#B23A35", fontSize: 10, fontWeight: "800" },
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
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 15,
    paddingVertical: 10,
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
    marginHorizontal: 12,
    marginBottom: 8,
    maxHeight: "48%",
    padding: 17,
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
