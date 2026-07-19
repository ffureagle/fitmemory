import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
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

type Tab = "scan" | "studio" | "closet" | "profile";

const tabs: {
  key: Tab;
  label: string;
  icon: string;
}[] = [
  { key: "scan", label: "Beden", icon: "◫" },
  { key: "studio", label: "Stüdyo", icon: "✦" },
  { key: "closet", label: "Dolabım", icon: "▣" },
  { key: "profile", label: "Profil", icon: "○" },
];

function Shell() {
  const session = useSession();
  const [tab, setTab] = useState<Tab>(
    session.profile?.age ? "scan" : "profile",
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
      <View style={styles.body}>
        {tab === "scan" && (
          <ScanScreen
            openProfile={() => setTab("profile")}
            openStudio={() => setTab("studio")}
          />
        )}
        {tab === "studio" && <StudioScreen />}
        {tab === "closet" && <ClosetScreen />}
        {tab === "profile" && <ProfileScreen />}
      </View>
      <View style={styles.navigation}>
        {tabs.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={item.key}
              onPress={() => setTab(item.key)}
              style={({ pressed }) => [
                styles.navItem,
                active && styles.navItemActive,
                pressed && styles.navPressed,
              ]}
            >
              <Text
                style={[
                  styles.navIcon,
                  active && styles.navIconActive,
                ]}
              >
                {item.icon}
              </Text>
              <Text
                style={[
                  styles.navLabel,
                  active && styles.navLabelActive,
                ]}
              >
                {item.label}
              </Text>
              {item.key === "closet" && session.orders.length > 0 ? (
                <View style={styles.navBadge}>
                  <Text style={styles.navBadgeText}>
                    {Math.min(99, session.orders.length)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Application() {
  const session = useSession();
  if (!session.ready) {
    return <ScreenLoader label="Dolabın açılıyor" />;
  }
  return session.account && session.token ? <Shell /> : <AuthScreen />;
}

export default function App() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Application />
    </SessionProvider>
  );
}

const styles = StyleSheet.create({
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
    minHeight: Platform.OS === "ios" ? 94 : 72,
    paddingBottom: 12,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 42 : 16,
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
    bottom: 0,
    flexDirection: "row",
    left: 0,
    paddingBottom: Platform.OS === "ios" ? 22 : 8,
    paddingHorizontal: 8,
    paddingTop: 8,
    position: "absolute",
    right: 0,
  },
  navItem: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    gap: 3,
    justifyContent: "center",
    minHeight: 52,
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
