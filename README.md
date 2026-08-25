# FitMemory

FitMemory, farklı marka ve kalıplardaki beden tutarsızlığını kullanıcının gerçek
dolap geçmişiyle karşılaştıran bir beden ve kombin asistanıdır.

Proje üç istemci/servis katmanından oluşur:

- Manifest V3 Chrome uzantısı: aktif ürünün beden tablosunu ve mağazadaki
  görünür siparişleri tarar.
- Expo + React Native mobil uygulama: aynı hesap, dolap, profil ve Kombin
  Stüdyosu'nu Android/iOS'a taşır; mağaza sayfalarını uygulama içi tarayıcıda
  açıp tarar.
- ASP.NET Core API: hesapları, profilleri, uyum hafızasını, beden önerilerini
  ve AI iletişimini yönetir. Yerelde SQLite kullanır. Üretimde PostgreSQL
  açıksa ona bağlanır; proje silinmiş veya ulaşılamıyorsa aynı API dosya
  tabanına düşer ve beden önerisi çalışmayı sürdürür.

AI anahtarları uzantıya veya mobil uygulamaya gömülmez. Yalnızca backend
ortam değişkenlerinde tutulur.

Yerel ölçü motoru ilk taslağı üretir. AI son denetleyicidir: ürünün kalıp,
dikiş, kesim ve FitLabel etiketlerini taslakla birlikte tartıp nihai bedeni
seçer. Aynı kesimde daha önce alınan beden ("M almıştı, şöyle olmuştu")
AI'ya destek olarak gider; bedeni kilitlemez. Kombin yorumu ikincildir.
Fiziksel olarak imkânsız bir beden, güvenilirlik için AI tahmininin üstünde
tutulur.

Üretim API: `https://fitmemory-api.onrender.com` (Docker, `backend/Dockerfile`).
Render, GitHub `ffureagle/fitmemory` `main` dalına bakıyorsa bu ağaçtaki
düzeltmelerin oraya push edilmesi gerekir. Node `api/` klasörü Render'a
bağlanmamalıdır.

## Klasörler

```text
fitmemory/
├── backend/                  ASP.NET Core API (üretim)
├── backend.tests/            .NET testleri
├── extension/                Chrome Manifest V3 uzantısı (1.25.8)
├── mobile/                   Expo React Native uygulaması
├── mobile-expo-go/           Expo Go istemcisi (1.25.16)
├── migration/
│   └── FitMemory.Migrate/    SQLite → PostgreSQL taşıma aracı
├── deploy/                   Docker Compose, PostgreSQL, Caddy ve yedekleme
├── demo/                     Yerel tarama ve Expo Go deneme sayfaları
├── Directory.Build.props
└── FitMemory.sln
```

## Yerel backend

Gereksinim: .NET 10 SDK.

```bash
dotnet user-secrets set "Gemini:ApiKey" "KENDI_ANAHTARINIZ" --project backend/FitMemory.Api.csproj
dotnet run --project backend/FitMemory.Api.csproj --urls http://0.0.0.0:43123
```

API `http://localhost:43123`, sağlık kontrolü
`http://localhost:43123/health` adresindedir. Yerel veriler
`backend/fitmemory.db` dosyasına yazılır.

Telefonun aynı Wi-Fi ağından yerel API'ye ulaşması için backend'i bütün ağ
arayüzlerinde başlatın (`0.0.0.0`). Mobil Profil ekranındaki API adresini
bilgisayarın yerel IP'siyle girin: `http://192.168.x.x:43123`. Android
emülatörü için varsayılan adres `http://10.0.2.2:43123`, iOS simülatörü
için `http://localhost:43123` olur.

## Chrome uzantısı

Chrome uzantısı hesap, profil ve yerel beden taslağını cihazda tutabilir.
Mobil ve AI denetimi üretimde Render'daki .NET API'yi kullanır.

1. Chrome'da `chrome://extensions` sayfasını açın.
2. **Geliştirici modu**nu açın.
3. **Paketlenmemiş öğe yükle** ile `extension` klasörünü seçin.
4. Yüklüyse karttaki **dairesel yenile**ye basın. **Kaldır** demeyin; Kaldır
   hesabı ve dolabı siler. Yeni zip’i her zaman **aynı klasörün** üzerine çıkarın.
5. FitMemory simgesini sabitleyin, hesap oluşturun ve profilini kaydedin.
   Oturum bu Chrome profilinde kalır; her açılışta yeniden giriş istenmez.
6. Bir ürün sayfasını açık tutun; yan panel **o sekmedeki** görünür beden
   tablosunu okur. Yapıştırma yoktur. Okumayı denemek için `demo/tee.html`
   dosyasını yerel bir HTTP sunucusunda açın, uzantıyı yeniden yükleyin ve
   ürün sekmesine geçin.
