# FitMemory Mobil

Expo SDK 57 tabanlı Android/iOS istemcisidir. Chrome uzantısıyla aynı backend
hesabını kullanır; profil, dolap, uyum notları ve Kombin Stüdyosu iki cihazda
aynı kalır.

## Çalıştırma

```powershell
pnpm install
pnpm start
```

Varsayılan geliştirme API adresleri:

- Android emülatörü: `http://10.0.2.2:5158`
- iOS simülatörü: `http://localhost:5158`
- Fiziksel cihaz: Profil ekranından bilgisayarın LAN adresini girin
  (`http://192.168.x.x:5158`)
- Üretim: `EXPO_PUBLIC_API_BASE_URL=https://fitmemory-api.onrender.com`

Üretim adresiyle başlatma örneği:

```powershell
$env:EXPO_PUBLIC_API_BASE_URL="https://fitmemory-api.onrender.com"
pnpm start
```

## Mobil akış

1. FitMemory hesabına giriş yapın veya hesap oluşturun.
2. Profilde yaş, boy, kilo, omuz, göğüs çevresi, bel çevresi, ayak uzunluğu,
   EU ayakkabı numarası ve tercih edilen silüeti kaydedin.
3. **Beden** sekmesinde mağaza tarayıcısını açın.
4. Ürün sayfasındaki beden rehberini görünür hale getirip **Ürünü tara**ya
   basın.
5. Sipariş sayfasında ürün kartları görünürken **Sipariş**e basarak dolabı
   aktarın.
6. Taradığınız ama almadığınız parçayı **Kombin için ayır** ile Stüdyo'ya
   gönderin.

## Güvenlik

- FitMemory bearer token'ı `expo-secure-store` içinde saklanır.
- Mağaza oturumu ve çerezleri WebView içinde kalır.
- Ürün tarayıcısına yalnızca kullanıcı düğmeye bastığında scanner JavaScript'i
  enjekte edilir.
- Sipariş ekran görüntüsünde hassas metin alanları görüntü yakalanmadan önce
  karartılır; görüntü alındıktan hemen sonra karartmalar sayfadan kaldırılır.
- API anahtarı mobil pakette bulunmaz.

## Doğrulama

```powershell
pnpm typecheck
pnpm exec expo export --platform android
```

## Dağıtım notu

Google Play ve App Store için son aşamada Expo Application Services veya yerel
native build kullanılabilir. Mağaza paketi oluşturulmadan önce:

- `app.json` içindeki bundle/package kimliklerini kesinleştirin.
- Üretim API adresini HTTPS yapın.
- Gizlilik politikası ve hesap/veri silme akışını yayınlayın.
- Android/iOS gerçek cihazlarda Pull&Bear, Bershka ve Zara oturum/tarama
  akışlarını yeniden doğrulayın.

Android Studio kurmadan telefona yüklenebilir beta APK üretmek için bir Expo
hesabıyla:

```powershell
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview
```

`preview` profili indirilebilir APK, `production` profili mağaza paketi üretir.
İlk `build:configure` çalıştırması Expo proje kimliğini `app.json` dosyasına
ekler; bu kimlik Expo hesabına bağlı olduğundan kaynak kodda önceden
uydurulmamıştır.
