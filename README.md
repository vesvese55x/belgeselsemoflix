# BELGESELSEMOFLIX

BELGESELSEMOFLIX, belgeselsemo.com.tr deneyimini masaüstüne taşıyan çok platformlu bir belge film uygulamasıdır. Proje; Windows, Linux ve macOS üzerinde çalışan özel bir desktop shell, yerel PHP sunucusu, Tauri tabanlı masaüstü uygulama katmanı ve zengin içerikli web arayüzünden oluşur.

## Öne Çıkanlar

- Masaüstüne özel şık header/footer shell
- Windows installer ve portable dağıtım desteği
- Linux `deb`, `rpm`, `AppImage` ve `zst` çıktıları
- macOS `app` ve `dmg` paketleri
- Premium / misafir giriş akışı
- Kullanıcıya özel favoriler, izleme listesi, notlar ve izleme geçmişi
- Port değişse bile kalıcı storage senkronizasyonu
- Premium Kazan popup akışı ve FileQ indirme fallback mantığı
- Uygulama içi popup / duyuru sistemi için uzaktan `popup.html` desteği
- Tek / seri belgeseller, sezon-bölüm yapısı, DsmartGo & Extra, YouTube ve araçlar bölümleri

## Mimarinin Kısa Özeti

Uygulama, Tauri üzerinden masaüstü kabuğunu çalıştırır. Web arayüzü yerel PHP sunucusu üzerinden `localhost` origin’inde açılır. Desktop tarafında:

- yerel storage ile `localStorage` senkronu yapılır
- uygulama açılışında gerekli veri prefetch işlemleri yapılır
- Windows portable sürümde gerekli runtime hazırlıkları yönetilir
- uzaktan yönetilen popup içeriği login sonrası güvenli biçimde enjekte edilir

## Platform Çıktıları

### Windows

- Kurulumlu `NSIS` sürüm
- Portable sürüm
- Portable sürümde WebView2 Runtime yoksa hazırlık akışı

### Linux

- `.deb`
- `.rpm`
- `.AppImage`
- `.zst`

### macOS

- `.app`
- `.dmg`

## Kullanıcı Verileri

Uygulama aşağıdaki verileri kullanıcıya özel tutar:

- favoriler
- izleme listesi
- kaldığın yerden devam et
- izlenenler
- notlar
- izleme geçmişi
- giriş bilgisi ve reward state

Bu veriler masaüstünde kalıcı storage alanında tutulur ve web arayüzündeki `localStorage` ile senkronize edilir.

## Uzaktan Popup Sistemi

Repo kökünde bulunan `popup.html`, login sonrası ana içerik tamamen hazır olduğunda kontrol edilir. Dosya doluysa, ana web içeriğini bozmadan ekran ortasında popup olarak gösterilir. Böylece:

- bayram mesajları
- kampanyalar
- kısa duyurular

yeniden build almadan yönetilebilir.

## Build Sistemi

GitHub Actions workflow’u:

- şifreli `webapp` arşivini çözer
- platform bağımlılıklarını hazırlar
- tüm hedef platformlar için paketleri üretir
- Windows tarafında installer ve portable hatlarını ayrı yönetir

## Geliştirme Notu

Public repo içinde düz `webapp` kaynağı yerine şifreli arşiv kullanılır. Yerel geliştirme akışı ve arşiv yönetimi, git’e dahil edilmeyen yerel belgeler ve script’lerle yönetilir.

## Marka Dili

BELGESELSEMOFLIX masaüstü sürümü; koyu sinematik görünüm, hızlı gezinme, içerik odaklı akış ve yerel uygulama hissini koruyan kontrollü bir shell yaklaşımıyla tasarlanmıştır.
