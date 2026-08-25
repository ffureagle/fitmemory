import { useMemo, useState } from "react";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  SectionTitle,
} from "../components/Ui";
import { useSession } from "../session";
import { colors } from "../theme";
import { Text, useI18n } from "../i18n";
import type { FavoriteOutfit, Order, WardrobeOutfit } from "../types";

const categoryNames: Record<string, string> = {
  Tops: "Tişört & Üst",
  Shirts: "Gömlek",
  Outerwear: "Ceket & Dış giyim",
  Knitwear: "Triko",
  Bottoms: "Pantolon",
  Denim: "Pantolon & Jean",
  Dresses: "Elbise",
  Footwear: "Ayakkabı",
  Returns: "İadeler",
  Other: "Diğer",
};

const outcomeNames: Record<Order["outcome"], string> = {
  PurchasedUnknownFit: "Henüz değerlendirilmedi",
  KeptGoodFit: "Tam oldu · dolapta",
  KeptTooBaggy: "Bol geldi · dolapta",
  KeptTooTight: "Dar geldi · dolapta",
  ReturnedTooBaggy: "İade · bol geldi",
  ReturnedTooTight: "İade · dar geldi",
};

function groupKey(category: string) {
  const normalized = category.toLocaleLowerCase("tr-TR");
  if (/(ayakkabı|shoe|sneaker|footwear|bot|loafer)/i.test(normalized)) {
    return "Footwear";
  }
  if (/(jean|denim)/i.test(normalized)) return "Denim";
  if (/(pantolon|bottom|trouser|short|etek)/i.test(normalized)) {
    return "Bottoms";
  }
  if (/(ceket|jacket|mont|coat|outer|kaban|trenç)/i.test(normalized)) {
    return "Outerwear";
  }
  if (/(gömlek|shirt)/i.test(normalized) &&
      !/(t-shirt|tişört)/i.test(normalized)) {
    return "Shirts";
  }
  if (/(kazak|triko|knit|hırka|sweater)/i.test(normalized)) {
    return "Knitwear";
  }
  if (/(elbise|dress|tulum)/i.test(normalized)) return "Dresses";
  if (/(tişört|t-shirt|tee|top|sweat|hoodie|polo)/i.test(normalized)) {
    return "Tops";
  }
  return categoryNames[category] ? category : "Other";
}

function isReturned(outcome: Order["outcome"]) {
  return outcome === "ReturnedTooBaggy" ||
    outcome === "ReturnedTooTight";
}

const categoryIcons: Record<string, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> = {
  Tops: "tshirt-crew-outline",
  Shirts: "hanger",
  Outerwear: "coat-rack",
  Knitwear: "layers-outline",
  Dresses: "human-female",
  Footwear: "shoe-sneaker",
  Returns: "archive-arrow-down-outline",
  Other: "dots-horizontal-circle-outline",
};

function CategoryGlyph({ category }: { category: string }) {
  if (category === "Bottoms" || category === "Denim") {
    return (
      <View style={styles.trouserIcon}>
        <View style={styles.trouserWaist} />
        <View style={styles.trouserLeftLeg} />
        <View style={styles.trouserRightLeg} />
      </View>
    );
  }
  return (
    <MaterialCommunityIcons
      color={colors.blue}
      name={categoryIcons[category] ?? categoryIcons.Other}
      size={21}
    />
  );
}

