# FitMemory Veri Güvenliği Özeti

Sürüm: 22 Temmuz 2026

- API iletişimi HTTPS ile yapılır ve üretim adresi `https://fitmemory-api.onrender.com` olarak sabitlenmiştir.
- Hesap oturumları kullanıcıya bağlı erişim belirteçleriyle korunur; API, başka kullanıcı kimliğine erişimi reddeder.
- Parolalar açık metin tutulmaz; parola doğrulama için tek yönlü güvenli özet kullanılır.
- Sipariş taramasında e-posta, telefon, adres, sipariş numarası ve ödeme satırları analiz öncesinde tarayıcı tarafında ayıklanmaya çalışılır.
- Yapay zekâ sağlayıcısına yalnız kullanıcı taramayı başlattığında analiz için gerekli ürün/sipariş kanıtı gönderilir.
- API anahtarları Chrome uzantısına konmaz; sunucu ortam değişkenlerinde tutulur.
- Ürün sayfasına kalıcı arayüz enjekte edilmez; uygulama Chrome Yan Panel içinde çalışır ve kapatıldığında sayfada katman bırakmaz.
- Bağımlılıklar ve erişim günlükleri düzenli gözden geçirilmelidir. Güvenlik bildirimi `https://mfurkangokbag.com.tr` iletişim kanalından yapılabilir.

Bu belge mevcut beta mimarisinin güvenlik özetidir; bağımsız sertifikasyon veya mutlak güvenlik garantisi değildir.
