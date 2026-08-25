# FitMemory Expo Go (iOS / Android)

Aynı FitMemory arayüzü, Expo Go içinde. Native OCR yok; tarama DOM + Render API ile çalışır. Oturum telefonda kalır.

**Önemli:** Telefonda **Expo Go SDK 54** olmalı. App Store / Play Store’daki Expo Go eskiyse proje açılmaz. Expo Go içinde Hesap → SDK 54 görünmeli.

## Telefona yükle (QR)

1. Telefona **Expo Go** kur.
2. iPhone’da **Kamera** veya Expo Go içindeki **Scan QR code**.
3. Android’de doğrudan Expo Go’dan QR tara.
4. Aynı Wi‑Fi şart değil; **tunnel** adresi internet üzerinden açılır.
5. İlk açılışta Render uykudaysa giriş 1 dakikayı bulabilir. Oturum ve dolap bu telefonda e-postaya bağlı kasada durur; sunucu hesabı silinse bile aynı e-posta ve şifreyle girince ölçülerin geri yüklenir. Şifre kodu e-postaya gitmezse uygulamada görünür.

Bilgisayarında:

```bash
cd mobile-expo-go
pnpm install
EXPO_PUBLIC_API_BASE_URL=https://fitmemory-api.onrender.com pnpm start -- --tunnel
```

Terminaldeki `exp://...exp.direct` adresini Expo Go tarasın. QR kaybolursa aynı komutu yeniden çalıştır.

## Sipariş tarama

Pull&Bear / Bershka / Zara içinde **Siparişlerim**, **sipariş detayı** veya **Alışveriş özeti** sayfasını aç. Ürün adı, beden ve fiyat görünsün, sonra **Tara**.

## Expo hesabına OTA (fstudio)

```bash
npx eas-cli@latest login
npx eas-cli@latest update --channel production --message "1.25.18"
```

Proje: https://expo.dev/accounts/fstudio/projects/fitmemory-go  
`runtimeVersion`: `exposdk:54.0.0`

## Render

Mobil hesaplar `.NET` FitMemory API + Postgres üzerindedir. Render panelinden **Manual Deploy** (Clear build cache kapalı) ile `main` alınır:

https://dashboard.render.com/web/srv-d9gds137uimc73esn7ag

Bu Cursor git uzak ucu Render’ın GitHub bağlantısı değildir; panelden deploy gerekir.

Sayfa okuma **Playwright ajanı** yalnız Zara / Pull&Bear **ürün** URL’leri içindir (`POST /api/product-scans/agent`). **Tara / sipariş** taraması ajan değil; açık sayfadaki DOM + metin okuyucusudur. Ajan Render uyuyorsa cevap vermez; sipariş eklemek için ajan gerekmez.
