import { StatusBar } from "expo-status-bar";
import { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "../i18n";

type IntroSplashProps = {
  sessionReady: boolean;
  onFinished(): void;
};

const LINES = ["KALIBIN.", "DOLABIN.", "SENİN VERİN."] as const;
const HOLD_AFTER_READY_MS = 1800;
const EXIT_MS = 420;

export function IntroSplash({ sessionReady, onFinished }: IntroSplashProps) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const sessionReadyRef = useRef(sessionReady);
  sessionReadyRef.current = sessionReady;

  const screen = useRef(new Animated.Value(1)).current;
  const logo = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const words = useRef(LINES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    let cancelled = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let readyPoll: ReturnType<typeof setInterval> | null = null;

    const finish = () => {
      if (cancelled) return;
      Animated.timing(screen, {
        duration: EXIT_MS,
        easing: Easing.in(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && !cancelled) onFinishedRef.current();
      });
    };

    const holdThenFinish = () => {
      if (cancelled) return;
      holdTimer = setTimeout(finish, HOLD_AFTER_READY_MS);
    };

    const waitForReady = () => {
      if (sessionReadyRef.current) {
        holdThenFinish();
        return;
      }
      readyPoll = setInterval(() => {
        if (cancelled || !sessionReadyRef.current) return;
        if (readyPoll) clearInterval(readyPoll);
        readyPoll = null;
        holdThenFinish();
      }, 80);
    };

    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      if (reduceMotion) {
        logo.setValue(1);
        words.forEach((word) => word.setValue(1));
        waitForReady();
        return;
      }

      Animated.sequence([
        Animated.timing(logo, {
          duration: 520,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(sweep, {
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.stagger(
          160,
          words.map((word) =>
            Animated.timing(word, {
              duration: 360,
              easing: Easing.out(Easing.cubic),
              toValue: 1,
              useNativeDriver: true,
            }),
          ),
        ),
      ]).start(({ finished }) => {
        if (!finished || cancelled) return;
        waitForReady();
      });
    });

    return () => {
      cancelled = true;
      if (holdTimer) clearTimeout(holdTimer);
      if (readyPoll) clearInterval(readyPoll);
    };
  }, [logo, screen, sweep, words]);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Animated.View
        style={[
          styles.content,
          {
            opacity: screen,
          },
        ]}
      >
        <View style={styles.mark}>
          <Animated.Image
            resizeMode="contain"
            source={require("../../assets/fitmemory-logo.png")}
            style={[
              styles.logo,
              {
                opacity: logo,
              },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.light,
              {
                opacity: sweep.interpolate({
                  inputRange: [0, 0.18, 0.55, 1],
                  outputRange: [0, 0.9, 0.55, 0],
                }),
                transform: [
                  {
                    translateX: sweep.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-220, 220],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
        <View style={styles.copy}>
          {LINES.map((lineText, index) => (
            <Animated.View
              key={lineText}
              style={{
                opacity: words[index],
                transform: [
                  {
                    translateY: words[index].interpolate({
                      inputRange: [0, 1],
                      outputRange: [8, 0],
                    }),
                  },
                ],
              }}
            >
              <Text style={styles.word}>{lineText}</Text>
            </Animated.View>
          ))}
        </View>
        {!sessionReady ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#FFFFFF" size="small" />
            <Text style={styles.loadingCopy}>Dolabın açılıyor</Text>
          </View>
        ) : (
          <View style={styles.loadingSpacer} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center",
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    width: "100%",
  },
  mark: {
    alignItems: "center",
    height: 268,
    justifyContent: "center",
    overflow: "hidden",
    width: "100%",
  },
  logo: {
    height: 248,
    maxWidth: 400,
    width: "82%",
  },
  light: {
    backgroundColor: "#FFFFFF",
    height: 248,
    opacity: 0.85,
    position: "absolute",
    width: 28,
  },
  copy: {
    alignItems: "center",
    gap: 7,
    marginTop: -8,
  },
  word: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 3.2,
    textAlign: "center",
  },
  loading: {
    alignItems: "center",
    gap: 12,
    height: 64,
    justifyContent: "flex-end",
    marginTop: 28,
  },
  loadingSpacer: {
    height: 64,
    marginTop: 28,
  },
  loadingCopy: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
});