export function ClosetScreen() {
  const { translate } = useI18n();
  const session = useSession();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<Order | null>(null);
  const [note, setNote] = useState("");
  const [selectedOutcome, setSelectedOutcome] =
    useState<Order["outcome"]>("KeptGoodFit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"closet" | "saved">("closet");
  const savedOutfits = session.favoriteOutfits.filter((item) => item.title.startsWith("Dolap · "));
  const [outfitPrompt, setOutfitPrompt] = useState("");
  const [outfitBusy, setOutfitBusy] = useState(false);
  const [outfitError, setOutfitError] = useState("");
  const [wardrobeOutfit, setWardrobeOutfit] = useState<WardrobeOutfit | null>(null);
  const [wardrobeFavoriteBusy, setWardrobeFavoriteBusy] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);

  const groups = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const order of session.orders) {
      const key = isReturned(order.outcome)
        ? "Returns"
        : groupKey(order.category);
      map.set(key, [...(map.get(key) ?? []), order]);
    }
    return [...map.entries()].sort(([left], [right]) => {
      if (left === "Returns") return 1;
      if (right === "Returns") return -1;
      return (categoryNames[left] ?? left).localeCompare(
        categoryNames[right] ?? right,
        "tr",
      );
    });
  }, [session.orders]);

  const openEditor = (order: Order) => {
    setEditing(order);
    setNote(order.userFitNotes ?? "");
    setSelectedOutcome(
      order.outcome === "PurchasedUnknownFit"
        ? "KeptGoodFit"
        : order.outcome,
    );
    setError("");
  };

  const saveFeedback = async () => {
    if (!editing || !session.account || !session.token) return;
    setSaving(true);
    setError("");
    try {
      const updated = await session.api.updateOrderFeedback(
        editing.id,
        session.account.userId,
        session.token,
        {
          outcome: selectedOutcome,
          returnConfirmedByUser: isReturned(selectedOutcome),
          userFitNotes: note.trim() || null,
        },
      );
      session.updateOrders(
        session.orders.map((order) =>
          order.id === updated.id ? updated : order,
        ),
      );
      setEditing(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Uyum notu kaydedilemedi.",
      );
    } finally {
      setSaving(false);
    }
  };

  const confirmReturn = () => {
    if (!editing || !session.account || !session.token) return;
    const returnOutcome: Order["outcome"] = selectedOutcome === "KeptTooBaggy" || selectedOutcome === "ReturnedTooBaggy"
      ? "ReturnedTooBaggy"
      : selectedOutcome === "KeptTooTight" || selectedOutcome === "ReturnedTooTight"
        ? "ReturnedTooTight"
        : "ReturnedTooTight";
    const reason = returnOutcome === "ReturnedTooBaggy" ? "bol geldi" : "dar geldi";
    Alert.alert(
      "İadeyi onayla",
      `${editing.productName} “${reason}” bilgisiyle iadeler bölümüne taşınsın mı?`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Evet, iade ettim",
          style: "destructive",
          onPress: () => {
            setSaving(true);
            void session.api.updateOrderFeedback(
              editing.id,
              session.account!.userId,
              session.token!,
              { outcome: returnOutcome, returnConfirmedByUser: true, userFitNotes: note.trim() || null },
            ).then((updated) => {
              session.updateOrders(session.orders.map((order) => order.id === updated.id ? updated : order));
              setEditing(null);
            }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "İade kaydedilemedi."))
              .finally(() => setSaving(false));
          },
        },
      ],
    );
  };

  const restoreToCloset = (order: Order) => {
    if (!session.account || !session.token) return;
    Alert.alert(
      "Dolaba geri gönder",
      `${order.productName} iade listesinden çıkarılıp dolaba geri alınsın mı?`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Dolaba geri al",
          onPress: () => void session.api.updateOrderFeedback(
            order.id,
            session.account!.userId,
            session.token!,
            {
              outcome: order.outcome === "ReturnedTooBaggy" ? "KeptTooBaggy" : "KeptTooTight",
              returnConfirmedByUser: false,
              userFitNotes: order.userFitNotes,
            },
          ).then((updated) => session.updateOrders(
            session.orders.map((item) => item.id === updated.id ? updated : item),
          )).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Ürün dolaba alınamadı.")),
        },
      ],
    );
  };

  const deleteOrder = (order: Order) => {
    if (!session.account || !session.token) return;
    Alert.alert(
      "Dolaptan sil",
      `${order.productName} kalıp hafızasından da kalıcı olarak silinsin mi?`,
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Sil",
          style: "destructive",
          onPress: () => {
            void session.api
              .deleteOrder(
                order.id,
                session.account!.userId,
                session.token!,
              )
              .then(() => {
                session.updateOrders(
                  session.orders.filter((item) => item.id !== order.id),
                );
              })
              .catch((reason: unknown) => {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Parça silinemedi.",
                );
              });
          },
        },
      ],
    );
  };

  const togglePicked = (order: Order) => {
    setPicked((current) =>
      current.includes(order.id)
        ? current.filter((id) => id !== order.id)
        : [...current, order.id],
    );
    setOutfitError("");
  };

  const createClosetOutfit = async () => {
    if (!session.token || !session.account) return;
    const selected = session.orders.filter((order) => picked.includes(order.id) && !isReturned(order.outcome));
    const prompt = outfitPrompt.trim() || (
      selected.length >= 2
        ? `Şu dolap parçalarımla giyilebilir bir kombin kur: ${selected.map((order) => `${order.brand} ${order.productName} (${order.purchasedSize})`).join(", ")}.`
        : ""
    );
    if (prompt.length < 3) {
      setOutfitError("En az iki parça seç veya nasıl görünmek istediğini yaz.");
      return;
    }
    setOutfitBusy(true);
    setOutfitError("");
    setWardrobeOutfit(null);
    try {
      setWardrobeOutfit(
        await session.api.createWardrobeOutfit(session.account.userId, session.token, prompt),
      );
    } catch (reason) {
      setOutfitError(reason instanceof Error ? reason.message : "Kombin oluşturulamadı.");
    } finally {
      setOutfitBusy(false);
    }
  };

  const saveClosetOutfit = async () => {
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
      setTab("saved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kombin kaydedilemedi.");
    } finally {
      setWardrobeFavoriteBusy(false);
    }
  };

  const deleteSaved = (item: FavoriteOutfit) => {
    if (!session.account || !session.token) return;
    Alert.alert("Kaydı kaldır", `${item.title.replace("Dolap · ", "")} kaydedilenlerden kaldırılsın mı?`, [
      { text: "Vazgeç", style: "cancel" },
      {
        text: "Kaldır",
        style: "destructive",
        onPress: () => void session.api
          .deleteFavoriteOutfit(item.id, session.account!.userId, session.token!)
          .then(() => session.updateFavoriteOutfits(
            session.favoriteOutfits.filter((candidate) => candidate.id !== item.id),
          ))
          .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Kayıt kaldırılamadı.")),
      },
    ]);
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <SectionTitle
          eyebrow="Kişisel kalıp hafızan"
          title="Dolabım"
        />
        <View accessibilityRole="tablist" style={styles.tabs}>
          {([
            ["closet", "Dolabım"],
            ["saved", `Kaydedilenler · ${savedOutfits.length}`],
          ] as const).map(([key, label]) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === key }}
              key={key}
              onPress={() => setTab(key)}
              style={[styles.tab, tab === key && styles.tabActive]}
            >
              <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.intro}>
          {tab === "saved"
            ? "Burada yalnız dolabındaki parçalarla kurduğun kombinler durur. Almadığın ürünler Stüdyo → Kaydedilenler’dedir."
            : "Satın aldığın parçalar burada yaşar. İki veya daha fazla parçayı seçip AI ile kombin yaptırabilirsin."}
        </Text>
        {error ? (
          <ErrorNotice message={error} onDismiss={() => setError("")} />
        ) : null}
        {tab === "saved" ? (
          !savedOutfits.length ? (
            <EmptyState copy="Dolabındaki parçaları seçip kombin yap, sonra ‘Kombini kaydet’. Almadığın ürünler Stüdyo → Kaydedilenler’e gider." symbol="♡" title="Henüz kayıt yok" />
          ) : (
            <View style={styles.savedGrid}>
              {savedOutfits.map((item) => (
                <Card key={item.id} style={styles.savedCard}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {item.items.map((piece) => piece.imageUrl ? (
                      <Pressable key={piece.id} onPress={() => piece.productUrl ? void Linking.openURL(piece.productUrl) : undefined}>
                        <Image source={{ uri: piece.imageUrl }} style={styles.savedImage} />
                      </Pressable>
                    ) : (
                      <View key={piece.id} style={styles.savedFallback}><Text>FM</Text></View>
                    ))}
                  </ScrollView>
                  <View style={styles.savedCopy}>
                    <Text style={styles.brand}>DOLABIMDAN KOMBİN</Text>
                    <Text numberOfLines={2} style={styles.productName}>{item.title.replace("Dolap · ", "")}</Text>
                    <Text numberOfLines={2} style={styles.savedMeta}>{item.analysis.explanation}</Text>
                  </View>
                  <Pressable onPress={() => deleteSaved(item)} style={styles.savedRemove}>
                    <Text style={styles.deleteText}>Kaldır</Text>
                  </Pressable>
                </Card>
              ))}
            </View>
          )
        ) : !groups.length ? (
          <EmptyState
            copy="Mağazanın sipariş sayfasını mobil tarayıcıda açıp “Sipariş” tuşuna bas."
            symbol="▣"
            title="Dolabın henüz boş"
          />
        ) : (
          <View style={styles.groups}>
            <Card style={styles.outfitMaker}>
              <Text style={styles.outfitEyebrow}>DOLAPTAN KOMBİN</Text>
              <Text style={styles.outfitTitle}>Dolabındakilerle kombin kur</Text>
              <Text style={styles.outfitHint}>
                {picked.length ? `${picked.length} parça seçili.` : "Parçanın fotoğrafına dokunarak seç; ya da nasıl görünmek istediğini yaz."}
              </Text>
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
              <Button
                busy={outfitBusy}
                disabled={outfitPrompt.trim().length < 3 && picked.length < 2}
                label={picked.length >= 2 ? "Seçilenlerle kombin yap" : "Dolabımla kombin oluştur"}
                onPress={() => void createClosetOutfit()}
                small
                tone="blue"
              />
              {outfitError ? (
                <ErrorNotice message={outfitError} onDismiss={() => setOutfitError("")} />
              ) : null}
              {wardrobeOutfit ? (
                <View style={styles.outfitResult}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {wardrobeOutfit.pieces.map((piece) => piece.imageUrl ? (
                      <Image key={piece.orderId} source={{ uri: piece.imageUrl }} style={styles.outfitImage} />
                    ) : (
                      <View key={piece.orderId} style={styles.outfitFallback}><Text style={styles.productFallbackText}>FM</Text></View>
                    ))}
                  </ScrollView>
                  <Text style={styles.productName}>{wardrobeOutfit.analysis.headline}</Text>
                  <Text style={styles.savedMeta}>{wardrobeOutfit.analysis.explanation}</Text>
                  <Button busy={wardrobeFavoriteBusy} label="Kombini kaydet" onPress={() => void saveClosetOutfit()} small />
                </View>
              ) : null}
            </Card>
            {groups.map(([key, orders]) => {
              const isOpen = expanded === key;
              return (
                <Card key={key} style={styles.group}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setExpanded(isOpen ? null : key)}
                    style={styles.groupHead}
                  >
                    <View style={styles.groupIndex}>
                      <CategoryGlyph category={key} />
                    </View>
                    <View style={styles.groupCopy}>
                      <Text style={styles.groupTitle}>
                        {categoryNames[key] ?? key}
                      </Text>
                      <Text style={styles.groupMeta}>
                        {key === "Returns"
                          ? `${orders.length} iade`
                          : `${orders.length} parça`}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>{isOpen ? "⌃" : "⌄"}</Text>
                  </Pressable>
                  {isOpen ? (
                    <View style={styles.products}>
                      {orders.map((order) => (
                        <View key={order.id} style={[styles.product, picked.includes(order.id) && styles.productPicked]}>
                          <Pressable onPress={() => key === "Returns" ? undefined : togglePicked(order)} style={styles.pickHit}>
                            {order.imageUrl ? (
                              <Image
                                source={{ uri: order.imageUrl }}
                                style={styles.productImage}
                              />
                            ) : (
                              <View style={styles.productFallback}>
                                <Text style={styles.productFallbackText}>FM</Text>
                              </View>
                            )}
                            {picked.includes(order.id) ? (
                              <View style={styles.pickedFlag}><Text style={styles.pickedFlagText}>SEÇİLİ</Text></View>
                            ) : null}
                          </Pressable>
                          <View style={styles.productCopy}>
                            <Text style={styles.brand}>{order.brand}</Text>
                            <Text numberOfLines={2} style={styles.productName}>
                              {order.productName}
                            </Text>
                            <View style={styles.badges}>
                              {order.fitLabel ? (
                                <Text style={styles.fitBadge}>
                                  {order.fitLabel}
                                </Text>
                              ) : null}
                              {order.materialSummary ? (
                                <Text numberOfLines={1} style={styles.fitBadge}>
                                  ◇ {order.materialSummary}
                                </Text>
                              ) : null}
                              <Text
                                style={[
                                  styles.outcomeBadge,
                                  isReturned(order.outcome) &&
                                    styles.outcomeReturned,
                                ]}
                              >
                                {outcomeNames[order.outcome]}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.size}>
                            <Text style={styles.sizeText}>
                              {order.purchasedSize}
                            </Text>
                          </View>
                          <View style={styles.productActions}>
                            <Pressable
                              onPress={() => openEditor(order)}
                              style={styles.textAction}
                            >
                              <Text style={styles.textActionText}>
                                {order.outcome === "PurchasedUnknownFit"
                                  ? "Değerlendir"
                                  : "Düzenle"}
                              </Text>
                            </Pressable>
                            <Pressable
                              onPress={() => deleteOrder(order)}
                              style={styles.textAction}
                            >
                              <Text style={styles.deleteText}>Sil</Text>
                            </Pressable>
                            {key === "Returns" ? (
                              <Pressable onPress={() => restoreToCloset(order)} style={styles.textAction}>
                                <Text style={styles.textActionText}>Dolaba geri gönder</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        animationType="slide"
        onRequestClose={() => setEditing(null)}
        transparent
        visible={Boolean(editing)}
      >
        <Pressable
          onPress={() => setEditing(null)}
          style={styles.modalBackdrop}
        >
          <Pressable onPress={() => undefined} style={styles.editor}>
            <View style={styles.editorHandle} />
            <Text style={styles.editorEyebrow}>GERÇEK UYUMUN</Text>
            <Text style={styles.editorTitle}>
              {editing?.productName}
            </Text>
            <Text style={styles.editorCopy}>
              Bölgesel detay yaz: “boydan tam, belden dar” gibi. Bu not başka
              ürüne kopyalanmaz; benzer kalıplar için kanıt olur.
            </Text>
            <View style={styles.choiceGrid}>
              {[
                ["Tam oldu", "KeptGoodFit"],
                ["Bol geldi", "KeptTooBaggy"],
                ["Dar geldi", "KeptTooTight"],
              ].map(([label, outcome]) => (
                <Pressable
                  key={outcome}
                  onPress={() =>
                    setSelectedOutcome(outcome as Order["outcome"])
                  }
                  style={[
                    styles.choice,
                    selectedOutcome === outcome && styles.choiceActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.choiceText,
                      selectedOutcome === outcome &&
                        styles.choiceTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              maxLength={500}
              multiline
              onChangeText={setNote}
              placeholder={translate("Örn. Belden tam, baldırdan biraz dar; boyu iyi.")}
              placeholderTextColor="#959188"
              style={styles.note}
              value={note}
            />
            {error ? <ErrorNotice message={error} /> : null}
            <Button
              busy={saving}
              label="Uyum hafızasına kaydet"
              onPress={() => void saveFeedback()}
              tone="blue"
            />
            <Pressable
              onPress={confirmReturn}
              style={styles.returnAction}
            >
              <Text style={styles.returnActionText}>
                Bu ürünü iade ettim
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 15,
    paddingBottom: 110,
    paddingHorizontal: 20,
    paddingTop: 26,
  },
  intro: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 5,
  },
  groups: {
    gap: 10,
  },
  tabs: {
    backgroundColor: "#E7E4DC",
    borderRadius: 14,
    flexDirection: "row",
    padding: 4,
  },
  tab: {
    alignItems: "center",
    borderRadius: 11,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
  },
  tabActive: {
    backgroundColor: colors.card,
  },
  tabText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  tabTextActive: {
    color: colors.ink,
  },
  savedGrid: {
    gap: 10,
  },
  outfitMaker: { gap: 10, padding: 16 },
  outfitEyebrow: { color: colors.blue, fontSize: 9, fontWeight: "900", letterSpacing: 1.4 },
  outfitTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  outfitHint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  outfitPrompt: {
    backgroundColor: "#F2F0EA",
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 12,
    minHeight: 72,
    padding: 12,
    textAlignVertical: "top",
  },
  outfitResult: { borderTopColor: colors.line, borderTopWidth: 1, gap: 8, paddingTop: 12 },
  outfitImage: { backgroundColor: "#ECEAE4", borderRadius: 10, height: 118, marginRight: 8, resizeMode: "cover", width: 88 },
  outfitFallback: { alignItems: "center", backgroundColor: "#ECEAE4", borderRadius: 10, height: 118, justifyContent: "center", marginRight: 8, width: 88 },
  savedCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    padding: 10,
  },
  savedImage: {
    backgroundColor: "#EEECE6",
    borderRadius: 10,
    height: 92,
    resizeMode: "cover",
    width: 72,
  },
  savedFallback: {
    alignItems: "center",
    backgroundColor: "#EEECE6",
    borderRadius: 10,
    height: 92,
    justifyContent: "center",
    width: 72,
  },
  savedCopy: {
    flex: 1,
  },
  savedMeta: {
    color: colors.muted,
    fontSize: 9.5,
    marginTop: 6,
  },
  savedRemove: {
    alignSelf: "flex-end",
    padding: 8,
  },
  group: {
    padding: 0,
  },
  groupHead: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 72,
    paddingHorizontal: 15,
  },
  groupIndex: {
    alignItems: "center",
    backgroundColor: colors.blueSoft,
    borderRadius: 9,
    height: 38,
    justifyContent: "center",
    marginRight: 12,
    width: 38,
  },
  groupIndexText: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: "900",
  },
  trouserIcon: {
    height: 22,
    position: "relative",
    width: 18,
  },
  trouserWaist: {
    borderColor: colors.blue,
    borderRadius: 2,
    borderWidth: 1.7,
    height: 5,
    left: 1,
    position: "absolute",
    top: 0,
    width: 16,
  },
  trouserLeftLeg: {
    borderBottomLeftRadius: 3,
    borderColor: colors.blue,
    borderTopWidth: 0,
    borderWidth: 1.7,
    height: 17,
    left: 2,
    position: "absolute",
    top: 4,
    transform: [{ rotate: "4deg" }],
    width: 7,
  },
  trouserRightLeg: {
    borderBottomRightRadius: 3,
    borderColor: colors.blue,
    borderTopWidth: 0,
    borderWidth: 1.7,
    height: 17,
    position: "absolute",
    right: 2,
    top: 4,
    transform: [{ rotate: "-4deg" }],
    width: 7,
  },
  groupCopy: {
    flex: 1,
  },
  groupTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  groupMeta: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 3,
  },
  chevron: {
    color: colors.muted,
    fontSize: 16,
  },
  products: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
  },
  product: {
    borderBottomColor: "#E7E4DC",
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 11,
    padding: 14,
  },
  productPicked: {
    backgroundColor: "#F3F6FF",
  },
  pickedFlag: {
    backgroundColor: colors.ink,
    borderRadius: 4,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    position: "absolute",
    top: 6,
  },
  pickedFlagText: {
    color: colors.card,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  productImage: {
    backgroundColor: "#EEECE6",
    borderRadius: 9,
    height: 82,
    resizeMode: "cover",
    width: 64,
  },
  pickHit: { position: "relative" },
  productFallback: {
    alignItems: "center",
    backgroundColor: "#EEECE6",
    borderRadius: 9,
    height: 82,
    justifyContent: "center",
    width: 64,
  },
  productFallbackText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  productCopy: {
    flex: 1,
    minWidth: 140,
  },
  brand: {
    color: colors.blue,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  productName: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 4,
  },
  badges: {
    alignItems: "flex-start",
    gap: 5,
    marginTop: 7,
  },
  fitBadge: {
    backgroundColor: colors.blueSoft,
    borderRadius: 20,
    color: colors.blue,
    fontSize: 8.5,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  outcomeBadge: {
    backgroundColor: colors.greenSoft,
    borderRadius: 20,
    color: colors.green,
    fontSize: 8.5,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  outcomeReturned: {
    backgroundColor: colors.redSoft,
    color: colors.red,
  },
  size: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 7,
    height: 42,
    justifyContent: "center",
    minWidth: 42,
    paddingHorizontal: 7,
  },
  sizeText: {
    color: colors.card,
    fontSize: 14,
    fontWeight: "900",
  },
  productActions: {
    flexDirection: "row",
    gap: 18,
    marginLeft: 75,
    width: "100%",
  },
  textAction: {
    paddingVertical: 4,
  },
  textActionText: {
    color: colors.blue,
    fontSize: 10.5,
    fontWeight: "800",
  },
  deleteText: {
    color: colors.red,
    fontSize: 10.5,
    fontWeight: "800",
  },
  modalBackdrop: {
    backgroundColor: "#11110F99",
    flex: 1,
    justifyContent: "flex-end",
  },
  editor: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: 13,
    maxHeight: "88%",
    paddingBottom: Platform.OS === "ios" ? 34 : 22,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  editorHandle: {
    alignSelf: "center",
    backgroundColor: "#C8C5BC",
    borderRadius: 4,
    height: 4,
    marginBottom: 7,
    width: 42,
  },
  editorEyebrow: {
    color: colors.blue,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  editorTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  editorCopy: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 19,
  },
  choiceGrid: {
    flexDirection: "row",
    gap: 8,
  },
  choice: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 43,
  },
  choiceActive: {
    backgroundColor: colors.blueSoft,
    borderColor: "#9FB5FF",
  },
  choiceText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
  },
  choiceTextActive: {
    color: colors.blue,
  },
  note: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 19,
    minHeight: 92,
    padding: 13,
    textAlignVertical: "top",
  },
  returnAction: {
    alignItems: "center",
    minHeight: 36,
    justifyContent: "center",
  },
  returnActionText: {
    color: colors.red,
    fontSize: 11,
    fontWeight: "800",
  },
  returnWarning: {
    color: colors.red,
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
  },
});
