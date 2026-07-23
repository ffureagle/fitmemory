import * as Haptics from "expo-haptics";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
  useRef,
} from "react";

type FeedbackApi = {
  tap(): void;
  select(): void;
  success(): void;
};

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: PropsWithChildren) {
  const lastSelectionAt = useRef(0);

  const value = useMemo<FeedbackApi>(
    () => ({
      tap() {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
          () => undefined,
        );
      },
      select() {
        const now = Date.now();
        if (now - lastSelectionAt.current < 90) return;
        lastSelectionAt.current = now;
        void Haptics.selectionAsync().catch(() => undefined);
      },
      success() {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => undefined);
      },
    }),
    [],
  );

  return (
    <FeedbackContext.Provider value={value}>
      {children}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) {
    throw new Error("useFeedback must be used inside FeedbackProvider.");
  }
  return value;
}
