<?php
// ============================================
// Stream Proxy - M3U & HLS/MP4 CORS Bypass
// M3U listeleri ve stream URL'lerini proxy'ler
// ============================================

// Güvenlik: sadece izin verilen domain'lerden istek kabul et
$allowedOrigins = ['http://localhost', 'http://localhost:8080', 'http://127.0.0.1', 'http://127.0.0.1:8080'];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';

// Geliştirme ortamında herkese izin ver, production'da kısıtla
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Range');
header('Access-Control-Expose-Headers: Content-Length, Content-Range, Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// URL parametresini al ve doğrula
$url = isset($_GET['url']) ? trim($_GET['url']) : '';

if (empty($url)) {
    http_response_code(400);
    echo json_encode(['error' => 'url parametresi gerekli']);
    exit;
}

// Sadece http/https URL'lerine izin ver
if (!preg_match('/^https?:\/\//i', $url)) {
    http_response_code(400);
    echo json_encode(['error' => 'Geçersiz URL']);
    exit;
}

// Güvenlik: localhost/private IP'lere erişimi engelle (SSRF koruması)
$host = parse_url($url, PHP_URL_HOST);
if (preg_match('/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i', $host)) {
    http_response_code(403);
    echo json_encode(['error' => 'Bu adrese erişim yasak']);
    exit;
}

// Range header'ı destekle (video seek için)
$rangeHeader = $_SERVER['HTTP_RANGE'] ?? '';

// cURL ile isteği at
$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 5,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_SSL_VERIFYPEER => false, // Bazı stream sunucuları self-signed cert kullanıyor
    CURLOPT_SSL_VERIFYHOST => false,
    CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    CURLOPT_HTTPHEADER     => array_filter([
        'Accept: */*',
        'Accept-Language: tr-TR,tr;q=0.9,en;q=0.8',
        'Connection: keep-alive',
        $rangeHeader ? "Range: $rangeHeader" : null,
    ]),
    CURLOPT_HEADER         => true, // Response header'larını da al
    CURLOPT_ENCODING       => '', // gzip/deflate otomatik decode
]);

$response   = curl_exec($ch);
$httpCode   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$finalUrl   = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
$curlError  = curl_error($ch);
curl_close($ch);

if ($curlError) {
    http_response_code(502);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'cURL hatası: ' . $curlError]);
    exit;
}

// Header ve body'yi ayır
$responseHeaders = substr($response, 0, $headerSize);
$body            = substr($response, $headerSize);

// Content-Type belirle
$isM3U      = stripos($contentType, 'mpegurl') !== false
           || stripos($contentType, 'x-mpegurl') !== false
           || preg_match('/\.(m3u8?|m3u)(\?|$)/i', $url);
$isTS       = stripos($contentType, 'video/mp2t') !== false
           || preg_match('/\.ts(\?|$)/i', $url);
$isMP4      = stripos($contentType, 'video/mp4') !== false
           || preg_match('/\.mp4(\?|$)/i', $url);

// M3U/M3U8 ise içindeki URL'leri proxy URL'sine çevir
if ($isM3U && ($httpCode === 200 || $httpCode === 206)) {
    header('Content-Type: application/vnd.apple.mpegurl');
    header('Cache-Control: no-cache');

    // Base URL: relative URL'leri çözmek için
    $baseUrl = preg_replace('/[^\/]*$/', '', $finalUrl ?: $url);

    $lines = explode("\n", $body);
    $output = [];

    foreach ($lines as $line) {
        $line = rtrim($line);

        // Boş satır veya yorum (URI içermeyen)
        if (empty($line) || ($line[0] === '#' && !preg_match('/#EXT-X-KEY.*URI=|#EXT-X-MAP.*URI=/i', $line))) {
            // #EXT-X-KEY ve #EXT-X-MAP içindeki URI'leri de proxy'le
            if (preg_match('/(URI=")([^"]+)(")/i', $line, $m)) {
                $segUrl = resolveUrl($m[2], $baseUrl);
                $line = str_replace($m[0], $m[1] . proxyUrl($segUrl) . $m[3], $line);
            }
            $output[] = $line;
            continue;
        }

        // URL satırı (http ile başlıyor veya relative)
        if ($line[0] !== '#') {
            if (preg_match('/^https?:\/\//i', $line)) {
                $output[] = proxyUrl($line);
            } else {
                $output[] = proxyUrl(resolveUrl($line, $baseUrl));
            }
        } else {
            $output[] = $line;
        }
    }

    echo implode("\n", $output);
    exit;
}

// TS segment veya MP4 — direkt aktar
http_response_code($httpCode);

// İlgili response header'larını aktar
$headersToForward = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'];
foreach (explode("\r\n", $responseHeaders) as $header) {
    $lower = strtolower($header);
    foreach ($headersToForward as $h) {
        if (strpos($lower, $h . ':') === 0) {
            header($header);
            break;
        }
    }
}

echo $body;
exit;

// ── YARDIMCI FONKSİYONLAR ──

function proxyUrl($url) {
    // Kendi proxy URL'mizi oluştur
    $base = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http')
          . '://' . $_SERVER['HTTP_HOST']
          . dirname($_SERVER['SCRIPT_NAME']) . '/stream-proxy.php';
    return $base . '?url=' . urlencode($url);
}

function resolveUrl($relative, $base) {
    if (preg_match('/^https?:\/\//i', $relative)) return $relative;
    if ($relative[0] === '/') {
        // Absolute path
        $parsed = parse_url($base);
        return $parsed['scheme'] . '://' . $parsed['host'] . $relative;
    }
    return rtrim($base, '/') . '/' . ltrim($relative, '/');
}
