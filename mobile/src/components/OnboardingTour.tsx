import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useFeedback } from "../feedback";
import { Text, useI18n } from "../i18n";
import { colors, shadow } from "../theme";
import { Button } from "./Ui";

const content = {
  tr: [
    {
      symbol: "01",
      eyebrow: "BEDEN HAFIZASI",
      title: "Önce seni tanıyalım.",
      copy: "Profilindeki temel ölçüler başlangıç noktamızdır. Sonraki gerçek uyum notların kişisel kalıp hafızanı geliştirir.",
    },
    {
      symbol: "02",
      eyebrow: "AKILLI TARAMA",
      title: "Ürün sayfasını aç ve tara.",
      copy: "Pull&Bear, Bershka veya Zara ürününü uygulama içindeki tarayıcıda aç. FitMemory beden tablosunu, kesimi ve model bilgisini birlikte inceler.",
    },
    {
      symbol: "03",
      eyebrow: "DOLABIN",
      title: "Nasıl olduğunu söyle.",
      copy: "Tuttuğun veya iade ettiğin parçaya bol, dar ya da iyi uyum notu ver. Her kategori ve kalıp kendi içinde öğrenilir.",
    },
    {
      symbol: "04",
      eyebrow: "KOMBİN STÜDYOSU",
      title: "Almadan önce kombinle.",
      copy: "Taradığın ürünü stüdyoya ayır, dolabındaki parçalarla dene ve stilist değerlendirmesini gör.",
    },
  ],
  en: [
    {
      symbol: "01",
      eyebrow: "FIT MEMORY",
      title: "Let us get to know you.",
      copy: "Your basic measurements are the starting point. Real fit feedback from your clothes continuously improves your personal fit memory.",
    },
    {
      symbol: "02",
      eyebrow: "SMART SCANNING",
      title: "Open a product and scan it.",
      copy: "Open a Pull&Bear, Bershka or Zara product in the in-app browser. FitMemory reviews its size chart, cut and model details together.",
    },
    {
      symbol: "03",
      eyebrow: "YOUR CLOSET",
      title: "Tell us how it fitted.",
      copy: "Mark a kept or returned item as loose, tight or a good fit. Every category and cut learns independently.",
    },
    {
      symbol: "04",
      eyebrow: "OUTFIT STUDIO",
      title: "Style it before buying.",
      copy: "Save a scanned product to Studio, pair it with your closet and receive a stylist review.",
    },
  ],
} as const;

export function OnboardingTour({ userId }: { userId: string }) {
  const { language } = useI18n();
  const feedback = useFeedback();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const pages = content[language];
  const page = pages[step] ?? pages[0];
  const storageKey = `fitmemory.tour.v1.${userId}`;

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void SecureStore.getItemAsync(storageKey).then((seen) => {
        if (active && !seen) setVisible(true);
      });
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [storageKey]);

  const finish = async () => {
    feedback.success();
    setVisible(false);
    await SecureStore.setItemAsync(storageKey, "seen");
  };

  const next = () => {
    if (step >= pages.length - 1) {
      void finish();
      return;
    }
    feedback.select();
    setStep((current) => current + 1);
  };

  return (
    <Modal animationType="fade" transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.topRow}>
            <View style={styles.symbol}>
              <Text style={styles.symbolText}>{page.symbol}</Text>
            </View>
            <Pressable onPress={() => void finish()} hitSlop={12}>
              <Text style={styles.skip}>{language === "tr" ? "Atla" : "Skip"}</Text>
            </Pressable>
          </View>
          <View style={styles.copyWrap}>
            <Text style={styles.eyebrow}>{page.eyebrow}</Text>
            <Text style={styles.title}>{page.title}</Text>
            <Text style={styles.copy}>{page.copy}</Text>
          </View>
          <View style={styles.dots}>
            {pages.map((_, index) => (
              <View key={index} style={[styles.dot, index === step && styles.dotActive]} />
            ))}
          </View>
          <Button
            label={
              step === pages.length - 1
                ? language === "tr" ? "Başlayalım" : "Get started"
                : language === "tr" ? "Devam" : "Continue"
            }
            onPress={next}
            tone="blue"
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(12, 12, 12, 0.62)",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    maxWidth: 430,
    padding: 24,
    width: "100%",
    ...shadow,
  },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  symbol: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 23,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  symbolText: { color: colors.card, fontSize: 13, fontWeight: "900" },
  skip: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  copyWrap: { marginBottom: 28, marginTop: 34 },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "900", letterSpacing: 1.8 },
  title: { color: colors.ink, fontSize: 28, fontWeight: "900", letterSpacing: -1.2, lineHeight: 32, marginTop: 9 },
  copy: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 14 },
  dots: { flexDirection: "row", gap: 6, justifyContent: "center", marginBottom: 20 },
  dot: { backgroundColor: colors.line, borderRadius: 3, height: 5, width: 16 },
  dotActive: { backgroundColor: colors.blue, width: 30 },
});
