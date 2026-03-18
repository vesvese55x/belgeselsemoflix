<?php
// ============================================
// YouTube API Proxy - Google API v3
// Şifreli API key'ler ile güvenli çalışma
// ============================================

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ============================================
// ENCRYPTED API KEYS CONFIGURATION
// ============================================
$config = [
    'encrypted_keys' => [
        'FIr1rY4lzg8tPr6vHI6v9nRvNGYyakMrTC9Yb2Z2L3ZpRjZFZHBxcEJqV2lRNlNOWnVMLy9EUlRpZ0NvTG5OSzhoMDVYaG1wQk5wOHVmZXY=', // Key 1
        '7GMZvGrJJU7F5XjqMQ+JFjBpam9KbENWdVdBT0g3Y2F6aFJxZzJIc3d4cGJGNHdCWGc0bFBiSVh2ZzBPWDR2L2t0NDhRWlpuMnA4dEI5ZTQ=', // Key 2
        '+NXZZvpLEex65eH/HpBe9UtnY1ZrWHZqczh4bWk5RUZXMmhMMHdmeW9vL2c5di9uOHI2UHdDS1lxaVlMK0hZaXBUbkJURGQvNERLcXduU3o=', // Key 3
        'W64sxRFuPK2bkbwMaqSdC2wrSzNuSUpodzlzTmRiQURXazVtdzJMSEQram00cVlsQ0NIb1RUOTExdnNMOTFnc3FROVhqV0kzUjhHVENxeEs=', // Key 4
        'HKYX5PqXOhEyKjS8mzwqd0tyQ1hqN3BJQ0FlSGllbkgzc0NxcWY3YWlXQWFGRnZuM1puRWRPNndGcktLMTBYT3BvTVYwSkU1b1NmeGdWcTk=', // Key 5
        'Y6BXY1lsYUt45b8W8cFLU1FpTU9SQStGbm5UbCtJT0JEbGdHanBqdG16WThPU25OQ0NLYUxZZENzV1NNNmZzS0lNZDhwMmdmT3ZVRFhSTnI=', // Key 6
    ],
    'encryption_key' => 'ecaeb9e4e9c5f138303ecfb2166411d61f7c59d571c4d167adcd7736fe4755c5',
    'cache_duration' => 3600,
    'daily_limit_per_key' => 10000,
    'auto_rotate' => true
];

// API key'leri decrypt et
function decryptApiKey($encryptedKey, $key) {
    $data = base64_decode($encryptedKey);
    $iv = substr($data, 0, 16);
    $encrypted = substr($data, 16);
    return openssl_decrypt($encrypted, 'AES-256-CBC', $key, 0, $iv);
}

// Şifreli key'leri çöz
$apiKeys = [];
$encryptionKey = $config['encryption_key'];
foreach ($config['encrypted_keys'] as $encryptedKey) {
    $decrypted = decryptApiKey($encryptedKey, $encryptionKey);
    if ($decrypted) {
        $apiKeys[] = $decrypted;
    }
}

if (empty($apiKeys)) {
    http_response_code(500);
    echo json_encode(['error' => 'API key\'ler yüklenemedi']);
    exit;
}

// Endpoint parametresini al
$endpoint = isset($_GET['endpoint']) ? $_GET['endpoint'] : '';

if (empty($endpoint)) {
    http_response_code(400);
    echo json_encode(['error' => 'Endpoint gerekli']);
    exit;
}

// Google API endpoint'lerini dönüştür
$googleEndpoint = '';
$params = [];

