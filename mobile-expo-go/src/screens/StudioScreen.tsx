import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { Text } from "../i18n";
import type { StyleBoardAnalysis, StyleBoardItem } from "../types";

const slotOrder = ["upper", "bottom", "outer", "shoe", "one", "other"];
const slotNames: Record<string, string> = {
  upper: "Üst",
  bottom: "Pantolon & Alt",
  outer: "Ceket & Dış giyim",
  shoe: "Ayakkabı",
  one: "Tek parça",
  other: "Diğer",
};

function slot(item: StyleBoardItem) {
  const value = `${item.category} ${item.productName} ${item.description} ${item.fitLabel}`
    .toLocaleLowerCase("tr-TR").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
  if (/(ayakkabi|shoe|sneaker|trainer|bot|loafer|sandal|terlik)/i.test(value)) return "shoe";
  if (/(ceket|jacket|mont|coat|kaban|parka|trenc|outer|blazer)/i.test(value)) {
    return "outer";
  }
  if (/(pantolon|jean|denim|trouser|pants|bottom|etek|sort|short|bermuda)/i.test(value)) {
    return "bottom";
  }
  if (/(elbise|dress|tulum|jumpsuit)/i.test(value)) return "one";
  if (/(tisort|t.?shirt|tee|polo(?: yaka)?|top|shirt|gomlek|bluz|sweat|hoodie|kazak|triko|hirka|jersey)/i.test(value)) {
    return "upper";
  }
  return "other";
}

