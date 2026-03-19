<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$allowedFiles = [
    'all_documentaries.json',
    'single_documentaries.json',
    'series_documentaries.json',
    'episodes.json',
    'categories.json',
    'download_links.json',
];

$file = $_GET['file'] ?? '';
if (!in_array($file, $allowedFiles, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_file'], JSON_UNESCAPED_UNICODE);
    exit;
}

$remoteUrl = 'https://belgeselsemo.com.tr/php/data/' . rawurlencode($file);

$payload = null;

if (function_exists('curl_init')) {
    $ch = curl_init($remoteUrl);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_ENCODING => '',
        CURLOPT_HTTPHEADER => [
            'Accept: application/json',
            'User-Agent: BELGESELSEMOFLIX Desktop',
        ],
    ]);

    $result = curl_exec($ch);
    $httpCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($result !== false && $httpCode >= 200 && $httpCode < 300) {
        $payload = $result;
    } else {
        error_log("data-proxy curl failed for {$file}: code={$httpCode} error={$curlError}");
    }
}

if ($payload === null) {
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 60,
            'header' => "Accept: application/json\r\nUser-Agent: BELGESELSEMOFLIX Desktop\r\n",
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ]);

    $result = @file_get_contents($remoteUrl, false, $context);
    if ($result !== false) {
        $payload = $result;
    }
}

if ($payload === null) {
    http_response_code(502);
    echo json_encode(['error' => 'upstream_fetch_failed', 'file' => $file], JSON_UNESCAPED_UNICODE);
    exit;
}

echo $payload;