if (preg_match('/\/api\/v1\/playlists\/([^\/]+)/', $endpoint, $matches)) {
    // Playlist videoları (önce kontrol et - daha spesifik)
    $playlistId = $matches[1];
    $googleEndpoint = 'https://www.googleapis.com/youtube/v3/playlistItems';
    $params = [
        'part' => 'snippet,contentDetails',
        'playlistId' => $playlistId,
        'maxResults' => 50
    ];
} elseif (preg_match('/\/api\/v1\/channels\/([^\/]+)\/playlists/', $endpoint, $matches)) {
    // Kanal playlist'leri
    $channelId = $matches[1];
    $googleEndpoint = 'https://www.googleapis.com/youtube/v3/playlists';
    $params = [
        'part' => 'snippet,contentDetails',
        'channelId' => $channelId,
        'maxResults' => 50
    ];
} elseif (preg_match('/\/api\/v1\/channels\/([^\/]+)\/videos/', $endpoint, $matches)) {
    // Kanal videoları
    $channelId = $matches[1];
    $googleEndpoint = 'https://www.googleapis.com/youtube/v3/search';
    $params = [
        'part' => 'snippet',
        'channelId' => $channelId,
        'maxResults' => 50,
        'order' => 'date',
        'type' => 'video'
    ];
} elseif (preg_match('/\/api\/v1\/videos\/([^\/]+)/', $endpoint, $matches)) {
    // Video detayları
    $videoId = $matches[1];
    $googleEndpoint = 'https://www.googleapis.com/youtube/v3/videos';
    $params = [
        'part' => 'snippet,contentDetails,statistics',
        'id' => $videoId
    ];
} else {
    http_response_code(400);
    echo json_encode(['error' => 'Desteklenmeyen endpoint']);
    exit;
}

// API key rotation (her istekte farklı key kullan)
$currentKeyIndex = isset($_COOKIE['yt_key_index']) ? (int)$_COOKIE['yt_key_index'] : 0;
$currentKeyIndex = ($currentKeyIndex + 1) % count($apiKeys);
setcookie('yt_key_index', $currentKeyIndex, time() + 86400, '/', '', false, true); // HttpOnly

$apiKey = $apiKeys[$currentKeyIndex];
$params['key'] = $apiKey;

// URL oluştur
$url = $googleEndpoint . '?' . http_build_query($params);

// cURL ile istek at
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// API key'i bellekten temizle
$apiKey = null;
unset($apiKey);

if ($httpCode !== 200) {
    // Hata durumunda başka key dene
    foreach ($apiKeys as $index => $key) {
        if ($index === $currentKeyIndex) continue;
        
        $params['key'] = $key;
        $url = $googleEndpoint . '?' . http_build_query($params);
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($httpCode === 200) {
            setcookie('yt_key_index', $index, time() + 86400, '/', '', false, true);
            break;
        }
    }
}

// Tüm key'leri bellekten temizle
$apiKeys = null;
unset($apiKeys);

if ($httpCode !== 200) {
    http_response_code(500);
    echo json_encode([
        'error' => 'API isteği başarısız',
        'httpCode' => $httpCode
    ]);
    exit;
}

// Google API yanıtını YouTube client formatına dönüştür
$data = json_decode($response, true);

// Debug için endpoint'i logla
error_log("YouTube Proxy - Endpoint: $endpoint");
error_log("YouTube Proxy - Google Endpoint: $googleEndpoint");

if (preg_match('/\/api\/v1\/playlists\/([^\/]+)$/', $endpoint)) {
    // Playlist videoları (tek playlist) - ÖNCELİKLİ
    $videos = [];
    if (isset($data['items'])) {
        foreach ($data['items'] as $item) {
            $videoId = $item['contentDetails']['videoId'] ?? $item['snippet']['resourceId']['videoId'] ?? '';
            if (!empty($videoId)) {
                $videos[] = [
                    'videoId' => $videoId,
                    'title' => $item['snippet']['title'],
                    'author' => $item['snippet']['channelTitle'] ?? '',
                    'videoThumbnails' => [
                        ['url' => $item['snippet']['thumbnails']['medium']['url'] ?? '']
                    ]
                ];
            }
        }
    }
    
    http_response_code(200);
    echo json_encode(['videos' => $videos]);
    exit;
} elseif (strpos($endpoint, '/channels/') !== false && strpos($endpoint, '/playlists') !== false) {
    // Kanal playlist listesi
    $playlists = [];
    if (isset($data['items'])) {
        foreach ($data['items'] as $item) {
            $playlists[] = [
                'playlistId' => $item['id'],
                'title' => $item['snippet']['title'],
                'videoCount' => $item['contentDetails']['itemCount'] ?? 0,
                'playlistThumbnail' => $item['snippet']['thumbnails']['medium']['url'] ?? ''
            ];
        }
    }
    
    http_response_code(200);
    echo json_encode(['playlists' => $playlists]);
    exit;
} elseif (strpos($endpoint, '/channels/') !== false && strpos($endpoint, '/videos') !== false) {
    // Kanal videoları
    $videos = [];
    if (isset($data['items'])) {
        foreach ($data['items'] as $item) {
            $videos[] = [
                'videoId' => $item['id']['videoId'] ?? $item['id'],
                'title' => $item['snippet']['title'],
                'videoThumbnails' => [
                    ['url' => $item['snippet']['thumbnails']['medium']['url'] ?? '']
                ]
            ];
        }
    }
    
    http_response_code(200);
    echo json_encode($videos);
    exit;
} elseif (strpos($endpoint, '/videos/') !== false) {
    // Video detayları
    if (isset($data['items'][0])) {
        $item = $data['items'][0];
        $result = [
            'videoId' => $item['id'],
            'title' => $item['snippet']['title'],
            'description' => $item['snippet']['description'],
            'author' => $item['snippet']['channelTitle'],
            'lengthSeconds' => 0,
            'viewCount' => $item['statistics']['viewCount'] ?? 0,
            'likeCount' => $item['statistics']['likeCount'] ?? 0,
            'videoThumbnails' => [
                ['url' => $item['snippet']['thumbnails']['medium']['url'] ?? '']
            ]
        ];
        
        http_response_code(200);
        echo json_encode($result);
        exit;
    }
}

