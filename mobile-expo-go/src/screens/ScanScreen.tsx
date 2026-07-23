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
import type {
  ProductSnapshot,
  Recommendation,
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
  } catch {
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
  const [outfitPrompt, setOutfitPrompt] = useState("");
  const [outfitBusy, setOutfitBusy] = useState(false);
  const [wardrobeOutfit, setWardrobeOutfit] = useState<WardrobeOutfit | null>(null);

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

  const canScan = Boolean(session.profile?.age && session.token);
  const currentProductUrl = snapshot?.product.url ?? "";

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
    setStatus(
      mode === "product"
        ? "Beden tablosu ve kalıp okunuyor"
        : "Görünür siparişler hazırlanıyor",
    );
    setScanMode(mode);
    webViewRef.current?.injectJavaScript(createScanScript(mode));
  };

  const analyzeSnapshot = async (nextSnapshot: ProductSnapshot) => {
    if (!session.token || !session.account) return;
    setSnapshot(nextSnapshot);
    setRecommendation(null);
    setStatus("Ölçüler ve dolabın karşılaştırılıyor");
    const result = await session.api.analyzeProduct(
      session.account.userId,
      session.token,
      nextSnapshot,
    );
    setRecommendation(result);
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

  const handleMessage = async (event: WebViewMessageEvent) => {
    let message: ScannerMessage;
    try {
      message = JSON.parse(event.nativeEvent.data) as ScannerMessage;
    } catch {
      setScanMode(null);
      setError("Sayfa tarama sonucunu okunamayan biçimde döndürdü.");
      return;
    }
    if (message.type === "fitmemory-error") {
      setScanMode(null);
      setStatus("");
      setError(message.message);
      return;
    }
    try {
      if (message.type === "fitmemory-product") {
        await analyzeSnapshot(message.snapshot);
      } else {
        await importOrderSnapshot(message.snapshot);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Tarama tamamlanamadı.",
      );
      setStatus("");
    } finally {
      setScanMode(null);
    }
  };

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
      openStudio();
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
        <Button
          label={canScan ? "Mağaza tarayıcısını aç" : "Önce profilini tamamla"}
          onPress={() => openBrowser()}
          tone="dark"
        />
        <Card style={styles.outfitMaker}>
          <Text style={styles.outfitMakerEyebrow}>AI KOMBİN YAPICI</Text>
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
            </View>
          ) : null}
        </Card>
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={goBackInBrowser}
        visible={browserOpen}
      >
        <View style={styles.browser}>
          <View style={styles.browserTop}>
            <Pressable
              accessibilityLabel="Tarayıcıyı kapat"
              onPress={() => setBrowserOpen(false)}
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
                const allowed = isAllowedShopUrl(request.url);
                if (!allowed) {
                  setError(
                    "Bu bağlantı desteklenen mağazaların dışına çıkıyor ve güvenlik için açılmadı.",
                  );
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
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
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
    paddingBottom: Platform.OS === "ios" ? 24 : 24,
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
    bottom: Platform.OS === "ios" ? 86 : 72,
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
    bottom: Platform.OS === "ios" ? 92 : 78,
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
    marginTop: 10,
  },
});
