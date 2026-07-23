import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  View,
} from "react-native";
import { Brand, Button, ErrorNotice, Field } from "../components/Ui";
import { useSession } from "../session";
import { colors } from "../theme";
import { LanguageSwitch, Text } from "../i18n";

export function AuthScreen() {
  const { api, busy, login, register } = useSession();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordAgain, setRegisterPasswordAgain] = useState("");
  const [error, setError] = useState("");
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordAgain, setResetPasswordAgain] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  const sendResetCode = async () => {
    setError("");
    setResetBusy(true);
    try {
      const result = await api.forgotPassword(resetEmail.trim());
      setResetMessage(result.message);
      setResetStep(2);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kod gönderilemedi.");
    } finally {
      setResetBusy(false);
    }
  };

  const completeReset = async () => {
    setError("");
    if (resetPassword !== resetPasswordAgain) {
      setError("Şifreler aynı değil.");
      return;
    }
    setResetBusy(true);
    try {
      await api.resetPassword(resetEmail.trim(), resetCode.trim(), resetPassword);
      setLoginEmail(resetEmail.trim());
      setResetMessage("Şifren yenilendi. Yeni şifrenle giriş yapabilirsin.");
      setResetStep(0);
      setMode("login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Şifre yenilenemedi.");
    } finally {
      setResetBusy(false);
    }
  };

  const submit = async () => {
    setError("");
    const email = mode === "login" ? loginEmail : registerEmail;
    const password = mode === "login" ? loginPassword : registerPassword;
    if (!email.trim() || password.length < 8) {
      setError("Geçerli e-posta ve en az 8 karakterlik şifre gir.");
      return;
    }
    if (mode === "register") {
      if (registerName.trim().length < 2) {
        setError("Adın en az 2 karakter olmalı.");
        return;
      }
      if (registerPassword !== registerPasswordAgain) {
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
        await register(registerName, registerEmail, registerPassword);
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
        <LanguageSwitch />
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
                disabled={busy}
                key={value}
                onPress={() => {
                  setMode(value);
                  setResetStep(0);
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
            {resetStep ? (
              <>
                <Text style={styles.resetTitle}>Şifreni yenile</Text>
                <Text style={styles.resetCopy}>
                  {resetStep === 1
                    ? "Hesabındaki e-posta adresine 6 haneli, tek kullanımlık kod göndereceğiz."
                    : resetMessage}
                </Text>
                <Field
                  autoCapitalize="none"
                  keyboardType="email-address"
                  label="E-posta"
                  onChangeText={setResetEmail}
                  placeholder="sen@example.com"
                  value={resetEmail}
                />
                {resetStep === 2 ? (
                  <>
                    <Field keyboardType="number-pad" label="6 haneli kod" maxLength={6} onChangeText={setResetCode} placeholder="000000" value={resetCode} />
                    <Field autoCapitalize="none" label="Yeni şifre" onChangeText={setResetPassword} placeholder="En az 8 karakter" secureTextEntry value={resetPassword} />
                    <Field autoCapitalize="none" label="Yeni şifre tekrar" onChangeText={setResetPasswordAgain} placeholder="Şifreni tekrar yaz" secureTextEntry value={resetPasswordAgain} />
                  </>
                ) : null}
                {error ? <ErrorNotice message={error} onDismiss={() => setError("")} /> : null}
                <Button busy={resetBusy} label={resetStep === 1 ? "Kodu e-postama gönder" : "Şifremi yenile"} onPress={() => void (resetStep === 1 ? sendResetCode() : completeReset())} tone="blue" />
                <Pressable onPress={() => { setResetStep(0); setError(""); }}>
                  <Text style={styles.forgot}>Giriş ekranına dön</Text>
                </Pressable>
              </>
            ) : (
              <>
            {mode === "register" && (
              <Field
                autoCapitalize="words"
                label="Adın"
                onChangeText={setRegisterName}
                placeholder=""
                value={registerName}
              />
            )}
            {mode === "login" ? (
              <Pressable onPress={() => { setResetEmail(loginEmail); setResetStep(1); setError(""); }}>
                <Text style={styles.forgot}>Şifremi unuttum</Text>
              </Pressable>
            ) : null}
            <Field
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              label="E-posta"
              onChangeText={mode === "login" ? setLoginEmail : setRegisterEmail}
              placeholder="sen@example.com"
              value={mode === "login" ? loginEmail : registerEmail}
            />
            <Field
              autoCapitalize="none"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              label="Şifre"
              onChangeText={
                mode === "login" ? setLoginPassword : setRegisterPassword
              }
              placeholder="En az 8 karakter"
              secureTextEntry
              value={mode === "login" ? loginPassword : registerPassword}
            />
            {mode === "register" && (
              <Field
                autoCapitalize="none"
                autoComplete="new-password"
                label="Şifre tekrar"
                onChangeText={setRegisterPasswordAgain}
                placeholder="Şifreni tekrar yaz"
                secureTextEntry
                value={registerPasswordAgain}
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
              </>
            )}
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
    paddingTop:
      Platform.OS === "ios" ? 70 : (NativeStatusBar.currentHeight ?? 24) + 24,
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
  forgot: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: "800",
    paddingVertical: 4,
    textAlign: "center",
  },
  resetTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  resetCopy: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
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
