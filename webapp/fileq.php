<?php
// ============================================
// FileQ.net API - Dosya Listesi
// Tüm dosyaları JSON formatında çeker
// ============================================

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// FileQ.net API Ayarları
define('FILEQ_API_KEY', '318co5vm9gtiulsx1jd');
define('FILEQ_API_URL', 'https://fileq.net/api/file/list');
define('FILEQ_CACHE_TTL', 900);

$GLOBALS['FILEQ_LAST_ERROR'] = null;

function setFileQError($message, $context = []) {
    $GLOBALS['FILEQ_LAST_ERROR'] = [
        'message' => $message,
        'context' => $context,
    ];
}

function getFileQError() {
    return $GLOBALS['FILEQ_LAST_ERROR'];
}

function fileqCacheDir() {
    $desktopDir = getenv('BELGESELSEMOFLIX_DESKTOP_DATA_DIR');
    if ($desktopDir && is_dir($desktopDir)) {
        $dir = rtrim($desktopDir, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'fileq-cache';
    } else {
        $dir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'belgeselsemoflix-fileq-cache';
    }

    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }

    return $dir;
}

function fileqCachePath($cacheKey) {
    return fileqCacheDir() . DIRECTORY_SEPARATOR . md5($cacheKey) . '.json';
}

function readFileQCache($cacheKey, $allowStale = false) {
    $path = fileqCachePath($cacheKey);
    if (!is_file($path)) {
        return false;
    }

    if (!$allowStale && (time() - @filemtime($path)) > FILEQ_CACHE_TTL) {
        return false;
    }

    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return false;
    }

    $data = json_decode($raw, true);
    return is_array($data) ? $data : false;
}

function writeFileQCache($cacheKey, $body) {
    if (!is_string($body) || trim($body) === '') {
        return;
    }

    @file_put_contents(fileqCachePath($cacheKey), $body, LOCK_EX);
}

function extractDohAddresses($decoded) {
    if (!is_array($decoded) || empty($decoded['Answer']) || !is_array($decoded['Answer'])) {
        return [];
    }

    $ips = [];
    foreach ($decoded['Answer'] as $answer) {
        if (!is_array($answer)) {
            continue;
        }

        $type = $answer['type'] ?? null;
        $data = trim((string)($answer['data'] ?? ''));
        if (($type === 1 || $type === 28) && $data !== '') {
            $ips[] = $data;
        }
    }

    return array_values(array_unique($ips));
}

function resolveHostViaDoh($host) {
    $endpoints = [
        [
            'url' => "https://cloudflare-dns.com/dns-query?name={$host}&type=A",
            'resolve' => ['cloudflare-dns.com:443:1.1.1.1', 'cloudflare-dns.com:443:1.0.0.1'],
            'headers' => ['Accept: application/dns-json'],
        ],
        [
            'url' => "https://dns.google/resolve?name={$host}&type=A",
            'resolve' => ['dns.google:443:8.8.8.8', 'dns.google:443:8.8.4.4'],
            'headers' => ['Accept: application/dns-json'],
        ],
    ];

    foreach ($endpoints as $endpoint) {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $endpoint['url'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => $endpoint['headers'],
            CURLOPT_RESOLVE => $endpoint['resolve'],
            CURLOPT_USERAGENT => 'BELGESELSEMOFLIX/1.0 (+https://belgeselsemo.com.tr)',
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        if (PHP_VERSION_ID < 80500) {
            curl_close($ch);
        }

        if ($response === false || $httpCode !== 200) {
            continue;
        }

        $decoded = json_decode($response, true);
        $ips = extractDohAddresses($decoded);
        if (!empty($ips)) {
            return $ips;
        }
    }

    return [];
}

function resolveHostCandidates($host) {
    $ips = [];

    if (function_exists('gethostbynamel')) {
        $ipv4 = @gethostbynamel($host);
        if (is_array($ipv4)) {
            $ips = array_merge($ips, $ipv4);
        }
    }

    if (function_exists('dns_get_record')) {
        $records = @dns_get_record($host, DNS_A + DNS_AAAA);
        if (is_array($records)) {
            foreach ($records as $record) {
                if (!empty($record['ip'])) {
                    $ips[] = $record['ip'];
                }
                if (!empty($record['ipv6'])) {
                    $ips[] = $record['ipv6'];
                }
            }
        }
    }

    if (empty($ips)) {
        $ips = array_merge($ips, resolveHostViaDoh($host));
    }

    return array_values(array_unique(array_filter($ips)));
}

function curlJsonRequest($url, $timeout, $options = []) {
    $headers = $options['headers'] ?? [];
    $resolve = $options['resolve'] ?? null;
    $verify = $options['verify'] ?? true;
    $ipResolve = $options['ip_resolve'] ?? CURL_IPRESOLVE_WHATEVER;

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_CONNECTTIMEOUT => 12,
        CURLOPT_SSL_VERIFYPEER => $verify,
        CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_USERAGENT => 'BELGESELSEMOFLIX/1.0 (+https://belgeselsemo.com.tr)',
        CURLOPT_HTTPHEADER => array_merge([
            'Accept: application/json',
            'Cache-Control: no-cache'
        ], $headers),
        CURLOPT_IPRESOLVE => $ipResolve,
    ]);

    if (is_array($resolve) && !empty($resolve)) {
        curl_setopt($ch, CURLOPT_RESOLVE, $resolve);
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    if (PHP_VERSION_ID < 80500) {
        curl_close($ch);
    }

    return [$response, $httpCode, $error];
}

