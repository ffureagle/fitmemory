import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Image,
  Platform,
  Pressable,
  StatusBar as NativeStatusBar,
  StyleSheet,
  View,
} from "react-native";
import { AuthScreen } from "./src/screens/AuthScreen";
import { ClosetScreen } from "./src/screens/ClosetScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { ScanScreen } from "./src/screens/ScanScreen";
import { StudioScreen } from "./src/screens/StudioScreen";
import { Brand, ScreenLoader } from "./src/components/Ui";
import { SessionProvider, useSession } from "./src/session";
import { colors } from "./src/theme";
import { FeedbackProvider, useFeedback } from "./src/feedback";
import { I18nProvider, Text, useI18n } from "./src/i18n";
import { OnboardingTour } from "./src/components/OnboardingTour";
import { LanguageScreen } from "./src/screens/LanguageScreen";

type Tab = "scan" | "studio" | "closet" | "profile";

const tabs: {
  key: Tab;
  label: string;
}[] = [
  { key: "scan", label: "Beden" },
  { key: "studio", label: "Stüdyo" },
  { key: "closet", label: "Dolabım" },
  { key: "profile", label: "Profil" },
];

function NavIcon({ active, type }: { active: boolean; type: Tab }) {
  const color = active ? colors.card : "#77756E";
  if (type === "profile") {
    return (
      <View style={styles.profileIcon}>
        <View style={[styles.profileHead, { borderColor: color }]} />
        <View style={[styles.profileBody, { borderColor: color }]} />
      </View>
    );
  }
  if (type === "studio") {
    return <View style={styles.studioIcon}><View style={[styles.hangerHook, { borderColor: color }]} /><View style={[styles.hangerBar, { borderColor: color }]} /></View>;
  }
  return (
    <View style={[styles.wardrobeIcon, { borderColor: color }]}>
      <View style={[styles.wardrobeSplit, { backgroundColor: color }]} />
      <View style={[styles.wardrobeKnob, { backgroundColor: color }]} />
      {type === "scan" ? <View style={[styles.scanBeam, { backgroundColor: active ? colors.orange : colors.blue }]} /> : null}
    </View>
  );
}

function Shell() {
  const session = useSession();
  const feedback = useFeedback();
  const [tab, setTab] = useState<Tab>(
    session.profile?.age ? "scan" : "profile",
  );
  const [reduceMotion, setReduceMotion] = useState(false);
  const screenProgress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  const openTab = useCallback(
    (nextTab: Tab) => {
      if (nextTab === tab) return;
      feedback.select();
      setTab(nextTab);
      if (reduceMotion) return;
      screenProgress.stopAnimation();
      screenProgress.setValue(0);
      requestAnimationFrame(() => {
        Animated.timing(screenProgress, {
          duration: 230,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }).start();
      });
    },
    [feedback, reduceMotion, screenProgress, tab],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          void session.refresh().catch(() => undefined);
        }
      },
    );
    return () => subscription.remove();
  }, [session.refresh]);

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <Brand compact />
        <View style={styles.headerStatus}>
          <View style={styles.headerStatusDot} />
          <Text style={styles.headerStatusText}>HESABIN BAĞLI</Text>
        </View>
      </View>
      <Animated.View
        style={[
          styles.body,
          {
            opacity: screenProgress,
            transform: [
              {
                translateY: screenProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [10, 0],
                }),
              },
            ],
          },
        ]}
      >
        {tab === "scan" && (
          <ScanScreen
            openProfile={() => openTab("profile")}
            openStudio={() => openTab("studio")}
          />
        )}
        {tab === "studio" && <StudioScreen />}
        {tab === "closet" && <ClosetScreen />}
        {tab === "profile" && <ProfileScreen />}
      </Animated.View>
      <View style={styles.navigation}>
        {tabs.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={item.key}
              onPress={() => openTab(item.key)}
              style={({ pressed }) => [
                styles.navItem,
                active && styles.navItemActive,
                pressed && styles.navPressed,
              ]}
            >
              <NavIcon active={active} type={item.key} />
              <Text
                style={[
                  styles.navLabel,
                  active && styles.navLabelActive,
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {session.account ? <OnboardingTour userId={session.account.userId} /> : null}
    </View>
  );
}

function Application() {
  const session = useSession();
  const { ready, hasChosenLanguage } = useI18n();
  const [introVisible, setIntroVisible] = useState(true);
  const introProgress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!ready || !hasChosenLanguage || !session.ready) return;
    Animated.sequence([
      Animated.delay(520),
      Animated.timing(introProgress, { duration: 220, toValue: 0, useNativeDriver: true }),
    ]).start(() => setIntroVisible(false));
  }, [hasChosenLanguage, introProgress, ready, session.ready]);
  if (!ready) {
    return <ScreenLoader label="Hazırlanıyor" />;
  }
  if (!hasChosenLanguage) {
    return <LanguageScreen />;
  }
  if (introVisible || !session.ready) {
    return (
      <View style={styles.introSplash}>
        <Animated.View style={[styles.introContent, { opacity: session.ready ? introProgress : 1, transform: [{ scale: session.ready ? introProgress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) : 1 }] }]}>
          <Image resizeMode="contain" source={require("./assets/fitmemory-logo.png")} style={styles.introLogo} />
          <Text style={styles.introSplashCopy}>KALIBIN. DOLABIN. SENİN VERİN.</Text>
          {!session.ready ? (
            <View style={styles.introLoading}>
              <ActivityIndicator color="#FFFFFF" size="small" />
              <Text style={styles.introLoadingCopy}>Dolabın açılıyor</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    );
  }
  return session.account && session.token ? <Shell /> : <AuthScreen />;
}

