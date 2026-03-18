// ============================================
// YouTube Client - Google API v3
// Şifreli API key'ler ile güvenli çalışma
// ============================================

class YouTubeClient {
    constructor() {
        // Kanallar
        this.channels = [
            {
                handle: '@belgeselsemo',
                name: 'BELGESELSEMO (Eski Kanal)',
                id: 'UCgiXOjS4WIEvjXUePDXSxfg'
            },
            {
                handle: '@belgeselsemo55',
                name: 'BELGESELSEMO Learn & Explore',
                id: 'UCBvgyGpWHzUbPW10Kkp-FDw'
            },
            {
                handle: '@trtbelgesel',
                name: 'TRT Belgesel',
                id: 'UCdVBWUBCuREx1Q2Ikw9R8Mw'
            },
            {
                handle: '@DMAXTurkiye',
                name: 'DMAX Türkiye',
                id: 'UCuEgo07zsZr_FTcNTETRS5Q'
            },
            {
                handle: '@KhanAcademyTurkce',
                name: 'Khan Academy Türkçe',
                id: 'UC8hgx5hCiyDmO3UeBl95_1Q'
            },
            {
                handle: '@bebarbilim',
                name: 'Bebar Bilim',
                id: 'UCDTSUkdlbcgEU-IGH_mHgmw'
            },
            {
                handle: '@Holosen',
                name: 'HOLOSEN',
                id: 'UCy4BR1769dOmYbuCJCBcqEw'
            },
            {
                name: 'DİĞER',
                isMerged: true,
                subChannels: [
                    { name: 'FEY', id: 'UCXDPGKBmtGAjIaUrd7nYEOg' },
                    { name: 'NATURE EMPIRE TR', id: 'UC73GUWWHTahOKVo7l9cKHfw' }
                ]
            },
            {
                handle: '@FaynStudio',
                name: 'FAYN Studio',
                id: 'UCgEOWU0DQr7Hv2qS5YTY2qg'
            },
            {
                handle: '@Tarih101YT',
                name: 'TARİH 101',
                id: 'UCPlTdUoi8jAjEdk1wf5cQug'
            },
            {
                handle: '@Bilim101',
                name: 'BİLİM 101',
                id: 'UCdp2nCbhgw2nw-xZuZPHLiA'
            }
        ];
    }

    // PHP Proxy üzerinden API çağrısı
    async fetchAPI(endpoint, maxRetries = 2) {
        let lastError;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // PHP proxy kullan (CORS bypass)
                const proxyUrl = `/youtube-proxy.php?endpoint=${encodeURIComponent(endpoint)}`;
                console.log(`🔄 İstek (Proxy): ${endpoint}`);
                
                const response = await fetch(proxyUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    },
                    signal: AbortSignal.timeout(15000) // 15 saniye timeout
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                console.log(`✅ Başarılı (Proxy)`);
                return data;
                
            } catch (error) {
                console.warn(`⚠️ Hata (${attempt + 1}/${maxRetries}):`, error.message);
                lastError = error;
                
                // Son deneme değilse bekle
                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        throw new Error(`Proxy başarısız: ${lastError.message}`);
    }

    // Kanal playlist'lerini al
    async getChannelPlaylists(channelId) {
        try {
            const cacheKey = `playlists_${channelId}`;
            const cached = this.getCached(cacheKey);
            if (cached) {
                console.log(`💾 Cache: ${channelId}`);
                return cached;
            }

            const endpoint = `/api/v1/channels/${channelId}/playlists`;
            const data = await this.fetchAPI(endpoint);
            const playlists = data.playlists || [];

            this.setCache(cacheKey, playlists);
            console.log(`✅ ${playlists.length} playlist: ${channelId}`);
            return playlists;

        } catch (error) {
            console.error(`❌ Playlist hatası (${channelId}):`, error.message);
            return [];
        }
    }

    // Kanal videolarını al
    async getChannelVideos(channelId) {
        try {
            const endpoint = `/api/v1/channels/${channelId}/videos`;
            const data = await this.fetchAPI(endpoint);
            return (data.videos || data || []).map(v => ({
                ...v,
                videoId: v.videoId || v.id
            }));
        } catch (error) {
            console.error(`❌ Video hatası (${channelId}):`, error.message);
            return [];
        }
    }

    // Playlist videolarını al
    async getPlaylistVideos(playlistId) {
        try {
            const cacheKey = `playlist_videos_${playlistId}`;
            const cached = this.getCached(cacheKey);
            if (cached) {
                console.log(`💾 Cache: ${playlistId}`, cached);
                return cached;
            }

            if (playlistId.startsWith('videos_')) {
                const channelId = playlistId.replace('videos_', '');
                const videos = await this.getChannelVideos(channelId);
                this.setCache(cacheKey, videos);
                return videos;
            }

            const endpoint = `/api/v1/playlists/${playlistId}`;
            console.log(`📡 Playlist videoları çekiliyor: ${playlistId}`);
            const data = await this.fetchAPI(endpoint);
            console.log(`📦 Proxy yanıtı:`, data);
            
            const videos = (data.videos || []).map(v => ({
                ...v,
                videoId: v.videoId || v.id
            }));

            console.log(`✅ ${videos.length} video parse edildi`);
            this.setCache(cacheKey, videos);
            return videos;

        } catch (error) {
            console.error(`❌ Video hatası (${playlistId}):`, error.message);
            return [];
        }
    }