// Direkt yanıtı döndür
http_response_code(200);
echo $response;
?>

// API key'leri decrypt et
function decryptApiKey($encryptedKey, $key) {
    $data = base64_decode($encryptedKey);
    $iv = substr($data, 0, 16);
    $encrypted = substr($data, 16);
    return openssl_decrypt($encrypted, 'AES-256-CBC', $key, 0, $iv);
}

// Şifreli key'leri çöz
$apiKeys = [];
$encryptionKey = $config['encryption_key'];
foreach ($config['encrypted_keys'] as $encryptedKey) {
    $decrypted = decryptApiKey($encryptedKey, $encryptionKey);
    if ($decrypted) {
        $apiKeys[] = $decrypted;
    }
}

if (empty($apiKeys)) {
    http_response_code(500);
    echo json_encode(['error' => 'API key\'ler yüklenemedi']);
    exit;
}

// Endpoint parametresini al
$endpoint = isset($_GET['endpoint']) ? $_GET['endpoint'] : '';

if (empty($endpoint)) {
    http_response_code(400);
    echo json_encode(['error' => 'Endpoint gerekli']);
    exit;
}

// Google API endpoint'lerini dönüştür
$googleEndpoint = '';
$params = [];

if (preg_match('/\/api\/v1\/playlists\/([^\/]+)/', $endpoint, $matches)) {
    // Playlist videoları (önce kontrol et - daha spesifik)
    $playlistId = $matches[1];
    $googleEndpoint = 'https://www.googleapis.com/youtube/v3/playlistItems';
    $params = [
        'part' => 'snippet,contentDetails',
        'playlistId' => $playlistId,
        'maxResults' => 50
    ];
} elseif (preg_match('/\/api\/v1\/channels\/([^\/]+)\/playlists/', $endpoint, $matches)) {
    // Kanal playlist'leri
    $channelId = $matches[1];
    $googleEndpoint = 'https://www.googleapis.com/youtube/v3/playlists';
    $params = [
        'part' => 'snippet,contentDetails',
        'channelId' => $channelId,
        'maxResults' => 50
    ];
} elseif (preg_match('/\/api\/v1\/channels\/([^\/]+)\/videos/', $endpoint, $matches)) {
    // Kanal videoları
    $channelId = $matches[1];
    $googleEndpoint = 'https://www.googleapis.com/youtube/v3/search';
    $params = [
        'part' => 'snippet',
        'channelId' => $channelId,
        'maxResults' => 50,
        'order' => 'date',
        'type' => 'video'
    ];
} elseif (preg_match('/\/api\/v1\/videos\/([^\/]+)/', $endpoint, $matches)) {
    // Video detayları
    $videoId = $matches[1];
    $googleEndpoint = 'https://www.googleapis.com/youtube/v3/videos';
    $params = [
        'part' => 'snippet,contentDetails,statistics',
        'id' => $videoId
    ];
} else {
    http_response_code(400);
    echo json_encode(['error' => 'Desteklenmeyen endpoint']);
    exit;
}

// API key rotation (her istekte farklı key kullan)
$currentKeyIndex = isset($_COOKIE['yt_key_index']) ? (int)$_COOKIE['yt_key_index'] : 0;
$currentKeyIndex = ($currentKeyIndex + 1) % count($apiKeys);
setcookie('yt_key_index', $currentKeyIndex, time() + 86400, '/', '', false, true); // HttpOnly

