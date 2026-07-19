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
  ve AI iletişimini yönetir. Yerelde SQLite, üretimde PostgreSQL kullanır.

AI anahtarları uzantıya veya mobil uygulamaya gömülmez. Yalnızca backend
ortam değişkenlerinde tutulur.

## Klasörler

```text
fitmemory/
├── backend/                  ASP.NET Core API
├── extension/                Chrome Manifest V3 uzantısı
├── mobile/                   Expo React Native uygulaması
├── migration/
│   └── FitMemory.Migrate/    SQLite → PostgreSQL taşıma aracı
├── deploy/                   Docker Compose, PostgreSQL, Caddy ve yedekleme
├── Directory.Build.props
└── FitMemory.sln
```

## Yerel backend

Gereksinim: .NET 10 SDK.

```powershell
dotnet user-secrets set "Gemini:ApiKey" "KENDI_ANAHTARINIZ" --project .\backend\FitMemory.Api.csproj
dotnet run --project .\backend\FitMemory.Api.csproj --launch-profile http
```

API `http://localhost:5158`, sağlık kontrolü
`http://localhost:5158/health` adresindedir. Yerel veriler
`backend/fitmemory.db` dosyasına yazılır.

Telefonun aynı Wi-Fi ağından yerel API'ye ulaşması için backend'i bütün ağ
arayüzlerinde başlatın:

```powershell
dotnet run --project .\backend\FitMemory.Api.csproj --urls http://0.0.0.0:5158
```

Windows Güvenlik Duvarı yalnızca özel ağ için izin istemelidir. Mobil Profil
ekranındaki API adresini bilgisayarın yerel IP'siyle girin:
`http://192.168.x.x:5158`. Android emülatörü için varsayılan adres
`http://10.0.2.2:5158`, iOS simülatörü için `http://localhost:5158` olur.

## Chrome uzantısı

1. Chrome'da `chrome://extensions` sayfasını açın.
2. **Geliştirici modu**nu açın.
3. **Paketlenmemiş öğe yükle** ile `extension` klasörünü seçin.
4. FitMemory simgesini sabitleyin.
5. Profil ekranındaki API adresini yerel veya üretim API adresi yapın.

Uzantının derlenmiş CSS'i hazırdır. CSS'i yeniden üretmek için:

```powershell
cd .\extension
pnpm install
pnpm run build
```

## Mobil uygulama

Gereksinim: Node.js 22.13 veya daha yeni, pnpm ve Android Studio ya da Xcode.

```powershell
cd .\mobile
pnpm install
pnpm start
```

Ardından terminalde:

- Android emülatörü için `a`
- iOS simülatörü için `i` (yalnızca macOS)
- Fiziksel cihaz için ekrandaki QR kod

Mobil uygulamadaki mağaza oturumu WebView içinde kalır. Mağaza şifresi ve
çerezleri FitMemory API'ye gönderilmez. Sipariş aktarımında e-posta, telefon,
adres, ödeme ve sipariş numarası alanları ekran görüntüsünden önce karartılır;
DOM metni ayrıca cihazda ayıklanır. FitMemory erişim anahtarı cihazın şifreli
SecureStore alanında tutulur.

Ayrıntılar: [mobile/README.md](mobile/README.md)

## Üretim sunucusu

Gereksinim: Linux sunucu, Docker Engine, Docker Compose ve DNS yönetimi.
Bu kurulumun üretim API adresi
`https://api.mfurkangokbag.com.tr` olarak sabitlenmiştir.

```bash
cd deploy
cp .env.example .env
# .env içindeki domain, PostgreSQL parolası ve AI anahtarını doldurun.
docker compose up -d --build
```

Caddy, `API_DOMAIN` için TLS sertifikasını otomatik alır ve yalnızca HTTPS
üzerinden API'yi yayınlar. PostgreSQL doğrudan internete port açmaz.

Ayrıntılar ve geçiş sırası: [deploy/README.md](deploy/README.md)

## Yerel dolabı PostgreSQL'e taşıma

Önce `backend/fitmemory.db` dosyasının ayrıca bir kopyasını alın. Üretim
sunucusundaki `deploy` klasöründe:

```bash
docker compose up -d postgres
docker compose --profile tools run --rm migrate
docker compose up -d api caddy
```

Taşıma aracı hedef PostgreSQL boş değilse işlemi durdurur. Hedefi bilinçli
olarak tamamen değiştirmeniz gerekiyorsa komuta `--replace` ekleyin.

Yerel makineden doğrudan çalıştırmak da mümkündür:

```powershell
dotnet run --project .\migration\FitMemory.Migrate -- `
  --sqlite .\backend\fitmemory.db `
  --postgres "Host=SUNUCU;Database=fitmemory;Username=fitmemory;Password=PAROLA"
```

Hesaplar, parola özetleri, profiller, aktif oturumlar, dolap parçaları, uyum
notları, öneri geçmişi ve Stüdyo parçaları birlikte taşınır. Açık metin parola
taşınmaz; sistem zaten parola özeti saklar.

## Yedekleme

Linux sunucuda:

```bash
cd deploy
chmod +x backup.sh
./backup.sh
```

Yedekler `deploy/backups` altında sıkıştırılmış PostgreSQL dökümü olarak
oluşur, bütünlüğü `gzip -t` ile doğrulanır ve varsayılan olarak 30 gün tutulur.
Günlük çalıştırmak için sunucunun cron/systemd zamanlayıcısına eklenmelidir.

## Doğrulama

```powershell
dotnet build .\FitMemory.sln --configuration Release

cd .\mobile
pnpm typecheck

node --check ..\extension\background.js
node --check ..\extension\content.js
node --check ..\extension\popup.js
```

## Güvenlik sınırları

- Tüm kullanıcı verisi bir `UserAccount` ve ona ait `UserProfile` ile
  ilişkilidir; başka hesabın `userId` değeriyle istek `403` döndürür.
- Parolalar ASP.NET Core `PasswordHasher` ile özetlenir.
- Oturum anahtarının yalnızca SHA-256 özeti veritabanında tutulur.
- API anahtarları yalnızca backend ortamında bulunur.
- Üretimde PostgreSQL ve API container ağı içinde kalır; dışarı Caddy'nin
  80/443 portları açılır.
- `.env`, veritabanları, yedekler, loglar ve `node_modules` Git'e alınmaz.
- Genel internete açılmadan önce e-posta doğrulama, şifre sıfırlama, merkezi
  log/izleme ve harici yedek hedefi eklenmelidir.