export default function App() {
  return (
    <I18nProvider>
      <FeedbackProvider>
        <SessionProvider>
          <StatusBar style="dark" />
          <Application />
        </SessionProvider>
      </FeedbackProvider>
    </I18nProvider>
  );
}

const styles = StyleSheet.create({
  introSplash: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center",
  },
  introContent: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  introLogo: {
    height: 260,
    maxWidth: 420,
    width: "84%",
  },
  introSplashCopy: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginTop: -20,
    textAlign: "center",
  },
  introLoading: {
    alignItems: "center",
    gap: 12,
    marginTop: 30,
  },
  introLoadingCopy: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  shell: {
    backgroundColor: colors.paper,
    flex: 1,
  },
  header: {
    alignItems: "center",
    backgroundColor: colors.paper,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: Platform.OS === "ios" ? 94 : 76,
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop:
      Platform.OS === "ios" ? 42 : (NativeStatusBar.currentHeight ?? 24) + 10,
  },
  headerStatus: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  headerStatusDot: {
    backgroundColor: colors.green,
    borderRadius: 5,
    height: 7,
    width: 7,
  },
  headerStatusText: {
    color: colors.muted,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  body: {
    flex: 1,
  },
  navigation: {
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    paddingBottom: Platform.OS === "ios" ? 22 : 20,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  navItem: {
    alignItems: "center",
    borderRadius: 999,
    flex: 1,
    gap: 3,
    justifyContent: "center",
    marginHorizontal: 3,
    minHeight: 56,
    position: "relative",
  },
  navItemActive: {
    backgroundColor: colors.ink,
  },
  navPressed: {
    opacity: 0.7,
  },
  navIcon: {
    color: "#77756E",
    fontSize: 18,
    fontWeight: "500",
  },
  navIconActive: {
    color: colors.card,
  },
  wardrobeIcon: {
    borderRadius: 4,
    borderWidth: 1.7,
    height: 20,
    overflow: "hidden",
    position: "relative",
    width: 21,
  },
  wardrobeSplit: {
    height: 18,
    left: 9,
    opacity: 0.72,
    position: "absolute",
    top: 0,
    width: 1,
  },
  wardrobeKnob: {
    borderRadius: 2,
    height: 3,
    left: 12,
    position: "absolute",
    top: 9,
    width: 3,
  },
  scanBeam: {
    bottom: 2,
    left: 2,
    position: "absolute",
    top: 2,
    width: 2,
  },
  studioIcon: {
    height: 20,
    position: "relative",
    width: 24,
  },
  hangerHook: {
    borderBottomWidth: 0,
    borderLeftWidth: 1.7,
    borderRadius: 8,
    borderRightWidth: 1.7,
    borderTopWidth: 1.7,
    height: 8,
    left: 9,
    position: "absolute",
    top: 0,
    transform: [{ rotate: "18deg" }],
    width: 7,
  },
  hangerBar: {
    borderBottomWidth: 1.7,
    borderLeftWidth: 1.7,
    borderRightWidth: 1.7,
    height: 10,
    left: 2,
    position: "absolute",
    top: 8,
    transform: [{ rotate: "0deg" }],
    width: 20,
  },
  profileIcon: {
    height: 22,
    position: "relative",
    width: 22,
  },
  profileHead: {
    borderRadius: 6,
    borderWidth: 1.7,
    height: 10,
    left: 6,
    position: "absolute",
    top: 0,
    width: 10,
  },
  profileBody: {
    borderBottomWidth: 0,
    borderLeftWidth: 1.7,
    borderRadius: 10,
    borderRightWidth: 1.7,
    borderTopWidth: 1.7,
    height: 9,
    left: 2,
    position: "absolute",
    top: 12,
    width: 18,
  },
  navLabel: {
    color: "#77756E",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  navLabelActive: {
    color: colors.card,
  },
  navBadge: {
    alignItems: "center",
    backgroundColor: colors.orange,
    borderColor: colors.card,
    borderRadius: 9,
    borderWidth: 2,
    height: 18,
    justifyContent: "center",
    position: "absolute",
    right: 12,
    top: 4,
    minWidth: 18,
  },
  navBadgeText: {
    color: colors.card,
    fontSize: 7,
    fontWeight: "900",
  },
});
