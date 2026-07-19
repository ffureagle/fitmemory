import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Brand, Button, ErrorNotice, Field } from "../components/Ui";
import { useSession } from "../session";
import { colors } from "../theme";

export function AuthScreen() {
  const { busy, login, register } = useSession();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!email.trim() || password.length < 8) {
      setError("Geçerli e-posta ve en az 8 karakterlik şifre gir.");
      return;
    }
    if (mode === "register") {
      if (name.trim().length < 2) {
        setError("Adın en az 2 karakter olmalı.");
        return;
      }
      if (password !== passwordAgain) {
        setError("Şifreler aynı değil.");
        return;
      }
      if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(password) || !/\d/.test(password)) {
        setError("Şifre en az bir harf ve bir rakam içermeli.");
        return;
      }
    }
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(name, email, password);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Hesap işlemi başarısız.",
      );
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Brand />
        <View style={styles.hero}>
          <Text style={styles.kicker}>KİŞİSEL KALIP HAFIZASI</Text>
          <Text style={styles.title}>Bedenini ezbere değil, veriye göre seç.</Text>
          <Text style={styles.copy}>
            Geçmiş kıyafetlerin, gerçek uyum notların ve ürünün kesimi aynı
            hesapta buluşur.
          </Text>
        </View>

        <View style={styles.panel}>
          <View style={styles.tabs}>
            {(["login", "register"] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => {
                  setMode(value);
                  setError("");
                }}
                style={[
                  styles.tab,
                  mode === value && styles.tabActive,
                ]}
              >
                <Text
                  style={[
                    styles.tabText,
                    mode === value && styles.tabTextActive,
                  ]}
                >
                  {value === "login" ? "Giriş yap" : "Hesap oluştur"}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.form}>
            {mode === "register" && (
              <Field
                autoCapitalize="words"
                label="Adın"
                onChangeText={setName}
                placeholder="Furkan"
                value={name}
              />
            )}
            <Field
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              label="E-posta"
              onChangeText={setEmail}
              placeholder="sen@example.com"
              value={email}
            />
            <Field
              autoCapitalize="none"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              label="Şifre"
              onChangeText={setPassword}
              placeholder="En az 8 karakter"
              secureTextEntry
              value={password}
            />
            {mode === "register" && (
              <Field
                autoCapitalize="none"
                autoComplete="new-password"
                label="Şifre tekrar"
                onChangeText={setPasswordAgain}
                placeholder="Şifreni tekrar yaz"
                secureTextEntry
                value={passwordAgain}
              />
            )}
            {error ? (
              <ErrorNotice message={error} onDismiss={() => setError("")} />
            ) : null}
            <Button
              busy={busy}
              label={mode === "login" ? "Hesabıma gir" : "Hesabımı oluştur"}
              onPress={() => void submit()}
              tone="blue"
            />
          </View>
        </View>
        <Text style={styles.privacy}>
          Oturum anahtarın cihazın güvenli kasasında tutulur. Mağaza şifrelerin
          FitMemory sunucusuna gönderilmez.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.paper,
    flex: 1,
  },
  content: {
    paddingBottom: 36,
    paddingHorizontal: 22,
    paddingTop: Platform.OS === "ios" ? 70 : 42,
  },
  hero: {
    marginBottom: 28,
    marginTop: 44,
  },
  kicker: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  title: {
    color: colors.ink,
    fontSize: 37,
    fontWeight: "900",
    letterSpacing: -2,
    lineHeight: 40,
    marginTop: 10,
  },
  copy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 14,
  },
  panel: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  tabs: {
    backgroundColor: "#ECE9E1",
    flexDirection: "row",
    padding: 5,
  },
  tab: {
    alignItems: "center",
    borderRadius: 10,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  tabActive: {
    backgroundColor: colors.card,
  },
  tabText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  tabTextActive: {
    color: colors.ink,
  },
  form: {
    gap: 15,
    padding: 18,
  },
  privacy: {
    color: colors.muted,
    fontSize: 10.5,
    lineHeight: 16,
    marginTop: 16,
    paddingHorizontal: 8,
    textAlign: "center",
  },
});