$apiKey = $apiKeys[$currentKeyIndex];
$params['key'] = $apiKey;

// URL oluştur
$url = $googleEndpoint . '?' . http_build_query($params);

// cURL ile istek at
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

// API key'i bellekten temizle
$apiKey = null;
unset($apiKey);

if ($httpCode !== 200) {
    // Hata durumunda başka key dene
    foreach ($apiKeys as $index => $key) {
        if ($index === $currentKeyIndex) continue;
        
        $params['key'] = $key;
        $url = $googleEndpoint . '?' . http_build_query($params);
        
        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 10);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        if ($httpCode === 200) {
            setcookie('yt_key_index', $index, time() + 86400, '/', '', false, true);
            break;
        }
    }
}

// Tüm key'leri bellekten temizle
$apiKeys = null;
unset($apiKeys);

if ($httpCode !== 200) {
    http_response_code(500);
    echo json_encode([
        'error' => 'API isteği başarısız',
        'httpCode' => $httpCode
    ]);
    exit;
}

// Google API yanıtını YouTube client formatına dönüştür
$data = json_decode($response, true);

// Debug için endpoint'i logla
error_log("YouTube Proxy - Endpoint: $endpoint");
error_log("YouTube Proxy - Google Endpoint: $googleEndpoint");

if (preg_match('/\/api\/v1\/playlists\/([^\/]+)$/', $endpoint)) {
    // Playlist videoları (tek playlist) - ÖNCELİKLİ
    $videos = [];
    if (isset($data['items'])) {
        foreach ($data['items'] as $item) {
            $videoId = $item['contentDetails']['videoId'] ?? $item['snippet']['resourceId']['videoId'] ?? '';
            if (!empty($videoId)) {
                $videos[] = [
                    'videoId' => $videoId,
                    'title' => $item['snippet']['title'],
                    'author' => $item['snippet']['channelTitle'] ?? '',
                    'videoThumbnails' => [
                        ['url' => $item['snippet']['thumbnails']['medium']['url'] ?? '']
                    ]
                ];
            }
        }
    }
    
    http_response_code(200);
    echo json_encode(['videos' => $videos]);
    exit;
} elseif (strpos($endpoint, '/channels/') !== false && strpos($endpoint, '/playlists') !== false) {
    // Kanal playlist listesi
    $playlists = [];
    if (isset($data['items'])) {
        foreach ($data['items'] as $item) {
            $playlists[] = [
                'playlistId' => $item['id'],
                'title' => $item['snippet']['title'],
                'videoCount' => $item['contentDetails']['itemCount'] ?? 0,
                'playlistThumbnail' => $item['snippet']['thumbnails']['medium']['url'] ?? ''
            ];
        }
    }
    
    http_response_code(200);
    echo json_encode(['playlists' => $playlists]);
    exit;
} elseif (strpos($endpoint, '/channels/') !== false && strpos($endpoint, '/videos') !== false) {
    // Kanal videoları
    $videos = [];
    if (isset($data['items'])) {
        foreach ($data['items'] as $item) {
            $videos[] = [
                'videoId' => $item['id']['videoId'] ?? $item['id'],
                'title' => $item['snippet']['title'],
                'videoThumbnails' => [
                    ['url' => $item['snippet']['thumbnails']['medium']['url'] ?? '']
                ]
            ];
        }
    }
    
    http_response_code(200);
    echo json_encode($videos);
    exit;
} elseif (strpos($endpoint, '/videos/') !== false) {
    // Video detayları
    if (isset($data['items'][0])) {
        $item = $data['items'][0];
        $result = [
            'videoId' => $item['id'],
            'title' => $item['snippet']['title'],
            'description' => $item['snippet']['description'],
            'author' => $item['snippet']['channelTitle'],
            'lengthSeconds' => 0,
            'viewCount' => $item['statistics']['viewCount'] ?? 0,
            'likeCount' => $item['statistics']['likeCount'] ?? 0,
            'videoThumbnails' => [
                ['url' => $item['snippet']['thumbnails']['medium']['url'] ?? '']
            ]
        ];
        
        http_response_code(200);
        echo json_encode($result);
        exit;
    }
}

// Direkt yanıtı döndür
http_response_code(200);
echo $response;
?>