function requestFileQJson($url, $cacheKey, $timeout = 30) {
    $host = parse_url($url, PHP_URL_HOST) ?: 'fileq.net';
    $attempts = [
        ['verify' => true, 'ip_resolve' => CURL_IPRESOLVE_WHATEVER],
        ['verify' => false, 'ip_resolve' => CURL_IPRESOLVE_V4],
    ];

    foreach ($attempts as $attempt) {
        [$response, $httpCode, $error] = curlJsonRequest($url, $timeout, $attempt);

        if ($response !== false && $httpCode === 200) {
            $decoded = json_decode($response, true);
            if (is_array($decoded)) {
                writeFileQCache($cacheKey, $response);
                return $decoded;
            }
        }

        error_log("FileQ request failed: HTTP {$httpCode} - {$error} - {$url}");
    }

    $resolvedIps = resolveHostCandidates($host);
    foreach ($resolvedIps as $ip) {
        [$response, $httpCode, $error] = curlJsonRequest($url, $timeout, [
            'verify' => true,
            'resolve' => ["{$host}:443:{$ip}"],
        ]);

        if ($response !== false && $httpCode === 200) {
            $decoded = json_decode($response, true);
            if (is_array($decoded)) {
                writeFileQCache($cacheKey, $response);
                return $decoded;
            }
        }

        error_log("FileQ resolved request failed: HTTP {$httpCode} - {$error} - {$url} - {$ip}");
    }

    $staleCache = readFileQCache($cacheKey, true);
    if ($staleCache !== false) {
        setFileQError('FileQ servisine canlı erişim kurulamadı, önbellek kullanıldı.', [
            'host' => $host,
            'fallback' => 'stale-cache',
        ]);
        return $staleCache;
    }

    setFileQError('FileQ servisine erişilemedi.', [
        'host' => $host,
        'resolved_ips' => $resolvedIps,
    ]);
    return false;
}

/**
 * FileQ.net API'den dosya listesini çeker
 * 
 * @param int $page Sayfa numarası (varsayılan: 1)
 * @param int $perPage Sayfa başına dosya sayısı (varsayılan: 100)
 * @param int $fldId Klasör ID (0 = tüm dosyalar)
 * @param int $public Public dosyalar (1 = evet, 0 = hayır)
 * @return array|false API yanıtı veya hata durumunda false
 */
function getFileQFiles($page = 1, $perPage = 100, $fldId = 0, $public = 1) {
    $params = [
        'key' => FILEQ_API_KEY,
        'page' => $page,
        'per_page' => $perPage,
        'public' => $public
    ];
    
    // Klasör ID varsa ekle
    if ($fldId > 0) {
        $params['fld_id'] = $fldId;
    }
    
    $url = FILEQ_API_URL . '?' . http_build_query($params);
    
    $cacheKey = "files:{$page}:{$perPage}:{$fldId}:{$public}";
    $data = requestFileQJson($url, $cacheKey, 30);
    
    if (!$data || !isset($data['result'])) {
        if (!getFileQError()) {
            setFileQError('FileQ API beklenen formatta yanıt vermedi.', [
                'url' => $url
            ]);
        }
        error_log("FileQ API Error: Invalid response format");
        return false;
    }
    
    return $data;
}

