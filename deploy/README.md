# FitMemory Üretim Dağıtımı — Hetzner Cloud

Bu paket API, PostgreSQL ve otomatik HTTPS reverse proxy'yi aynı Docker Compose
ağında çalıştırır.

Hedef API:

```text
https://api.mfurkangokbag.com.tr
```

## 1. Hetzner VPS

Önerilen başlangıç sunucusu:

- Ubuntu 24.04 LTS
- En az 2 vCPU, 4 GB RAM ve 40 GB NVMe
- Hetzner Cloud Firewall: TCP 22 yalnızca yönetim IP'nizden; TCP 80 ve
  TCP/UDP 443 herkese açık
- 5432 portu kapalı

Projeyi sunucuya aldıktan sonra:

```bash
cd /opt/fitmemory/deploy
chmod +x prepare-hetzner-ubuntu.sh
sudo ./prepare-hetzner-ubuntu.sh
```

Betik Docker'ın resmi Ubuntu deposunu kullanır, Docker Compose'u kurar,
`ufw` üzerinde yalnızca SSH/HTTP/HTTPS'e izin verir ve
`/opt/fitmemory` dizinini hazırlar.

## 2. DNS

Hetzner Cloud panelindeki VPS'in public IPv4 adresini aldıktan sonra domain
panelinde şu kaydı oluşturun:

```text
Tür: A
Ad/Host: api
Değer: HETZNER_VPS_IPV4
TTL: 300
```

Ana domainin mevcut `77.245.159.120` kaydını değiştirmeyin. Yalnızca
`api.mfurkangokbag.com.tr` alt alanı Hetzner'e yönlenecek.

DNS kontrolü:

```bash
dig +short api.mfurkangokbag.com.tr A
```

Sonuç Hetzner VPS IPv4 adresi olmalıdır. Caddy, DNS doğru olduktan ve 80/443
portlarına erişebildikten sonra TLS sertifikasını otomatik alır.

## 3. Proje dosyaları

Projeyi `/opt/fitmemory` dizinine kopyalayın. Git kullanılıyorsa:

```bash
cd /opt
git clone PROJENIN_GIT_ADRESI fitmemory
cd /opt/fitmemory/deploy
```

Git kullanılmıyorsa proje klasörünü SCP/SFTP ile aynı konuma yükleyin.
`backend/fitmemory.db` dosyasının da sunucuya geldiğini doğrulayın.

## 4. Ortam dosyası

```bash
cd /opt/fitmemory/deploy
cp .env.example .env
chmod 600 .env
```

`.env` içinde:

- `API_DOMAIN=api.mfurkangokbag.com.tr`
- `APP_ORIGINS=https://mfurkangokbag.com.tr,https://www.mfurkangokbag.com.tr`
- `POSTGRES_PASSWORD`: en az 32 karakter rastgele parola
- `AI_PROVIDER`: `Gemini` veya `OpenAI`
- Seçilen sağlayıcının API anahtarı ve modeli

Güçlü PostgreSQL parolası üretmek için:

```bash
openssl rand -base64 36
```

Gerçek anahtarları `.env.example`, Git veya mesaj içine yazmayın.

## 5. Yerel dolabı PostgreSQL'e taşıma

Önce sunucudaki SQLite dosyasını yedekleyin:

```bash
cp /opt/fitmemory/backend/fitmemory.db \
  /opt/fitmemory/backend/fitmemory-before-postgres.db
```

Ardından:

```bash
cd /opt/fitmemory/deploy
docker compose up -d postgres
docker compose --profile tools run --rm migrate
```

Hedef PostgreSQL boş değilse taşıma aracı veri kaybını önlemek için durur.
Mevcut hedef veriyi bilinçli olarak SQLite kopyasıyla tamamen değiştirmek
gerekiyorsa:

```bash
docker compose --profile tools run --rm migrate --replace
```

## 6. API ve HTTPS

```bash
docker compose up -d --build api caddy
docker compose ps
curl https://api.mfurkangokbag.com.tr/health
```

Sağlık yanıtında:

```json
{
  "status": "healthy",
  "databaseHealthy": true,
  "aiConfigured": true
}
```

görülmelidir. `database` alanı Npgsql/PostgreSQL sağlayıcısını göstermelidir.

## 7. İstemcileri bağlama

- Yeni Chrome uzantısı kurulumları varsayılan olarak
  `https://api.mfurkangokbag.com.tr` kullanır.
- Daha önce kurulmuş uzantıda Profil → API adresini aynı URL yapın.
- EAS `preview` ve `production` mobil profilleri aynı API adresini paketler.
- Web paneli bağlandığında origin değerleri `.env` içindeki `APP_ORIGINS`
  listesinde hazırdır.

## 8. Yedekleme

```bash
chmod +x backup.sh
./backup.sh
```

Günlük cron:

```cron
20 3 * * * /opt/fitmemory/deploy/backup.sh >> /var/log/fitmemory-backup.log 2>&1
```

Yedekleri yalnızca aynı VPS'te bırakmayın. Şifreli Hetzner Storage Box veya
başka fiziksel hedefe ikinci kopya gönderin. Geri yüklemeyi üretimden ayrı bir
PostgreSQL örneğinde düzenli olarak test edin.

## Güncelleme

```bash
cd /opt/fitmemory/deploy
./backup.sh
docker compose build api
docker compose up -d api
curl https://api.mfurkangokbag.com.tr/health
```

`docker compose down -v` kullanmayın; `-v` PostgreSQL verisini siler.