export function StudioScreen() {
  const session = useSession();
  const [tab, setTab] = useState<"studio" | "favorites">("studio");
  const [analysis, setAnalysis] = useState<StyleBoardAnalysis | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const selectionVersions = useRef(new Map<number, number>());

  const groups = useMemo(() => {
    const map = new Map<string, StyleBoardItem[]>();
    for (const item of session.styleBoard.filter((candidate) => candidate.isInStudio)) {
      const key = slot(item);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()].sort(
      ([left], [right]) =>
        slotOrder.indexOf(left) - slotOrder.indexOf(right),
    );
  }, [session.styleBoard]);

  const selected = session.styleBoard.filter((item) => item.isInStudio && item.isSelected);
  const studioItems = session.styleBoard.filter((item) => item.isInStudio);
  const studioFavorites = session.favoriteOutfits.filter(
    (item) => !item.title.startsWith("Dolap · "),
  );

  const selectItem = async (item: StyleBoardItem) => {
    if (!session.token || !session.account) return;
    setError("");
    const before = session.styleBoard;
    const itemSlot = slot(item);
    const nextSelected = !item.isSelected;
    const version = (selectionVersions.current.get(item.id) ?? 0) + 1;
    selectionVersions.current.set(item.id, version);
    setAnalysis(null);
    session.updateStyleBoard(before.map((candidate) =>
      candidate.id === item.id
        ? { ...candidate, isSelected: nextSelected }
        : nextSelected && slot(candidate) === itemSlot
          ? { ...candidate, isSelected: false }
          : candidate,
    ));
    try {
      const updated = await session.api.selectStyleBoardItem(
        item.id,
        session.account.userId,
        session.token,
      );
      if (selectionVersions.current.get(item.id) === version && updated.isSelected !== nextSelected) {
        session.updateStyleBoard(before.map((candidate) =>
          candidate.id === item.id ? { ...candidate, isSelected: updated.isSelected } : candidate,
        ));
      }
    } catch (reason) {
      if (selectionVersions.current.get(item.id) === version) session.updateStyleBoard(before);
      setError(
        reason instanceof Error ? reason.message : "Parça seçilemedi.",
      );
    }
  };

  const deleteItem = async (item: StyleBoardItem) => {
    if (!session.token || !session.account) return;
    setError("");
    try {
      await session.api.deleteStyleBoardItem(
        item.id,
        session.account.userId,
        session.token,
      );
      session.updateStyleBoard(
        item.isSaved
          ? session.styleBoard.map((candidate) => candidate.id === item.id ? { ...candidate, isInStudio: false, isSelected: false } : candidate)
          : session.styleBoard.filter((candidate) => candidate.id !== item.id),
      );
      setAnalysis(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Parça silinemedi.",
      );
    }
  };

  const saveFavorite = async () => {
    if (!analysis || !session.token || !session.account) return;
    setFavoriteBusy(true);
    setError("");
    try {
      const favorite = await session.api.saveFavoriteOutfit(
        session.account.userId,
        session.token,
        analysis.headline || "Favori kombin",
        analysis,
        selected.map((item) => item.id),
      );
      session.updateFavoriteOutfits([favorite, ...session.favoriteOutfits]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kombin favorilere eklenemedi.");
    } finally {
      setFavoriteBusy(false);
    }
  };

  const deleteFavorite = async (id: number) => {
    if (!session.token || !session.account) return;
    setError("");
    try {
      await session.api.deleteFavoriteOutfit(id, session.account.userId, session.token);
      session.updateFavoriteOutfits(session.favoriteOutfits.filter((item) => item.id !== id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Favori silinemedi.");
    }
  };

  const clear = () => {
    if (!session.token || !session.account) return;
    Alert.alert(
      "Stüdyoyu boşalt",
      "Ayırdığın tüm kombin adayları stüdyodan çıkarılsın mı?",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Tamamını çıkar",
          style: "destructive",
          onPress: () => {
            void session.api
              .clearStyleBoard(session.account!.userId, session.token!)
              .then(() => {
                session.updateStyleBoard(session.styleBoard
                  .filter((item) => item.isSaved)
                  .map((item) => ({ ...item, isInStudio: false, isSelected: false })));
                setAnalysis(null);
              })
              .catch((reason: unknown) =>
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Stüdyo boşaltılamadı.",
                ),
              );
          },
        },
      ],
    );
  };

  const analyze = async () => {
    if (!session.token || !session.account) return;
    setBusy(true);
    setError("");
    try {
      setAnalysis(
        await session.api.analyzeStyleBoard(
          session.account.userId,
          session.token,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Kombin yorumlanamadı.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <SectionTitle
        action={
          studioItems.length ? (
            <Pressable onPress={clear} style={styles.clear}>
              <Text style={styles.clearText}>Tümünü sil</Text>
            </Pressable>
          ) : null
        }
        eyebrow="Almadan önce dene"
        title="Kombin Stüdyosu"
      />
      <View accessibilityRole="tablist" style={styles.tabs}>
        {([
          ["studio", "Stüdyo"],
          ["favorites", `Favoriler · ${studioFavorites.length}`],
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
        {tab === "studio"
          ? "Taradığın aday parçaları kategori kategori seç; AI kesim, renk, mevsim ve yaş uyumunu birlikte yorumlar."
          : "Beğendiğin stüdyo kombinleri burada saklanır. Ürün görseline dokunarak resmi ürün sayfasını açabilirsin."}
      </Text>
      {error ? (
        <ErrorNotice message={error} onDismiss={() => setError("")} />
      ) : null}
      {tab === "favorites" ? (
        !studioFavorites.length ? (
          <EmptyState copy="Stilist yorumunu aldıktan sonra kombini favorilerine ekleyebilirsin." symbol="♡" title="Favori kombin yok" />
        ) : (
          <View style={styles.favoriteList}>
            {studioFavorites.map((favorite) => (
              <Card key={favorite.id} style={styles.favoriteCard}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.favoriteImages}>
                  {favorite.items.map((item) => item.imageUrl ? (
                    <Pressable key={item.id} onPress={() => item.productUrl ? void Linking.openURL(item.productUrl) : undefined}>
                      <Image source={{ uri: item.imageUrl }} style={styles.favoriteImage} />
                    </Pressable>
                  ) : <View key={item.id} style={styles.selectedFallback}><Text style={styles.selectedFallbackText}>FM</Text></View>)}
                </ScrollView>
                <Text style={styles.favoriteTitle}>{favorite.title}</Text>
                <Text style={styles.favoriteCopy}>{favorite.analysis.explanation}</Text>
                <View style={styles.favoriteFoot}>
                  <Text style={styles.favoriteScore}>{favorite.analysis.score}/100</Text>
                  <Pressable onPress={() => void deleteFavorite(favorite.id)}><Text style={styles.clearText}>Favoriden çıkar</Text></Pressable>
                </View>
              </Card>
            ))}
          </View>
        )
      ) : !groups.length ? (
        <EmptyState
          copy="Bir ürün taradıktan sonra “Kombin için ayır” seçeneğine dokun."
          symbol="✦"
          title="Stüdyo boş"
        />
      ) : (
        <>
          {groups.map(([key, items]) => (
            <View key={key} style={styles.group}>
              <View style={styles.groupHead}>
                <Text style={styles.groupTitle}>{slotNames[key] ?? key}</Text>
                <Text style={styles.groupMeta}>
                  {items.length} seçenek · 1 aktif
                </Text>
              </View>
              <ScrollView
                contentContainerStyle={styles.carousel}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => void selectItem(item)}
                    style={[
                      styles.item,
                      item.isSelected && styles.itemSelected,
                    ]}
                  >
                    <View style={styles.imageWrap}>
                      {item.imageUrl ? (
                        <Image
                          source={{ uri: item.imageUrl }}
                          style={styles.image}
                        />
                      ) : (
                        <View style={styles.imageFallback}>
                          <Text style={styles.imageFallbackText}>FM</Text>
                        </View>
                      )}
                      {item.isSelected ? (
                        <View style={styles.activeFlag}>
                          <Text style={styles.activeFlagText}>AKTİF</Text>
                        </View>
                      ) : null}
                      <Pressable
                        accessibilityLabel={`${item.productName} parçasını sil`}
                        onPress={() => void deleteItem(item)}
                        style={styles.remove}
                      >
                        <Text style={styles.removeText}>×</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.brand}>{item.brand}</Text>
                    <Text numberOfLines={2} style={styles.name}>
                      {item.productName}
                    </Text>
                    <View style={styles.itemMeta}>
                      {item.recommendedSize ? (
                        <Text style={styles.size}>
                          {item.recommendedSize}
                        </Text>
                      ) : null}
                      {item.fitLabel ? (
                        <Text numberOfLines={1} style={styles.fit}>
                          {item.fitLabel}
                        </Text>
                      ) : null}
                      {item.materialSummary ? (
                        <Text numberOfLines={1} style={styles.fit}>
                          ◇ {item.materialSummary}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ))}

          <Card style={styles.selection}>
            <Text style={styles.selectionEyebrow}>AKTİF KOMBİN</Text>
            <View style={styles.selectedImages}>
              {selected.map((item) =>
                item.imageUrl ? (
                  <Image
                    key={item.id}
                    source={{ uri: item.imageUrl }}
                    style={styles.selectedImage}
                  />
                ) : (
                  <View key={item.id} style={styles.selectedFallback}>
                    <Text style={styles.selectedFallbackText}>FM</Text>
                  </View>
                ),
              )}
            </View>
            <Text style={styles.selectionCopy}>
              {selected.length} farklı kategori seçili
            </Text>
            <Button
              busy={busy}
              disabled={selected.length < 2}
              label={
                selected.length < 2
                  ? "En az 2 farklı kategori seç"
                  : "Stilist yorumunu al"
              }
              onPress={() => void analyze()}
              tone="blue"
            />
          </Card>
        </>
      )}

      {tab === "studio" && analysis ? (
        <Card style={styles.analysis}>
          <View style={styles.analysisHead}>
            <View>
              <Text style={styles.analysisEyebrow}>
                {analysis.seasonContext}
              </Text>
              <Text style={styles.analysisVerdict}>{analysis.verdict}</Text>
            </View>
            <View style={styles.score}>
              <Text style={styles.scoreValue}>{analysis.score}</Text>
              <Text style={styles.scoreLabel}>/100</Text>
            </View>
          </View>
          <Text style={styles.analysisTitle}>{analysis.headline}</Text>
          <Text style={styles.analysisCopy}>{analysis.explanation}</Text>
          {analysis.notes.map((note) => (
            <View key={note} style={styles.note}>
              <Text style={styles.noteMark}>+</Text>
              <Text style={styles.noteText}>{note}</Text>
            </View>
          ))}
          <Button busy={favoriteBusy} label="Kombini favorilere ekle" onPress={() => void saveFavorite()} tone="light" />
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    paddingBottom: 110,
    paddingHorizontal: 20,
    paddingTop: 26,
  },
  clear: {
    paddingBottom: 4,
    paddingHorizontal: 4,
  },
  clearText: {
    color: colors.red,
    fontSize: 10.5,
    fontWeight: "800",
  },
  intro: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 5,
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
    justifyContent: "center",
    minHeight: 42,
  },
  tabActive: { backgroundColor: colors.card },
  tabText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  tabTextActive: { color: colors.ink },
  favoriteList: { gap: 12 },
  favoriteCard: { gap: 11 },
  favoriteImages: { gap: 7 },
  favoriteImage: { backgroundColor: "#EEECE6", borderRadius: 9, height: 128, resizeMode: "cover", width: 96 },
  favoriteTitle: { color: colors.ink, fontSize: 17, fontWeight: "900", lineHeight: 21 },
  favoriteCopy: { color: colors.muted, fontSize: 11.5, lineHeight: 18 },
  favoriteFoot: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  favoriteScore: { color: colors.blue, fontSize: 13, fontWeight: "900" },
  group: {
    gap: 9,
  },
  groupHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  groupTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900",
  },
  groupMeta: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "700",
  },
  carousel: {
    gap: 10,
    paddingBottom: 8,
    paddingRight: 20,
  },
  item: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    overflow: "hidden",
    paddingBottom: 11,
    width: 168,
  },
  itemSelected: {
    borderColor: colors.blue,
    borderWidth: 2,
  },
  imageWrap: {
    backgroundColor: "#ECEAE4",
    height: 178,
    position: "relative",
  },
  image: {
    height: "100%",
    resizeMode: "cover",
    width: "100%",
  },
  imageFallback: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  imageFallbackText: {
    color: colors.muted,
    fontSize: 18,
    fontWeight: "900",
  },
  activeFlag: {
    backgroundColor: colors.blue,
    borderRadius: 5,
    left: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
    position: "absolute",
    top: 8,
  },
  activeFlagText: {
    color: colors.card,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  remove: {
    alignItems: "center",
    backgroundColor: "#FFFFFFE8",
    borderRadius: 16,
    height: 28,
    justifyContent: "center",
    position: "absolute",
    right: 8,
    top: 8,
    width: 28,
  },
  removeText: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: "300",
    lineHeight: 20,
  },
  brand: {
    color: colors.blue,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.1,
    marginHorizontal: 11,
    marginTop: 10,
    textTransform: "uppercase",
  },
  name: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
    marginHorizontal: 11,
    marginTop: 4,
    minHeight: 32,
  },
  itemMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginHorizontal: 11,
    marginTop: 8,
  },
  size: {
    backgroundColor: colors.ink,
    borderRadius: 5,
    color: colors.card,
    fontSize: 9,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  fit: {
    color: colors.muted,
    flex: 1,
    fontSize: 8.5,
  },
  selection: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
    gap: 12,
    marginTop: 4,
  },
  selectionEyebrow: {
    color: "#AFC1FF",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  selectedImages: {
    flexDirection: "row",
    gap: 7,
  },
  selectedImage: {
    backgroundColor: "#2B2B29",
    borderRadius: 8,
    height: 82,
    resizeMode: "cover",
    width: 64,
  },
  selectedFallback: {
    alignItems: "center",
    backgroundColor: "#2B2B29",
    borderRadius: 8,
    height: 82,
    justifyContent: "center",
    width: 64,
  },
  selectedFallbackText: {
    color: "#AFAEAA",
    fontSize: 10,
    fontWeight: "900",
  },
  selectionCopy: {
    color: "#B7B6B1",
    fontSize: 11,
  },
  analysis: {
    gap: 12,
  },
  analysisHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  analysisEyebrow: {
    color: colors.blue,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  analysisVerdict: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  score: {
    alignItems: "baseline",
    flexDirection: "row",
  },
  scoreValue: {
    color: colors.blue,
    fontSize: 29,
    fontWeight: "900",
    letterSpacing: -1.5,
  },
  scoreLabel: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "800",
  },
  analysisTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: -0.7,
    lineHeight: 24,
  },
  analysisCopy: {
    color: colors.muted,
    fontSize: 12.5,
    lineHeight: 20,
  },
  note: {
    alignItems: "flex-start",
    backgroundColor: colors.blueSoft,
    borderRadius: 9,
    flexDirection: "row",
    gap: 8,
    padding: 10,
  },
  noteMark: {
    color: colors.blue,
    fontSize: 13,
    fontWeight: "900",
  },
  noteText: {
    color: "#27417F",
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
});
