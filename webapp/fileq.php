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
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        error_log("FileQ API Error: HTTP $httpCode - $error");
        return false;
    }
    
    $data = json_decode($response, true);
    
    if (!$data || !isset($data['result'])) {
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
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($httpCode !== 200) return false;
    return json_decode($response, true);
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
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'Stats alınamadı']);
        } else {
            echo json_encode(['success' => true, 'result' => $stats['result'] ?? $stats]);
        }
        exit;
    }
    
    // Tüm dosyaları çek
    $files = getAllFileQFiles($fldId, $public);
    
    if ($files === false || empty($files)) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Dosyalar yüklenemedi veya hiç dosya bulunamadı',
            'total' => 0,
            'files' => []
        ]);
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