7. **Tara** için `Siparişlerim`, sipariş detayı veya **Alışveriş özeti** sayfasını
   açık tutun, profiliniz kayıtlı olsun, sonra yan panelde Tara’ya basın. Sürüm
   **1.25.8** olmalıdır.

Uzantının derlenmiş CSS'i hazırdır. CSS'i yeniden üretmek için:

```bash
cd extension
pnpm install
pnpm run build
```

## Mobil uygulama

Gereksinim: Node.js 22.13 veya daha yeni, pnpm ve Android Studio ya da Xcode.

Kullandığınız istemci Expo Go ise `mobile-expo-go` (sürüm **1.25.16**):

```bash
cd mobile-expo-go
pnpm install
EXPO_PUBLIC_API_BASE_URL=https://fitmemory-api.onrender.com pnpm start
```

Ardından Expo Go SDK 54 ile QR kodu okutun. Uygulamadan Zara / Bershka /
Pull&Bear'a girin ve ürün sayfasında Tara'ya basın. Ölçü tablosunu elle
açmanız gerekmez. Profil **Mobil · 1.25.16** görünmelidir.

Sunucu ücretsiz uyuyup hesap dosyasını silerse telefon aynı e-posta ile
yeniden girince ölçüleri ve dolabı yerel kasadan yükler. Şifre unuttum
kodu e-postaya gitmezse uygulamada büyük hanelerle gösterilir.

Mağaza oturumu WebView içinde kalır. Mağaza şifresi ve çerezleri FitMemory
API'ye gönderilmez. Ürün taraması ölçü panelini kendisi açar. Markanın göğüs
**çevresi** tablosu ile ürünün göğüs **eni** tablosu ayrı türlerdir; motor
ikisini birbirine çevirir.

Ayrıntılar: [mobile/README.md](mobile/README.md),
[mobile-expo-go/README.md](mobile-expo-go/README.md)

## Üretim sunucusu

Render web servisi **fitmemory-api**, runtime **Docker**, dosya
`./backend/Dockerfile` (resmi `aspnet:10.0` imajı). Playwright taban imajına
.NET 10 bindirmeyin; Render bunu status 139 ile düşürür. Node `api/` dizinine
geçmeyin.

Ücretsiz Render örneği uykuya yatar; ilk istek 50 saniyeden uzun sürebilir.
Kalıcı çözüm plan yükseltmektir. İstemciler önce `/health` ile uyandırır.

`render.yaml` içindeki eski Supabase proje kimliği artık yok. Postgres
yanıt vermezse API `/app/data/fitmemory.db` dosyasına yazar. Bu dosya
ücretsiz örnek uyuyunca silinebilir; kalıcı dolap için canlı bir
PostgreSQL adresi (`DATABASE_URL` veya `POSTGRES_HOST`) gerekir. Parolayı
sohbete yapıştırmayın, Render Environment ekranına yazın.

Eski kırmızı **Exited with status 139** kartı 1 Ağustos sürümüdür.
Onu yeniden başlatmayın ve Rollback yapmayın. Güncel imaj
`mcr.microsoft.com/dotnet/aspnet:10.0` kullanır.

Kendi Linux sunucunuz için:

```bash
cd deploy
cp .env.example .env
# .env içindeki domain, PostgreSQL parolası ve AI anahtarını doldurun.
docker compose up -d --build
```

Ayrıntılar: [deploy/README.md](deploy/README.md)

## Yerel dolabı PostgreSQL'e taşıma

Önce `backend/fitmemory.db` dosyasının ayrıca bir kopyasını alın.

```bash
dotnet run --project migration/FitMemory.Migrate -- \
  --sqlite backend/fitmemory.db \
  --postgres "Host=SUNUCU;Database=fitmemory;Username=fitmemory;Password=PAROLA"
```

## Doğrulama

```bash
dotnet test backend.tests/FitMemory.Api.Tests.csproj --configuration Release
node scripts/test-local-fit.mjs
node scripts/test-pants-fit.mjs
node scripts/test-render-runtime.mjs
node scripts/smoke-api.mjs
node --check extension/background.js
node --check extension/content.js
node --check extension/popup.js
```

## Güvenlik sınırları

- Tüm kullanıcı verisi bir `UserAccount` ve ona ait `UserProfile` ile
  ilişkilidir; başka hesabın `userId` değeriyle istek `403` döndürür.
- Parolalar ASP.NET Core `PasswordHasher` ile özetlenir.
- Oturum anahtarının yalnızca SHA-256 özeti veritabanında tutulur.
- API anahtarları yalnızca backend ortamında bulunur.
- `.env`, veritabanları, yedekler, loglar ve `node_modules` Git'e alınmaz.
