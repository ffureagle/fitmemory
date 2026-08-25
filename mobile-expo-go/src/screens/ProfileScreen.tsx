import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  Brand,
  Button,
  Card,
  ErrorNotice,
  Field,
  SectionTitle,
} from "../components/Ui";
import { useSession } from "../session";
import { colors } from "../theme";
import { useFeedback } from "../feedback";
import { LanguageSwitch, Text } from "../i18n";
import type { FitPreference, Profile } from "../types";
import {
  clearProfileDraft,
  initialProfileForm,
  profileForServerSync,
  readProfileDraft,
  shoulderCircumferenceCm,
  writePendingProfile,
  writeProfileDraft,
  type ProfileFormState,
} from "../profilePersistence";

const preferences: {
  value: FitPreference;
  label: string;
  copy: string;
}[] = [
  {
    value: "TrueToSize",
    label: "Dengeli",
    copy: "Vücuda oturan ama sıkmayan",
  },
  {
    value: "Relaxed",
    label: "Rahat",
    copy: "Biraz hareket payı olan",
  },
  {
    value: "Oversized",
    label: "Bol",
    copy: "Bilinçli geniş silüet",
  },
  {
    value: "Slim",
    label: "Dar",
    copy: "Vücuda yakın görünüm",
  },
];

function number(value: string, name: string) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} alanını sayıyla doldur.`);
  }
  return parsed;
}

export function ProfileScreen() {
  const session = useSession();
  const feedback = useFeedback();
  const [form, setForm] = useState<ProfileFormState>(() =>
    initialProfileForm(session.profile),
  );
  const [editingMeasurements, setEditingMeasurements] = useState(
    !session.profile,
  );
  const [apiUrl, setApiUrl] = useState(session.apiBaseUrl);
  const [saving, setSaving] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const savedForm = initialProfileForm(session.profile);
  const formChanged = JSON.stringify(form) !== JSON.stringify(savedForm);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const draft = await readProfileDraft(session.account?.userId);
      if (cancelled || savingRef.current) return;
      if (draft) {
        dirtyRef.current = true;
        setForm(draft.form);
        setEditingMeasurements(true);
        return;
      }
      if (dirtyRef.current) return;
      setForm(initialProfileForm(session.profile));
      if (session.profile) setEditingMeasurements(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [session.account?.userId, session.profile]);

  useEffect(() => {
    setApiUrl(session.apiBaseUrl);
  }, [session.apiBaseUrl]);

  useEffect(() => {
    if (!session.account?.userId || !formChanged || savingRef.current) {
      return;
    }
    const timer = setTimeout(() => {
      void writeProfileDraft(session.account!.userId, form);
    }, 250);
    return () => clearTimeout(timer);
  }, [form, formChanged, session.account]);

  const set = (key: keyof ProfileFormState, value: string) => {
    dirtyRef.current = true;
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!session.account || !session.token) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const body = {
        age: number(form.age, "Yaş"),
        heightCm: number(form.height, "Boy"),
        weightKg: number(form.weight, "Kilo"),
        shoulderWidthCm: number(form.shoulder, "Omuz çevresi"),
        chestCircumferenceCm: number(form.chest, "Göğüs"),
        waistCircumferenceCm: number(form.waist, "Bel"),
        footLengthCm: number(form.foot, "Ayak uzunluğu"),
        usualShoeSizeEu: number(form.shoe, "Ayakkabı numarası"),
        fitPreference: form.preference,
      };
      const localProfile: Profile = {
        userId: session.account.userId,
        ...body,
        createdAt: session.profile?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await writePendingProfile(localProfile);
      session.updateProfile(localProfile, true);
      await clearProfileDraft();
      dirtyRef.current = false;
      setEditingMeasurements(false);
      setSuccess("Ölçüler bu telefonda kaydoldu.");
      feedback.success();
      const userId = session.account.userId;
      const token = session.token;
      void (async () => {
        try {
          await session.api.health(90_000).catch(() => undefined);
          const updated = await session.api.saveProfile(
            userId,
            token,
            profileForServerSync(body),
          );
          session.updateProfile(updated);
          await clearProfileDraft();
        } catch {
          // Sunucu uyanınca oturum açılışında yeniden denenecek.
        }
      })();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Profil kaydedilemedi.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const changeApi = async () => {
    setTestingApi(true);
    setError("");
    setSuccess("");
    try {
      await session.setApiBaseUrl(apiUrl);
      setSuccess("Sunucu bağlantısı doğrulandı.");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Sunucuya ulaşılamadı.",
      );
    } finally {
      setTestingApi(false);
    }
  };

  const confirmApiChange = () => {
    if (apiUrl.trim().replace(/\/+$/, "") === session.apiBaseUrl.trim().replace(/\/+$/, "")) {
      setSuccess("API adresinde değişiklik yok.");
      return;
    }
    Alert.alert(
      "API sunucusunu değiştir",
      "Yeni sunucu hesabındaki verilere erişecek. Adresi doğrulayıp kaydetmek istediğine emin misin?",
      [
        { text: "Vazgeç", style: "cancel" },
        { text: "Doğrula ve kaydet", onPress: () => void changeApi() },
      ],
    );
  };

  const closeMeasurementEditor = () => {
    if (!formChanged) {
      setEditingMeasurements(false);
      return;
    }
    Alert.alert(
      "Değişiklikler kaydedilsin mi?",
      "Ölçülerinde yaptığın değişiklikleri kaydetmeden çıkabilirsin.",
      [
        {
          text: "Kaydetmeden çık",
          style: "destructive",
          onPress: () => {
            dirtyRef.current = false;
            void clearProfileDraft();
            setForm(initialProfileForm(session.profile));
            setEditingMeasurements(false);
            setError("");
          },
        },
        { text: "Düzenlemeye devam", style: "cancel" },
        { text: "Kaydet", onPress: () => void save() },
      ],
    );
  };

  const logout = () => {
    Alert.alert(
      "Hesaptan çık",
      "Dolabın silinmez; merkezi hesabında kalır.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Çıkış yap",
          style: "destructive",
          onPress: () => void session.logout(),
        },
      ],
    );
  };

  const deleteAccount = () => {
    Alert.alert(
      "Hesabı kalıcı olarak sil",
      "Profilin, dolabın, uyum notların, önerilerin ve oturumların geri alınamayacak şekilde silinir.",
      [
        { text: "Vazgeç", style: "cancel" },
        {
          text: "Hesabı sil",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Son onay",
              "Bu işlem geri alınamaz. FitMemory hesabını silmek istiyor musun?",
              [
                { text: "Vazgeç", style: "cancel" },
                {
                  text: "Kalıcı olarak sil",
                  style: "destructive",
                  onPress: () => void session.deleteAccount(),
                },
              ],
            );
          },
        },
      ],
    );
  };

  const initials = (session.account?.displayName ?? "FM")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toLocaleUpperCase("tr-TR");

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <SectionTitle eyebrow="Hesap & ölçüler" title="Profilim" />
      <Card style={styles.account}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={styles.accountCopy}>
          <Text style={styles.accountName}>
            {session.account?.displayName}
          </Text>
          <Text style={styles.accountEmail}>{session.account?.email}</Text>
        </View>
        <View style={styles.online}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>BAĞLI</Text>
        </View>
      </Card>

      {!session.profile ? (
        <View style={styles.onboarding}>
          <Text style={styles.onboardingTitle}>Önce beden haritanı çıkar.</Text>
          <Text style={styles.onboardingCopy}>
            Ölçüleri santimetre olarak gir. Omuz, göğüs ve bel çevre ölçüsüdür.
          </Text>
        </View>
      ) : null}

      {session.profile && !editingMeasurements ? (
        <Card style={styles.measurementSummary}>
          <View style={styles.measurementSummaryHead}>
            <View>
              <Text style={styles.formTitle}>VÜCUT ÖLÇÜLERİ</Text>
              <Text style={styles.measurementSummaryTitle}>
                Beden haritan kayıtlı
              </Text>
            </View>
            <Pressable
              onPress={() => setEditingMeasurements(true)}
              style={styles.editMeasurements}
            >
              <Text style={styles.editMeasurementsText}>Düzenle</Text>
            </Pressable>
          </View>
          <Text style={styles.measurementSummaryText}>
            {session.profile.age} yaş · {session.profile.heightCm} cm · {session.profile.weightKg} kg
          </Text>
          <Text style={styles.measurementSummaryMeta}>
            Omuz {shoulderCircumferenceCm(session.profile.shoulderWidthCm)} · Göğüs {session.profile.chestCircumferenceCm} · Bel {session.profile.waistCircumferenceCm} cm
          </Text>
        </Card>
      ) : (
      <Card style={styles.formCard}>
        <Text style={styles.formTitle}>VÜCUT ÖLÇÜLERİ</Text>
        <View style={styles.row}>
          <View style={styles.half}>
            <Field
              keyboardType="number-pad"
              label="Yaş"
              onChangeText={(value) => set("age", value)}
              placeholder=""
              value={form.age}
            />
          </View>
          <View style={styles.half}>
            <Field
              keyboardType="decimal-pad"
              label="Boy · cm"
              onChangeText={(value) => set("height", value)}
              placeholder=""
              value={form.height}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.half}>
            <Field
              keyboardType="decimal-pad"
              label="Kilo · kg"
              onChangeText={(value) => set("weight", value)}
              placeholder=""
              value={form.weight}
            />
          </View>
          <View style={styles.half}>
            <Field
              hint="Çevre ölçüsü"
              keyboardType="decimal-pad"
              label="Omuz çevresi · cm"
              onChangeText={(value) => set("shoulder", value)}
              placeholder=""
              value={form.shoulder}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.half}>
            <Field
              hint="Çevre ölçüsü"
              keyboardType="decimal-pad"
              label="Göğüs · cm"
              onChangeText={(value) => set("chest", value)}
              placeholder=""
              value={form.chest}
            />
          </View>
          <View style={styles.half}>
            <Field
              hint="Çevre ölçüsü"
              keyboardType="decimal-pad"
              label="Bel · cm"
              onChangeText={(value) => set("waist", value)}
              placeholder=""
              value={form.waist}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.half}>
            <Field
              keyboardType="decimal-pad"
              label="Ayak · cm"
              onChangeText={(value) => set("foot", value)}
              placeholder=""
              value={form.foot}
            />
          </View>
          <View style={styles.half}>
            <Field
              keyboardType="decimal-pad"
              label="EU numara"
              onChangeText={(value) => set("shoe", value)}
              placeholder=""
              value={form.shoe}
            />
          </View>
        </View>

        <Text style={styles.formTitle}>TERCİH EDİLEN SİLÜET</Text>
        <View style={styles.preferences}>
          {preferences.map((preference) => (
            <Pressable
              key={preference.value}
              onPress={() => {
                dirtyRef.current = true;
                setForm((current) => ({
                  ...current,
                  preference: preference.value,
                }));
              }}
              style={[
                styles.preference,
                form.preference === preference.value &&
                  styles.preferenceActive,
              ]}
            >
              <View
                style={[
                  styles.radio,
                  form.preference === preference.value &&
                    styles.radioActive,
                ]}
              >
                {form.preference === preference.value ? (
                  <View style={styles.radioCore} />
                ) : null}
              </View>
              <View>
                <Text style={styles.preferenceLabel}>
                  {preference.label}
                </Text>
                <Text style={styles.preferenceCopy}>
                  {preference.copy}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        {error ? (
          <ErrorNotice message={error} onDismiss={() => setError("")} />
        ) : null}
        {success ? <Text style={styles.success}>{success}</Text> : null}
        <Button
          busy={saving}
          label="Profili kaydet"
          onPress={() => void save()}
          tone="blue"
        />
        {session.profile ? (
          <Button label="Düzenlemeden çık" onPress={closeMeasurementEditor} tone="light" />
        ) : null}
      </Card>
      )}

      <Card style={styles.security}>
        <Text style={styles.securityMark}>✓</Text>
        <View style={styles.securityCopy}>
          <Text style={styles.securityTitle}>Güvenli mobil oturum</Text>
          <Text style={styles.securityText}>
            Erişim anahtarı cihazın şifreli kasasında, dolap verileri hesapla
            ilişkili merkezi veritabanında tutulur.
          </Text>
        </View>
      </Card>
      <Card style={styles.settingsCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: settingsOpen }}
          onPress={() => setSettingsOpen((current) => !current)}
          style={styles.settingsToggle}
        >
          <View style={styles.settingsIcon}>
            <Text style={styles.settingsIconText}>⚙</Text>
          </View>
          <View style={styles.settingsCopy}>
            <Text style={styles.settingsTitle}>Ayarlar</Text>
            <Text style={styles.settingsSubtitle}>Dil ve hesap yönetimi</Text>
          </View>
          <Text style={styles.settingsChevron}>{settingsOpen ? "⌃" : "⌄"}</Text>
        </Pressable>
        {settingsOpen ? (
          <View style={styles.settingsBody}>
            <View style={styles.languageRow}>
              <View style={styles.settingsCopy}>
                <Text style={styles.settingLabel}>Dil tercihi</Text>
                <Text style={styles.settingHint}>Uygulama ve AI yanıt dili</Text>
              </View>
              <LanguageSwitch compact />
            </View>
            <View style={styles.settingsDivider} />
            <View style={styles.serverCard}>
              <View style={styles.serverHead}>
                <Text style={styles.formTitle}>API SUNUCUSU</Text>
                <Text style={styles.serverTag}>GELİŞTİRİCİ</Text>
              </View>
              <Field
                autoCapitalize="none"
                autoCorrect={false}
                hint="Beta ve üretim sunucusu: https://fitmemory-api.onrender.com"
                keyboardType="url"
                label="Adres"
                onChangeText={setApiUrl}
                value={apiUrl}
              />
              <Button busy={testingApi} label="Değişikliği doğrula" onPress={confirmApiChange} small tone="light" />
            </View>
            <View style={styles.settingsDivider} />
            <Pressable onPress={logout} style={styles.logout}>
              <View style={styles.logoutCopy}>
                <Text style={styles.settingLabel}>Oturumu kapat</Text>
                <Text style={styles.settingHint}>
                  Dolabın ve profilin hesabında saklanmaya devam eder
                </Text>
              </View>
              <Text style={styles.logoutText}>Çıkış yap</Text>
            </Pressable>
            <View style={styles.settingsDivider} />
            <Pressable onPress={deleteAccount} style={styles.deleteAccount}>
              <Text style={styles.deleteAccountText}>Hesabımı ve verilerimi sil</Text>
            </Pressable>
          </View>
        ) : null}
      </Card>
      <Card style={styles.security}>
        <Text style={styles.securityMark}>i</Text>
        <View style={styles.securityCopy}>
          <Text style={styles.securityTitle}>Bağımsız platform bildirimi</Text>
          <Text style={styles.securityText}>
            FitMemory bağımsız bir platformdur. Uygulama içerisinde yer alan 3. taraf markalar ve logolar ilgili şirketlerin kendi tescilli mülkiyetindedir ve yalnızca yönlendirme (navigasyon) amacıyla kullanılmıştır. FitMemory'nin bu markalarla resmi bir bağı bulunmamaktadır.
          </Text>
        </View>
      </Card>
      <View style={styles.footerBrand}>
        <Brand compact />
        <Text style={styles.version}>Mobil · 1.25.15</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 15,
    paddingBottom: 110,
    paddingHorizontal: 20,
    paddingTop: 26,
  },
  account: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: 10,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  avatarText: {
    color: colors.card,
    fontSize: 14,
    fontWeight: "900",
  },
  accountCopy: {
    flex: 1,
  },
  accountName: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900",
  },
  accountEmail: {
    color: colors.muted,
    fontSize: 10.5,
    marginTop: 3,
  },
  online: {
    alignItems: "center",
    backgroundColor: colors.greenSoft,
    borderRadius: 20,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  onlineDot: {
    backgroundColor: colors.green,
    borderRadius: 4,
    height: 6,
    width: 6,
  },
  onlineText: {
    color: colors.green,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  onboarding: {
    backgroundColor: colors.orangeSoft,
    borderColor: "#F7CDBB",
    borderRadius: 14,
    borderWidth: 1,
    padding: 15,
  },
  onboardingTitle: {
    color: "#8C3D20",
    fontSize: 14,
    fontWeight: "900",
  },
  onboardingCopy: {
    color: "#93533A",
    fontSize: 11.5,
    lineHeight: 18,
    marginTop: 5,
  },
  formCard: {
    gap: 15,
  },
  measurementSummary: {
    gap: 8,
    padding: 15,
  },
  measurementSummaryHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  measurementSummaryTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 4,
  },
  measurementSummaryText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "700",
  },
  measurementSummaryMeta: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 15,
  },
  editMeasurements: {
    backgroundColor: colors.blueSoft,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editMeasurementsText: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: "900",
  },
  formTitle: {
    color: colors.blue,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  half: {
    flex: 1,
  },
  preferences: {
    gap: 8,
  },
  preference: {
    alignItems: "center",
    backgroundColor: "#F8F7F3",
    borderColor: colors.line,
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: "row",
    gap: 11,
    minHeight: 58,
    paddingHorizontal: 13,
  },
  preferenceActive: {
    backgroundColor: colors.blueSoft,
    borderColor: "#A7B9F7",
  },
  radio: {
    alignItems: "center",
    borderColor: "#A9A69E",
    borderRadius: 10,
    borderWidth: 1,
    height: 19,
    justifyContent: "center",
    width: 19,
  },
  radioActive: {
    borderColor: colors.blue,
  },
  radioCore: {
    backgroundColor: colors.blue,
    borderRadius: 5,
    height: 9,
    width: 9,
  },
  preferenceLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
  },
  preferenceCopy: {
    color: colors.muted,
    fontSize: 9.5,
    marginTop: 2,
  },
  success: {
    backgroundColor: colors.greenSoft,
    borderRadius: 9,
    color: colors.green,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    padding: 11,
  },
  serverCard: {
    gap: 13,
  },
  serverHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  serverTag: {
    backgroundColor: "#EEECE6",
    borderRadius: 12,
    color: colors.muted,
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  security: {
    alignItems: "flex-start",
    backgroundColor: colors.greenSoft,
    borderColor: "#B9E3D0",
    flexDirection: "row",
    gap: 11,
  },
  securityMark: {
    color: colors.green,
    fontSize: 17,
    fontWeight: "900",
  },
  securityCopy: {
    flex: 1,
  },
  securityTitle: {
    color: colors.green,
    fontSize: 11,
    fontWeight: "900",
  },
  securityText: {
    color: "#3F6E5A",
    fontSize: 10.5,
    lineHeight: 16,
    marginTop: 4,
  },
  logout: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    minHeight: 48,
  },
  logoutCopy: { flex: 1 },
  logoutText: {
    color: colors.red,
    fontSize: 11,
    fontWeight: "800",
  },
  settingsCard: {
    padding: 0,
    overflow: "hidden",
  },
  settingsToggle: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 68,
    paddingHorizontal: 16,
  },
  settingsIcon: {
    alignItems: "center",
    backgroundColor: colors.paper,
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    marginRight: 12,
    width: 36,
  },
  settingsIconText: { color: colors.ink, fontSize: 16 },
  settingsCopy: { flex: 1 },
  settingsTitle: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  settingsSubtitle: { color: colors.muted, fontSize: 10.5, marginTop: 3 },
  settingsChevron: { color: colors.muted, fontSize: 16, fontWeight: "700" },
  settingsBody: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: 16,
    padding: 16,
  },
  languageRow: { alignItems: "center", flexDirection: "row", gap: 14 },
  settingLabel: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  settingHint: { color: colors.muted, fontSize: 10, marginTop: 3 },
  settingsDivider: { backgroundColor: colors.line, height: 1 },
  deleteAccount: {
    alignItems: "center",
    borderColor: "#E5B8B5",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  deleteAccountText: {
    color: colors.red,
    fontSize: 12,
    fontWeight: "800",
  },
  footerBrand: {
    alignItems: "center",
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 18,
  },
  version: {
    color: colors.muted,
    fontSize: 9,
  },
});