/**
 * Tüm dosyaları sayfalama yaparak çeker
 * 
 * @param int $fldId Klasör ID (0 = tüm dosyalar)
 * @param int $public Public dosyalar (1 = evet, 0 = hayır)
 * @return array Tüm dosyalar
 */
function getAllFileQFiles($fldId = 0, $public = 1) {
    $allFiles = [];
    $page = 1;
    $perPage = 100; // Maksimum sayfa başına dosya
    
    do {
        $response = getFileQFiles($page, $perPage, $fldId, $public);
        
        if (!$response || !isset($response['result']['files'])) {
            break;
        }
        
        $files = $response['result']['files'];
        $allFiles = array_merge($allFiles, $files);
        
        $resultsTotal = $response['result']['results_total'] ?? 0;
        $currentCount = count($allFiles);
        
        // Tüm dosyalar çekildi mi?
        if ($currentCount >= $resultsTotal) {
            break;
        }
        
        $page++;
        
        // Sonsuz döngü koruması (maksimum 100 sayfa)
        if ($page > 100) {
            error_log("FileQ API Warning: Reached maximum page limit (100)");
            break;
        }
        
    } while (true);
    
    return $allFiles;
}

/**
 * Dosya boyutunu okunabilir formata çevirir
 * 
 * @param int $bytes Byte cinsinden boyut
 * @return string Okunabilir boyut (örn: "1.5 MB")
 */
function formatFileSize($bytes) {
    if ($bytes >= 1073741824) {
        return number_format($bytes / 1073741824, 2) . ' GB';
    } elseif ($bytes >= 1048576) {
        return number_format($bytes / 1048576, 2) . ' MB';
    } elseif ($bytes >= 1024) {
        return number_format($bytes / 1024, 2) . ' KB';
    } else {
        return $bytes . ' bytes';
    }
}

// ============================================
// STATS PROXY - API key'i gizlemek için
// ============================================
function getFileQStats() {
    $url = 'https://fileq.net/api/account/stats?key=' . FILEQ_API_KEY;
    return requestFileQJson($url, 'stats', 15);
}

