import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Pressable,
  StyleSheet,
  Text as NativeText,
  type TextProps,
  View,
} from "react-native";
import { colors } from "./theme";

export type Language = "tr" | "en";

const LANGUAGE_KEY = "fitmemory.language.v1";

const english: Record<string, string> = {
  "Beden": "Size",
  "Stüdyo": "Studio",
  "Dolabım": "Closet",
  "Profil": "Profile",
  "HESABIN BAĞLI": "ACCOUNT CONNECTED",
  "Dolabın açılıyor": "Opening your closet",
  "Hazırlanıyor": "Getting ready",
  "KALIBIN.": "YOUR CUT.",
  "DOLABIN.": "YOUR CLOSET.",
  "SENİN VERİN.": "YOUR DATA.",
  "KALIBINI HATIRLAR": "REMEMBERS YOUR FIT",
  "KİŞİSEL KALIP HAFIZASI": "PERSONAL FIT MEMORY",
  "Bedenini ezbere değil, veriye göre seç.": "Choose your size from evidence, not guesswork.",
  "Geçmiş kıyafetlerin, gerçek uyum notların ve ürünün kesimi aynı hesapta buluşur.": "Your past clothes, real fit feedback and each product's cut come together in one account.",
  "Oturum anahtarın cihazın güvenli kasasında tutulur. Mağaza şifrelerin FitMemory sunucusuna gönderilmez.": "Your session is kept in your device's secure storage. Store passwords are never sent to FitMemory.",
  "İşlem tamamlanamadı": "Could not complete the action",
  "Giriş yap": "Sign in",
  "Hesap oluştur": "Create account",
  "Hesabıma gir": "Sign in",
  "Hesabımı oluştur": "Create my account",
  "Adın": "Name",
  "E-posta": "Email",
  "Şifre": "Password",
  "Şifre tekrar": "Confirm password",
  "Şifreni tekrar yaz": "Enter your password again",
  "En az 8 karakter": "At least 8 characters",
  "sen@example.com": "you@example.com",
  "Geçerli e-posta ve en az 8 karakterlik şifre gir.": "Enter a valid email and a password of at least 8 characters.",
  "Adın en az 2 karakter olmalı.": "Your name must be at least 2 characters.",
  "Şifreler aynı değil.": "Passwords do not match.",
  "Şifre en az bir harf ve bir rakam içermeli.": "Password must contain at least one letter and one number.",
  "Hesap işlemi başarısız.": "Account operation failed.",
  "Bedenini bul.": "Find your size.",
  "Mağazalar": "Stores",
  "Mağaza tarayıcısını aç": "Open store browser",
  "Önce profilini tamamla": "Complete your profile first",
  "Tarayıcıyı kapat": "Close browser",
  "Sayfaya git": "Go to page",
  "Geri": "Back",
  "Ürününü tara": "Scan product",
  "Siparişi tara": "Scan orders",
  "BEDEN": "SIZE",
  "KANIT GÜVENİ": "EVIDENCE CONFIDENCE",
  "AI'ın yeniden tartmasını istediğin detay…": "Add a detail you want the AI to reconsider…",
  "Yeniden düşün": "Reconsider",
  "Kombin için ayır": "Save for an outfit",
  "Ürünü kaydet": "Save product",
  "Kaydedildi": "Saved",
  "Kaydedilenler": "Saved",
  "DOLAPTAN KOMBİN": "CLOSET OUTFIT",
  "Stüdyodaki gibi, dolabındakilerle dene": "Try outfits from your closet",
  "Dolabındakilerle kombin kur": "Build an outfit from your closet",
  "Seçilenlerle kombin yap": "Make an outfit from the selection",
  "Kombini kaydet": "Save outfit",
  "En az iki parça seç veya nasıl görünmek istediğini yaz.": "Select at least two pieces or write how you want to look.",
  "Henüz kayıt yok": "No saved products yet",
  "Kayıttan çıkar": "Remove from saved",
  "Stüdyo → Kaydedilenler sekmesine eklendi.": "Added to Studio → Saved.",
  "Taradığın ürünler burada durur. Fotoğrafa dokununca mağaza sayfası açılır.": "Your saved products stay here. Tap the photo to open the store page.",
  "Ürün kaydedilemedi.": "The product could not be saved.",
  "Açık panelde yalnız seçili bedenin milimleri okundu; diğer bedenler toplanamadı. Ölçü tablosunu açık bırakıp tekrar dene.": "Only the selected size was read from the open panel; the other sizes were not collected. Keep the chart open and try again.",
  "Ürün ölçüleri okundu ama bu kalıpta ölçülerinle güvenle örtüşen bir beden bulunamadı. Tablodaki komşu bedenleri kontrol edip tekrar dene.": "The measurements were read, but no size in this cut safely matches yours. Check the neighbouring sizes on the chart and try again.",
  "Favoriler": "Favorites",
  "Favori kombin yok": "No favorite outfits yet",
  "Kombini favorilere ekle": "Add outfit to favorites",
  "Favoriden çıkar": "Remove favorite",
  "Stüdyoda": "In studio",
  "Beden tablosu ve kalıp okunuyor": "Reading size chart and fit",
  "Görünür siparişler hazırlanıyor": "Preparing visible orders",
  "Ölçüler ve dolabın karşılaştırılıyor": "Comparing measurements with your closet",
  "AI kalıp, dikiş ve etiketleri denetliyor": "AI is checking cut, construction and fit labels",
  "AI denetimi tamamlandı": "AI review finished",
  "AI'ya ulaşılamadı; yerel taslak korundu": "AI was unreachable; the local draft was kept",
  "Siparişler araştırılıyor ve dolabına ekleniyor": "Researching orders and adding them to your closet",
  "Notunla birlikte yeniden düşünüyor": "Reconsidering with your note",
  "Yeniden değerlendirme için kısa bir detay yaz.": "Add a short detail before reconsidering.",
  "Öneri yeniden değerlendirilemedi.": "The recommendation could not be reconsidered.",
  "Tarama tamamlanamadı.": "The scan could not be completed.",
  "Parça stüdyoya eklenemedi.": "The item could not be added to the studio.",
  "Dolabım.": "My closet.",
  "Dolabın henüz boş": "Your closet is empty",
  "İadeler": "Returns",
  "Tişört & Üst": "T-shirts & Tops",
  "Pantolon & Jean": "Trousers & Jeans",
  "Ceket & Dış giyim": "Jackets & Outerwear",
  "Gömlek": "Shirts",
  "Triko": "Knitwear",
  "Elbise": "Dresses",
  "Ayakkabı": "Shoes",
  "Diğer": "Other",
  "İyi uyum · tutuldu": "Good fit · kept",
  "Bol geldi · dolapta": "Too loose · in closet",
  "Dar geldi · dolapta": "Too tight · in closet",
  "İade · bol geldi": "Returned · too loose",
  "İade · dar geldi": "Returned · too tight",
  "Henüz değerlendirilmedi": "Not rated yet",
  "Değerlendir": "Rate fit",
  "Düzenle": "Edit",
  "Dolaptan sil": "Remove from closet",
  "Sil": "Delete",
  "Vazgeç": "Cancel",
  "Bol geldi": "Too loose",
  "Dar geldi": "Too tight",
  "Uyum hafızasına kaydet": "Save to fit memory",
  "Örn. Belden tam, baldırdan biraz dar; boyu iyi.": "Example: Good at the waist, slightly tight at the calf; length is good.",
  "Kombin Stüdyosu.": "Outfit Studio.",
  "Stüdyo boş": "Studio is empty",
  "Stüdyoyu boşalt": "Clear studio",
  "Tamamını çıkar": "Remove all",
  "En az 2 farklı kategori seç": "Select at least 2 different categories",
  "Stilist yorumunu al": "Get stylist feedback",
  "Tek parça": "Single item",
  "Almadan önce dene": "Try before you buy",
  "Bir ürün taradıktan sonra “Kombin için ayır” seçeneğine dokun.": "After scanning a product, tap “Save for an outfit”.",
  "Kombin yorumlanamadı.": "The outfit could not be reviewed.",
  "Parça seçilemedi.": "The item could not be selected.",
  "Parça silinemedi.": "The item could not be removed.",
  "Stüdyo boşaltılamadı.": "The studio could not be cleared.",
  "Profilim.": "My profile.",
  "Profilim": "My profile",
  "Kombin Stüdyosu": "Outfit Studio",
  "AI KOMBİN ASİSTANI": "AI OUTFIT ASSISTANT",
  "BAĞLI": "CONNECTED",
  "Önce beden haritanı çıkar.": "Create your body map first.",
  "Ölçüleri santimetre olarak gir. Omuz, göğüs ve bel çevre ölçüsüdür.": "Enter measurements in centimetres. Shoulder, chest and waist are circumferences.",
  "VÜCUT ÖLÇÜLERİ": "BODY MEASUREMENTS",
  "Beden haritan kayıtlı": "Your body map is saved",
  "Hesap & ölçüler": "Account & measurements",
  "Yaş": "Age",
  "Boy": "Height",
  "Kilo": "Weight",
  "Omuz": "Shoulders",
  "Göğüs": "Chest",
  "Bel": "Waist",
  "Ayak uzunluğu": "Foot length",
  "Ayakkabı numarası": "Shoe size",
  "Boy · cm": "Height · cm",
  "Kilo · kg": "Weight · kg",
  "Omuz · cm": "Shoulders · cm",
  "Omuz çevresi · cm": "Shoulder circumference · cm",
  "Çevre ölçüsü": "Circumference",
  "Göğüs · cm": "Chest · cm",
  "Bel · cm": "Waist · cm",
  "Profili kaydet": "Save profile",
  "Beden profilin güncellendi.": "Your fit profile has been updated.",
  "Ölçüler bu telefonda kaydoldu.": "Measurements are saved on this phone.",
  "Ölçüler bu telefonda kaydoldu; sunucu uyanınca senkronlanacak.": "Measurements are saved on this phone and will sync when the server wakes.",
  "Profil kaydedilemedi.": "The profile could not be saved.",
  "Bağlantıyı doğrula": "Verify connection",
  "API ADRESİ": "API ADDRESS",
  "Sunucu bağlantısı doğrulandı.": "Server connection verified.",
  "Sunucuya ulaşılamadı.": "Could not reach the server.",
  "Çıkış yap": "Sign out",
  "Hesaptan çık": "Sign out",
  "Hesabı kalıcı olarak sil": "Permanently delete account",
  "Hesabı sil": "Delete account",
  "Kalıcı olarak sil": "Delete permanently",
  "Kişisel kalıp hafızan": "Your personal fit memory",
  "TERCİH EDİLEN KALIP": "PREFERRED FIT",
  "Dengeli": "Balanced",
  "Oversize": "Oversized",
  "Vücuda yakın": "Fitted",
  "Biraz hareket payı olan": "With a little ease",
  "Bilinçli geniş silüet": "Intentionally roomy silhouette",
  "Vücuda oturan ama sıkmayan": "Close to the body without feeling tight",
  "Ölçüler": "Measurements",
  "Tercih edilen kalıp": "Preferred fit",
  "Türkçe": "Türkçe",
  "İngilizce": "English",
  "Dil": "Language",
  "Ayarlar": "Settings",
  "Dil ve hesap yönetimi": "Language and account management",
  "Dil tercihi": "Language preference",
  "Uygulama ve AI yanıt dili": "App and AI response language",
  "Hesabımı ve verilerimi sil": "Delete my account and data",
  "Hesaptan çıkış yap": "Sign out",
  "Şifremi unuttum": "Forgot password",
  "Şifreni yenile": "Reset your password",
  "Hesabındaki e-posta adresine 6 haneli, tek kullanımlık kod göndereceğiz.": "We will send a one-time 6-digit code to your account email.",
  "6 haneli kod": "6-digit code",
  "Yeni şifre": "New password",
  "Yeni şifre tekrar": "Confirm new password",
  "Kodu e-postama gönder": "Email me the code",
  "Şifremi yenile": "Reset my password",
  "Giriş ekranına dön": "Back to sign in",
  "Şifren yenilendi. Yeni şifrenle giriş yapabilirsin.": "Your password was reset. You can now sign in with your new password.",
  "AI KOMBİN YAPICI": "AI OUTFIT MAKER",
  "Bugün nasıl görünmek istiyorsun?": "How do you want to look today?",
  "Örn. Akşam yemeği için sade, rahat ve yaşımı yansıtan bir kombin.": "Example: A clean, comfortable dinner outfit that suits my age.",
  "Dolabımla kombin oluştur": "Create from my closet",
  "Yukarı kaydırarak kapat": "Swipe up to dismiss",
  "KALIBIN. DOLABIN. SENİN VERİN.": "YOUR FIT. YOUR CLOSET. YOUR DATA.",
};

