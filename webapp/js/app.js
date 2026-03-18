// ============================================
// BELGESELSEMO FLIX - TÜM KATEGORİLER
// Gerçek kategoriler tags'den çekiliyor
// ============================================

class BelgeselSemoFlix {
    constructor() {
        this.data = {
            all: [],
            singles: [],
            series: [],
            episodes: [],
            categories: {},
            downloadLinks: []  // İndirme linkleri için boş array
        };

        this.categoryDocuments = {}; // Kategori -> Belgeseller mapping

        this.state = {
            currentPage: 'home',
            searchActive: false,
            filters: {
                year: null,
                duration: null,
                rating: null,
                category: null,
                country: null
            },
            sortBy: 'default' // default, rating-high, rating-low, alpha-asc, alpha-desc, most-watched
        };

        // localStorage'dan tüm verileri yükle
        this.favorites = JSON.parse(localStorage.getItem('favorites') || '[]');
        this.watchlist = JSON.parse(localStorage.getItem('watchlist') || '[]');
        this.continueWatching = JSON.parse(localStorage.getItem('continueWatching') || '[]'); // {id, timestamp, duration}
        this.watched = JSON.parse(localStorage.getItem('watched') || '[]'); // İzlenenler
        this.notes = JSON.parse(localStorage.getItem('notes') || '{}'); // {docId: "not metni"}
        this.watchHistory = JSON.parse(localStorage.getItem('watchHistory') || '[]'); // {id, timestamp, duration}

        this.playerStartTime = null; // Player açılma zamanı
        this.currentPlayingId = null; // Şu an oynatılan belgesel ID

        this.imageObserver = null;
        this.navigationHistory = []; // Stack for navigation history
        this.currentPage = 'home';
        
        // Popup engelleyiciyi aktif et
        this.setupPopupBlocker();
        
        this.init();
        this.previousPageState = null; // Store previous page for back navigation
    }

    async init() {
        this.showLoading();
        await this.loadData();
        this.buildCategoryMappings();
        this.setupLazyLoading();
        this.setupEventListeners();
        this.renderPage('home');
        this.hideLoading();
    }

    // ============================================
    // DATA LOADING
    // ============================================

    async loadData() {
        const BASE = 'https://belgeselsemo.com.tr/php/data';
        try {
            const [all, singles, series, episodes, categoriesData, downloadLinks] = await Promise.all([
                fetch(`${BASE}/all_documentaries.json`).then(r => r.json()),
                fetch(`${BASE}/single_documentaries.json`).then(r => r.json()),
                fetch(`${BASE}/series_documentaries.json`).then(r => r.json()),
                fetch(`${BASE}/episodes.json`).then(r => r.json()),
                fetch(`${BASE}/categories.json`).then(r => r.json()),
                fetch(`${BASE}/download_links.json`).then(r => r.json()).catch(() => [])
            ]);

            this.data.all = all;
            this.data.singles = singles;
            this.data.series = series;
            this.data.episodes = episodes;
            this.data.categories = categoriesData.all || categoriesData;
            this.data.downloadLinks = downloadLinks;

            console.log(`✅ ${all.length} belgesel, ${singles.length} tek bölümlük, ${series.length} seri yüklendi!`);
            console.log(`📂 ${this.data.categories.length} kategori bulundu`);
            console.log(`💾 ${downloadLinks.length} indirme linki yüklendi`);

            // Footer istatistiklerini güncelle
            const footerStats = document.getElementById('footerStats');
            if (footerStats) {
                footerStats.textContent = `${singles.length} Tek • ${series.length} Seri • ${episodes.length} Bölüm`;
            }
        } catch (error) {
            console.error('❌ Hata:', error);
            if (window.customAlert) {
                window.customAlert('Veriler yüklenirken hata oluştu!', 'Hata', '❌');
            } else {
                alert('Veriler yüklenirken hata oluştu!');
            }
        }
    }

    // ============================================
    // KATEGORİ MAPPING
    // ============================================

    buildCategoryMappings() {
        console.log('📂 Kategori mappinglari oluşturuluyor...');

        // Sadece post_tag taxonomy'li gerçek kategorileri al
        const realCategories = this.data.categories.filter(cat =>
            cat.taxonomy === 'post_tag' && cat.count > 0
        );

        console.log(`✅ ${realCategories.length} gerçek kategori bulundu`);

        // Her kategori için belgeselleri eşleştir
        realCategories.forEach(category => {
            const categoryName = category.name;
            const categorySlug = category.slug;

            // Tüm belgesellerde tags alanını kontrol et (TÜM TİPLER: post, tv, episode)
            const matchingDocs = this.data.all.filter(doc => {
                if (!doc.tags || doc.tags.length === 0) return false;

                // Tags'de bu kategori var mı?
                return doc.tags.some(tag =>
                    tag === categoryName ||
                    this.slugify(tag) === categorySlug ||
                    tag.toLowerCase() === categoryName.toLowerCase()
                );
            });

            if (matchingDocs.length > 0) {
                // Tek bölümlük ve seri sayılarını ayrı hesapla
                const singles = matchingDocs.filter(d => d.type === 'post');
                const series = matchingDocs.filter(d => d.type === 'tv');
                const episodes = matchingDocs.filter(d => d.type === 'episode');

                this.categoryDocuments[categoryName] = {
                    slug: categorySlug,
                    docs: matchingDocs,
                    count: matchingDocs.length,
                    singles: singles.length,
                    series: series.length,
                    episodes: episodes.length,
                    emoji: this.getCategoryEmoji(categoryName)
                };

                console.log(`  ✓ ${categoryName}: ${matchingDocs.length} içerik (${singles.length} tek bölümlük + ${series.length} seri + ${episodes.length} bölüm)`);
            }
        });

        console.log(`✅ ${Object.keys(this.categoryDocuments).length} kategoriye içerik eşleştirildi!`);
    }

    // ============================================
    // LAZY LOADING
    // ============================================