function emitFileQFailure($format, $message, $errorData = null) {
    http_response_code(503);

    $payload = [
        'success' => false,
        'error' => $message,
        'error_code' => 'fileq_unreachable',
        'diagnostic' => $errorData['message'] ?? null,
        'context' => $errorData['context'] ?? null,
        'total' => 0,
        'files' => []
    ];

    if ($format === 'html') {
        header('Content-Type: text/html; charset=utf-8');
        $safeMessage = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
        $safeDiagnostic = htmlspecialchars($payload['diagnostic'] ?? 'Bilinmeyen hata', ENT_QUOTES, 'UTF-8');
        echo "<!doctype html><html lang=\"tr\"><head><meta charset=\"utf-8\"><title>FileQ Hatası</title><style>body{font-family:Segoe UI,Arial,sans-serif;background:#111;color:#eee;padding:32px} .card{max-width:900px;margin:0 auto;background:#1d1d1d;border:1px solid #333;border-radius:16px;padding:24px} h1{color:#ff4d5f} code{display:block;margin-top:16px;padding:12px;background:#0f0f0f;border-radius:10px;color:#ffd0d5;white-space:pre-wrap;word-break:break-word}</style></head><body><div class=\"card\"><h1>FileQ verisine erişilemedi</h1><p>{$safeMessage}</p><code>{$safeDiagnostic}</code></div></body></html>";
        return;
    }

    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

// ============================================
// ANA İŞLEM
// ============================================

try {
    // URL parametrelerini al
    $fldId = isset($_GET['fld_id']) ? (int)$_GET['fld_id'] : 0;
    $public = isset($_GET['public']) ? (int)$_GET['public'] : 1;
    $format = isset($_GET['format']) ? $_GET['format'] : 'json'; // json veya html

    // Stats proxy endpoint
    if ($format === 'stats') {
        header('Content-Type: application/json; charset=utf-8');
        $stats = getFileQStats();
        if ($stats === false) {
            emitFileQFailure('json', 'FileQ istatistikleri alınamadı.', getFileQError());
        } else {
            echo json_encode(['success' => true, 'result' => $stats['result'] ?? $stats]);
        }
        exit;
    }
    
    // Tüm dosyaları çek
    $files = getAllFileQFiles($fldId, $public);
    
    if ($files === false || empty($files)) {
        emitFileQFailure($format, 'FileQ dosyaları yüklenemedi veya hiç dosya bulunamadı.', getFileQError());
        exit;
    }
    
    // Dosyaları işle ve zenginleştir
    $processedFiles = array_map(function($file) {
        return [
            'name' => $file['name'],
            'file_code' => $file['file_code'],
            'link' => $file['link'],
            'download_link' => "https://fileq.net/{$file['file_code']}.html",
            'size' => $file['size'],
            'size_formatted' => formatFileSize($file['size']),
            'downloads' => $file['downloads'],
            'thumbnail' => $file['thumbnail'],
            'public' => $file['public'] == 1,
            'folder_id' => $file['fld_id'],
            'uploaded' => $file['uploaded'],
            'uploaded_timestamp' => strtotime($file['uploaded'])
        ];
    }, $files);
    
    // Alfabetik sırala (doğal sıralama - part-001, part-002, ... part-010)
    usort($processedFiles, function($a, $b) {
        return strnatcasecmp($a['name'], $b['name']);
    });
    
    // İstatistikler
    $stats = [
        'total_files' => count($processedFiles),
        'total_size' => array_sum(array_column($processedFiles, 'size')),
        'total_downloads' => array_sum(array_column($processedFiles, 'downloads')),
        'public_files' => count(array_filter($processedFiles, fn($f) => $f['public'])),
        'private_files' => count(array_filter($processedFiles, fn($f) => !$f['public']))
    ];
    $stats['total_size_formatted'] = formatFileSize($stats['total_size']);
    
    // JSON formatında döndür
    if ($format === 'json') {
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'stats' => $stats,
            'files' => $processedFiles,
            'generated_at' => date('Y-m-d H:i:s')
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    // HTML formatında döndür (debug için)
    else if ($format === 'html') {
        http_response_code(200);
        header('Content-Type: text/html; charset=utf-8');
        ?>
        <!DOCTYPE html>
        <html lang="tr">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>FileQ.net Dosyalarım - BELGESELSEMOFLIX</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            <style>
                * { 
                    margin: 0; 
                    padding: 0; 
                    box-sizing: border-box; 
                }
                
                :root {
                    --bg-dark: #141414;
                    --bg-card: #1f1f1f;
                    --bg-hover: #2a2a2a;
                    --accent: #e50914;
                    --accent-hover: #f40612;
                    --text-primary: #ffffff;
                    --text-secondary: #b3b3b3;
                    --text-muted: #808080;
                    --header-height: 80px;
                    --footer-height: 60px;
                }
                
                html, body {
                    height: 100%;
                    overflow: hidden;
                }
                
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    background: var(--bg-dark);
                    color: var(--text-primary);
                    line-height: 1.6;
                    display: flex;
                    flex-direction: column;
                }
                
                .container { 
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                    overflow: hidden;
                }
                
                .header {
                    flex-shrink: 0;
                    height: var(--header-height);
                    padding: 1rem 2rem;
                    border-bottom: 2px solid var(--accent);
                    background: var(--bg-dark);
                    z-index: 100;
                }
                
                h1 { 
                    color: var(--accent);
                    font-size: 2rem;
                    font-weight: 800;
                    margin-bottom: 0.25rem;
                    letter-spacing: -1px;
                }
                
                .subtitle {
                    color: var(--text-secondary);
                    font-size: 0.95rem;
                }
                
                .stats { 
                    flex-shrink: 0;
                    display: grid; 
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); 
                    gap: 1.5rem; 
                    padding: 1.5rem 2rem;
                    background: var(--bg-dark);
                }
                
                .stat-card { 
                    background: var(--bg-card);
                    padding: 1.5rem;
                    border-radius: 8px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    transition: all 0.3s;
                }
                
                .stat-card:hover {
                    transform: translateY(-5px);
                    border-color: var(--accent);
                    box-shadow: 0 10px 30px rgba(229, 9, 20, 0.3);
                }
                
                .stat-card .icon {
                    font-size: 2rem;
                    color: var(--accent);
                    margin-bottom: 0.5rem;
                }
                
                .stat-card h3 { 
                    font-size: 0.9rem;
                    color: var(--text-secondary);
                    margin-bottom: 0.5rem;
                    font-weight: 500;
                }
                
                .stat-card p { 
                    font-size: 2rem;
                    font-weight: 700;
                    color: var(--text-primary);
                }
                
                .table-wrapper {
                    flex: 1;
                    overflow-y: auto;
                    padding: 0 2rem 2rem;
                    min-height: 0;
                }
                
                .table-container {
                    background: var(--bg-card);
                    border-radius: 8px;
                    overflow: hidden;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                
                table { 
                    width: 100%; 
                    border-collapse: collapse; 
                }
                
                th, td { 
                    padding: 1rem; 
                    text-align: left; 
                }
                
                th { 
                    background: var(--bg-hover);
                    color: var(--text-primary);
                    font-weight: 600;
                    font-size: 0.9rem;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    border-bottom: 2px solid var(--accent);
                    position: sticky;
                    top: 0;
                    z-index: 10;
                }
                
                tbody tr {
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    transition: all 0.3s;
                }
                
                tbody tr:hover { 
                    background: var(--bg-hover);
                }
                
                tbody tr:last-child {
                    border-bottom: none;
                }
                
                td {
                    color: var(--text-secondary);
                    font-size: 0.95rem;
                }
                
                .file-name {
                    color: var(--text-primary);
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                
                .file-name i {
                    color: var(--accent);
                }
                
                a { 
                    color: var(--accent);
                    text-decoration: none;
                    transition: all 0.3s;
                    font-weight: 500;
                }
                
                a:hover { 
                    color: var(--accent-hover);
                    text-decoration: underline;
                }
                
                .badge { 
                    display: inline-block; 
                    padding: 0.25rem 0.75rem; 
                    border-radius: 20px; 
                    font-size: 0.75rem; 
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                
                .badge-public { 
                    background: rgba(16, 185, 129, 0.2);
                    color: #10b981;
                    border: 1px solid #10b981;
                }
                
                .badge-private { 
                    background: rgba(239, 68, 68, 0.2);
                    color: #ef4444;
                    border: 1px solid #ef4444;
                }
                
                .footer {
                    flex-shrink: 0;
                    height: var(--footer-height);
                    padding: 1rem 2rem;
                    border-top: 1px solid rgba(255, 255, 255, 0.1);
                    text-align: center;
                    color: var(--text-muted);
                    font-size: 0.85rem;
                    background: var(--bg-dark);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100;
                }
                
                .actions {
                    display: flex;
                    gap: 0.5rem;
                }
                
                .btn {
                    padding: 0.5rem 1rem;
                    border-radius: 4px;
                    font-size: 0.85rem;
                    font-weight: 600;
                    transition: all 0.3s;
                    border: none;
                    cursor: pointer;
                    text-decoration: none;
                    display: inline-flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                
                .btn-primary {
                    background: var(--accent);
                    color: white;
                }
                
                .btn-primary:hover {
                    background: var(--accent-hover);
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(229, 9, 20, 0.4);
                    text-decoration: none;
                }
                
                /* Mobile Optimizations */
                @media (max-width: 768px) {
                    :root {
                        --header-height: 100px;
                    }
                    
                    .header {
                        padding: 1rem;
                    }
                    
                    h1 {
                        font-size: 1.5rem;
                    }
                    
                    .subtitle {
                        font-size: 0.85rem;
                    }
                    
                    .stats {
                        grid-template-columns: repeat(2, 1fr);
                        gap: 0.75rem;
                        padding: 1rem;
                    }
                    
                    .stat-card {
                        padding: 0.75rem;
                    }
                    
                    .stat-card .icon {
                        font-size: 1.25rem;
                        margin-bottom: 0.25rem;
                    }
                    
                    .stat-card h3 {
                        font-size: 0.7rem;
                        margin-bottom: 0.25rem;
                    }
                    
                    .stat-card p {
                        font-size: 1.25rem;
                    }
                    
                    .table-wrapper {
                        padding: 0 1rem 1rem;
                    }
                    
                    table {
                        font-size: 0.8rem;
                    }
                    
                    th, td {
                        padding: 0.5rem;
                    }
                    
                    th {
                        font-size: 0.75rem;
                    }
                    
                    /* Durum sütununu gizle */
                    th:nth-child(4),
                    td:nth-child(4) {
                        display: none;
                    }
                    
                    .btn {
                        padding: 0.4rem 0.75rem;
                        font-size: 0.75rem;
                    }
                    
                    .footer {
                        font-size: 0.75rem;
                        padding: 0.75rem 1rem;
                    }
                }
                
                /* Extra small screens */
                @media (max-width: 480px) {
                    .stats {
                        grid-template-columns: repeat(2, 1fr);
                        gap: 0.5rem;
                    }
                    
                    .stat-card {
                        padding: 0.5rem;
                    }
                    
                    .stat-card .icon {
                        font-size: 1rem;
                    }
                    
                    .stat-card h3 {
                        font-size: 0.65rem;
                    }
                    
                    .stat-card p {
                        font-size: 1rem;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1><i class="fas fa-folder-open"></i> BELGESELSEMOFLIX</h1>
                    <p class="subtitle">FileQ.net Dosya Yönetimi</p>
                </div>
                
                <div class="stats">
                    <div class="stat-card">
                        <div class="icon"><i class="fas fa-file"></i></div>
                        <h3>Toplam Dosya</h3>
                        <p><?= number_format($stats['total_files']) ?></p>
                    </div>
                    <div class="stat-card">
                        <div class="icon"><i class="fas fa-database"></i></div>
                        <h3>Toplam Boyut</h3>
                        <p><?= $stats['total_size_formatted'] ?></p>
                    </div>
                    <div class="stat-card">
                        <div class="icon"><i class="fas fa-download"></i></div>
                        <h3>Toplam İndirme</h3>
                        <p><?= number_format($stats['total_downloads']) ?></p>
                    </div>
                    <div class="stat-card">
                        <div class="icon"><i class="fas fa-eye"></i></div>
                        <h3>Public / Private</h3>
                        <p><?= $stats['public_files'] ?> / <?= $stats['private_files'] ?></p>
                    </div>
                </div>
                
                <div class="table-wrapper">
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th><i class="fas fa-file-video"></i> Dosya Adı</th>
                                    <th><i class="fas fa-weight-hanging"></i> Boyut</th>
                                    <th><i class="fas fa-download"></i> İndirme</th>
                                    <th><i class="fas fa-shield-alt"></i> Durum</th>
                                    <th><i class="fas fa-calendar"></i> Yüklenme</th>
                                    <th><i class="fas fa-link"></i> İşlemler</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($processedFiles as $index => $file): ?>
                                <tr>
                                    <td>
                                        <div class="file-name">
                                            <i class="fas fa-film"></i>
                                            <?= htmlspecialchars($file['name']) ?>
                                        </div>
                                    </td>
                                    <td><?= $file['size_formatted'] ?></td>
                                    <td><?= number_format($file['downloads']) ?></td>
                                    <td>
                                        <span class="badge <?= $file['public'] ? 'badge-public' : 'badge-private' ?>">
                                            <?= $file['public'] ? 'Public' : 'Private' ?>
                                        </span>
                                    </td>
                                    <td><?= date('d.m.Y H:i', $file['uploaded_timestamp']) ?></td>
                                    <td>
                                        <div class="actions">
                                            <a href="<?= $file['download_link'] ?>" target="_blank" class="btn btn-primary">
                                                <i class="fas fa-download"></i> İndir
                                            </a>
                                        </div>
                                    </td>
                                </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="footer">
                    <p>
                        <i class="fas fa-clock"></i> 
                        Oluşturulma: <?= date('d.m.Y H:i:s') ?> | 
                        <i class="fas fa-copyright"></i> 
                        2025 BELGESELSEMOFLIX
                    </p>
                </div>
            </div>
        </body>
        </html>
        <?php
    }
    
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage(),
        'total' => 0,
        'files' => []
    ]);
}
?>
