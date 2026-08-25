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
const HOLD_AFTER_READY_MS = 2400;
const EXIT_MS = 480;

export function IntroSplash({ sessionReady, onFinished }: IntroSplashProps) {
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const sessionReadyRef = useRef(sessionReady);
  sessionReadyRef.current = sessionReady;

  const screen = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const logo = useRef(new Animated.Value(0)).current;
  const line = useRef(new Animated.Value(0)).current;
  const scan = useRef(new Animated.Value(0)).current;
  const words = useRef(LINES.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    let cancelled = false;
    let pulseLoop: Animated.CompositeAnimation | null = null;
    let scanLoop: Animated.CompositeAnimation | null = null;
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
        glow.setValue(1);
        logo.setValue(1);
        line.setValue(1);
        words.forEach((word) => word.setValue(1));
        waitForReady();
        return;
      }

      pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            duration: 1700,
            easing: Easing.inOut(Easing.sin),
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            duration: 1700,
            easing: Easing.inOut(Easing.sin),
            toValue: 0,
            useNativeDriver: true,
          }),
        ]),
      );
      scanLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(scan, {
            duration: 1100,
            easing: Easing.inOut(Easing.quad),
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(scan, {
            duration: 1100,
            easing: Easing.inOut(Easing.quad),
            toValue: 0,
            useNativeDriver: true,
          }),
        ]),
      );
      pulseLoop.start();
      scanLoop.start();

      Animated.parallel([
        Animated.timing(glow, {
          duration: 760,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(140),
          Animated.timing(logo, {
            duration: 720,
            easing: Easing.out(Easing.cubic),
            toValue: 1,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(620),
          Animated.timing(line, {
            duration: 560,
            easing: Easing.out(Easing.cubic),
            toValue: 1,
            useNativeDriver: true,
          }),
        ]),
        Animated.stagger(
          260,
          words.map((word) =>
            Animated.sequence([
              Animated.delay(480),
              Animated.timing(word, {
                duration: 420,
                easing: Easing.out(Easing.cubic),
                toValue: 1,
                useNativeDriver: true,
              }),
            ]),
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
      pulseLoop?.stop();
      scanLoop?.stop();
    };
  }, [glow, line, logo, pulse, scan, screen, words]);

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <Animated.View
        style={[
          styles.content,
          {
            opacity: screen,
            transform: [
              {
                scale: screen.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1],
                }),
              },
            ],
          },
        ]}
      >
        <View style={styles.mark}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glowOuter,
              {
                opacity: Animated.multiply(
                  glow,
                  pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.22, 0.45],
                  }),
                ),
                transform: [
                  {
                    scale: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.9, 1.1],
                    }),
                  },
                ],
              },
            ]}
          />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glowInner,
              {
                opacity: Animated.multiply(
                  glow,
                  pulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.16, 0.32],
                  }),
                ),
              },
            ]}
          />
          <Animated.Image
            resizeMode="contain"
            source={require("../../assets/fitmemory-logo.png")}
            style={[
              styles.logo,
              {
                opacity: logo,
                transform: [
                  {
                    scale: logo.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.86, 1],
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
                      outputRange: [10, 0],
                    }),
                  },
                ],
              }}
            >
              <Text style={styles.word}>{lineText}</Text>
            </Animated.View>
          ))}
          <View style={styles.lineTrack}>
            <Animated.View
              style={[
                styles.lineFill,
                {
                  opacity: line,
                  transform: [{ scaleX: line }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.scanDot,
                {
                  opacity: line,
                  transform: [
                    {
                      translateX: scan.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-54, 54],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
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
    width: "100%",
  },
  glowOuter: {
    backgroundColor: "#F26B38",
    borderRadius: 150,
    height: 260,
    position: "absolute",
    width: 260,
  },
  glowInner: {
    backgroundColor: "#2457F5",
    borderRadius: 90,
    height: 160,
    position: "absolute",
    width: 160,
  },
  logo: {
    height: 248,
    maxWidth: 400,
    width: "82%",
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
  lineTrack: {
    alignItems: "center",
    height: 10,
    justifyContent: "center",
    marginTop: 14,
    width: 120,
  },
  lineFill: {
    backgroundColor: "#F26B38",
    height: 1,
    width: 120,
  },
  scanDot: {
    backgroundColor: "#FFFFFF",
    borderRadius: 3,
    height: 5,
    position: "absolute",
    width: 5,
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