type I18nContextValue = {
  ready: boolean;
  hasChosenLanguage: boolean;
  language: Language;
  setLanguage(language: Language): Promise<void>;
  translate(value: string): string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [hasChosenLanguage, setHasChosenLanguage] = useState(false);
  const [language, setLanguageState] = useState<Language>("tr");

  useEffect(() => {
    void SecureStore.getItemAsync(LANGUAGE_KEY)
      .then((stored) => {
        if (stored === "tr" || stored === "en") {
          setLanguageState(stored);
          setHasChosenLanguage(true);
        }
      })
      .finally(() => setReady(true));
  }, []);

  const setLanguage = useCallback(async (next: Language) => {
    setLanguageState(next);
    setHasChosenLanguage(true);
    await SecureStore.setItemAsync(LANGUAGE_KEY, next);
  }, []);

  const translate = useCallback(
    (value: string) => {
      if (language === "tr") return value;
      const exact = english[value.trim()];
      if (!exact) return value;
      const leading = value.match(/^\s*/)?.[0] ?? "";
      const trailing = value.match(/\s*$/)?.[0] ?? "";
      return `${leading}${exact}${trailing}`;
    },
    [language],
  );

  const value = useMemo(
    () => ({ ready, hasChosenLanguage, language, setLanguage, translate }),
    [hasChosenLanguage, language, ready, setLanguage, translate],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider.");
  return context;
}

function translateNode(node: ReactNode, translate: (value: string) => string): ReactNode {
  if (typeof node === "string") return translate(node);
  if (Array.isArray(node)) return node.map((item) => translateNode(item, translate));
  return node;
}

export function Text({ children, ...props }: TextProps) {
  const { translate } = useI18n();
  return <NativeText {...props}>{translateNode(children, translate)}</NativeText>;
}

export function LanguageSwitch({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage } = useI18n();
  return (
    <View accessibilityRole="tablist" style={[styles.languageSwitch, compact && styles.compact]}>
      {(["tr", "en"] as const).map((item) => {
        const active = item === language;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={item}
            onPress={() => void setLanguage(item)}
            style={[styles.languageOption, active && styles.languageOptionActive]}
          >
            <NativeText style={[styles.languageText, active && styles.languageTextActive]}>
              {item === "tr" ? "TR" : "EN"}
            </NativeText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  languageSwitch: {
    alignSelf: "flex-end",
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    padding: 3,
  },
  compact: { alignSelf: "auto" },
  languageOption: {
    alignItems: "center",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 30,
    minWidth: 38,
  },
  languageOptionActive: { backgroundColor: colors.ink },
  languageText: { color: colors.muted, fontSize: 10, fontWeight: "900" },
  languageTextActive: { color: colors.card },
});