    // Video detaylarını al
    async getVideoDetails(videoId) {
        try {
            const cacheKey = `video_${videoId}`;
            const cached = this.getCached(cacheKey);
            if (cached) {
                console.log(`💾 Cache: ${videoId}`);
                return cached;
            }

            const endpoint = `/api/v1/videos/${videoId}`;
            const data = await this.fetchAPI(endpoint);
            this.setCache(cacheKey, data);
            return data;
            
        } catch (error) {
            console.error(`❌ Video detay hatası (${videoId}):`, error.message);
            throw error;
        }
    }


    // Tüm kanalları yükle
    async loadAllChannels() {
        const cached = this.getCached('all_channels');
        if (cached) {
            console.log('💾 Kanal listesi cache\'den geldi');
            return cached;
        }

        console.log('🚀 YouTube kanalları yükleniyor...');
        const results = [];

        for (const channel of this.channels) {
            try {
                console.log(`📡 Yükleniyor: ${channel.name}`);
                
                // Birleştirilmiş kanal (DİĞER)
                if (channel.isMerged) {
                    let playlists = [];
                    for (const sub of channel.subChannels) {
                        try {
                            const videos = await this.getChannelVideos(sub.id);
                            if (videos.length > 0) {
                                // Kanal avatar'ını çek
                                let channelAvatar = '';
                                try {
                                    const channelInfo = await this.fetchAPI(`/api/v1/channels/${sub.id}`);
                                    if (channelInfo?.authorThumbnails?.length > 0) {
                                        channelAvatar = channelInfo.authorThumbnails[channelInfo.authorThumbnails.length - 1].url;
                                    }
                                } catch (e) {
                                    console.warn(`⚠️ Avatar hatası: ${sub.name}`);
                                }

                                this.setCache(`playlist_videos_videos_${sub.id}`, videos);
                                playlists.push({
                                    id: `videos_${sub.id}`,
                                    title: sub.name,
                                    videoCount: videos.length,
                                    thumbnail: channelAvatar || (videos[0]?.videoThumbnails?.[0]?.url || '')
                                });
                            }
                        } catch (e) {
                            console.warn(`⚠️ Alt kanal hatası: ${sub.name}`);
                        }
                    }

                    if (playlists.length > 0) {
                        results.push({
                            ...channel,
                            id: 'merged_diger',
                            playlists: playlists
                        });
                        console.log(`✅ ${channel.name}: ${playlists.length} playlist`);
                    }
                    continue;
                }

                // Normal kanal
                let channelId = channel.id;
                if (!channelId) {
                    console.warn(`⚠️ Kanal ID yok: ${channel.name}`);
                    continue;
                }

                let playlists = [];
                
                if (channel.fetchVideos) {
                    const videos = await this.getChannelVideos(channelId);
                    if (videos.length > 0) {
                        this.setCache(`playlist_videos_videos_${channelId}`, videos);
                        playlists = [{
                            playlistId: `videos_${channelId}`,
                            title: 'Tüm Videolar',
                            videoCount: videos.length,
                            playlistThumbnail: videos[0]?.videoThumbnails?.[0]?.url || ''
                        }];
                    }
                } else {
                    playlists = await this.getChannelPlaylists(channelId);
                }

                if (playlists.length > 0) {
                    results.push({
                        ...channel,
                        id: channelId,
                        playlists: playlists.map(p => ({
                            id: p.playlistId,
                            title: p.title,
                            videoCount: p.videoCount,
                            thumbnail: p.playlistThumbnail || p.videos?.[0]?.videoThumbnails?.[0]?.url || ''
                        }))
                    });
                    console.log(`✅ ${channel.name}: ${playlists.length} playlist`);
                }

            } catch (error) {
                console.error(`❌ Kanal hatası: ${channel.name}`, error.message);
                continue;
            }
        }

        console.log(`✅ Toplam ${results.length} kanal yüklendi`);
        this.setCache('all_channels', results);
        return results;
    }

    // Cache yönetimi
    getCached(key) {
        try {
            const item = localStorage.getItem(`yt_simple_${key}`);
            if (!item) return null;

            const { data, cacheDate } = JSON.parse(item);
            const today = new Date().toISOString().split('T')[0];

            if (cacheDate !== today) {
                localStorage.removeItem(`yt_simple_${key}`);
                return null;
            }

            return data;
        } catch (error) {
            return null;
        }
    }

    setCache(key, data) {
        try {
            const today = new Date().toISOString().split('T')[0];
            const item = { data, cacheDate: today };
            localStorage.setItem(`yt_simple_${key}`, JSON.stringify(item));
        } catch (error) {
            console.warn('Cache hatası:', error);
        }
    }

    clearCache() {
        const keys = Object.keys(localStorage);
        keys.forEach(key => {
            if (key.startsWith('yt_simple_')) {
                localStorage.removeItem(key);
            }
        });
        console.log('🗑️ Cache temizlendi');
    }
}

// Global instance
const youtubeClient = new YouTubeClient();

// Export
if (typeof window !== 'undefined') {
    window.youtubeClient = youtubeClient;
}
