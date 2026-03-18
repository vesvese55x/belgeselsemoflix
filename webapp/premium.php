<?php
/**
 * BELGESELSEMO - Premium Üye Servisi
 * validate_premium_user.php + decrypt_premium_users.php birleşimi
 *
 * GET  ?action=list  → Tüm premium üyeleri listeler (CLI/tarayıcı)
 * POST (JSON body)   → Email/şifre doğrulama API'si
 */

$encryptionKey = 'BELGESELSEMO_PREMIUM_2026_SECRET_KEY_XYZ123';

// ── Yardımcı: AES-256-CBC çözme ──────────────────────────────────────────────
function decryptUser(string $encryptedB64, string $key): ?array {
    $decrypted = openssl_decrypt(
        base64_decode($encryptedB64),
        'AES-256-CBC',
        hash('sha256', $key),
        0,
        substr(hash('sha256', $key), 0, 16)
    );
    return $decrypted ? json_decode($decrypted, true) : null;
}

// ── Yardımcı: WordPress şifre doğrulama ──────────────────────────────────────
function verifyWpPassword(string $password, string $storedHash): bool {
    // WordPress 6.8+ $wp$2y$ formatı
    if (strncmp($storedHash, '$wp', 3) === 0) {
        $preHash = base64_encode(hash_hmac('sha384', trim($password), 'wp-sha384', true));
        return password_verify($preHash, substr($storedHash, 3));
    }
    // Standart bcrypt $2y$
    if (strncmp($storedHash, '$2y$', 4) === 0) {
        return password_verify($password, $storedHash);
    }
    // WordPress eski PHPass $P$ formatı
    if (strncmp($storedHash, '$P$', 3) === 0) {
        $itoa64     = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        $count_log2 = strpos($itoa64, $storedHash[3]);
        $count      = 1 << $count_log2;
        $salt       = substr($storedHash, 4, 8);
        $hash       = md5($salt . $password, true);
        do { $hash = md5($hash . $password, true); } while (--$count);
        $output = substr($storedHash, 0, 12);
        $i = 0;
        do {
            $value   = ord($hash[$i++]);
            $output .= $itoa64[$value & 0x3f];
            if ($i < 16) $value |= ord($hash[$i]) << 8;
            $output .= $itoa64[($value >> 6) & 0x3f];
            if ($i++ >= 16) break;
            if ($i < 16) $value |= ord($hash[$i]) << 16;
            $output .= $itoa64[($value >> 12) & 0x3f];
            if ($i++ >= 16) break;
            $output .= $itoa64[($value >> 18) & 0x3f];
        } while ($i < 16);
        return ($output === $storedHash);
    }
    return false;
}

$encryptionKey = 'BELGESELSEMO_PREMIUM_2026_SECRET_KEY_XYZ123';
$jsonUrl       = 'https://belgeselsemo.com.tr/php/data/premium_users.json';

// ── JSON dosyasını remote'tan oku ─────────────────────────────────────────────
$jsonRaw = @file_get_contents($jsonUrl);
if ($jsonRaw === false) {
    $ch = curl_init($jsonUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    $jsonRaw = curl_exec($ch);
    curl_close($ch);
}

if (!$jsonRaw) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'Premium kullanıcı veritabanı bulunamadı']);
    } else {
        die("❌ Hata: premium_users.json alınamadı!\n");
    }
    exit;
}

$jsonData = json_decode($jsonRaw, true);

if (!$jsonData || !isset($jsonData['users'])) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'error' => 'Veritabanı okunamadı']);
    } else {
        die("❌ Hata: JSON dosyası okunamadı!\n");
    }
    exit;
}

// ════════════════════════════════════════════════════════════════════════════
// GET ?action=list  →  Kullanıcı listesi (eski decrypt_premium_users.php)
// ════════════════════════════════════════════════════════════════════════════
if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($_GET['action'] ?? '') === 'list') {
    header('Content-Type: text/plain; charset=utf-8');
    echo "🔐 BELGESELSEMO - Premium Üyeler\n";
    echo "================================\n\n";
    echo "📅 Oluşturulma: " . ($jsonData['generated_at'] ?? '-') . "\n";
    echo "👥 Toplam: " . ($jsonData['total_premium_users'] ?? '?') . " aktif premium üye\n";
    echo "🔒 Şifreleme: " . ($jsonData['encryption'] ?? '-') . "\n\n";
    echo "================================\n\n";

    foreach ($jsonData['users'] as $index => $user) {
        $userData = decryptUser($user['data'], $encryptionKey);
        if (!$userData) {
            echo "❌ Kullanıcı #{$user['user_id']} - Şifre çözülemedi!\n\n";
            continue;
        }
        echo ($index + 1) . ". 👤 {$userData['display_name']}\n";
        echo "   📧 Email: {$userData['email']}\n";
        echo "   🔑 Username: {$userData['username']}\n";
        echo "   🔐 Hash: " . substr($userData['password_hash'] ?? 'YOK', 0, 20) . "...\n";
        echo "   📛 Nicename: {$userData['nicename']}\n";
        echo "   ⏰ Bitiş: {$userData['expire_time']}\n";
        echo "   🆔 User ID: {$user['user_id']}\n\n";
    }
    echo "================================\n";
    echo "✅ Tüm premium üyeler listelendi!\n";
    exit;
}

// ════════════════════════════════════════════════════════════════════════════
// POST  →  Email/şifre doğrulama (eski validate_premium_user.php)
// ════════════════════════════════════════════════════════════════════════════
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$input = json_decode(file_get_contents('php://input'), true);

if (!$input || !isset($input['email'], $input['password'])) {
    echo json_encode(['success' => false, 'error' => 'Eksik bilgi']);
    exit;
}

$inputEmail    = trim(strtolower($input['email']));
$inputPassword = $input['password'];

foreach ($jsonData['users'] as $user) {
    $userData = decryptUser($user['data'], $encryptionKey);
    if (!$userData) continue;
    if (strtolower($userData['email']) !== $inputEmail) continue;

    if (!isset($userData['password_hash'])) {
        echo json_encode(['success' => false, 'error' => 'Şifre verisi eksik. Lütfen SQL dosyasını tekrar yükleyin.']);
        exit;
    }

    if (!verifyWpPassword($inputPassword, $userData['password_hash'])) {
        echo json_encode(['success' => false, 'error' => 'Email veya şifre hatalı']);
        exit;
    }

    echo json_encode([
        'success' => true,
        'user'    => [
            'user_id'     => $user['user_id'],
            'name'        => $userData['display_name'],
            'email'       => $userData['email'],
            'username'    => $userData['username'],
            'expire_time' => $userData['expire_time'],
            'isPremium'   => true
        ]
    ]);
    exit;
}

echo json_encode(['success' => false, 'error' => 'Email veya şifre hatalı']);
