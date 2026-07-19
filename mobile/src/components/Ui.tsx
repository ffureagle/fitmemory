import type { PropsWithChildren, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { colors, shadow } from "../theme";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.brand}>
      <View style={[styles.brandMark, compact && styles.brandMarkCompact]}>
        <Text style={styles.brandMarkText}>FM</Text>
      </View>
      <View>
        <Text style={styles.brandName}>FITMEMORY</Text>
        {!compact && (
          <Text style={styles.brandTag}>KALIBINI HATIRLAR</Text>
        )}
      </View>
    </View>
  );
}

export function Card({
  children,
  style,
}: PropsWithChildren<{ style?: object }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  busy = false,
  disabled = false,
  tone = "dark",
  small = false,
}: {
  label: string;
  onPress(): void;
  busy?: boolean;
  disabled?: boolean;
  tone?: "dark" | "blue" | "light" | "danger";
  small?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${tone}`],
        small && styles.buttonSmall,
        (busy || disabled) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {busy && (
        <ActivityIndicator
          color={tone === "light" ? colors.ink : colors.card}
          size="small"
        />
      )}
      <Text
        style={[
          styles.buttonText,
          tone === "light" && styles.buttonTextDark,
          tone === "danger" && styles.buttonTextDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor="#99968D"
        selectionColor={colors.blue}
        style={styles.field}
        {...props}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

export function SectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

export function EmptyState({
  symbol,
  title,
  copy,
}: {
  symbol: string;
  title: string;
  copy: string;
}) {
  return (
    <Card style={styles.empty}>
      <Text style={styles.emptySymbol}>{symbol}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyCopy}>{copy}</Text>
    </Card>
  );
}

export function ErrorNotice({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?(): void;
}) {
  return (
    <Pressable
      accessibilityRole={onDismiss ? "button" : undefined}
      onPress={onDismiss}
      style={styles.error}
    >
      <Text style={styles.errorTitle}>İşlem tamamlanamadı</Text>
      <Text style={styles.errorCopy}>{message}</Text>
    </Pressable>
  );
}

export function ScreenLoader({ label = "Hazırlanıyor" }: { label?: string }) {
  return (
    <View style={styles.loader}>
      <Brand />
      <ActivityIndicator
        color={colors.blue}
        size="large"
        style={styles.loaderSpinner}
      />
      <Text style={styles.loaderText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: "center",
    flexDirection: "row",
    gap: 11,
  },
  brandMark: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 3,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  brandMarkCompact: {
    height: 36,
    width: 36,
  },
  brandMarkText: {
    color: colors.card,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  brandName: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900",
    letterSpacing: -0.7,
  },
  brandTag: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 2,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    ...shadow,
  },
  button: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 18,
  },
  button_dark: {
    backgroundColor: colors.ink,
  },
  button_blue: {
    backgroundColor: colors.blue,
  },
  button_light: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
  },
  button_danger: {
    backgroundColor: colors.redSoft,
    borderColor: "#F2C3C0",
    borderWidth: 1,
  },
  buttonSmall: {
    minHeight: 40,
    paddingHorizontal: 13,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  buttonText: {
    color: colors.card,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.15,
  },
  buttonTextDark: {
    color: colors.ink,
  },
  buttonTextDanger: {
    color: colors.red,
  },
  fieldWrap: {
    gap: 7,
  },
  fieldLabel: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  field: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 15,
    minHeight: 52,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  fieldHint: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  sectionHead: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  sectionCopy: {
    flex: 1,
  },
  eyebrow: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.7,
    marginBottom: 7,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -1.3,
    lineHeight: 32,
  },
  empty: {
    alignItems: "center",
    paddingHorizontal: 28,
    paddingVertical: 36,
  },
  emptySymbol: {
    color: colors.blue,
    fontSize: 28,
    fontWeight: "300",
    marginBottom: 14,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  error: {
    backgroundColor: colors.redSoft,
    borderColor: "#F0BDBA",
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    padding: 13,
  },
  errorTitle: {
    color: colors.red,
    fontSize: 12,
    fontWeight: "800",
  },
  errorCopy: {
    color: "#87322E",
    fontSize: 12,
    lineHeight: 18,
  },
  loader: {
    alignItems: "center",
    backgroundColor: colors.paper,
    flex: 1,
    justifyContent: "center",
  },
  loaderSpinner: {
    marginTop: 36,
  },
  loaderText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.7,
    marginTop: 13,
  },
});