    setupLazyLoading() {
        this.imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.classList.add('loaded');
                        // fallback varsa onerror ekle
                        if (img.dataset.fallback) {
                            img.onerror = () => {
                                img.onerror = null;
                                img.src = img.dataset.fallback;
                            };
                        }
                        this.imageObserver.unobserve(img);
                    }
                }
            });
        }, { rootMargin: '300px' });
    }

    observeImages() {
        document.querySelectorAll('img[data-src]').forEach(img => {
            this.imageObserver.observe(img);
        });
    }

    // ============================================
    // EVENT LISTENERS
    // ============================================

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateTo(page);
            });
        });

        // Logo Click -> Home
        const logo = document.querySelector('.logo');
        if (logo) {
            logo.addEventListener('click', () => {
                // Clear history when going to home
                this.navigationHistory = [];
                this.currentPage = 'home';
                this.previousPageState = null;
                this.navigateTo('home');
            });
        }

        // Footer links
        document.querySelectorAll('.footer a[data-page]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo(link.dataset.page);
            });
        });

        // Search
        const searchBtn = document.getElementById('searchBtn');
        const searchClose = document.getElementById('searchClose');
        const searchInput = document.getElementById('searchInput');
        const searchOverlay = document.getElementById('searchOverlay');

        searchBtn.addEventListener('click', () => this.openSearch());

        // Download button (header)
        const downloadBtn = document.getElementById('downloadBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.openTool('downloads', 'Belgesel İndir');
            });
        }

        // Random Watch
        const randomBtn = document.getElementById('randomBtn');
        if (randomBtn) {
            randomBtn.addEventListener('click', () => this.playRandom());
        }
        searchClose.addEventListener('click', () => this.closeSearch());
        searchOverlay.addEventListener('click', (e) => {
            if (e.target === searchOverlay) this.closeSearch();
        });

        searchInput.addEventListener('input', (e) => {
            this.performSearch(e.target.value);
        });

        // Mobile menu toggle - BASİT ÇÖZÜM
        const menuToggle = document.getElementById('menuToggle');
        const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
        const mobileMenuPopup = document.getElementById('mobileMenuPopup');

        if (menuToggle && mobileMenuOverlay && mobileMenuPopup) {
            // Hamburger'a tıklayınca menüyü aç
            menuToggle.addEventListener('click', () => {
                mobileMenuOverlay.classList.add('active');
                mobileMenuPopup.classList.add('active');
                document.body.style.overflow = 'hidden';
            });

            // Overlay'e tıklayınca menüyü kapat
            mobileMenuOverlay.addEventListener('click', () => {
                mobileMenuOverlay.classList.remove('active');
                mobileMenuPopup.classList.remove('active');
                document.body.style.overflow = '';
            });

            // Menü linklerine tıklayınca
            document.querySelectorAll('#mobileMenuPopup .nav-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const page = link.dataset.page;

                    // Save current page to history before navigation
                    this.pushHistory(page);

                    // Close mobile menu
                    mobileMenuOverlay.classList.remove('active');
                    mobileMenuPopup.classList.remove('active');
                    document.body.style.overflow = '';

                    // Update active link and navigate
                    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                    link.classList.add('active');
                    this.loadPage(page);
                });
            });
        }

        // Modal close
        document.getElementById('modalOverlay').addEventListener('click', () => this.closeModal());
        document.getElementById('playerOverlay').addEventListener('click', () => this.closePlayer());
        document.getElementById('playerClose').addEventListener('click', () => this.closePlayer());
        
        // DsmartGo button
        document.getElementById('dsmartGoBtn').addEventListener('click', (e) => {
            e.preventDefault();
            this.openTool('dsmartgo', 'DsmartGo & Extra');
        });
        document.getElementById('dsmartGoMobileBtn').addEventListener('click', (e) => {
            e.preventDefault();
            this.openTool('dsmartgo', 'DsmartGo & Extra');
        });
    }

    // ============================================
    // NAVIGATION
    // ============================================

    navigateTo(page) {
        // Save current page to history before navigation
        this.pushHistory(page);

        this.state.currentPage = page;

        // Clear tool-has-tabs when navigating away
        document.body.classList.remove('tool-has-tabs');

        // Update active nav
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });

        // Close mobile menu
        document.querySelector('.nav-menu').classList.remove('active');

        // Render page
        this.renderPage(page);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    renderPage(page) {
        const content = document.getElementById('contentArea');

        switch (page) {
            case 'home':
                this.renderHomePage();
                break;
            case 'documentaries':
                this.renderDocumentariesPage();
                break;
            case 'series':
                this.renderSeriesPage();
                break;
            case 'categories':
                this.renderCategoriesPage();
                break;
            case 'tools':
                this.renderToolsPage();
                break;
            case 'youtube':
                this.renderYouTubePage();
                break;
            case 'favorites':
                this.renderFavoritesPage();
                break;
            case 'watchlist':
                this.renderWatchlistPage();
                break;
            case 'statistics':
                this.renderStatisticsPage();
                break;
            default:
                this.renderHomePage();
        }
    }

    // ============================================
    // HOME PAGE - TÜM KATEGORİLER
    // ============================================

    renderHomePage() {
        const content = document.getElementById('contentArea');

        // Featured içerikler (sadece post ve tv, episodes hariç)
        // Tüm içerikleri al ve rastgele sırala
        const allDocs = this.data.all || [];
        const shuffledDocs = this.shuffleArray([...allDocs]);

        const seriesDocs = shuffledDocs.filter(d => d.type === 'tv').slice(0, 40);
        const singleDocs = shuffledDocs.filter(d => d.type === 'post').slice(0, 40);

        // Kategorileri alfabetik sırala
        const sortedCategories = Object.entries(this.categoryDocuments)
            .sort(([a], [b]) => a.localeCompare(b, 'tr'));

        let html = `
            <!-- FEATURED CAROUSEL -->
            <div class="featured-carousel-container">
                <!-- Tabs -->
                <div class="featured-tabs">
                    <div class="featured-tab active" onclick="app.switchFeaturedTab('series')">
                        Seri Belgeseller
                    </div>
                    <div class="featured-tab" onclick="app.switchFeaturedTab('singles')">
                        Tek Belgeseller
                    </div>
                </div>
                
                <div class="featured-carousel" id="featuredCarousel">
                    <!-- Seri Belgeseller -->
                    <div class="featured-slide active" data-tab="series">
                        <div class="featured-content">
                            ${seriesDocs.map(doc => {
            const cleanDesc = this.cleanDescription(doc.description || doc.content);

            let seasonEpisodeBadge = '';
            if (doc.type === 'tv') {
                const seriesInfo = this.getSeriesInfo(doc.id);
                if (seriesInfo.seasons > 0 && seriesInfo.episodes > 0) {
                    seasonEpisodeBadge = `<div class="season-badge">S${seriesInfo.seasons}-B${seriesInfo.episodes}</div>`;
                }
            }

            return `
                                <div class="featured-item" onclick="app.showModal(${doc.id})">
                                    <div class="featured-poster">
                                        <img src="${this.getPoster(doc)}" alt="${doc.title}" onerror="this.src='https://picsum.photos/seed/${doc.id}a/300/450'">
                                        <div class="card-badge">${this.getTypeBadge(doc.type)}</div>
                                        ${seasonEpisodeBadge}
                                    </div>
                                    <div class="featured-info">
                                        <h3 class="featured-title">${doc.title}</h3>
                                        <div class="featured-description">${cleanDesc}</div>
                                        <div class="featured-date">${doc.date || (doc.year ? doc.year : 'Tarih bilgisi yok')}</div>
                                    </div>
                                </div>
                                `;
        }).join('')}
                        </div>
                    </div>
                    
                    <!-- Tek Belgeseller -->
                    <div class="featured-slide" data-tab="singles">
                        <div class="featured-content">
                            ${singleDocs.map(doc => {
            const cleanDesc = this.cleanDescription(doc.description || doc.content);
            return `
                                <div class="featured-item" onclick="app.showModal(${doc.id})">
                                    <div class="featured-poster">
                                        <img src="${this.getPoster(doc)}" alt="${doc.title}" onerror="this.src='https://picsum.photos/seed/${doc.id}b/300/450'">
                                        <div class="card-badge">${this.getTypeBadge(doc.type)}</div>
                                    </div>
                                    <div class="featured-info">
                                        <h3 class="featured-title">${doc.title}</h3>
                                        <div class="featured-description">${cleanDesc}</div>
                                        <div class="featured-date">${doc.date || (doc.year ? doc.year : 'Tarih bilgisi yok')}</div>
                                    </div>
                                </div>
                                `;
        }).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;

        html += `
            <!-- NETFLIX CAROUSEL SECTIONS -->
            <div class="netflix-rows">
        `;

        // CONTINUE WATCHING SECTION (netflix-rows içinde)
        const continueWatchingDocs = this.continueWatching
            .map(item => this.data.all.find(d => d.id === item.id))
            .filter(d => d); // null/undefined temizle


        const appPromos = [
            {
                id: 'app_belgeselsemo',
                title: 'BELGESELSEMO',
                subtitle: 'Mobil Uygulama',
                poster: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby50cl9pY29uXzE3NTczODg3NzZfMDc5/icon.png?w=256&fakeurl=1',
                banner: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby50cl9pY29uXzE3NTczODg3NzZfMDc5/icon.png?w=256&fakeurl=1',
                description: 'Binlerce HD belgesel ve 30\'dan fazla ücretsiz araç tek bir uygulamada! Hesap makinesi, not defteri, hava durumu, EPG viewer, wiki ve daha fazlası. 13 dil desteği ile her yerde yanınızda.',
                playstore: 'https://play.google.com/store/apps/details?id=com.belgeselsemo.tr',
                badge: '🤖 Uygulama'
            },
            {
                id: 'app_nutuk',
                title: 'NUTUK 1919-1927',
                subtitle: 'Mobil Uygulama',
                poster: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5udXR1a19pY29uXzE3NjMxNDQzOTZfMDk2/icon.png?w=256&fakeurl=1',
                banner: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5udXR1a19pY29uXzE3NjMxNDQzOTZfMDk2/icon.png?w=256&fakeurl=1',
                description: 'Atatürk\'ün ölümsüz eseri Nutuk, en kapsamlı dijital deneyimle cebinizde! 20+ dilde okuyun, sesli kitap olarak dinleyin, interaktif bilgi yarışmasıyla test edin. Entegre sözlük ve 15+ tema.',
                playstore: 'https://play.google.com/store/apps/details?id=com.belgeselsemo.nutuk',
                badge: '🤖 Uygulama'
            },
            {
                id: 'app_epgviewer',
                title: 'BELGESELSEMO TV REHBERİ',
                subtitle: 'Mobil Uygulama',
                poster: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5lcGd2aWV3ZXJfaWNvbl8xNzYwOTEyMTc4XzAyNg/icon.png?w=256&fakeurl=1',
                banner: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5lcGd2aWV3ZXJfaWNvbl8xNzYwOTEyMTc4XzAyNg/icon.png?w=256&fakeurl=1',
                description: '250\'den fazla EPG kaynağı ile dünyanın dört bir yanından binlerce TV kanalının yayın akışı parmaklarınızın ucunda! 15+ cam efektli tema, favori sistemi, akıllı hatırlatıcı ve XMLTV desteği.',
                playstore: 'https://play.google.com/store/apps/details?id=com.belgeselsemo.epgviewer',
                badge: '🤖 Uygulama'
            },
            {
                id: 'app_nb724',
                title: 'NÖBETÇİ ECZANELER 7/24',
                subtitle: 'Mobil Uygulama',
                poster: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5uYjcyNF9pY29uXzE3NjAzOTg1NzhfMDg4/icon.png?w=256&fakeurl=1',
                banner: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5uYjcyNF9pY29uXzE3NjAzOTg1NzhfMDg4/icon.png?w=256&fakeurl=1',
                description: 'Türkiye\'nin 81 ili ve KKTC\'deki tüm nöbetçi eczaneleri anında bulun! GPS ile en yakın eczane, harita görünümü, tek dokunuşla arama ve yol tarifi. 15+ tema, 7 dil desteği.',
                playstore: 'https://play.google.com/store/apps/details?id=com.belgeselsemo.nb724',
                badge: '🤖 Uygulama'
            },
            {
                id: 'app_trivia',
                title: 'BELGESELSEMO TRIVIA',
                subtitle: 'Mobil Uygulama',
                poster: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby50cml2aWFfaWNvbl8xNzU2OTI2NTcyXzA3MA/icon.png?w=256&fakeurl=1',
                banner: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby50cml2aWFfaWNvbl8xNzU2OTI2NTcyXzA3MA/icon.png?w=256&fakeurl=1',
                description: 'Zekanıza meydan okuyun! 24 farklı kategori, binlerce soru, 18+ dil desteği. Seviye atlama sistemi, 4 joker hakkı, günlük meydan okuma ve yüksek puanlar listesi ile Türkiye\'nin en eğlenceli trivia oyunu!',
                playstore: 'https://play.google.com/store/apps/details?id=com.belgeselsemo.trivia',
                badge: '🤖 Uygulama'
            }
        ];

        const showContinueSection = continueWatchingDocs.length > 0 || appPromos.length > 0;

        if (showContinueSection) {
            const totalCount = continueWatchingDocs.length + appPromos.length;
            html += `
                <div class="netflix-row continue-watching-section">
                    <div class="row-header">
                        <h2 class="row-title">📺 Kaldığınız Yerden Devam Edin</h2>
                        <span class="row-count">${continueWatchingDocs.length > 0 ? continueWatchingDocs.length + ' belgesel' : 'Uygulamalarımız'}</span>
                    </div>
                    <div class="row-slider" data-row="continue">
                        <button class="slider-btn slider-btn-prev" data-row="continue" style="display: none;">
                            <i class="fas fa-chevron-left"></i>
                        </button>
                        <div class="slider-content" data-row="continue">
                            ${continueWatchingDocs.map(doc => {
                let seasonEpisodeBadge = '';
                if (doc.type === 'tv') {
                    const seriesInfo = this.getSeriesInfo(doc.id);
                    if (seriesInfo.seasons > 0 && seriesInfo.episodes > 0) {
                        seasonEpisodeBadge = `<div class="season-badge">S${seriesInfo.seasons}-B${seriesInfo.episodes}</div>`;
                    }
                }
                return `
                                <div class="netflix-card" onclick="app.showModal(${doc.id})">
                                    <div class="card-image">
                                        <img data-src="${this.getPoster(doc)}" alt="${doc.title}">
                                        <div class="card-badge">${this.getTypeBadge(doc.type)}</div>
                                        ${seasonEpisodeBadge}
                                        <div class="card-overlay">
                                            <div class="card-play">
                                                <i class="fas fa-play-circle"></i>
                                            </div>
                                        </div>
                                        <div class="continue-badge">
                                            <i class="fas fa-history"></i>
                                        </div>
                                    </div>
                                    <div class="card-title">${doc.title}</div>
                                    <div class="card-meta">
                                        ${doc.year ? `<span>${doc.year}</span>` : ''}
                                        ${doc.rating ? `<span>⭐ ${doc.rating}</span>` : ''}
                                    </div>
                                </div>
                                `;
            }).join('')}
                            ${appPromos.map(app => `
                                <div class="netflix-card app-promo-card" onclick="app.showAppModal('${app.id}')">
                                    <div class="card-image">
                                        <img data-src="${app.poster}" data-fallback="${app.banner}" alt="${app.title}">
                                        <div class="card-badge app-badge">${app.badge}</div>
                                        <div class="card-overlay">
                                            <div class="card-play">
                                                <i class="fas fa-play-circle"></i>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="card-title">${app.title}</div>
                                    <div class="card-meta">
                                        <span>BELGESELSEMO</span>
                                        <span>📲 Ücretsiz</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        <button class="slider-btn slider-btn-next" data-row="continue">
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        // SON EKLENENLER SECTION
        const recentlyAddedDocs = [...allDocs]
            .filter(d => d.type === 'post' || d.type === 'tv') // Sadece tek ve seri belgeseller
            .filter(d => d.date) // Tarihi olanlar
            .sort((a, b) => new Date(b.date) - new Date(a.date)); // En yeniden eskiye (sınır yok)

        if (recentlyAddedDocs.length > 0) {
            html += `
                <div class="netflix-row recently-added-section">
                    <div class="row-header">
                        <h2 class="row-title">🆕 Son Eklenenler</h2>
                        <span class="row-count" onclick="app.showRecentlyAdded()" title="Tümünü Gör">${recentlyAddedDocs.length} belgesel</span>
                    </div>
                    <div class="row-slider" data-row="recent">
                        <button class="slider-btn slider-btn-prev" data-row="recent" style="display: none;">
                            <i class="fas fa-chevron-left"></i>
                        </button>
                        <div class="slider-content" data-row="recent">
                            ${recentlyAddedDocs.map(doc => {
                let seasonEpisodeBadge = '';
                if (doc.type === 'tv') {
                    const seriesInfo = this.getSeriesInfo(doc.id);
                    if (seriesInfo.seasons > 0 && seriesInfo.episodes > 0) {
                        seasonEpisodeBadge = `<div class="season-badge">S${seriesInfo.seasons}-B${seriesInfo.episodes}</div>`;
                    }
                }
                
                // Tarihi gg.aa.yy formatına çevir
                const dateLabel = this.formatDateShort(doc.date);
                
                return `
                                <div class="netflix-card" onclick="app.showModal(${doc.id})">
                                    <div class="card-image">
                                        <img data-src="${this.getPoster(doc)}" alt="${doc.title}">
                                        <div class="card-badge">${this.getTypeBadge(doc.type)}</div>
                                        ${seasonEpisodeBadge}
                                        <div class="card-overlay">
                                            <div class="card-play">
                                                <i class="fas fa-play-circle"></i>
                                            </div>
                                        </div>
                                        ${this.isWatched(doc.id) ? '<div class="watched-badge"><i class="fas fa-check-circle"></i></div>' : ''}
                                        <div class="date-badge">${dateLabel}</div>
                                    </div>
                                    <div class="card-title">${doc.title}</div>
                                    <div class="card-meta">
                                        ${doc.year ? `<span>${doc.year}</span>` : ''}
                                        ${doc.rating ? `<span>⭐ ${doc.rating}</span>` : ''}
                                    </div>
                                </div>
                                `;
            }).join('')}
                        </div>
                        <button class="slider-btn slider-btn-next" data-row="recent">
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            `;
        }

        // TÜM KATEGORİLERİ NETFLIX TARZI CAROUSEL OLARAK EKLE
        sortedCategories.forEach(([categoryName, categoryData], index) => {
            // Sadece post ve tv tiplerini göster (episode'ları hariç tut), en yeniden eskiye sırala
            const filteredDocs = categoryData.docs
                .filter(d => d.type === 'post' || d.type === 'tv')
                .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

            if (filteredDocs.length === 0) return;

            html += `
                <div class="netflix-row">
                    <div class="row-header">
                        <h2 class="row-title">${categoryData.emoji} ${categoryName}</h2>
                        <span class="row-count" onclick="app.showCategoryByName('${categoryName.replace(/'/g, "\\'")}')" title="Tümünü Gör">${filteredDocs.length} içerik</span>
                    </div>
                    <div class="row-slider" data-row="${index}">
                        <button class="slider-btn slider-btn-prev" data-row="${index}" style="display: none;">
                            <i class="fas fa-chevron-left"></i>
                        </button>
                        <div class="slider-content" data-row="${index}">
                            ${filteredDocs.map(doc => {
                let seasonEpisodeBadge = '';
                if (doc.type === 'tv') {
                    const seriesInfo = this.getSeriesInfo(doc.id);
                    if (seriesInfo.seasons > 0 && seriesInfo.episodes > 0) {
                        seasonEpisodeBadge = `<div class="season-badge">S${seriesInfo.seasons}-B${seriesInfo.episodes}</div>`;
                    }
                }
                return `
                                <div class="netflix-card" onclick="app.showModal(${doc.id})">
                                    <div class="card-image">
                                        <img data-src="${this.getPoster(doc)}" alt="${doc.title}">
                                        <div class="card-badge">${this.getTypeBadge(doc.type)}</div>
                                        ${seasonEpisodeBadge}
                                        <div class="card-overlay">
                                            <div class="card-play">
                                                <i class="fas fa-play-circle"></i>
                                            </div>
                                        </div>
                                        ${this.isWatched(doc.id) ? '<div class="watched-badge"><i class="fas fa-check-circle"></i></div>' : ''}
                                    </div>
                                    <div class="card-title">${doc.title}</div>
                                    <div class="card-meta">
                                        ${doc.year ? `<span>${doc.year}</span>` : ''}
                                        ${doc.rating ? `<span>⭐ ${doc.rating}</span>` : ''}
                                    </div>
                                </div>
                                `;
            }).join('')}
                        </div>
                        <button class="slider-btn slider-btn-next" data-row="${index}">
                            <i class="fas fa-chevron-right"></i>
                        </button>
                    </div>
                </div>
            `;
        });

        html += `</div>`;

        content.innerHTML = html;

        this.setupNetflixSliders();
        requestAnimationFrame(() => this.observeImages());

        console.log(`✅ Netflix tarzı Ana Sayfa render edildi: ${sortedCategories.length} kategori!`);
    }

    switchFeaturedTab(tabName) {
        // Tüm tab'ları pasif yap
        document.querySelectorAll('.featured-tab').forEach(tab => {
            tab.classList.remove('active');
        });

        // Tüm slide'ları gizle
        document.querySelectorAll('.featured-slide').forEach(slide => {
            slide.classList.remove('active');
        });

        // Tıklanan tab'ı aktif yap
        event.target.classList.add('active');

        // İlgili slide'ı göster
        const targetSlide = document.querySelector(`.featured-slide[data-tab="${tabName}"]`);
        if (targetSlide) {
            targetSlide.classList.add('active');
        }
    }

    // ============================================
    // CAROUSEL SECTION COMPONENT
    // ============================================

    renderCarouselSection(title, items, id, seeAllPage = null, subtitle = null) {
        if (!items || items.length === 0) return '';

        return `
            <section class="carousel-section">
                <div class="section-header">
                    <div>
                        <h2>${title}</h2>
                        ${subtitle ? `<span class="category-count">${subtitle}</span>` : ''}
                    </div>
                    ${seeAllPage ? `<a href="#" class="see-all" data-page="${seeAllPage}">Tümünü Gör →</a>` : ''}
                </div>
                ${this.renderCarousel(items, id)}
            </section>
        `;
    }

    // ============================================
    // CAROUSEL COMPONENT
    // ============================================

    renderCarousel(items, id) {
        if (!items || items.length === 0) return '<p>İçerik bulunamadı</p>';

        return `
            <div class="carousel" data-carousel="${id}">
                <button class="carousel-btn carousel-btn-prev" data-carousel="${id}">
                    <i class="fas fa-chevron-left"></i>
                </button>
                <div class="carousel-track">
                    ${items.map(item => this.renderCarouselCard(item)).join('')}
                </div>
                <button class="carousel-btn carousel-btn-next" data-carousel="${id}">
                    <i class="fas fa-chevron-right"></i>
                </button>
            </div>
        `;
    }

    renderCarouselCard(doc) {
        // Seri belgesel için sezon ve bölüm sayısını hesapla
        let seasonEpisodeBadge = '';
        if (doc.type === 'tv') {
            const seriesInfo = this.getSeriesInfo(doc.id);
            if (seriesInfo.seasons > 0 && seriesInfo.episodes > 0) {
                seasonEpisodeBadge = `<div class="season-badge">S${seriesInfo.seasons}-B${seriesInfo.episodes}</div>`;
            }
        }

        return `
            <div class="carousel-card" onclick="app.showModal(${doc.id})">
                <div class="carousel-card-poster">
                    <img data-src="${this.getPoster(doc)}" alt="${doc.title}">
                    <div class="card-badge">${this.getTypeBadge(doc.type)}</div>
                    ${seasonEpisodeBadge}
                </div>
                <div class="carousel-card-info">
                    <h4>${doc.title}</h4>
                    <div class="card-meta">
                        ${doc.year ? `<span>${doc.year}</span>` : ''}
                        ${doc.rating ? `<span>⭐ ${doc.rating}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    setupNetflixSliders() {
        document.querySelectorAll('.slider-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rowIndex = btn.dataset.row;
                const sliderContent = document.querySelector(`.slider-content[data-row="${rowIndex}"]`);
                const cardWidth = 280; // Netflix card genişliği
                const visibleCards = Math.floor(sliderContent.offsetWidth / cardWidth);
                const scrollAmount = cardWidth * visibleCards;

                if (btn.classList.contains('slider-btn-prev')) {
                    sliderContent.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
                } else {
                    sliderContent.scrollBy({ left: scrollAmount, behavior: 'smooth' });
                }

                // Buton görünürlüğünü güncelle
                setTimeout(() => {
                    const prevBtn = document.querySelector(`.slider-btn-prev[data-row="${rowIndex}"]`);
                    const nextBtn = document.querySelector(`.slider-btn-next[data-row="${rowIndex}"]`);

                    if (prevBtn) {
                        prevBtn.style.display = sliderContent.scrollLeft > 0 ? 'flex' : 'none';
                    }

                    if (nextBtn) {
                        const maxScroll = sliderContent.scrollWidth - sliderContent.offsetWidth;
                        nextBtn.style.display = sliderContent.scrollLeft < maxScroll - 10 ? 'flex' : 'none';
                    }
                }, 300);
            });
        });

        // Scroll olayını dinle (buton görünürlüğü için)
        document.querySelectorAll('.slider-content').forEach(slider => {
            slider.addEventListener('scroll', () => {
                const rowIndex = slider.dataset.row;
                const prevBtn = document.querySelector(`.slider-btn-prev[data-row="${rowIndex}"]`);
                const nextBtn = document.querySelector(`.slider-btn-next[data-row="${rowIndex}"]`);

                if (prevBtn) {
                    prevBtn.style.display = slider.scrollLeft > 0 ? 'flex' : 'none';
                }

                if (nextBtn) {
                    const maxScroll = slider.scrollWidth - slider.offsetWidth;
                    nextBtn.style.display = slider.scrollLeft < maxScroll - 10 ? 'flex' : 'none';
                }
            });
        });
    }

    // ============================================
    // FEATURED CAROUSEL (Auto-play, Navigation)
    // ============================================

    setupFeaturedCarousel() {
        this.currentFeaturedSlide = 0;
        this.featuredSlides = document.querySelectorAll('.featured-slide');
        this.featuredTotal = this.featuredSlides.length;

        if (this.featuredTotal === 0) return;

        // Auto-play (her 5 saniyede)
        this.featuredInterval = setInterval(() => {
            this.nextFeaturedSlide();
        }, 5000);

        // Hover yapınca auto-play'i durdur
        const container = document.querySelector('.featured-carousel-container');
        if (container) {
            container.addEventListener('mouseenter', () => {
                clearInterval(this.featuredInterval);
            });

            container.addEventListener('mouseleave', () => {
                this.featuredInterval = setInterval(() => {
                    this.nextFeaturedSlide();
                }, 5000);
            });
        }
    }

    nextFeaturedSlide() {
        if (!this.featuredSlides || this.featuredTotal === 0) return;

        this.featuredSlides[this.currentFeaturedSlide].classList.remove('active');
        this.currentFeaturedSlide = (this.currentFeaturedSlide + 1) % this.featuredTotal;
        this.featuredSlides[this.currentFeaturedSlide].classList.add('active');
    }

    prevFeaturedSlide() {
        if (!this.featuredSlides || this.featuredTotal === 0) return;

        this.featuredSlides[this.currentFeaturedSlide].classList.remove('active');
        this.currentFeaturedSlide = (this.currentFeaturedSlide - 1 + this.featuredTotal) % this.featuredTotal;
        this.featuredSlides[this.currentFeaturedSlide].classList.add('active');
    }

    setupCarouselNavigation() {
        document.querySelectorAll('.carousel-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const carouselId = btn.dataset.carousel;
                const carousel = document.querySelector(`.carousel[data-carousel="${carouselId}"]`);
                const track = carousel.querySelector('.carousel-track');
                const cardWidth = 200;
                const scrollAmount = cardWidth * 5;

                if (btn.classList.contains('carousel-btn-prev')) {
                    track.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
                } else {
                    track.scrollBy({ left: scrollAmount, behavior: 'smooth' });
                }
            });
        });
    }

    setupSeeAllLinks() {
        document.querySelectorAll('.see-all[data-page]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo(link.dataset.page);
            });
        });
    }

    // ============================================
    // FEATURED HERO
    // ============================================

    renderFeaturedHero(doc) {
        if (!doc) return '';

        return `
            <div class="featured-hero">
                <img data-src="${this.getPoster(doc)}" alt="${doc.title}">
                <div class="hero-overlay"></div>
                <div class="hero-content">
                    <div class="hero-badge">⭐ ÖNE ÇIKAN</div>
                    <h1 class="hero-title">${doc.title}</h1>
                    <div class="hero-meta">
                        ${doc.year ? `<span>📅 ${doc.year}</span>` : ''}
                        ${doc.rating ? `<span>⭐ ${doc.rating}/10</span>` : ''}
                        ${doc.tags && doc.tags[0] ? `<span>🎬 ${doc.tags[0]}</span>` : ''}
                    </div>
                    <p class="hero-desc">${(doc.description || doc.content || '').substring(0, 200)}...</p>
                    <div class="hero-buttons">
                        <button class="btn btn-primary" onclick="app.showModal(${doc.id})">
                            <i class="fas fa-play"></i> Şimdi İzle
                        </button>
                        <button class="btn btn-secondary" onclick="app.showModal(${doc.id})">
                            <i class="fas fa-info-circle"></i> Detaylar
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================
    // DOCUMENTARIES PAGE
    // ============================================

    renderDocumentariesPage() {
        const content = document.getElementById('contentArea');

        // Filtreleri uygula
        let filteredDocs = [...this.data.singles];
        filteredDocs = this.applyFilters(filteredDocs);

        content.innerHTML = `
            <div class="page-header">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h1>🎬 Tek Belgeseller</h1>
                    ${this.navigationHistory.length > 0 || this.previousPageState ? `
                        <button class="btn-icon" onclick="app.goBack()" title="Geri">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    ` : ''}
                </div>
                <p>${filteredDocs.length} belgesel</p>
            </div>
            ${this.renderFilters('documentaries')}
            <div class="content-container">
                <div class="grid">
                    ${filteredDocs.map(doc => this.renderCard(doc)).join('')}
                </div>
            </div>
        `;

        this.observeImages();
    }

    // ============================================
    // SERIES PAGE
    // ============================================

    renderSeriesPage() {
        const content = document.getElementById('contentArea');

        // Filtreleri uygula
        let filteredDocs = [...this.data.series];
        filteredDocs = this.applyFilters(filteredDocs);

        content.innerHTML = `
            <div class="page-header">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h1>📺 Seri Belgeseller</h1>
                    ${this.navigationHistory.length > 0 || this.previousPageState ? `
                        <button class="btn-icon" onclick="app.goBack()" title="Geri">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    ` : ''}
                </div>
                <p>${filteredDocs.length} seri</p>
            </div>
            ${this.renderFilters('series')}
            <div class="content-container">
                <div class="grid">
                    ${filteredDocs.map(doc => this.renderCard(doc)).join('')}
                </div>
            </div>
        `;

        this.observeImages();
    }

    // ============================================
    // CATEGORIES PAGE
    // ============================================

    renderCategoriesPage() {
        const content = document.getElementById('contentArea');

        // Kategorileri sayıya göre sırala
        const sortedCategories = Object.entries(this.categoryDocuments)
            .sort(([_, a], [__, b]) => b.count - a.count);

        content.innerHTML = `
            <div class="page-header">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h1>📁 Kategoriler</h1>
                    ${this.navigationHistory.length > 0 || this.previousPageState ? `
                        <button class="btn-icon" onclick="app.goBack()" title="Geri">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    ` : ''}
                </div>
                <p>${Object.keys(this.categoryDocuments).length} kategori</p>
            </div>
            <div class="content-container">
                <div class="categories-grid">
                    ${sortedCategories.map(([categoryName, categoryData]) => {
            const parts = [];
            if (categoryData.singles > 0) parts.push(`${categoryData.singles} belgesel`);
            if (categoryData.series > 0) parts.push(`${categoryData.series} seri`);
            const subtitle = parts.join(' • ');

            return `
                        <div class="category-card" onclick="app.showCategoryByName('${categoryName.replace(/'/g, "\\'")}')">
                            <div class="category-icon">${categoryData.emoji}</div>
                            <h3>${categoryName}</h3>
                            <p>${subtitle || `${categoryData.count} içerik`}</p>
                        </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;
    }

    renderToolsPage() {
        const content = document.getElementById('contentArea');

        // HTML araçları listesi
        const tools = [
            { file: 'belgeselsemo-ceviri.html', name: 'Çeviri', icon: '🌐', desc: 'Dil çevirisi yapın' },
            { file: 'belgeselsemo-ekonomi.html', name: 'Ekonomi', icon: '💰', desc: 'Ekonomi haberleri' },
            { file: 'belgeselsemo-epg-viewer.html', name: 'EPG Viewer', icon: '📺', desc: 'TV program rehberi' },
            { file: 'belgeselsemo-hava-durumu.html', name: 'Hava Durumu', icon: '🌤️', desc: 'Hava durumu bilgisi' },
            { file: 'belgeselsemo-muzik-player.html', name: 'Müzik Player', icon: '🎵', desc: 'Müzik dinleyin' },
            { file: 'belgeselsemo-notepad.html', name: 'Notepad', icon: '📝', desc: 'Not defteri' },
            { file: 'belgeselsemo-pdf-viewer.html', name: 'PDF Viewer', icon: '📄', desc: 'PDF görüntüleyici' },
            { file: 'belgeselsemo-takvim.html', name: 'Takvim', icon: '📅', desc: 'Takvim ve ajanda' },
            { file: 'belgeselsemo-wiki.html', name: 'Wiki', icon: '📚', desc: 'Wikipedia araması' },
            { file: 'hesap-makinesi.html', name: 'Hesap Makinesi', icon: '🔢', desc: 'Hesaplama yapın' },
            { file: 'nobetci-eczaneler.html', name: 'Nöbetçi Eczaneler', icon: '💊', desc: 'Nöbetçi eczane bul' },
            { file: 'downloads', name: 'Belgesel İndir', icon: '💾', desc: 'Belgeselleri indirin' },
            { file: 'belgeselsemo-besteleyici.html', name: 'Besteleyici', icon: '🎼', desc: 'Melodi yaz & ses analiz et' }
        ];

        content.innerHTML = `
            <div class="page-header">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h1>🛠️ Araçlar</h1>
                    ${this.navigationHistory.length > 0 || this.previousPageState ? `
                        <button class="btn-icon" onclick="app.goBack()" title="Geri">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    ` : ''}
                </div>
                <p>${tools.length} araç</p>
            </div>
            <div class="content-container">
                <div class="categories-grid">
                    ${tools.map(tool => `
                        <div class="category-card" onclick="app.openTool('${tool.file}', '${tool.name}')">
                            <div class="category-icon">${tool.icon}</div>
                            <h3>${tool.name}</h3>
                            <p>${tool.desc}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    openTool(filename, toolName) {
        // Belgesel İndir için özel sayfa
        if (filename === 'downloads') {
            this.renderDownloadsPage();
            return;
        }
        
        // DsmartGo & Extra için özel iframe + tab
        if (filename === 'dsmartgo') {
            document.body.classList.add('tool-has-tabs');
            const content = document.getElementById('contentArea');
            content.innerHTML = `
                <div class="page-header tool-header has-tabs">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h1>📺 DsmartGo & Extra</h1>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn-icon" id="dsmartRefreshBtn" title="Yenile">
                                <i class="fas fa-sync"></i>
                            </button>
                            <button class="btn-icon" onclick="app.navigateTo('home')" title="Ana Sayfaya Dön">
                                <i class="fas fa-arrow-left"></i>
                            </button>
                        </div>
                    </div>
                    <!-- Tablar -->
                    <div style="display:flex;gap:0;margin-top:10px;border-bottom:2px solid rgba(255,255,255,0.1);">
                        <button id="tabDsmartgo" onclick="app.switchDsmartTab('dsmartgo')"
                            style="padding:8px 18px;background:none;border:none;border-bottom:2px solid #e50914;color:#fff;font-size:0.9rem;font-weight:700;cursor:pointer;margin-bottom:-2px;transition:all 0.2s;">
                            📺 DsmartGO
                        </button>
                        <button id="tabExtra" onclick="app.switchDsmartTab('extra')"
                            style="padding:8px 18px;background:none;border:none;border-bottom:2px solid transparent;color:#808080;font-size:0.9rem;font-weight:600;cursor:pointer;margin-bottom:-2px;transition:all 0.2s;">
                            📺 Extra TV
                        </button>
                    </div>
                </div>
                <div class="tool-iframe-container">
                    <iframe id="toolIframe"
                        src="https://belgeselsemo.com.tr/php/a.php"
                        frameborder="0" loading="eager"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation"
                        allowfullscreen>
                    </iframe>
                </div>
            `;

            // Refresh butonu
            document.getElementById('dsmartRefreshBtn').addEventListener('click', () => {
                const iframe = document.getElementById('toolIframe');
                if (iframe) iframe.src = iframe.src;
            });

            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        
        const content = document.getElementById('contentArea');
        document.body.classList.remove('tool-has-tabs');
        
        content.innerHTML = `
            <div class="page-header tool-header">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <h1>🛠️ ${toolName}</h1>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn-icon" onclick="app.openTool('${filename}', '${toolName}')" title="Yenile">
                            <i class="fas fa-sync"></i>
                        </button>
                        <button class="btn-icon" onclick="app.navigateTo('tools')" title="Araçlara Dön">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    </div>
                </div>
            </div>
            <div class="tool-iframe-container">
                <iframe 
                    id="toolIframe"
                    src="html-tools/${filename}" 
                    frameborder="0"
                    loading="eager"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-top-navigation-by-user-activation"
                    onload="
                        setTimeout(() => {
                            try {
                                this.contentWindow.dispatchEvent(new Event('resize'));
                                this.contentWindow.dispatchEvent(new Event('load'));
                            } catch(e) { console.log('iframe event trigger failed:', e); }
                        }, 500);
                    ">
                </iframe>
            </div>
        `;

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    showCategoryByName(categoryName) {
        // Save current page state before navigating
        if (!this.previousPageState) {
            this.previousPageState = {
                html: document.getElementById('contentArea').innerHTML,
                scrollY: window.scrollY
            };
        }

        const categoryData = this.categoryDocuments[categoryName];
        if (!categoryData) {
            if (window.customAlert) {
                window.customAlert('Kategori bulunamadı!', 'Hata', '❌');
            } else {
                alert('Kategori bulunamadı!');
            }
            return;
        }

        // Alt başlık oluştur
        const parts = [];
        if (categoryData.singles > 0) parts.push(`${categoryData.singles} belgesel`);
        if (categoryData.series > 0) parts.push(`${categoryData.series} seri`);
        if (categoryData.episodes > 0) parts.push(`${categoryData.episodes} bölüm`);
        const subtitle = parts.join(' • ');

        const content = document.getElementById('contentArea');
        content.innerHTML = `
            <div class="page-header">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h1>${categoryData.emoji} ${categoryName}</h1>
                    <button class="btn-icon" onclick="app.goBack()" title="Geri">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                </div>
                <p>${subtitle || `${categoryData.count} içerik`}</p>
            </div>
            <div class="content-container">
                <div class="grid">
                    ${[...categoryData.docs]
                        .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
                        .map(doc => this.renderCard(doc)).join('')}
                </div>
            </div>
        `;

        this.observeImages();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    showRecentlyAdded() {
        // Save current page state before navigating
        if (!this.previousPageState) {
            this.previousPageState = {
                html: document.getElementById('contentArea').innerHTML,
                scrollY: window.scrollY
            };
        }

        // Tüm belgeselleri tarihe göre sırala
        const allDocs = this.data.all || [];
        const recentlyAddedDocs = [...allDocs]
            .filter(d => d.type === 'post' || d.type === 'tv') // Sadece tek ve seri belgeseller
            .filter(d => d.date) // Tarihi olanlar
            .sort((a, b) => new Date(b.date) - new Date(a.date)); // En yeniden eskiye

        // Alt başlık oluştur
        const singles = recentlyAddedDocs.filter(d => d.type === 'post').length;
        const series = recentlyAddedDocs.filter(d => d.type === 'tv').length;
        const parts = [];
        if (singles > 0) parts.push(`${singles} belgesel`);
        if (series > 0) parts.push(`${series} seri`);
        const subtitle = parts.join(' • ');

        const content = document.getElementById('contentArea');
        content.innerHTML = `
            <div class="page-header">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h1>🆕 Son Eklenenler</h1>
                    <button class="btn-icon" onclick="app.goBack()" title="Geri">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                </div>
                <p>${subtitle || `${recentlyAddedDocs.length} içerik`}</p>
            </div>
            <div class="content-container">
                <div class="grid">
                    ${recentlyAddedDocs.map(doc => this.renderCardWithDate(doc)).join('')}
                </div>
            </div>
        `;

        this.observeImages();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async showYouTubeChannel(channelId, channelName) {
        // Save current page state before navigating
        if (!this.previousPageState) {
            this.previousPageState = {
                html: document.getElementById('contentArea').innerHTML,
                scrollY: window.scrollY
            };
        }

        const content = document.getElementById('contentArea');

        // Show loading state
        content.innerHTML = `
            <div class="page-header">
                <h1><i class="fab fa-youtube" style="color: #ff0000;"></i> ${channelName}</h1>
                <p>Yükleniyor...</p>
            </div>
            <div class="loading-spinner active"><div class="spinner"></div><p class="loading-text">İçerikler Yükleniyor..</p></div>
        `;

        try {
            const channels = await window.youtubeClient.loadAllChannels();
            const channel = channels.find(ch => ch.id === channelId);

            if (!channel || !channel.playlists) {
                content.innerHTML = `
                    <div class="page-header">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                            <h1><i class="fab fa-youtube" style="color: #ff0000;"></i> ${channelName}</h1>
                            <button class="btn-icon" onclick="app.goBack()" title="Geri">
                                <i class="fas fa-arrow-left"></i>
                            </button>
                        </div>
                        <p>⚠️ Playlistler yüklenemedi</p>
                    </div>
                `;
                return;
            }

            content.innerHTML = `
                <div class="page-header">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <h1><i class="fab fa-youtube" style="color: #ff0000;"></i> ${channelName}</h1>
                        <button class="btn-icon" onclick="app.goBack()" title="Geri">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    </div>
                    <p>${channel.playlists.length} playlist</p>
                </div>
                <div class="content-container">
                    <div class="grid">
                        ${channel.playlists.map(playlist => this.renderYouTubePlaylistCard(playlist, channel.name)).join('')}
                    </div>
                </div>
            `;

            this.observeImages();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (error) {
            console.error('YouTube channel yüklenemedi:', error);
            content.innerHTML = `
                <div class="page-header">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <h1><i class="fab fa-youtube" style="color: #ff0000;"></i> ${channelName}</h1>
                        <button class="btn-icon" onclick="app.goBack()" title="Geri">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    </div>
                    <p>⚠️ Bir hata oluştu</p>
                </div>
            `;
        }
    }

    goBack() {
        // First check if we have detail page state (category/channel detail)
        if (this.previousPageState) {
            document.getElementById('contentArea').innerHTML = this.previousPageState.html;
            this.observeImages();
            window.scrollTo({ top: this.previousPageState.scrollY, behavior: 'smooth' });
            this.previousPageState = null;
            return;
        }

        // Otherwise use navigation history
        if (this.navigationHistory.length > 0) {
            const previous = this.navigationHistory.pop();
            this.currentPage = previous.page;

            // Trigger navigation to previous page
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
                if (link.dataset.page === previous.page) {
                    link.classList.add('active');
                }
            });

            // Load the page
            this.state.currentPage = previous.page;
            this.renderPage(previous.page);

            // Restore scroll position after page loads
            setTimeout(() => {
                window.scrollTo({ top: previous.scrollY || 0, behavior: 'smooth' });
            }, 100);
        }
    }

    pushHistory(page) {
        // Don't push if it's the same as current page
        if (page !== this.currentPage) {
            this.navigationHistory.push({
                page: this.currentPage,
                scrollY: window.scrollY
            });
            this.currentPage = page;
        }
    }

    // ============================================
    //  YOUTUBE PAGE
    // ============================================

    async renderYouTubePage() {
        const content = document.getElementById('contentArea');

        content.innerHTML = `
            <div class="page-header">
                <h1>📺 YouTube Belgeselleri</h1>
                <p>Yükleniyor...</p>
            </div>
            <div class="loading-spinner active"><div class="spinner"></div><p class="loading-text">İçerikler Yükleniyor..</p></div>
        `;

        try {
            console.log('🚀 YouTube sayfası yükleniyor...');
            const channels = await window.youtubeClient.loadAllChannels();
            console.log('📊 Yüklenen kanal sayısı:', channels ? channels.length : 0);

            if (!channels || channels.length === 0) {
                content.innerHTML = `
                    <div class="page-header">
                        <h1>📺 YouTube Belgeselleri</h1>
                        <p style="color: #ff6b6b;">⚠️ Kanallar yüklenemedi</p>
                        <div style="margin-top: 2rem;">
                            <button class="btn btn-primary" onclick="window.youtubeClient.clearCache(); location.reload();" style="margin-right: 1rem;">
                                <i class="fas fa-sync"></i> Cache Temizle ve Yenile
                            </button>
                            <button class="btn btn-secondary" onclick="console.log('YouTube Client:', window.youtubeClient);">
                                <i class="fas fa-bug"></i> Debug Bilgisi
                            </button>
                        </div>
                        <p style="font-size: 0.9rem; opacity: 0.7; margin-top: 2rem;">
                            Tarayıcı konsolunu açın (F12) ve hata mesajlarını kontrol edin.
                        </p>
                    </div>
                `;
                return;
            }

            let html = `
                <div class="page-header">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <div>
                            <h1>📺 YouTube Belgeselleri</h1>
                            <p>${channels.length} kanal • ${channels.reduce((sum, ch) => sum + ch.playlists.length, 0)} playlist</p>
                        </div>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn-icon" onclick="window.youtubeClient.clearCache(); app.renderYouTubePage();" title="Yenile">
                                <i class="fas fa-sync"></i>
                            </button>
                            ${this.navigationHistory.length > 0 || this.previousPageState ? `
                                <button class="btn-icon" onclick="app.goBack()" title="Geri">
                                    <i class="fas fa-arrow-left"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
                <div class="content-container">
                    <div class="netflix-rows">
            `;

            channels.forEach((channel, index) => {
                if (!channel.playlists || channel.playlists.length === 0) return;

                html += `
                    <div class="netflix-row">
                        <div class="row-header">
                            <h2 class="row-title"><i class="fab fa-youtube" style="color: #ff0000;"></i> ${channel.name}</h2>
                            <span class="row-count" onclick="app.showYouTubeChannel('${channel.id}', '${channel.name.replace(/'/g, "\\\\'")}')" title="Tümünü Gör">${channel.playlists.length} playlist</span>
                        </div>
                        <div class="row-slider" data-row="yt-${index}">
                            <button class="slider-btn slider-btn-prev" data-row="yt-${index}" style="display: none;">
                                <i class="fas fa-chevron-left"></i>
                            </button>
                            <div class="slider-content" data-row="yt-${index}">
                                ${channel.playlists.map(playlist => `
                                    <div class="netflix-card" onclick="app.showYouTubePlaylist('${playlist.id}', '${playlist.title.replace(/'/g, "\\'")}')">
                                        <div class="card-image">
                                            <img data-src="${playlist.thumbnail || 'https://via.placeholder.com/300x450?text=No+Image'}" 
                                                 alt="${playlist.title}">
                                            <div class="card-badge">Playlist</div>
                                            <div class="season-badge">${playlist.videoCount || '?'} Video</div>
                                            <div class="card-overlay">
                                                <div class="card-play">
                                                    <i class="fas fa-play-circle"></i>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="card-title">${playlist.title}</div>
                                        <div class="card-meta">
                                            <span>${channel.name}</span>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                            <button class="slider-btn slider-btn-next" data-row="yt-${index}">
                                <i class="fas fa-chevron-right"></i>
                            </button>
                        </div>
                    </div>
                `;
            });

            html += `   </div>
                    </div>`; // Close netflix-rows and content-container

            content.innerHTML = html;

            // Re-use the Netflix slider logic for these new rows
            this.setupNetflixSliders();
            this.observeImages();

        } catch (error) {
            console.error('❌ YouTube sayfa hatası:', error);
            content.innerHTML = `
                <div class="page-header">
                    <h1>📺 YouTube Belgeselleri</h1>
                    <p style="color: #ff6b6b;">❌ Bir hata oluştu: ${error.message}</p>
                    <div style="margin-top: 2rem;">
                        <button class="btn btn-primary" onclick="window.youtubeClient.clearCache(); location.reload();" style="margin-right: 1rem;">
                            <i class="fas fa-sync"></i> Cache Temizle ve Yenile
                        </button>
                        <button class="btn btn-secondary" onclick="console.log('Hata:', error); console.log('YouTube Client:', window.youtubeClient);">
                            <i class="fas fa-bug"></i> Debug Bilgisi
                        </button>
                    </div>
                    <p style="font-size: 0.9rem; opacity: 0.7; margin-top: 2rem;">
                        Tarayıcı konsolunu açın (F12) ve detaylı hata mesajını kontrol edin.
                    </p>
                </div>
            `;
        }
    }

    async showYouTubePlaylist(playlistId, playlistTitle) {
        const modal = document.getElementById('detailModal');
        const modalContent = document.getElementById('modalContent');

        // Use the new fixed layout container
        modalContent.className = 'modal-content modal-content-fixed';
        modalContent.innerHTML = `<div class="loading-spinner active"><div class="spinner"></div><p class="loading-text">İçerikler Yükleniyor..</p></div>`;

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';

        try {
            const videos = await window.youtubeClient.getPlaylistVideos(playlistId);

            if (!videos || videos.length === 0) {
                modalContent.innerHTML = `
                    <div class="modal-header-fixed">
                        <h1>⚠️ Videolar Yüklenemedi</h1>
                        <button class="modal-close" onclick="app.closeModal()"><i class="fas fa-times"></i></button>
                    </div>
                    <div class="modal-body-scroll" style="display: flex; align-items: center; justify-content: center;">
                        <p>Bu playlistte video bulunamadı veya bir hata oluştu.</p>
                    </div>
                    <div class="modal-footer-fixed">
                        <button class="btn btn-secondary" onclick="app.closeModal()">Kapat</button>
                    </div>
                `;
                return;
            }

            this.currentPlaylistVideos = videos; // Store for quick access

            let html = `
                <div class="modal-header-fixed">
                    <button class="modal-close" onclick="app.closeModal()"><i class="fas fa-times"></i></button>
                    <h1><i class="fab fa-youtube"></i> ${playlistTitle}</h1>
                    <p>${videos.length} video</p>
                </div>
                
                <div class="modal-body-scroll">
                    <div class="youtube-video-grid">
                        ${videos.filter(v => v.videoId).map(video => `
                            <div class="youtube-video-card" onclick="event.stopPropagation(); app.playYouTubeVideo('${video.videoId}', '${video.title.replace(/'/g, "\\'")}'); app.closeModal();">
                                <div class="youtube-video-thumbnail">
                                    <img src="${video.videoThumbnails && video.videoThumbnails[0] ? video.videoThumbnails[0].url : 'https://via.placeholder.com/480x360'}" alt="${video.title}">
                                    <div class="youtube-play-overlay"><i class="fas fa-play-circle"></i></div>
                                    ${video.lengthSeconds ? `<span class="youtube-duration">${this.formatDuration(video.lengthSeconds)}</span>` : ''}
                                </div>
                                <div class="youtube-video-info">
                                    <h4>${video.title}</h4>
                                    ${video.author ? `<p>${video.author}</p>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="modal-footer-fixed">
                    <button class="btn btn-secondary" onclick="app.closeModal()">Kapat</button>
                </div>
            `;

            modalContent.innerHTML = html;
        } catch (error) {
            console.error('Playlist yüklenemedi:', error);
            modalContent.innerHTML = `
                <div class="modal-header-fixed">
                    <h1>❌ Hata</h1>
                    <button class="modal-close" onclick="app.closeModal()"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body-scroll" style="padding: 2rem; text-align: center;">
                    <h2>Bir hata oluştu: ${error.message}</h2>
                </div>
                <div class="modal-footer-fixed">
                    <button class="btn btn-secondary" onclick="app.closeModal()">Kapat</button>
                </div>
            `;
        }
    }

    async playYouTubeVideo(videoId, title) {
        const playerModal = document.getElementById('playerModal');
        const playerWrapper = document.getElementById('playerWrapper');

        // Close any existing detail modal
        this.closeModal();

        // Clean up any previous Plyr instance
        if (this.currentPlyr) {
            this.currentPlyr.destroy();
            this.currentPlyr = null;
        }

        // Check if we have description in current playlist data
        let initialDescription = '';
        if (this.currentPlaylistVideos) {
            const videoData = this.currentPlaylistVideos.find(v => v.videoId === videoId);
            if (videoData && (videoData.description || videoData.shortDescription)) {
                initialDescription = videoData.description || videoData.shortDescription;
            }
        }

        // 1. HIZLI BAŞLANGIÇ: Hemen player'ı ve (varsa) açıklamayı göster
        playerWrapper.innerHTML = `
            <div class="player-video">
                <div class="plyr-player-container" id="plyr-video-container">
                    <div class="plyr-loading">
                        <div class="plyr-spinner"></div>
                        <p>Video yükleniyor...</p>
                    </div>
                </div>
            </div>
            <div class="player-info">
                <h2><i class="fab fa-youtube"></i> ${title}</h2>
                <div id="video-description-area">
                    ${initialDescription ? `
                        <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem; margin-top: 1rem; max-height: 200px; overflow-y: auto; padding-right: 0.5rem;">
                            <p style="text-align: justify; line-height: 1.6; color: var(--text-secondary); font-size: 0.9rem; white-space: pre-wrap;">${initialDescription}</p>
                        </div>
                    ` : `
                        <p style="opacity: 0.7; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                            <i class="fas fa-circle-notch fa-spin"></i> Video bilgileri yükleniyor...
                        </p>
                    `}
                </div>
            </div>
        `;

        playerModal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Initialize Plyr player
        const plyrContainer = document.getElementById('plyr-video-container');
        if (plyrContainer && window.PlyrPlayerManager) {
            window.PlyrPlayerManager.initPlayer(plyrContainer, videoId);
        }
        
        console.log(`🚀 Hızlı Başlatma: YouTube video (${videoId}) player yüklendi`);

        // 2. ARKA PLAN: Video detaylarını çek (Asenkron + Cache)
        try {
            // Use the new caching method
            const videoDetails = await window.youtubeClient.getVideoDetails(videoId);

            // Detaylar geldi, açıklamayı güncelle (Eğer ilk başta gösterdiğimizden daha uzunsa veya ilk başta yoksa)
            const descArea = document.getElementById('video-description-area');
            if (descArea) {
                if (videoDetails && videoDetails.description) {
                    // Eğer zaten bir açıklama gösteriyorsak ve gelen aynısıysa güncelleme yapma (titremeyi önle)
                    if (initialDescription && videoDetails.description === initialDescription) return;

                    descArea.innerHTML = `
                        <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 1rem; margin-top: 1rem; max-height: 200px; overflow-y: auto; padding-right: 0.5rem;">
                            <p style="text-align: justify; line-height: 1.6; color: var(--text-secondary); font-size: 0.9rem; white-space: pre-wrap;">${videoDetails.description}</p>
                        </div>
                    `;
                } else if (!initialDescription) {
                    descArea.innerHTML = `
                        <p style="opacity: 0.5; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">Açıklama yok</p>
                    `;
                }
            }
        } catch (error) {
            console.error('Video detayları yüklenemedi (Muhtemelen gizli/silinmiş):', error);

            // HATA DURUMU: Video gerçekten oynatılamayacak durumdaysa arayüzü güncelle
            const plyrContainer = document.getElementById('plyr-video-container');
            if (plyrContainer && window.PlyrPlayerManager) {
                window.PlyrPlayerManager.showError(
                    plyrContainer,
                    'Video Oynatılamıyor',
                    `Bu video gizli, silinmiş veya erişilemez durumda. Hata: ${error.message || 'Bilinmeyen Hata'}`,
                    false
                );
            }
        }
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // ============================================
    // CARD RENDERING
    // ============================================

    renderCard(doc) {
        // Seri belgesel için sezon ve bölüm sayısını hesapla
        let seasonEpisodeInfo = '';
        if (doc.type === 'tv') {
            const seriesInfo = this.getSeriesInfo(doc.id);
            if (seriesInfo.seasons > 0 && seriesInfo.episodes > 0) {
                seasonEpisodeInfo = `<span class="season-episode-badge">S${seriesInfo.seasons}-B${seriesInfo.episodes}</span>`;
            }
        }

        return `
            <div class="card" onclick="app.showModal(${doc.id})">
                <div class="card-poster">
                    <img data-src="${this.getPoster(doc)}" alt="${doc.title}">
                    <div class="card-badge">${this.getTypeBadge(doc.type)}</div>
                    <div class="card-actions">
                        <button class="card-action-btn" data-favorite-id="${doc.id}" onclick="app.toggleFavorite(${doc.id}); event.stopPropagation();" title="Favorilere ekle">
                            <i class="${this.isFavorite(doc.id) ? 'fas' : 'far'} fa-heart"></i>
                        </button>
                        <button class="card-action-btn" data-watchlist-id="${doc.id}" onclick="app.toggleWatchlist(${doc.id}); event.stopPropagation();" title="İzleme listesine ekle">
                            <i class="${this.isInWatchlist(doc.id) ? 'fas' : 'far'} fa-bookmark"></i>
                        </button>
                        <button class="card-action-btn" data-watched-id="${doc.id}" onclick="app.toggleWatched(${doc.id}); event.stopPropagation();" title="İzledim">
                            <i class="${this.isWatched(doc.id) ? 'fas' : 'far'} fa-check-circle"></i>
                        </button>
                    </div>
                    ${this.isWatched(doc.id) ? '<div class="watched-badge"><i class="fas fa-check-circle"></i> İzlendi</div>' : ''}
                </div>
                <div class="card-info">
                    <h3 class="card-title">${doc.title}</h3>
                    <div class="card-meta">
                        <div class="card-meta-left">
                            ${doc.year ? `<span>${doc.year}</span>` : ''}
                            ${doc.rating ? `<span>⭐ ${doc.rating}</span>` : ''}
                        </div>
                        ${seasonEpisodeInfo}
                    </div>
                </div>
            </div>
        `;
    }

    renderCardWithDate(doc) {
        // Seri belgesel için sezon ve bölüm sayısını hesapla
        let seasonEpisodeInfo = '';
        if (doc.type === 'tv') {
            const seriesInfo = this.getSeriesInfo(doc.id);
            if (seriesInfo.seasons > 0 && seriesInfo.episodes > 0) {
                seasonEpisodeInfo = `<span class="season-episode-badge">S${seriesInfo.seasons}-B${seriesInfo.episodes}</span>`;
            }
        }

        // Tarihi gg.aa.yy formatına çevir
        const dateLabel = this.formatDateShort(doc.date);

        return `
            <div class="card" onclick="app.showModal(${doc.id})">
                <div class="card-poster">
                    <img data-src="${this.getPoster(doc)}" alt="${doc.title}">
                    <div class="card-badge">${this.getTypeBadge(doc.type)}</div>
                    <div class="card-actions">
                        <button class="card-action-btn" data-favorite-id="${doc.id}" onclick="app.toggleFavorite(${doc.id}); event.stopPropagation();" title="Favorilere ekle">
                            <i class="${this.isFavorite(doc.id) ? 'fas' : 'far'} fa-heart"></i>
                        </button>
                        <button class="card-action-btn" data-watchlist-id="${doc.id}" onclick="app.toggleWatchlist(${doc.id}); event.stopPropagation();" title="İzleme listesine ekle">
                            <i class="${this.isInWatchlist(doc.id) ? 'fas' : 'far'} fa-bookmark"></i>
                        </button>
                        <button class="card-action-btn" data-watched-id="${doc.id}" onclick="app.toggleWatched(${doc.id}); event.stopPropagation();" title="İzledim">
                            <i class="${this.isWatched(doc.id) ? 'fas' : 'far'} fa-check-circle"></i>
                        </button>
                    </div>
                    ${this.isWatched(doc.id) ? '<div class="watched-badge"><i class="fas fa-check-circle"></i> İzlendi</div>' : ''}
                    ${dateLabel ? `<div class="date-badge">${dateLabel}</div>` : ''}
                </div>
                <div class="card-info">
                    <h3 class="card-title">${doc.title}</h3>
                    <div class="card-meta">
                        <div class="card-meta-left">
                            ${doc.year ? `<span>${doc.year}</span>` : ''}
                            ${doc.rating ? `<span>⭐ ${doc.rating}</span>` : ''}
                        </div>
                        ${seasonEpisodeInfo}
                    </div>
                </div>
            </div>
        `;
    }

    renderYouTubePlaylistCard(playlist, channelName) {
        return `
            <div class="card" onclick="app.showYouTubePlaylist('${playlist.id}', '${playlist.title.replace(/'/g, "\\'")}')">
                <div class="card-poster">
                    <img data-src="${playlist.thumbnail || 'https://via.placeholder.com/300x200?text=No+Image'}" alt="${playlist.title}">
                    <div class="card-badge">Playlist</div>
                    <div class="card-actions">
                        <button class="card-action-btn" title="YouTube'da İzle" onclick="window.open('https://youtube.com/playlist?list=${playlist.id}', '_blank'); event.stopPropagation();">
                            <i class="fab fa-youtube"></i>
                        </button>
                    </div>
                </div>
                <div class="card-info">
                    <h3 class="card-title">${playlist.title}</h3>
                    <div class="card-meta">
                        <div class="card-meta-left">
                            <span>${playlist.videoCount || '?'} Video</span>
                        </div>
                        <span class="season-episode-badge">${channelName}</span>
                    </div>
                </div>
            </div>
        `;
    }

    getSeriesInfo(seriesId) {
        // Seri belgeseli bul
        const series = this.data.series.find(s => s.id === seriesId);
        if (!series) {
            return { seasons: 0, episodes: 0 };
        }

        // tmdb_id ile episode'ları eşleştir (çünkü parent_id kullanılmıyor)
        const episodes = this.data.episodes.filter(ep =>
            ep.tmdb_id && series.tmdb_id && ep.tmdb_id === series.tmdb_id
        );

        if (episodes.length === 0) {
            return { seasons: 0, episodes: 0 };
        }

        // Unique sezon sayısını bul
        const seasons = [...new Set(episodes.map(ep => ep.season_number))].filter(s => s).length;

        return {
            seasons: seasons || 1, // En az 1 sezon varsay
            episodes: episodes.length
        };
    }

    getTypeBadge(type) {
        const badges = {
            'tv': 'Seri',
            'episode': 'Bölüm',
            'post': 'Tek'
        };
        return badges[type] || 'Tek';
    }

    // ============================================
    // MODAL
    // ============================================

    // ============================================
    // APP PROMO MODAL
    // ============================================

    handleAppImgError(img) {
        const fallback = img.getAttribute('data-fallback');
        if (fallback && img.src !== fallback) {
            img.onerror = null;
            img.src = fallback;
        }
    }

    showAppModal(appId) {
        const appPromos = {
            'app_belgeselsemo': {
                title: 'BELGESELSEMO',
                subtitle: 'Belgesel & Araç Uygulaması',
                poster: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby50cl9pY29uXzE3NTczODg3NzZfMDc5/icon.png?w=256&fakeurl=1',
                banner: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby50cl9pY29uXzE3NTczODg3NzZfMDc5/icon.png?w=256&fakeurl=1',
                description: 'Binlerce HD belgesel ve 30\'dan fazla ücretsiz araç tek bir uygulamada! Hesap makinesi, not defteri, hava durumu, EPG viewer, wiki ve daha fazlası. 13 dil desteği ile her yerde yanınızda.',
                playstore: 'https://play.google.com/store/apps/details?id=com.belgeselsemo.tr',
                tags: ['Belgesel', 'Araçlar', '13 Dil', 'Ücretsiz']
            },
            'app_nutuk': {
                title: 'NUTUK 1919-1927',
                subtitle: 'Sesli Kitap & Quiz Uygulaması',
                poster: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5udXR1a19pY29uXzE3NjMxNDQzOTZfMDk2/icon.png?w=256&fakeurl=1',
                banner: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5udXR1a19pY29uXzE3NjMxNDQzOTZfMDk2/icon.png?w=256&fakeurl=1',
                description: 'Atatürk\'ün ölümsüz eseri Nutuk, en kapsamlı dijital deneyimle cebinizde! 20+ dilde okuyun, sesli kitap olarak dinleyin, interaktif bilgi yarışmasıyla test edin. Entegre sözlük ve 15+ tema.',
                playstore: 'https://play.google.com/store/apps/details?id=com.belgeselsemo.nutuk',
                tags: ['20+ Dil', 'Sesli Kitap', 'Quiz', 'Sözlük']
            },
            'app_epgviewer': {
                title: 'BELGESELSEMO TV REHBERİ',
                subtitle: 'EPG / TV Yayın Akışı',
                poster: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5lcGd2aWV3ZXJfaWNvbl8xNzYwOTEyMTc4XzAyNg/icon.png?w=256&fakeurl=1',
                banner: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5lcGd2aWV3ZXJfaWNvbl8xNzYwOTEyMTc4XzAyNg/icon.png?w=256&fakeurl=1',
                description: '250\'den fazla EPG kaynağı ile dünyanın dört bir yanından binlerce TV kanalının yayın akışı parmaklarınızın ucunda! 15+ cam efektli tema, favori sistemi, akıllı hatırlatıcı ve XMLTV desteği.',
                playstore: 'https://play.google.com/store/apps/details?id=com.belgeselsemo.epgviewer',
                tags: ['250+ EPG', 'TV Rehberi', 'Hatırlatıcı', 'XMLTV']
            },
            'app_nb724': {
                title: 'NÖBETÇİ ECZANELER 7/24',
                subtitle: 'Türkiye & KKTC Eczane Bulucu',
                poster: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5uYjcyNF9pY29uXzE3NjAzOTg1NzhfMDg4/icon.png?w=256&fakeurl=1',
                banner: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby5uYjcyNF9pY29uXzE3NjAzOTg1NzhfMDg4/icon.png?w=256&fakeurl=1',
                description: 'Türkiye\'nin 81 ili ve KKTC\'deki tüm nöbetçi eczaneleri anında bulun! GPS ile en yakın eczane, harita görünümü, tek dokunuşla arama ve yol tarifi. 15+ tema, 7 dil desteği.',
                playstore: 'https://play.google.com/store/apps/details?id=com.belgeselsemo.nb724',
                tags: ['81 İl + KKTC', 'GPS', 'Harita', '7 Dil']
            },
            'app_trivia': {
                title: 'BELGESELSEMO TRIVIA',
                subtitle: 'Bilgi Yarışması Oyunu',
                poster: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby50cml2aWFfaWNvbl8xNzU2OTI2NTcyXzA3MA/icon.png?w=256&fakeurl=1',
                banner: 'https://image.winudf.com/v2/image1/Y29tLmJlbGdlc2Vsc2Vtby50cml2aWFfaWNvbl8xNzU2OTI2NTcyXzA3MA/icon.png?w=256&fakeurl=1',
                description: 'Zekanıza meydan okuyun! 24 farklı kategori, binlerce soru, 18+ dil desteği. Seviye atlama sistemi, 4 joker hakkı, günlük meydan okuma ve yüksek puanlar listesi ile Türkiye\'nin en eğlenceli trivia oyunu!',
                playstore: 'https://play.google.com/store/apps/details?id=com.belgeselsemo.trivia',
                tags: ['24 Kategori', '18+ Dil', 'Joker', 'Günlük Quiz']
            }
        };

        const appData = appPromos[appId];
        if (!appData) return;

        const modal = document.getElementById('detailModal');
        const modalContent = document.getElementById('modalContent');

        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(appData.playstore)}&bgcolor=ffffff&color=000000&margin=10`;

        modalContent.innerHTML = `
            <button class="modal-close" onclick="app.closeModal()">
                <i class="fas fa-times"></i>
            </button>

            <div class="modal-header-fixed">
                <div class="modal-poster-fixed" id="appModalPoster_${appId}">
                    <img src="${appData.poster}" alt="${appData.title}" style="width:100%;height:100%;object-fit:fill;"
                        data-fallback="${appData.banner}" onerror="app.handleAppImgError(this)">
                </div>
                <h2 class="modal-title-fixed">${appData.title}</h2>
                <div class="modal-meta-fixed">
                    <span>📱 ${appData.subtitle}</span>
                    <span style="color:#4ade80;">✓ Ücretsiz</span>
                </div>
            </div>

            <div class="modal-desc-scroll">
                <div class="modal-desc-text">${appData.description}</div>
                <div class="modal-tags">
                    ${appData.tags.map(t => `<span class="tag">${t}</span>`).join('')}
                </div>
                <div style="margin-top:1rem;padding:0.75rem 1rem;background:rgba(229,9,20,0.1);border-left:3px solid #e50914;border-radius:6px;font-size:0.82rem;color:#ccc;line-height:1.5;">
                    ❤️ Uygulamalarımızı paylaşarak ve Play Store'da puan vererek yorum yaparak bizlere destek olabilirsiniz.
                </div>
            </div>

            <div class="modal-footer-fixed">
                <div class="modal-actions">
                    <button class="btn-icon" title="Linki Kopyala" onclick="navigator.clipboard.writeText('${appData.playstore}').then(()=>{ this.innerHTML='<i class=\\'fas fa-check\\'></i>'; setTimeout(()=>{ this.innerHTML='<i class=\\'fas fa-copy\\'></i>'; },2000); })">
                        <i class="fas fa-copy"></i>
                    </button>
                </div>
                <button class="btn btn-primary btn-flex" id="appInceleBtn_${appId}" onclick="
                    var poster = document.getElementById('appModalPoster_${appId}');
                    var btn = document.getElementById('appInceleBtn_${appId}');
                    if (poster.dataset.qr === '1') {
                        poster.innerHTML = '<img src=\\'${appData.poster}\\' alt=\\'${appData.title}\\' style=\\'width:100%;height:100%;object-fit:fill;\\' data-fallback=\\'${appData.banner}\\' onerror=\\'app.handleAppImgError(this)\\'>';
                        poster.dataset.qr = '0';
                        btn.innerHTML = '<i class=\\'fas fa-qrcode\\'></i> QRCODE';
                    } else {
                        poster.innerHTML = '<img src=\\'${qrUrl}\\' alt=\\'QR Kod\\' style=\\'width:100%;height:100%;object-fit:fill;background:#fff;padding:16px;\\' >';
                        poster.dataset.qr = '1';
                        btn.innerHTML = '<i class=\\'fas fa-arrow-left\\'></i> Geri';
                    }
                ">
                    <i class="fas fa-qrcode"></i> QRCODE
                </button>
            </div>
        `;

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    showModal(docId) {
        const doc = this.data.all.find(d => d.id === docId);
        if (!doc) return;

        const modal = document.getElementById('detailModal');
        const modalContent = document.getElementById('modalContent');

        // Kategori bilgisini tags'den al
        const categoryTags = (doc.tags && doc.tags.length > 0) ? doc.tags : [];

        modalContent.innerHTML = `
            <button class="modal-close" onclick="app.closeModal()">
                <i class="fas fa-times"></i>
            </button>
            
            <!--Fixed Header-->
            <div class="modal-header-fixed">
                <div class="modal-poster-fixed">
                    <img src="${this.getPoster(doc)}" alt="${doc.title}">
                </div>
                <h2 class="modal-title-fixed">${doc.title}</h2>
                <div class="modal-meta-fixed">
                    ${doc.year ? `<span>📅 ${doc.year}</span>` : ''}
                    ${doc.rating ? `<span>⭐ ${doc.rating}/10</span>` : ''}
                    ${doc.runtime ? `<span>⏱ ${doc.runtime} dk</span>` : ''}
                </div>
            </div>
            
            <!--Scrollable Description-->
            <div class="modal-desc-scroll">
                <div class="modal-desc-text">${this.cleanDescription(doc.description || doc.content)}</div>
                ${categoryTags.length > 0 ? `
                    <div class="modal-tags">
                        ${categoryTags.map(cat => `<span class="tag">${cat}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
            
            <!--Not Alanı-->
            <div class="modal-note-section">
                <textarea 
                    class="modal-note-input" 
                    id="noteInput_${doc.id}" 
                    placeholder="Bu belgesel hakkında notunuz..."
                    oninput="app.saveNote(${doc.id}, this.value)"
                >${this.getNote(doc.id)}</textarea>
            </div>
            
            <!--Fixed Footer-->
            <div class="modal-footer-fixed">
                <div class="modal-actions">
                    <button class="btn-icon" data-favorite-id="${doc.id}" onclick="app.toggleFavorite(${doc.id}); event.stopPropagation();" title="Favorilere ekle">
                        <i class="${this.isFavorite(doc.id) ? 'fas' : 'far'} fa-heart"></i>
                    </button>
                    <button class="btn-icon" data-watchlist-id="${doc.id}" onclick="app.toggleWatchlist(${doc.id}); event.stopPropagation();" title="İzleme listesine ekle">
                        <i class="${this.isInWatchlist(doc.id) ? 'fas' : 'far'} fa-bookmark"></i>
                    </button>
                    <button class="btn-icon" data-watched-id="${doc.id}" onclick="app.toggleWatched(${doc.id}); event.stopPropagation();" title="İzledim olarak işaretle">
                        <i class="${this.isWatched(doc.id) ? 'fas' : 'far'} fa-check-circle"></i>
                    </button>
                </div>
                <button class="btn btn-primary btn-flex" onclick="event.stopPropagation(); app.showPlayer(${doc.id}); app.closeModal();">
                    <i class="fas fa-play"></i> İzle
                </button>
            </div>
        `;

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    closeModal() {
        document.getElementById('detailModal').classList.remove('active');
        document.body.style.overflow = '';
    }

    showPlayer(docId) {
        const doc = this.data.all.find(d => d.id === docId);
        if (!doc) return;
        
        // NOT: Premium kontrolü burada YAPILMAYACAK
        // Player açılacak, sadece premium bölümlerin video alanında uyarı gösterilecek

        const playerModal = document.getElementById('playerModal');
        const playerWrapper = document.getElementById('playerWrapper');

        let videoUrl = '';
        let currentTitle = doc.title;
        let isPremiumVideo = false;

        // Eğer seri ise, ilk bölümün videosunu al
        if (doc.type === 'tv') {
            const episodes = this.data.episodes.filter(ep => {
                return ep.serie_title && ep.serie_title.toLowerCase().includes(doc.title.toLowerCase());
            });

            if (episodes.length > 0 && episodes[0].videos && episodes[0].videos.length > 0) {
                // İlk bölümün premium olup olmadığını kontrol et
                const firstVideo = episodes[0].videos[0];
                if (firstVideo.embed && firstVideo.embed.includes('[ihc-hide-content')) {
                    isPremiumVideo = true;
                }
                
                if (!isPremiumVideo || (window.currentUser && window.currentUser.isPremium)) {
                    videoUrl = this.extractIframeSrc(firstVideo.embed);
                }
                currentTitle = episodes[0].title;
            }
        } else {
            // Post veya Episode için direkt video al
            if (doc.videos && doc.videos.length > 0) {
                const firstVideo = doc.videos[0];
                if (firstVideo.embed && firstVideo.embed.includes('[ihc-hide-content')) {
                    isPremiumVideo = true;
                }
                
                if (!isPremiumVideo || (window.currentUser && window.currentUser.isPremium)) {
                    videoUrl = this.extractIframeSrc(firstVideo.embed);
                }
            }
        }

        if (!videoUrl) {
            if (isPremiumVideo && (!window.currentUser || !window.currentUser.isPremium)) {
                // Premium video - player aç, video alanında uyarı göster ama diğer bilgiler görünsün
                playerModal.classList.add('active');
                document.body.style.overflow = 'hidden';
                this.playerStartTime = Date.now();
                this.currentPlayingId = docId;
                
                const cleanDesc = this.cleanDescription(doc.description || doc.content);
                
                let html = `
                    <div class="player-video premium-mode" style="display:flex; align-items:center; justify-content:center; padding:40px; min-height:300px;">
                        <div style="text-align: center;">
                            <i class="fas fa-crown" style="font-size: 4rem; color: #e50914; margin-bottom: 20px; display:block;"></i>
                            <h3 style="color: #e50914; font-size: 1.8rem; margin-bottom: 15px;">🔒 Premium İçerik</h3>
                            <p style="color: #b3b3b3; font-size: 1.1rem; margin-bottom: 20px;">Bu içerik sadece Premium üyelere özeldir.</p>
                            <div style="background:rgba(255,152,0,0.08);border:1px solid rgba(255,152,0,0.3);border-radius:10px;padding:10px 16px;margin-bottom:14px;cursor:pointer;" onclick="DownloadReward.openModal()">
                                <span style="color:#ffb74d;font-size:0.9rem;">⚡ <strong>Ücretsiz Premium Kazan:</strong> Bir içerik indirerek 2 saat ücretsiz premium erişim kazanabilirsin!</span>
                                <span style="display:block;color:#ff9800;font-size:0.8rem;margin-top:3px;">→ İndirerek Kazan butonuna tıkla</span>
                            </div>
                            <p style="font-size: 0.9rem; color: #808080;">Premium üyelik için lütfen giriş yapın veya aşağıdaki iletişim kanallarından birini tercih edin.</p>
                            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:16px;">
                                <button onclick="copyAndOpen('semihsy54@gmail.com','Mail')" style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(229,9,20,0.35);color:#ff8080;padding:6px 13px;border-radius:20px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(229,9,20,0.12)'" onmouseout="this.style.background='transparent'"><i class="fas fa-envelope"></i> Mail</button>
                                <button onclick="copyAndOpen('https://alvo.chat/4CmsT','WhatsApp')" style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(37,211,102,0.3);color:#4cdb7a;padding:6px 13px;border-radius:20px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(37,211,102,0.1)'" onmouseout="this.style.background='transparent'"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                                <button onclick="copyAndOpen('https://x.com/messages/compose?recipient_id=semih_sylemez','Twitter')" style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(29,161,242,0.3);color:#5bb8f5;padding:6px 13px;border-radius:20px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(29,161,242,0.1)'" onmouseout="this.style.background='transparent'"><i class="fab fa-x-twitter"></i> Twitter</button>
                            </div>
                        </div>
                    </div>
                    <div class="player-info">
                        <h2 id="playerTitle">${doc.title}</h2>
                        <div class="player-meta">
                            <span>🎬 ${this.getTypeBadge(doc.type)}</span>
                            ${doc.year ? `<span>📅 ${doc.year}</span>` : ''}
                            ${doc.rating ? `<span>⭐ ${doc.rating}</span>` : ''}
                            ${doc.runtime ? `<span>⏱ ${doc.runtime} dk</span>` : ''}
                        </div>
                    </div>
                `;
                
                if (cleanDesc && cleanDesc !== 'Açıklama bulunmuyor.') {
                    html += `
                        <div class="player-description">
                            <h3>📖 Açıklama</h3>
                            <div class="description-content">${cleanDesc}</div>
                        </div>
                    `;
                }
                
                playerWrapper.innerHTML = html;
                return;
            }
            
            if (window.customAlert) {
                window.customAlert('Bu belgesel için video bulunamadı!', 'Video Bulunamadı', '🎬');
            } else {
                alert('Bu belgesel için video bulunamadı!');
            }
            return;
        }

        let html = `
        <div class="adblock-warning" style="background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%); color: white; padding: 1rem; border-radius: 10px; margin-bottom: 1rem; display: none;" id="adblockWarning">
            <div style="display: flex; align-items: center; gap: 1rem;">
                <i class="fas fa-exclamation-triangle" style="font-size: 2rem;"></i>
                <div style="flex: 1;">
                    <h4 style="margin: 0 0 0.5rem 0;">⚠️ Reklam Engelleyici Algılandı</h4>
                    <p style="margin: 0; font-size: 0.9rem; opacity: 0.9;">
                        Video oynatıcı reklam engelleyici algıladı. Lütfen bu site için reklam engelleyiciyi kapatın veya alternatif player'ları deneyin.
                    </p>
                </div>
                <button onclick="document.getElementById('adblockWarning').style.display='none'" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 0.5rem 1rem; border-radius: 5px; cursor: pointer;">
                    Kapat
                </button>
            </div>
        </div>
        <div class="player-video">
            <iframe
                id="videoIframe"
                    src="${videoUrl}"
                    frameborder="0"
                    scrolling="no"
                    allowfullscreen="true"
                    webkitallowfullscreen="true"
                    mozallowfullscreen="true"
                    msallowfullscreen="true"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen *; web-share"
                    referrerpolicy="no-referrer-when-downgrade"
                    sandbox="allow-forms allow-scripts allow-same-origin allow-presentation allow-modals"
                    onload="window.checkIframeLoad(this)"
                ></iframe>
        </div>

        <div class="player-info">
                <h2 id="playerTitle">${currentTitle}</h2>
                <div class="player-meta">
                    <span>🎬 ${this.getTypeBadge(doc.type)}</span>
                    ${doc.year ? `<span>📅 ${doc.year}</span>` : ''}
                    ${doc.rating ? `<span>⭐ ${doc.rating}</span>` : ''}
                    ${doc.runtime ? `<span>⏱ ${doc.runtime} dk</span>` : ''}
                </div>
                ${doc.videos && doc.videos.length > 1 ? `
                <div class="alternative-players" style="margin-top: 1rem; padding: 1rem; background: rgba(255,255,255,0.05); border-radius: 10px;">
                    <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; opacity: 0.8;">
                        <i class="fas fa-play-circle"></i> Alternatif Player'lar
                    </h4>
                    <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                        ${doc.videos.map((video, index) => `
                            <button 
                                class="alt-player-btn ${index === 0 ? 'active' : ''}" 
                                onclick="app.switchPlayer(${index}, '${this.extractIframeSrc(video.embed).replace(/'/g, "\\'")}')"
                                style="padding: 0.5rem 1rem; background: ${index === 0 ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255,255,255,0.1)'}; border: none; color: white; border-radius: 5px; cursor: pointer; font-size: 0.85rem; transition: all 0.3s;">
                                Player ${index + 1}${video.title ? ` - ${video.title}` : ''}
                            </button>
                        `).join('')}
                    </div>
                    <p style="margin: 0.5rem 0 0 0; font-size: 0.75rem; opacity: 0.6;">
                        💡 Video oynatılmıyorsa alternatif player'ları deneyin
                    </p>
                </div>
                ` : ''}
            </div>
        `;

        // Tek bölümlük belgeseller için açıklama ekle
        if (doc.type === 'post') {
            const cleanDesc = this.cleanDescription(doc.description || doc.content);

            if (cleanDesc && cleanDesc !== 'Açıklama bulunmuyor.') {
                html += `
        <div class="player-description">
                    <h3>📖 Açıklama</h3>
                    <div class="description-content">
                        ${cleanDesc}
                    </div>
                </div>
        `;
            }
        }

        // Eğer seri ise, bölümleri listele
        if (doc.type === 'tv') {
            const episodes = this.data.episodes.filter(ep => {
                // Seri adı ile eşleştir
                return ep.serie_title && ep.serie_title.toLowerCase().includes(doc.title.toLowerCase());
            });

            if (episodes.length > 0) {
                // Episode'ları episode_number'a göre sırala
                episodes.sort((a, b) => {
                    const epA = parseInt(a.episode_number) || 0;
                    const epB = parseInt(b.episode_number) || 0;
                    return epA - epB;
                });

                // Sezon bazlı gruplama
                const seasonGroups = {};
                episodes.forEach(ep => {
                    const season = ep.season_number || '1';
                    if (!seasonGroups[season]) {
                        seasonGroups[season] = [];
                    }
                    seasonGroups[season].push(ep);
                });

                html += `
        <div class="episodes-section">
                    <h3>📺 Bölümler (${episodes.length} Bölüm)</h3>
                    
                    <!--Sezon Tab'ları -->
        <div class="season-tabs">
                `;

                // Sezon tab'larını oluştur
                const sortedSeasons = Object.keys(seasonGroups).sort();
                sortedSeasons.forEach((season, index) => {
                    const seasonEpisodes = seasonGroups[season];
                    html += `
            <div class="season-tab ${index === 0 ? 'active' : ''}" onclick="app.switchSeason('${season}')">
                Sezon ${season} (${seasonEpisodes.length})
                    </div>
        `;
                });

                html += `</div> <div class="episodes-carousel">`;

                // Her sezon için
                sortedSeasons.forEach((season, index) => {
                    const seasonEpisodes = seasonGroups[season];

                    html += `<div class="season-group ${index === 0 ? 'active' : ''}" data-season="${season}">`;
                    html += `<div class="episodes-slider">`;

                    seasonEpisodes.forEach(episode => {
                        const episodeVideoEmbed = episode.videos && episode.videos.length > 0 ? episode.videos[0].embed : '';
                        const episodeVideoUrl = episodeVideoEmbed ? this.extractIframeSrc(episodeVideoEmbed) : '';
                        
                        // Premium kontrolü
                        const isEpisodePremium = episodeVideoEmbed && episodeVideoEmbed.includes('[ihc-hide-content');

                        html += `
                    <div class="episode-card" onclick="app.changeEpisode(${episode.id}, '${episodeVideoUrl.replace(/'/g, "\\'")}', '${episode.title.replace(/'/g, "\\'")}')">
                    <div class="episode-poster">
                        <img src="${this.getPoster(episode)}" alt="${episode.title}">
                            <div class="episode-play">
                                <i class="fas fa-play-circle"></i>
                            </div>
                            ${isEpisodePremium ? '<div class="premium-badge-small" style="position: absolute; top: 5px; right: 5px; background: rgba(229, 9, 20, 0.9); color: white; padding: 3px 8px; border-radius: 5px; font-size: 0.7rem; font-weight: 700;"><i class="fas fa-crown"></i> Premium</div>' : ''}
                    </div>
                    <div class="episode-info">
                        <h5>Bölüm ${episode.episode_number || '?'}</h5>
                        <p>${episode.episode_title || episode.title}</p>
                    </div>
                </div>
                `;
                    });

                    html += `</div></div>`;
                });

                html += `</div ></div > `;
            }
        }

        playerWrapper.innerHTML = html;
        playerModal.classList.add('active');
        document.body.style.overflow = 'hidden';

        // Modal'ı kapat
        this.closeModal();

        // İzleme takibi başlat
        this.currentPlayingId = docId;
        this.playerStartTime = Date.now();
        this.startWatchTracking(docId);

        // Tam ekran desteği için event listener ekle
        setTimeout(() => {
            const videoIframe = document.getElementById('videoIframe');
            const playerVideoDiv = document.querySelector('.player-video');

            if (videoIframe && playerVideoDiv) {
                // iframe'e çift tıklandığında fullscreen moduna geç
                videoIframe.addEventListener('dblclick', function (e) {
                    e.preventDefault();
                    const elem = playerVideoDiv;
                    if (elem.requestFullscreen) {
                        elem.requestFullscreen();
                    } else if (elem.webkitRequestFullscreen) {
                        elem.webkitRequestFullscreen();
                    } else if (elem.mozRequestFullScreen) {
                        elem.mozRequestFullScreen();
                    } else if (elem.msRequestFullscreen) {
                        elem.msRequestFullscreen();
                    }
                });

                console.log('✅ Tam ekran desteği aktif - iframe çift tıklama ile tam ekran');
            }
        }, 100);
    }

    changeEpisode(episodeId, videoUrl, title) {
        // Episode'u bul ve premium kontrolü yap
        const episode = this.data.episodes.find(ep => ep.id === episodeId);
        let isPremiumVideo = false;
        
        if (episode && episode.videos && episode.videos.length > 0) {
            // Video embed'lerini kontrol et
            for (const video of episode.videos) {
                if (video.embed && video.embed.includes('[ihc-hide-content')) {
                    isPremiumVideo = true;
                    break;
                }
            }
        }
        
        // Premium video ve kullanıcı premium değilse
        if (isPremiumVideo && (!window.currentUser || !window.currentUser.isPremium)) {
            const iframe = document.getElementById('videoIframe');
            if (iframe) {
                // iframe'i gizle ve premium uyarısı göster
                const playerVideo = document.querySelector('.player-video');
                if (playerVideo) {
                    playerVideo.classList.add('premium-mode');
                    playerVideo.innerHTML = `
                        <div class="premium-blocked" style="height: 100%; display: flex; align-items: center; justify-content: center; padding: 40px;">
                            <div style="text-align: center;">
                                <i class="fas fa-crown" style="font-size: 4rem; color: #e50914; margin-bottom: 20px;"></i>
                                <h3 style="color: #e50914; font-size: 1.8rem; margin-bottom: 15px;">🔒 Premium Bölüm</h3>
                                <p style="color: #b3b3b3; font-size: 1.1rem; margin-bottom: 20px;">
                                    Bu bölüm sadece Premium üyelere özeldir.
                                </p>
                                <div style="background:rgba(255,152,0,0.08);border:1px solid rgba(255,152,0,0.3);border-radius:10px;padding:10px 16px;margin-bottom:16px;cursor:pointer;" onclick="DownloadReward.openModal()">
                                    <span style="color:#ffb74d;font-size:0.9rem;">⚡ <strong>Ücretsiz Premium Kazan:</strong> Bir içerik indirerek 2 saat ücretsiz premium erişim kazanabilirsin!</span>
                                    <span style="display:block;color:#ff9800;font-size:0.8rem;margin-top:3px;">→ İndirerek Kazan butonuna tıkla</span>
                                </div>
                                <p style="font-size: 0.9rem; color: #808080;">
                                    Premium üyelik için lütfen giriş yapın veya aşağıdaki iletişim kanallarından birini tercih edin.
                                </p>
                                <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:16px;">
                                    <button onclick="copyAndOpen('semihsy54@gmail.com','Mail')" style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(229,9,20,0.35);color:#ff8080;padding:6px 13px;border-radius:20px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(229,9,20,0.12)'" onmouseout="this.style.background='transparent'"><i class="fas fa-envelope"></i> Mail</button>
                                    <button onclick="copyAndOpen('https://alvo.chat/4CmsT','WhatsApp')" style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(37,211,102,0.3);color:#4cdb7a;padding:6px 13px;border-radius:20px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(37,211,102,0.1)'" onmouseout="this.style.background='transparent'"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                                    <button onclick="copyAndOpen('https://x.com/messages/compose?recipient_id=semih_sylemez','Twitter')" style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(29,161,242,0.3);color:#5bb8f5;padding:6px 13px;border-radius:20px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(29,161,242,0.1)'" onmouseout="this.style.background='transparent'"><i class="fab fa-x-twitter"></i> Twitter</button>
                                </div>
                            </div>
                        </div>
                    `;
                }
            }
            
            // Başlığı güncelle
            const playerTitle = document.getElementById('playerTitle');
            if (playerTitle) {
                playerTitle.textContent = title;
            }
            
            return;
        }
        
        if (!videoUrl) {
            if (window.customAlert) {
                window.customAlert('Bu bölüm için video bulunamadı!', 'Video Bulunamadı', '🎬');
            } else {
                alert('Bu bölüm için video bulunamadı!');
            }
            return;
        }

        // iframe'i güncelle veya geri yükle
        const iframe = document.getElementById('videoIframe');
        const playerVideo = document.querySelector('.player-video');
        
        // premium-mode class'ını kaldır (normal video gösterilecek)
        if (playerVideo) {
            playerVideo.classList.remove('premium-mode');
        }
        
        if (playerVideo && !iframe) {
            // iframe yoksa (premium uyarısı gösteriliyordu), yeniden oluştur
            playerVideo.innerHTML = `
                <iframe
                    id="videoIframe"
                    src="${videoUrl}"
                    frameborder="0"
                    scrolling="no"
                    allowfullscreen="true"
                    webkitallowfullscreen="true"
                    mozallowfullscreen="true"
                    msallowfullscreen="true"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen *; web-share"
                    referrerpolicy="no-referrer-when-downgrade"
                    sandbox="allow-forms allow-scripts allow-same-origin allow-presentation allow-modals"
                ></iframe>
            `;
        } else if (iframe) {
            // iframe varsa sadece src'yi güncelle
            iframe.src = videoUrl;
        }

        // Başlığı güncelle
        const titleEl = document.getElementById('playerTitle');
        if (titleEl) {
            titleEl.textContent = title;
        }

        // En üste scroll
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    switchSeason(season) {
        // Tüm tab'lardan active class'ı kaldır
        document.querySelectorAll('.season-tab').forEach(tab => {
            tab.classList.remove('active');
        });

        // Tüm sezon gruplarını gizle
        document.querySelectorAll('.season-group').forEach(group => {
            group.classList.remove('active');
        });

        // Tıklanan tab'a active ekle
        event.target.classList.add('active');

        // İlgili sezon grubunu göster
        const seasonGroup = document.querySelector(`.season - group[data - season="${season}"]`);
        if (seasonGroup) {
            seasonGroup.classList.add('active');
        }
    }

    closePlayer() {
        const playerModal = document.getElementById('playerModal');
        const playerWrapper = document.getElementById('playerWrapper');

        // Cleanup PlyrPlayerManager
        if (window.PlyrPlayerManager) {
            window.PlyrPlayerManager.destroy();
        }

        playerModal.classList.remove('active');
        playerWrapper.innerHTML = '';
        document.body.style.overflow = '';
    }

    // ============================================
    // SEARCH
    // ============================================

    openSearch() {
        document.getElementById('searchOverlay').classList.add('active');
        document.getElementById('searchInput').focus();
        document.body.style.overflow = 'hidden';
    }

    closeSearch() {
        document.getElementById('searchOverlay').classList.remove('active');
        document.getElementById('searchInput').value = '';
        document.getElementById('searchResults').innerHTML = '';
        document.body.style.overflow = '';
    }

    performSearch(query) {
        const resultsContainer = document.getElementById('searchResults');

        if (!query || query.length < 2) {
            resultsContainer.innerHTML = '';
            return;
        }

        // Tüm sonuçları bul
        const allResults = this.data.all.filter(doc =>
            doc.title.toLowerCase().includes(query.toLowerCase())
        );

        // Kategorilere ayır
        const singles = allResults.filter(doc => doc.type === 'post').slice(0, 20);
        const series = allResults.filter(doc => doc.type === 'tv').slice(0, 20);
        const episodes = allResults.filter(doc => doc.type === 'episode').slice(0, 20);

        const totalResults = singles.length + series.length + episodes.length;

        if (totalResults === 0) {
            resultsContainer.innerHTML = '<p class="no-results">Sonuç bulunamadı</p>';
            return;
        }

        let html = `<div class="search-results-categorized">`;

        // Tek Bölümlük Belgeseller
        if (singles.length > 0) {
            html += `
                <div class="search-category">
                    <h3 class="search-category-title">🎬 Tek Belgeseller <span class="count">(${singles.length})</span></h3>
                    <div class="search-grid">
                        ${singles.map(doc => `
                            <div class="search-item" onclick="app.showModal(${doc.id}); app.closeSearch();">
                                <img src="${this.getPoster(doc)}" alt="${doc.title}">
                                <div class="search-item-info">
                                    <h4>${doc.title}</h4>
                                    <p>${doc.year || ''} ${doc.rating ? `⭐ ${doc.rating}` : ''}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Seri Belgeseller
        if (series.length > 0) {
            html += `
                <div class="search-category">
                    <h3 class="search-category-title">📺 Seri Belgeseller <span class="count">(${series.length})</span></h3>
                    <div class="search-grid">
                        ${series.map(doc => `
                            <div class="search-item" onclick="app.showModal(${doc.id}); app.closeSearch();">
                                <img src="${this.getPoster(doc)}" alt="${doc.title}">
                                <div class="search-item-info">
                                    <h4>${doc.title}</h4>
                                    <p>${doc.year || ''} ${doc.rating ? `⭐ ${doc.rating}` : ''}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Bölümler
        if (episodes.length > 0) {
            html += `
                <div class="search-category">
                    <h3 class="search-category-title">🎞️ Bölümler <span class="count">(${episodes.length})</span></h3>
                    <div class="search-grid">
                        ${episodes.map(doc => `
                            <div class="search-item" onclick="app.showModal(${doc.id}); app.closeSearch();">
                                <img src="${this.getPoster(doc)}" alt="${doc.title}">
                                <div class="search-item-info">
                                    <h4>${doc.title}</h4>
                                    <p>${doc.episode_number ? `Bölüm ${doc.episode_number}` : ''} ${doc.rating ? `⭐ ${doc.rating}` : ''}</p>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        html += `</div>`;
        resultsContainer.innerHTML = html;
    }

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    getPoster(item) {
        if (item.poster && item.poster !== 'N/A' && item.poster.trim() !== '') {
            return item.poster.replace(/\\\//g, '/').replace(/\\/g, '').trim();
        }
        // Fallback: seed bazlı placeholder
        const seed = item.id || Math.floor(Math.random() * 1000);
        return `https://picsum.photos/seed/${seed}/300/450`;
    }

    getTopRatedDocs(count) {
        return [...this.data.all]
            .sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0))
            .slice(0, count);
    }

    getRandomDocs(count) {
        const shuffled = [...this.data.all].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, count);
    }

    playRandom() {
        console.log('🎲 Rastgele belgesel seçiliyor...');
        if (!this.data.all || this.data.all.length === 0) {
            console.warn('⚠️ Veri henüz yüklenmedi veya boş!');
            return;
        }

        const randomIndex = Math.floor(Math.random() * this.data.all.length);
        const randomDoc = this.data.all[randomIndex];

        console.log(`✅ Seçilen: ${randomDoc.title} (ID: ${randomDoc.id})`);
        this.showModal(randomDoc.id);
    }

    getCategoryEmoji(name) {
        const emojis = {
            'Bilim Belgeselleri': '🔬',
            'Tarih Belgeselleri': '📜',
            'Uzay Belgeselleri': '🚀',
            'Gizem Belgeselleri': '🔮',
            'Türk Tarihi': '🇹🇷',
            'Sağlık ve Hastalık Belgeselleri': '🏥',
            'Doğa Belgeselleri': '🌿',
            'Doğa & Canlı Belgeselleri': '🦁',
            'Sanat Belgeselleri': '🎨',
            'Spor Belgeselleri': '⚽',
            'Müzik Belgeselleri': '🎵',
            'Teknoloji Belgeselleri': '💻',
            'Biyografi ve Drama Belgeselleri': '👤',
            'Savaş Belgeselleri': '⚔️',
            'Ekonomi Belgeselleri': '💰',
            'Din Belgeselleri': '🕌',
            'Yakın Tarih Belgeselleri': '📰',
            'Gezi-Kültür Belgeselleri': '🗺️',
            'Eğitici Animasyon': '📚',
            'Eleştiri Belgeselleri': '🎭',
            'Sanayi-Teknoloji Belgeselleri': '🏭',
            'Diğer Belgeseller': '🎬'
        };

        // Tam eşleşme kontrolü
        if (emojis[name]) {
            return emojis[name];
        }

        // Kısmi eşleşme
        for (const [key, emoji] of Object.entries(emojis)) {
            if (name.includes(key.replace(' Belgeselleri', '')) || key.includes(name)) {
                return emoji;
            }
        }

        return '🎬';
    }

    slugify(text) {
        return text.toLowerCase()
            .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
            .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    formatDateShort(dateString) {
        if (!dateString) return '';
        try {
            const date = new Date(dateString);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = String(date.getFullYear()).slice(-2);
            return `${day}.${month}.${year}`;
        } catch (e) {
            return '';
        }
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    truncateText(text, maxLength) {
        if (!text) return '';
        // HTML taglerini temizle
        const cleanText = text.replace(/<[^>]*>/g, '');
        if (cleanText.length <= maxLength) return cleanText;
        return cleanText.substring(0, maxLength) + '...';
    }

    cleanDescription(text) {
        if (!text) return 'Açıklama bulunmuyor.';

        let cleaned = text;

        // 1) Escaped literal \r\n, \n, \r → gerçek newline
        cleaned = cleaned.replace(/\\r\\n/g, '\n');
        cleaned = cleaned.replace(/\\r/g, '\n');
        cleaned = cleaned.replace(/\\n/g, '\n');

        // 2) Gerçek \r\n ve \r → \n
        cleaned = cleaned.replace(/\r\n/g, '\n');
        cleaned = cleaned.replace(/\r/g, '\n');

        // 3) HTML taglerini temizle (satır sonları korunmuş halde)
        cleaned = cleaned.replace(/<br\s*\/?>/gi, '\n');
        cleaned = cleaned.replace(/<p[^>]*>/gi, '');
        cleaned = cleaned.replace(/<\/p>/gi, '\n');
        cleaned = cleaned.replace(/<[^>]*>/g, '');

        // 4) HTML entity decode
        cleaned = cleaned.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

        // 5) Başta kalan artık "rn" kalıntılarını temizle (tüm durumlar)
        cleaned = cleaned.replace(/^rn\s*/gm, '');
        cleaned = cleaned.replace(/\brn\b/g, '');
        
        // Başta ve sonda boşlukları temizle
        cleaned = cleaned.trim();
        
        // Satırları paragraflara böl
        const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        
        // Her satırı işle
        const processedLines = lines.map(line => {
            // "Yapım:" ile başlayan satırları özel formatla - ortalanmış, kırmızı
            if (/^yapım\s*:/i.test(line)) {
                const formatted = line.replace(
                    /^(yapım\s*:)\s*(.+)$/i,
                    (_, label, value) => {
                        const producers = value.split(/[,&\/]/).map(p => 
                            `<span style="color:#e50914; font-weight:700;">${p.trim()}</span>`
                        ).join(', ');
                        return `<p style="text-align:center; margin-top:1.2rem; margin-bottom:0;"><span style="color:#b3b3b3; font-weight:600;">${label}</span> ${producers}</p>`;
                    }
                );
                return formatted;
            }
            return `<p>${line}</p>`;
        });
        
        return processedLines.join('');
    }

    shuffleArray(array) {
        // Fisher-Yates shuffle algoritması
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    extractIframeSrc(iframeHtml) {
        if (!iframeHtml) return '';

        // iframe HTML'inden src attribute'unu çıkar
        // Format: <iframe ... src="URL" ...>
        const srcMatch = iframeHtml.match(/src=["']([^"']+)["']/i);

        let url = '';
        if (srcMatch && srcMatch[1]) {
            url = srcMatch[1];
        } else if (iframeHtml.startsWith('http')) {
            // Eğer zaten URL ise direkt al
            url = iframeHtml;
        }

        // NOT: URL conversion removed - short.icu redirects don't work in iframes
        // Keep original abysscdn.com URLs for proper iframe playback

        return url;
    }

    // ============================================
    // FAVORİLER & İZLEME LİSTESİ
    // ============================================

    toggleFavorite(docId) {
        const index = this.favorites.indexOf(docId);
        if (index > -1) {
            this.favorites.splice(index, 1);
        } else {
            this.favorites.push(docId);
        }
        localStorage.setItem('favorites', JSON.stringify(this.favorites));
        this.updateFavoriteIcons();
    }

    toggleWatchlist(docId) {
        const index = this.watchlist.indexOf(docId);
        if (index > -1) {
            this.watchlist.splice(index, 1);
        } else {
            this.watchlist.push(docId);
        }
        localStorage.setItem('watchlist', JSON.stringify(this.watchlist));
        this.updateWatchlistIcons();
    }

    isFavorite(docId) {
        return this.favorites.includes(docId);
    }

    isInWatchlist(docId) {
        return this.watchlist.includes(docId);
    }

    updateFavoriteIcons() {
        document.querySelectorAll('[data-favorite-id]').forEach(btn => {
            const docId = parseInt(btn.dataset.favoriteId);
            const icon = btn.querySelector('i');
            if (this.isFavorite(docId)) {
                icon.className = 'fas fa-heart';
                btn.classList.add('active');
            } else {
                icon.className = 'far fa-heart';
                btn.classList.remove('active');
            }
        });
    }

    updateWatchlistIcons() {
        document.querySelectorAll('[data-watchlist-id]').forEach(btn => {
            const docId = parseInt(btn.dataset.watchlistId);
            const icon = btn.querySelector('i');
            if (this.isInWatchlist(docId)) {
                icon.className = 'fas fa-bookmark';
                btn.classList.add('active');
            } else {
                icon.className = 'far fa-bookmark';
                btn.classList.remove('active');
            }
        });
    }

    renderFavoritesPage() {
        const content = document.getElementById('contentArea');
        const favoriteDocs = this.data.all.filter(doc => this.isFavorite(doc.id));

        let html = `
            <div class="page-header">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h1>❤️ Favorilerim</h1>
                    ${this.navigationHistory.length > 0 || this.previousPageState ? `
                        <button class="btn-icon" onclick="app.goBack()" title="Geri">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    ` : ''}
                </div>
                <p>${favoriteDocs.length} içerik</p>
            </div>
        `;

        if (favoriteDocs.length === 0) {
            html += `
                <div class="empty-state">
                    <i class="far fa-heart"></i>
                    <h2>Henüz favori eklemediniz</h2>
                    <p>Beğendiğiniz belgeselleri favorilere ekleyerek kolayca bulabilirsiniz.</p>
                </div>
            `;
        } else {
            html += `<div class="grid">`;
            favoriteDocs.forEach(doc => {
                html += this.renderCard(doc);
            });
            html += `</div>`;
        }

        content.innerHTML = html;
        this.observeImages();
    }

    renderWatchlistPage() {
        const content = document.getElementById('contentArea');
        const watchlistDocs = this.data.all.filter(doc => this.isInWatchlist(doc.id));

        let html = `
            <div class="page-header">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h1>📋 İzleme Listem</h1>
                    ${this.navigationHistory.length > 0 || this.previousPageState ? `
                        <button class="btn-icon" onclick="app.goBack()" title="Geri">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    ` : ''}
                </div>
                <p>${watchlistDocs.length} içerik</p>
            </div>
        `;

        if (watchlistDocs.length === 0) {
            html += `
                <div class="empty-state">
                    <i class="far fa-bookmark"></i>
                    <h2>İzleme listeniz boş</h2>
                    <p>Sonra izlemek istediğiniz belgeselleri listenize ekleyin.</p>
                </div>
            `;
        } else {
            html += `<div class="grid">`;
            watchlistDocs.forEach(doc => {
                html += this.renderCard(doc);
            });
            html += `</div>`;
        }

        content.innerHTML = html;
        this.observeImages();
    }

    // ============================================
    // CONTINUE WATCHING & WATCH TRACKING
    // ============================================

    startWatchTracking(docId) {
        // 1 dakika sonra continueWatching'e ekle
        this.watchTrackingTimer = setTimeout(() => {
            this.addToContinueWatching(docId);
        }, 60000); // 60 saniye
    }

    addToContinueWatching(docId) {
        // Zaten varsa güncelle, yoksa ekle
        const existingIndex = this.continueWatching.findIndex(item => item.id === docId);
        const watchData = {
            id: docId,
            timestamp: Date.now(),
            duration: Date.now() - this.playerStartTime
        };

        if (existingIndex > -1) {
            this.continueWatching[existingIndex] = watchData;
        } else {
            this.continueWatching.unshift(watchData);
        }

        // Max 20 item tut
        if (this.continueWatching.length > 20) {
            this.continueWatching = this.continueWatching.slice(0, 20);
        }

        localStorage.setItem('continueWatching', JSON.stringify(this.continueWatching));

        // İzleme geçmişine de ekle
        this.addToWatchHistory(docId, watchData.duration);
    }

    addToWatchHistory(docId, duration) {
        this.watchHistory.push({
            id: docId,
            timestamp: Date.now(),
            duration: duration
        });
        localStorage.setItem('watchHistory', JSON.stringify(this.watchHistory));
    }

    // ============================================
    // İZLEDİM/İZLEMEDİM
    // ============================================

    toggleWatched(docId) {
        const index = this.watched.indexOf(docId);
        if (index > -1) {
            this.watched.splice(index, 1);
        } else {
            this.watched.push(docId);
        }
        localStorage.setItem('watched', JSON.stringify(this.watched));
        this.updateWatchedIcons();
    }

    isWatched(docId) {
        return this.watched.includes(docId);
    }

    updateWatchedIcons() {
        document.querySelectorAll('[data-watched-id]').forEach(btn => {
            const docId = parseInt(btn.dataset.watchedId);
            const icon = btn.querySelector('i');
            if (this.isWatched(docId)) {
                icon.className = 'fas fa-check-circle';
                btn.classList.add('active');
            } else {
                icon.className = 'far fa-check-circle';
                btn.classList.remove('active');
            }
        });
    }

    // ============================================
    // NOTLAR SİSTEMİ
    // ============================================

    saveNote(docId, noteText) {
        if (noteText && noteText.trim()) {
            this.notes[docId] = noteText.trim();
        } else {
            delete this.notes[docId];
        }
        localStorage.setItem('notes', JSON.stringify(this.notes));
    }

    getNote(docId) {
        return this.notes[docId] || '';
    }

    // ============================================
    // İSTATİSTİKLER SAYFASI
    // ============================================

    renderStatisticsPage() {
        const content = document.getElementById('contentArea');

        // İstatistikleri hesapla
        const totalWatched = this.watched.length;
        const totalFavorites = this.favorites.length;
        const totalWatchlist = this.watchlist.length;
        const totalNotes = Object.keys(this.notes).length;
        const totalWatchTime = this.watchHistory.reduce((sum, item) => sum + (item.duration || 0), 0);
        const totalWatchTimeHours = Math.floor(totalWatchTime / 3600000);
        const totalWatchTimeMinutes = Math.floor((totalWatchTime % 3600000) / 60000);

        // Kategori analizi
        const categoryStats = {};
        this.watched.forEach(docId => {
            const doc = this.data.all.find(d => d.id === docId);
            if (doc && doc.tags) {
                doc.tags.forEach(tag => {
                    categoryStats[tag] = (categoryStats[tag] || 0) + 1;
                });
            }
        });

        const topCategories = Object.entries(categoryStats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        let html = `
            <div class="page-header">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h1>📊 İstatistikler</h1>
                    ${this.navigationHistory.length > 0 || this.previousPageState ? `
                        <button class="btn-icon" onclick="app.goBack()" title="Geri">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    ` : ''}
                </div>
                <p>İzleme istatistikleriniz ve tercihleriniz</p>
            </div>
            
            <div class="statistics-grid">
                <div class="stat-card">
                    <div class="stat-icon">✅</div>
                    <div class="stat-number">${totalWatched}</div>
                    <div class="stat-label">İzlenen Belgesel</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon">❤️</div>
                    <div class="stat-number">${totalFavorites}</div>
                    <div class="stat-label">Favori</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon">📖</div>
                    <div class="stat-number">${totalWatchlist}</div>
                    <div class="stat-label">İzleme Listesi</div>
                </div>
                
                <div class="stat-card">
                    <div class="stat-icon">📝</div>
                    <div class="stat-number">${totalNotes}</div>
                    <div class="stat-label">Not</div>
                </div>
                
                <div class="stat-card stat-card-wide">
                    <div class="stat-icon">⏱️</div>
                    <div class="stat-number">${totalWatchTimeHours}s ${totalWatchTimeMinutes}dk</div>
                    <div class="stat-label">Toplam İzleme Süresi</div>
                </div>
            </div>
        `;

        // En çok izlenen kategoriler
        if (topCategories.length > 0) {
            html += `
                <div class="statistics-section">
                    <h2>🏆 En Çok İzlediğiniz Kategoriler</h2>
                    <div class="category-bars">
                        ${topCategories.map(([cat, count]) => {
                const percentage = (count / totalWatched) * 100;
                return `
                                <div class="category-bar">
                                    <div class="category-bar-label">${cat}</div>
                                    <div class="category-bar-track">
                                        <div class="category-bar-fill" style="width: ${percentage}%"></div>
                                    </div>
                                    <div class="category-bar-count">${count}</div>
                                </div>
                            `;
            }).join('')}
                    </div>
                </div>
            `;
        }

        html += `
            <div style="margin-top:2rem;padding:1.25rem;background:#1a1a1a;border-radius:10px;border:1px solid #333;text-align:center;">
                <p style="color:#aaa;font-size:0.82rem;margin-bottom:0.75rem;">
                    ⚠️ Butona tıklayarak tüm <strong style="color:#e50914;">Kullanım Verileri</strong>'niz sıfırlanır. Emin olmadan tıklamayınız!!!
                </p>
                <button onclick="app.resetAllStats()" style="background:#e50914;color:#fff;border:none;padding:0.6rem 1.5rem;border-radius:6px;font-size:0.9rem;font-weight:600;cursor:pointer;letter-spacing:0.5px;">
                    🗑️ Herşeyi Sıfırla
                </button>
            </div>
        `;

        content.innerHTML = html;
    }

    resetAllStats() {
        if (!confirm('Tüm kullanım verileriniz (favoriler, izleme listesi, notlar, geçmiş) silinecek. Emin misiniz?')) return;
        ['favorites', 'watchlist', 'continueWatching', 'watched', 'notes', 'watchHistory'].forEach(k => localStorage.removeItem(k));
        this.favorites = [];
        this.watchlist = [];
        this.continueWatching = [];
        this.watched = [];
        this.notes = {};
        this.watchHistory = [];
        this.renderStatisticsPage();
    }

    // ============================================
    // FİLTRELEME SİSTEMİ
    // ============================================

    renderFilters(page) {
        const years = [...new Set(this.data.all.map(d => d.year).filter(y => y))].sort((a, b) => b - a);
        const categories = Object.keys(this.categoryDocuments).sort();

        // Ülkeleri topla
        const countries = [...new Set(
            this.data.all
                .filter(d => d.countries && d.countries.length > 0)
                .flatMap(d => d.countries)
        )].sort((a, b) => a.localeCompare(b, 'tr'));

        return `
            <div class="filters-bar">
                <select class="filter-select" id="sortSelect" onchange="app.updateSort(this.value)">
                    <option value="default" ${this.state.sortBy === 'default' ? 'selected' : ''}>🔀 Sıralama</option>
                    <option value="rating-high" ${this.state.sortBy === 'rating-high' ? 'selected' : ''}>⭐ Puan (Yüksek)</option>
                    <option value="rating-low" ${this.state.sortBy === 'rating-low' ? 'selected' : ''}>⭐ Puan (Düşük)</option>
                    <option value="alpha-asc" ${this.state.sortBy === 'alpha-asc' ? 'selected' : ''}>🔤 A → Z</option>
                    <option value="alpha-desc" ${this.state.sortBy === 'alpha-desc' ? 'selected' : ''}>🔤 Z → A</option>
                    <option value="most-watched" ${this.state.sortBy === 'most-watched' ? 'selected' : ''}>👁️ En Çok İzlenen</option>
                </select>
                
                <select class="filter-select" id="filterCategory" onchange="app.updateFilter('category', this.value)">
                    <option value="">Tüm Kategoriler</option>
                    ${categories.map(cat => `<option value="${cat}" ${this.state.filters.category === cat ? 'selected' : ''}>${cat}</option>`).join('')}
                </select>
                
                <select class="filter-select" id="filterYear" onchange="app.updateFilter('year', this.value)">
                    <option value="">Tüm Yıllar</option>
                    ${years.map(year => `<option value="${year}" ${this.state.filters.year == year ? 'selected' : ''}>${year}</option>`).join('')}
                </select>
                
                ${countries.length > 0 ? `
                <select class="filter-select" id="filterCountry" onchange="app.updateFilter('country', this.value)">
                    <option value="">Tüm Ülkeler</option>
                    ${countries.map(country => `<option value="${country}" ${this.state.filters.country === country ? 'selected' : ''}>${country}</option>`).join('')}
                </select>
                ` : ''}
                
                <select class="filter-select" id="filterRating" onchange="app.updateFilter('rating', this.value)">
                    <option value="">Tüm Puanlar</option>
                    <option value="9" ${this.state.filters.rating == 9 ? 'selected' : ''}>9+ Puan</option>
                    <option value="8" ${this.state.filters.rating == 8 ? 'selected' : ''}>8+ Puan</option>
                    <option value="7" ${this.state.filters.rating == 7 ? 'selected' : ''}>7+ Puan</option>
                    <option value="6" ${this.state.filters.rating == 6 ? 'selected' : ''}>6+ Puan</option>
                </select>
                
                <select class="filter-select" id="filterDuration" onchange="app.updateFilter('duration', this.value)">
                    <option value="">Tüm Süreler</option>
                    <option value="short" ${this.state.filters.duration === 'short' ? 'selected' : ''}>Kısa (0-60 dk)</option>
                    <option value="medium" ${this.state.filters.duration === 'medium' ? 'selected' : ''}>Orta (60-120 dk)</option>
                    <option value="long" ${this.state.filters.duration === 'long' ? 'selected' : ''}>Uzun (120+ dk)</option>
                </select>
                
                ${this.hasActiveFilters() ? `<button class="btn btn-secondary" onclick="app.clearFilters()">Filtreleri Temizle</button>` : ''}
            </div>
        `;
    }

    updateFilter(type, value) {
        this.state.filters[type] = value || null;
        this.renderPage(this.state.currentPage);
    }

    clearFilters() {
        this.state.filters = {
            year: null,
            duration: null,
            rating: null,
            category: null,
            country: null
        };
        this.renderPage(this.state.currentPage);
    }

    hasActiveFilters() {
        return Object.values(this.state.filters).some(f => f !== null);
    }

    applyFilters(docs) {
        let filtered = [...docs];

        // Yıl filtresi
        if (this.state.filters.year) {
            filtered = filtered.filter(d => d.year == this.state.filters.year);
        }

        // Süre filtresi
        if (this.state.filters.duration) {
            filtered = filtered.filter(d => {
                const runtime = parseInt(d.runtime) || 0;
                if (this.state.filters.duration === 'short') return runtime <= 60;
                if (this.state.filters.duration === 'medium') return runtime > 60 && runtime <= 120;
                if (this.state.filters.duration === 'long') return runtime > 120;
                return true;
            });
        }

        // Rating filtresi
        if (this.state.filters.rating) {
            const minRating = parseFloat(this.state.filters.rating);
            filtered = filtered.filter(d => {
                const rating = parseFloat(d.rating) || 0;
                return rating >= minRating;
            });
        }

        // Kategori filtresi
        if (this.state.filters.category) {
            filtered = filtered.filter(d => {
                return d.tags && d.tags.includes(this.state.filters.category);
            });
        }

        // Ülke filtresi
        if (this.state.filters.country) {
            filtered = filtered.filter(d => {
                return d.countries && d.countries.includes(this.state.filters.country);
            });
        }

        // Sıralama uygula
        return this.applySorting(filtered);
    }

    // ============================================
    // SIRALAMA SİSTEMİ
    // ============================================

    applySorting(docs) {
        const sorted = [...docs];

        switch (this.state.sortBy) {
            case 'rating-high':
                return sorted.sort((a, b) => (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0));

            case 'rating-low':
                return sorted.sort((a, b) => (parseFloat(a.rating) || 0) - (parseFloat(b.rating) || 0));

            case 'alpha-asc':
                return sorted.sort((a, b) => a.title.localeCompare(b.title, 'tr'));

            case 'alpha-desc':
                return sorted.sort((a, b) => b.title.localeCompare(a.title, 'tr'));

            case 'most-watched':
                // İzlenme sayısına göre (watchHistory'den)
                return sorted.sort((a, b) => {
                    const aCount = this.watchHistory.filter(h => h.id === a.id).length;
                    const bCount = this.watchHistory.filter(h => h.id === b.id).length;
                    return bCount - aCount;
                });

            default:
                return sorted.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        }
    }

    updateSort(sortValue) {
        this.state.sortBy = sortValue;
        this.renderPage(this.state.currentPage);
    }

    showLoading() {
        document.getElementById('loadingSpinner').classList.add('active');
    }

    hideLoading() {
        document.getElementById('loadingSpinner').classList.remove('active');
    }

    // Popup engelleyici
    setupPopupBlocker() {
        console.log('🛡️ Popup engelleyici aktif');
        
        // window.open'i engelle
        const originalOpen = window.open;
        window.open = function(...args) {
            console.warn('🚫 Popup engellendi:', args[0]);
            return null;
        };

        // Reklam linklerini engelle (SADECE ana sayfada, iframe içinde değil)
        document.addEventListener('click', (e) => {
            // iframe içindeki tıklamaları kontrol etme
            if (e.target.closest('iframe') || e.target.tagName === 'IFRAME') {
                return; // iframe içindeki tıklamalara izin ver
            }
            
            if (e.target.tagName === 'A' && e.target.target === '_blank') {
                const href = e.target.href || '';
                const adDomains = ['short.icu', 'ads.', 'popup.', 'click.', 'adserver'];
                if (adDomains.some(domain => href.includes(domain))) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.warn('🚫 Reklam linki engellendi:', href);
                }
            }
        }, true);
    }

    // ============================================
    // BELGESEL İNDİR SAYFASI
    // ============================================

    renderDownloadsPage() {
        const content = document.getElementById('contentArea');
        
        const isPremium = window.currentUser && window.currentUser.isPremium;
        
        // downloadLinks kontrolü
        if (!this.data.downloadLinks || !Array.isArray(this.data.downloadLinks)) {
            content.innerHTML = `
                <div class="page-header">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <h1>💾 Belgesel İndir</h1>
                        <button class="btn-icon" onclick="app.navigateTo('tools')" title="Araçlara Dön">
                            <i class="fas fa-arrow-left"></i>
                        </button>
                    </div>
                    <p style="color: #e50914; margin-top: 2rem;">⚠️ İndirme linkleri yüklenemedi. Lütfen SQL dosyasını index.php'ye sürükle-bırak yapın.</p>
                </div>
            `;
            return;
        }
        
        // İndirme linklerini kategorilere ayır
        const seriesLinks = [];
        const singleLinks = [];
        
        this.data.downloadLinks.forEach(link => {
            if (link.title.match(/\(\d+\s*Bölüm/i) || link.title.match(/S\d+/i)) {
                seriesLinks.push(link);
            } else {
                singleLinks.push(link);
            }
        });

        content.innerHTML = `
            <div class="page-header">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                    <h1>💾 Belgesel İndir</h1>
                    <button class="btn-icon" onclick="app.navigateTo('tools')" title="Araçlara Dön">
                        <i class="fas fa-arrow-left"></i>
                    </button>
                </div>
                <p>${this.data.downloadLinks.length} indirme linki</p>
            </div>

            <div class="content-container">
                <!-- Arama ve Filtre -->
                <div style="margin-bottom: 2rem;">
                    <input 
                        type="text" 
                        id="downloadSearch" 
                        class="search-input" 
                        placeholder="🔍 Belgesel ara..." 
                        style="width: 100%; padding: 1rem; border-radius: 10px; border: 2px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05); color: white; font-size: 1rem;"
                        oninput="app.filterDownloads(this.value)"
                        ${!isPremium ? 'disabled' : ''}
                    >
                    
                    <div style="display: flex; gap: 1rem; margin-top: 1rem; flex-wrap: wrap;">
                        <button class="filter-btn active" data-filter="all" onclick="app.setDownloadFilter('all')" ${!isPremium ? 'disabled' : ''}>
                            Tümü (${this.data.downloadLinks.length})
                        </button>
                        <button class="filter-btn" data-filter="series" onclick="app.setDownloadFilter('series')" ${!isPremium ? 'disabled' : ''}>
                            Seri Belgeseller (${seriesLinks.length})
                        </button>
                        <button class="filter-btn" data-filter="single" onclick="app.setDownloadFilter('single')" ${!isPremium ? 'disabled' : ''}>
                            Tek Belgeseller (${singleLinks.length})
                        </button>
                    </div>
                </div>

                <!-- İndirme Tablosu veya Premium Uyarısı -->
                <div id="downloadsTableContainer">
                    ${isPremium ? this.renderDownloadsTable(this.data.downloadLinks) : `
                        <div class="premium-blocked" style="margin: 1rem auto; max-width: 600px;">
                            <i class="fas fa-crown"></i>
                            <h3>🔒 Premium Özellik</h3>
                            <p>Belgesel indirme özelliği sadece Premium üyelere özeldir.</p>
                            <div style="background:rgba(255,152,0,0.08);border:1px solid rgba(255,152,0,0.3);border-radius:10px;padding:10px 16px;margin:14px 0;cursor:pointer;" onclick="DownloadReward.openModal()">
                                <span style="color:#ffb74d;font-size:0.9rem;">⚡ <strong>Ücretsiz Premium Kazan:</strong> Bir içerik indirerek 2 saat ücretsiz premium erişim kazanabilirsin!</span>
                                <span style="display:block;color:#ff9800;font-size:0.8rem;margin-top:3px;">→ İndirerek Kazan butonuna tıkla</span>
                            </div>
                            <p style="font-size: 0.9rem; margin-top: 10px;">
                                Premium üyelik için lütfen giriş yapın veya aşağıdaki iletişim kanallarından birini tercih edin.
                            </p>
                            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:16px;">
                                <button onclick="copyAndOpen('semihsy54@gmail.com','Mail')" style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(229,9,20,0.35);color:#ff8080;padding:6px 13px;border-radius:20px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(229,9,20,0.12)'" onmouseout="this.style.background='transparent'"><i class="fas fa-envelope"></i> Mail</button>
                                <button onclick="copyAndOpen('https://alvo.chat/4CmsT','WhatsApp')" style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(37,211,102,0.3);color:#4cdb7a;padding:6px 13px;border-radius:20px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(37,211,102,0.1)'" onmouseout="this.style.background='transparent'"><i class="fab fa-whatsapp"></i> WhatsApp</button>
                                <button onclick="copyAndOpen('https://x.com/messages/compose?recipient_id=semih_sylemez','Twitter')" style="display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid rgba(29,161,242,0.3);color:#5bb8f5;padding:6px 13px;border-radius:20px;font-size:0.8rem;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.background='rgba(29,161,242,0.1)'" onmouseout="this.style.background='transparent'"><i class="fab fa-x-twitter"></i> Twitter</button>
                            </div>
                        </div>
                    `}
                </div>
            </div>
        `;

        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    switchDsmartTab(tab) {
            const iframe = document.getElementById('toolIframe');
            const tabDsmartgo = document.getElementById('tabDsmartgo');
            const tabExtra = document.getElementById('tabExtra');
            if (!iframe || !tabDsmartgo || !tabExtra) return;

            const activeStyle = 'border-bottom:2px solid #e50914;color:#fff;font-weight:700;';
            const inactiveStyle = 'border-bottom:2px solid transparent;color:#808080;font-weight:600;';

            if (tab === 'dsmartgo') {
                iframe.src = 'https://belgeselsemo.com.tr/php/a.php';
                tabDsmartgo.style.cssText = tabDsmartgo.style.cssText.replace(/border-bottom:[^;]+;|color:[^;]+;|font-weight:[^;]+;/g, '') + activeStyle;
                tabExtra.style.cssText = tabExtra.style.cssText.replace(/border-bottom:[^;]+;|color:[^;]+;|font-weight:[^;]+;/g, '') + inactiveStyle;
            } else {
                iframe.src = 'html-tools/extra-tv-belgeseller.html';
                tabExtra.style.cssText = tabExtra.style.cssText.replace(/border-bottom:[^;]+;|color:[^;]+;|font-weight:[^;]+;/g, '') + activeStyle;
                tabDsmartgo.style.cssText = tabDsmartgo.style.cssText.replace(/border-bottom:[^;]+;|color:[^;]+;|font-weight:[^;]+;/g, '') + inactiveStyle;
            }
        }

    renderDownloadsTable(links) {
        if (links.length === 0) {
            return `
                <div style="text-align: center; padding: 3rem; color: rgba(255,255,255,0.5);">
                    <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                    <p>Sonuç bulunamadı</p>
                </div>
            `;
        }

        return `
            <div class="downloads-table-wrapper">
                <table class="downloads-table">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 1rem;">BELGESEL ADI</th>
                            <th style="width: 120px; text-align: center; padding: 1rem;">BOYUT</th>
                            <th style="width: 100px; text-align: center; padding: 1rem;">İNDİR</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${links.map((link, index) => `
                            <tr class="download-row" data-index="${index}">
                                <td style="padding: 1rem;">
                                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                                        <span style="color: rgba(255,255,255,0.5); font-size: 0.9rem; min-width: 30px;">${index + 1}.</span>
                                        <span>${this.escapeHtml(link.title)}</span>
                                    </div>
                                </td>
                                <td style="text-align: center; padding: 1rem; color: rgba(255,255,255,0.7);">
                                    ${link.size}
                                </td>
                                <td style="text-align: center; padding: 1rem;">
                                    <button 
                                        class="download-btn" 
                                        onclick="app.downloadFile('${link.encoded_url}')"
                                        title="İndir"
                                    >
                                        <i class="fas fa-download"></i>
                                    </button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    setDownloadFilter(filter) {
        // Buton aktif durumunu güncelle
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');

        // Filtreleme
        let filteredLinks = this.data.downloadLinks;
        
        if (filter === 'series') {
            filteredLinks = this.data.downloadLinks.filter(link => 
                link.title.match(/\(\d+\s*Bölüm/i) || link.title.match(/S\d+/i)
            );
        } else if (filter === 'single') {
            filteredLinks = this.data.downloadLinks.filter(link => 
                !link.title.match(/\(\d+\s*Bölüm/i) && !link.title.match(/S\d+/i)
            );
        }

        // Arama kutusundaki değeri de uygula
        const searchValue = document.getElementById('downloadSearch').value;
        if (searchValue) {
            filteredLinks = filteredLinks.filter(link =>
                link.title.toLowerCase().includes(searchValue.toLowerCase())
            );
        }

        // Tabloyu güncelle
        document.getElementById('downloadsTableContainer').innerHTML = 
            this.renderDownloadsTable(filteredLinks);
    }

    filterDownloads(searchTerm) {
        const activeFilter = document.querySelector('.filter-btn.active').dataset.filter;
        
        let filteredLinks = this.data.downloadLinks;

        // Önce kategori filtresi
        if (activeFilter === 'series') {
            filteredLinks = filteredLinks.filter(link => 
                link.title.match(/\(\d+\s*Bölüm/i) || link.title.match(/S\d+/i)
            );
        } else if (activeFilter === 'single') {
            filteredLinks = filteredLinks.filter(link => 
                !link.title.match(/\(\d+\s*Bölüm/i) && !link.title.match(/S\d+/i)
            );
        }

        // Sonra arama
        if (searchTerm) {
            filteredLinks = filteredLinks.filter(link =>
                link.title.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // Tabloyu güncelle
        document.getElementById('downloadsTableContainer').innerHTML = 
            this.renderDownloadsTable(filteredLinks);
    }

    downloadFile(encodedUrl) {
        try {
            // Base64 decode et
            const decoded = atob(encodedUrl);
            // | karakterinden önce URL'yi al
            const url = decoded.split('|')[0];
            
            console.log('İndirme URL\'si:', url);
            
            // Popup modal ile link kopyalama göster
            this.openDownloadModal(url);
        } catch (error) {
            console.error('İndirme hatası:', error);
            if (window.customAlert) {
                window.customAlert('İndirme linki açılamadı!', 'Hata', '❌');
            } else {
                alert('İndirme linki açılamadı!');
            }
        }
    }

    openDownloadModal(url) {
        const modal = document.getElementById('playerModal');
        const playerContainer = document.querySelector('.player-container');
        
        playerContainer.innerHTML = `
            <button class="player-close" onclick="app.closeDownloadModal()">
                <i class="fas fa-times"></i>
            </button>
            <div class="player-wrapper" style="display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 3rem; text-align: center; background: var(--bg-card);">
                <div style="margin-bottom: 2rem;">
                    <i class="fas fa-copy" style="font-size: 5rem; color: var(--accent); animation: pulse 2s infinite;"></i>
                </div>
                <h2 style="font-size: 2rem; margin-bottom: 1rem; color: var(--text-primary);">
                    İndirme Linkini Kopyala
                </h2>
                <p style="font-size: 1.1rem; color: var(--text-secondary); margin-bottom: 2rem; max-width: 500px; line-height: 1.6;">
                    Aşağıdaki butona tıklayarak indirme linkini kopyalayabilir ve tarayıcınızın adres çubuğuna yapıştırarak indirme sayfasına erişebilirsiniz.
                </p>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center;">
                    <button class="btn-primary" id="copyLinkBtn" onclick="app.copyDownloadLink('${url}');" style="padding: 1rem 2rem; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
                        <i class="fas fa-copy"></i>
                        Linki Kopyala
                    </button>
                    <button class="btn-secondary" onclick="app.closeDownloadModal();" style="padding: 1rem 2rem; font-size: 1.1rem;">
                        <i class="fas fa-times"></i>
                        Kapat
                    </button>
                </div>
                <div style="margin-top: 2rem; padding: 1rem; background: rgba(255, 255, 255, 0.05); border-radius: 8px; max-width: 600px; width: 100%;">
                    <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 0.5rem;">
                        <i class="fas fa-link"></i> İndirme Linki:
                    </p>
                    <code id="downloadLinkText" style="font-size: 0.85rem; color: var(--accent); word-break: break-all; display: block; padding: 0.5rem; background: rgba(0, 0, 0, 0.3); border-radius: 4px; cursor: pointer;" onclick="app.copyDownloadLink('${url}');" title="Kopyalamak için tıklayın">
                        ${url}
                    </code>
                </div>
            </div>
        `;
        
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // Close on overlay click
        const overlay = document.getElementById('playerOverlay');
        overlay.onclick = () => this.closeDownloadModal();
    }

    copyDownloadLink(url) {
        // Clipboard API kullanarak kopyala
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                // Başarılı kopyalama bildirimi
                const btn = document.getElementById('copyLinkBtn');
                if (btn) {
                    const originalHTML = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Kopyalandı!';
                    btn.style.background = '#28a745';
                    
                    setTimeout(() => {
                        btn.innerHTML = originalHTML;
                        btn.style.background = '';
                    }, 2000);
                }
            }).catch(err => {
                console.error('Kopyalama hatası:', err);
                this.fallbackCopyToClipboard(url);
            });
        } else {
            // Fallback yöntemi
            this.fallbackCopyToClipboard(url);
        }
    }

    fallbackCopyToClipboard(text) {
        // Eski tarayıcılar için fallback
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                const btn = document.getElementById('copyLinkBtn');
                if (btn) {
                    const originalHTML = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Kopyalandı!';
                    btn.style.background = '#28a745';
                    
                    setTimeout(() => {
                        btn.innerHTML = originalHTML;
                        btn.style.background = '';
                    }, 2000);
                }
            } else {
                if (window.customAlert) {
                    window.customAlert('Link kopyalanamadı. Lütfen manuel olarak kopyalayın.', 'Hata', '❌');
                } else {
                    alert('Link kopyalanamadı. Lütfen manuel olarak kopyalayın.');
                }
            }
        } catch (err) {
            console.error('Fallback kopyalama hatası:', err);
            if (window.customAlert) {
                window.customAlert('Link kopyalanamadı. Lütfen manuel olarak kopyalayın.', 'Hata', '❌');
            } else {
                alert('Link kopyalanamadı. Lütfen manuel olarak kopyalayın.');
            }
        }
        
        document.body.removeChild(textArea);
    }

    closeDownloadModal() {
        const modal = document.getElementById('playerModal');
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// Initialize
let app;

// Global Popup Blocker (Akıllı Mod - Video kontrollerini bozmadan popup engelleme)
(function () {
    console.log('🛡️ Akıllı Popup Engelleyici Başlatılıyor...');
    
    // 1. window.open'i akıllıca engelle
    const originalWindowOpen = window.open;
    let userInteracted = false;
    let lastInteractionTime = 0;
    let clickCount = 0;
    let lastClickTime = 0;
    
    // Kullanıcı etkileşimini izle
    ['click', 'touchstart', 'keydown'].forEach(event => {
        document.addEventListener(event, (e) => {
            userInteracted = true;
            lastInteractionTime = Date.now();
            
            // Click sayacı (hızlı ardışık click'leri tespit et)
            if (event === 'click') {
                const now = Date.now();
                if (now - lastClickTime < 500) {
                    clickCount++;
                } else {
                    clickCount = 1;
                }
                lastClickTime = now;
            }
            
            // 1 saniye sonra sıfırla (video kontrolleri için daha kısa süre)
            setTimeout(() => {
                if (Date.now() - lastInteractionTime >= 1000) {
                    userInteracted = false;
                    clickCount = 0;
                }
            }, 1000);
        }, true);
    });
    
    window.open = function (...args) {
        const url = args[0];
        const timeSinceInteraction = Date.now() - lastInteractionTime;
        
        // Boş popup'ları engelle
        if (!url || url === '' || url === 'about:blank') {
            console.log('🚫 Boş popup engellendi');
            return null;
        }
        
        // İzin verilen domainler (YouTube ve video player domain'leri)
        const allowedDomains = [
            'youtube.com', 
            'youtu.be',
            'squaredfive.com',
            'abysscdn.com',
            'short.icu'
        ];
        const isAllowedDomain = allowedDomains.some(domain => url.includes(domain));
        
        // Video player domain'inden gelen popup'ları kontrol et
        if (isAllowedDomain) {
            // Eğer kullanıcı etkileşimi çok yakın zamanda olduysa (500ms içinde)
            // ve birden fazla click yoksa, bu muhtemelen reklam
            if (timeSinceInteraction < 500 && clickCount === 1) {
                console.log('🚫 Video player reklamı engellendi:', url);
                return null;
            }
            
            // Kullanıcı gerçekten tıkladıysa izin ver
            if (userInteracted && timeSinceInteraction < 1000) {
                console.log('✅ İzin verilen popup:', url);
                return originalWindowOpen.apply(this, args);
            }
        }
        
        // Kullanıcı etkileşimi olmadan açılan popup'ları engelle
        if (!userInteracted || timeSinceInteraction > 1000) {
            console.log('🚫 Otomatik popup engellendi:', url);
            return null;
        }
        
        // Şüpheli URL'leri engelle
        const suspiciousDomains = [
            'ads.', 'ad.', 'adserver', 'doubleclick', 'googlesyndication',
            'popads', 'popcash', 'propeller', 'exoclick', 'adsterra',
            'clickadu', 'hilltopads', 'trafficjunky', 'juicyads'
        ];
        const isSuspicious = suspiciousDomains.some(domain => url.toLowerCase().includes(domain));
        
        if (isSuspicious) {
            console.log('🚫 Reklam popup\'u engellendi:', url);
            return null;
        }
        
        // Diğer popup'ları engelle
        console.log('🚫 Şüpheli popup engellendi:', url);
        return null;
    };
    
    // 2. Tüm linkleri kontrol et (iframe içi hariç)
    document.addEventListener('click', function(e) {
        // iframe içindeki tıklamaları kontrol etme - video kontrollerine izin ver
        let element = e.target;
        while (element) {
            if (element.tagName === 'IFRAME') {
                return; // iframe içindeki tıklamalara izin ver
            }
            element = element.parentElement;
        }
        
        let target = e.target;
        
        // En yakın <a> elementini bul
        while (target && target.tagName !== 'A') {
            target = target.parentElement;
        }
        
        if (target && target.tagName === 'A') {
            const href = target.getAttribute('href');
            const targetAttr = target.getAttribute('target');
            
            // target="_blank" ve şüpheli URL'leri engelle
            if (targetAttr === '_blank' && href) {
                // İzin verilen domainler
                const allowedDomains = ['youtube.com', 'youtu.be'];
                const isAllowed = allowedDomains.some(domain => href.includes(domain));
                
                if (!isAllowed) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('🚫 Şüpheli link engellendi:', href);
                    return false;
                }
            }
        }
    }, true);
    
    // 3. iframe içindeki popup'ları engelle (postMessage ile)
    window.addEventListener('message', function(e) {
        // Şüpheli mesajları engelle
        if (e.data && typeof e.data === 'string') {
            if (e.data.includes('ad') || e.data.includes('popup') || e.data.includes('redirect')) {
                console.log('🚫 Şüpheli iframe mesajı engellendi');
                return false;
            }
        }
    }, true);
    
    // 4. beforeunload - kaldırıldı (indirme sayfalarında native popup çıkıyordu)
    // window.addEventListener('beforeunload', ...) - devre dışı
    
    // 5. Focus değişikliklerini izle (popup açılma girişimi)
    let windowFocused = true;
    let focusChangeCount = 0;
    let lastFocusChange = 0;
    
    window.addEventListener('blur', function() {
        const now = Date.now();
        
        // Hızlı ardışık focus değişiklikleri popup işareti
        if (now - lastFocusChange < 1000) {
            focusChangeCount++;
        } else {
            focusChangeCount = 1;
        }
        lastFocusChange = now;
        
        // Kullanıcı etkileşimi olmadan veya çok hızlı focus değişikliği
        if (!userInteracted || focusChangeCount > 2) {
            console.log('🚫 Şüpheli focus değişikliği algılandı');
            setTimeout(() => {
                if (document.hasFocus && !document.hasFocus()) {
                    window.focus();
                }
            }, 100);
        }
        windowFocused = false;
    });
    
    window.addEventListener('focus', function() {
        windowFocused = true;
        // Focus geri döndüğünde sayacı sıfırla
        setTimeout(() => {
            focusChangeCount = 0;
        }, 2000);
    });
    
    console.log('✅ Akıllı Popup Engelleyici Aktif!');
    console.log('   - window.open akıllıca engelleniyor');
    console.log('   - Video kontrolleri korunuyor');
    console.log('   - Reklam popup\'ları engelleniyor');
    console.log('   - iframe içi etkileşimler serbest');
})();

document.addEventListener('DOMContentLoaded', () => {
    app = new BelgeselSemoFlix();
});

// Global fonksiyonlar
window.checkIframeLoad = function(iframe) {
    // Iframe yüklendiğinde reklam engelleyici kontrolü yap
    setTimeout(() => {
        try {
            // Iframe içeriğine erişmeye çalış
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            if (!iframeDoc || iframeDoc.body.innerHTML.includes('security') || iframeDoc.body.innerHTML.includes('adblock')) {
                // Reklam engelleyici algılandı
                const warning = document.getElementById('adblockWarning');
                if (warning) {
                    warning.style.display = 'block';
                }
            }
        } catch (e) {
            // Cross-origin hatası - normal durum
            console.log('Iframe yüklendi (cross-origin)');
        }
    }, 2000);
};

window.switchPlayer = function(playerIndex, videoUrl) {
    const iframe = document.getElementById('videoIframe');
    if (iframe) {
        iframe.src = videoUrl;
        
        // Buton stillerini güncelle
        document.querySelectorAll('.alt-player-btn').forEach((btn, index) => {
            if (index === playerIndex) {
                btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                btn.classList.add('active');
            } else {
                btn.style.background = 'rgba(255,255,255,0.1)';
                btn.classList.remove('active');
            }
        });
        
        // Uyarıyı gizle
        const warning = document.getElementById('adblockWarning');
        if (warning) {
            warning.style.display = 'none';
        }
        
        console.log(`🔄 Player ${playerIndex + 1} aktif edildi`);
    }
};
