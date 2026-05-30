// ========== Night FM Music Player v3 ==========
// Features: local playback, Netease search, user auth, favorites, categories, admin

const API = '/api';
const FALLBACK_COVER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%2313131f" width="100" height="100"/><text fill="%23888" x="50" y="65" text-anchor="middle" font-size="40">🎵</text></svg>'
);

// ====== Data ======
const localTracks = [
    { title: 'Chill Ambient', artist: 'Night FM', cover: 'covers/chill-ambient.png', src: 'audio/chill-ambient.wav', duration: '1:04' },
    { title: 'Upbeat Energetic', artist: 'Night FM', cover: 'covers/upbeat-energetic.png', src: 'audio/upbeat-energetic.wav', duration: '0:48' },
    { title: 'Lo-fi Beat', artist: 'Night FM', cover: 'covers/lofi-beat.png', src: 'audio/lofi-beat.wav', duration: '0:48' },
    { title: 'Cinematic', artist: 'Night FM', cover: 'covers/cinematic.png', src: 'audio/cinematic.wav', duration: '1:00' },
    { title: 'Synthwave', artist: 'Night FM', cover: 'covers/synthwave.png', src: 'audio/synthwave.wav', duration: '0:50' },
];

const CATEGORIES = ['华语', '欧美', '日语', '韩语', '粤语', '电子', '摇滚', '民谣', 'R&B', '说唱', '轻音乐', '影视原声'];

// ====== Global State ======
let currentUser = null;  // { id, username }
let currentMode = 'local';
let localIndex = 0;
let currentTrack = null;
let isPlaying = false;
let shuffle = false;
let loopMode = 0;
let audio = null;
let searchTimeout = null;
let currentFavId = null;  // current playing song's NCM id for fav check
let lyricData = [];  // [{time: seconds, text: string}]

// ====== DOM Shortcuts ======
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ====== Bottom Player Bar ======
function updateBottomPlayer() {
    if (currentTrack) {
        $('#bottomPlayer').classList.add('visible');
        $('#bpCover').src = safeCover(currentTrack.cover || '');
        $('#bpTitle').textContent = currentTrack.title || '未知';
        $('#bpArtist').textContent = currentTrack.artist || '未知';
        $('#bpPlay').textContent = isPlaying ? '⏸' : '▶';
        $('#bpVolume').value = $('#volumeSlider').value;
    } else {
        $('#bottomPlayer').classList.remove('visible');
    }
}
function syncBpProgress(pct) {
    $('#bpProgressFill').style.width = (pct || 0) + '%';
}

// Bottom player controls
$('#bpPlay').addEventListener('click', togglePlay);
$('#bpPrev').addEventListener('click', () => { if (currentMode === 'local') prevLocalTrack(); else if (audio) audio.currentTime = 0; });
$('#bpNext').addEventListener('click', () => { if (currentMode === 'local') nextLocalTrack(); });
$('#bpVolume').addEventListener('input', () => {
    $('#volumeSlider').value = $('#bpVolume').value;
    if (audio) audio.volume = $('#bpVolume').value / 100;
    $('#volumeIcon').textContent = $('#bpVolume').value == 0 ? '🔇' : $('#bpVolume').value < 30 ? '🔉' : '🔊';
});
$('#bpProgress').addEventListener('click', e => {
    if (!audio || !audio.duration) return;
    const rect = $('#bpProgress').getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});
// Click cover to go to home page
$('#bpCover').addEventListener('click', () => {
    $$('.nav-link')[0].click();
});

// ====== Utilities ======
function formatTime(s) {
    if (isNaN(s) || s < 0 || !isFinite(s)) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
function svgCover() { return FALLBACK_COVER; }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function safeCover(url) { return (url && url.startsWith('http')) ? url : FALLBACK_COVER; }

// ====== Navigation ======
$$('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
        e.preventDefault();
        const page = link.dataset.page;

        // Check auth for favorites & admin
        if ((page === 'favorites' || page === 'admin') && !currentUser) {
            showAuth('登录');
            return;
        }

        // Check admin access
        if (page === 'admin' && currentUser?.username !== 'admin') {
            alert('仅管理员可访问后台');
            return;
        }

        $$('.nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        $$('.page').forEach(p => p.classList.remove('active'));
        $('#page' + page[0].toUpperCase() + page.slice(1)).classList.add('active');

        if (page === 'discover') loadCategories('华语');
        if (page === 'favorites') loadFavorites();
        if (page === 'admin') loadAdmin();
    });
});

// ====== Auth Modal ======
let authMode = 'login';

function showAuth(mode) {
    authMode = mode;
    $('#authTitle').textContent = mode === 'login' ? '登录' : '注册';
    $('#authSubmit').textContent = mode === 'login' ? '登录' : '注册';
    $('#authSwitchText').textContent = mode === 'login' ? '没有账号？' : '已有账号？';
    $('#authSwitch').textContent = mode === 'login' ? '去注册' : '去登录';
    $('#authError').style.display = 'none';
    $('#authUsername').value = '';
    $('#authPassword').value = '';
    $('#authModal').style.display = 'flex';
}

function hideAuth() {
    $('#authModal').style.display = 'none';
}

$('#loginBtn').addEventListener('click', () => showAuth('login'));
$('#logoutBtn').addEventListener('click', () => {
    currentUser = null;
    updateUserUI();
    // Go to home
    $$('.nav-link')[0].click();
    alert('已退出登录');
});
$('#closeAuth').addEventListener('click', hideAuth);
$('#authModal').addEventListener('click', e => { if (e.target === $('#authModal')) hideAuth(); });
$('#authSwitch').addEventListener('click', e => { e.preventDefault(); showAuth(authMode === 'login' ? 'register' : 'login'); });

$('#authSubmit').addEventListener('click', async () => {
    const username = $('#authUsername').value.trim();
    const password = $('#authPassword').value;
    const errEl = $('#authError');

    if (!username || !password) {
        errEl.textContent = '请填写用户名和密码';
        errEl.style.display = 'block';
        return;
    }

    const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
    try {
        const res = await fetch(API + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await res.json();

        if (data.success) {
            currentUser = data.user;
            updateUserUI();
            hideAuth();
            // Show admin link if admin
            if (currentUser.username === 'admin') $('#adminLink').style.display = '';
        } else {
            errEl.textContent = data.message || '操作失败';
            errEl.style.display = 'block';
        }
    } catch (e) {
        errEl.textContent = '网络错误，请确认服务器已启动';
        errEl.style.display = 'block';
    }
});

$('#authPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('#authSubmit').click();
});

function updateUserUI() {
    if (currentUser) {
        $('#userInfo').style.display = 'flex';
        $('#loginBtn').style.display = 'none';
        $('#userName').textContent = currentUser.username;
        if (currentUser.username === 'admin') $('#adminLink').style.display = '';
        else $('#adminLink').style.display = 'none';
    } else {
        $('#userInfo').style.display = 'none';
        $('#loginBtn').style.display = '';
        $('#adminLink').style.display = 'none';
    }
    updateFavBtn();
}

// ====== Music Player Core ======
function loadTrack(track) {
    currentTrack = track;
    if (audio) {
        audio.pause();
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('ended', onEnded);
    }
    audio = new Audio(track.src);
    audio.volume = $('#volumeSlider').value / 100;
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('ended', onEnded);

    $('#coverImg').src = safeCover(track.cover || '');
    $('#trackTitle').textContent = track.title || '未知';
    $('#trackArtist').textContent = track.artist || '未知';
    document.title = (track.title || 'Night FM') + ' - Night FM';
    $('#progressFill').style.width = '0%';
    $('#progressThumb').style.left = '0%';
    $('#currentTime').textContent = '0:00';
    $('#totalTime').textContent = track.duration || '--:--';
    $('#lyricPanel').innerHTML = '<p class="lyric-line">🎵 加载中...</p>';
    lyricData = [];
    currentFavId = track.ncmId || null;
    updateFavBtn();

    if (currentMode === 'local') {
        $$('.playlist-item[data-type="local"]').forEach((el, i) => el.classList.toggle('active', i === localIndex));
    }
    if (track.ncmId) fetchLyrics(track.ncmId);
    updateBottomPlayer();
    if (isPlaying) audio.play().catch(() => {});
}

function togglePlay() {
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play().catch(() => {});
}

function updatePlayState() {
    isPlaying = audio && !audio.paused && !audio.ended;
    $('#playBtn').textContent = isPlaying ? '⏸' : '▶';
    $('#coverWrapper').classList.toggle('playing', isPlaying);
    $('#equalizer').classList.toggle('active', isPlaying);
    if (currentTrack) {
        $('#bpPlay').textContent = isPlaying ? '⏸' : '▶';
        $('#bottomPlayer').classList.add('visible');
    }
}

async function updateFavBtn() {
    if (!currentUser || !currentFavId) {
        $('#favBtn').textContent = '♡';
        $('#favBtn').classList.remove('active');
        return;
    }
    try {
        const res = await fetch(`${API}/favorites/check/${currentFavId}?userId=${currentUser.id}`);
        const data = await res.json();
        $('#favBtn').textContent = data.isFav ? '❤️' : '♡';
        if (data.isFav) $('#favBtn').classList.add('active');
        else $('#favBtn').classList.remove('active');
    } catch (e) { /* ignore */ }
}

$('#favBtn').addEventListener('click', async () => {
    if (!currentUser) { showAuth('登录'); return; }
    if (!currentFavId || !currentTrack) return;

    const isFav = $('#favBtn').textContent === '❤️';
    try {
        if (isFav) {
            await fetch(`${API}/favorites/song/${currentFavId}?userId=${currentUser.id}`, { method: 'DELETE' });
        } else {
            await fetch(`${API}/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: currentUser.id,
                    song: {
                        id: currentFavId,
                        name: currentTrack.title,
                        artist: currentTrack.artist,
                        cover: currentTrack.cover,
                        duration: currentTrack.duration,
                    }
                }),
            });
        }
        updateFavBtn();
    } catch (e) { /* ignore */ }
});

function nextLocalTrack() {
    let next = shuffle ? Math.floor(Math.random() * localTracks.length) : (localIndex + 1) % localTracks.length;
    if (shuffle && localTracks.length > 1 && next === localIndex) next = (next + 1) % localTracks.length;
    localIndex = next;
    loadTrack(localTracks[next]);
    if (isPlaying && audio) audio.play().catch(() => {});
}

function prevLocalTrack() {
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
    let prev = shuffle ? Math.floor(Math.random() * localTracks.length) : (localIndex - 1 + localTracks.length) % localTracks.length;
    if (shuffle && localTracks.length > 1 && prev === localIndex) prev = (prev + 1) % localTracks.length;
    localIndex = prev;
    loadTrack(localTracks[prev]);
    if (isPlaying && audio) audio.play().catch(() => {});
}

function onTimeUpdate() {
    if (!audio) return;
    const pct = (audio.currentTime / audio.duration) * 100 || 0;
    $('#progressFill').style.width = pct + '%';
    $('#progressThumb').style.left = pct + '%';
    $('#currentTime').textContent = formatTime(audio.currentTime);
    syncBpProgress(pct);

    // Highlight current lyric line
    if (lyricData.length > 0) {
        let activeIdx = -1;
        for (let i = 0; i < lyricData.length; i++) {
            if (audio.currentTime >= lyricData[i].time) {
                activeIdx = i;
            } else {
                break;
            }
        }
        // Update highlights
        const lines = $('#lyricPanel').querySelectorAll('.lyric-line');
        lines.forEach((line, i) => {
            if (i === activeIdx) {
                line.classList.add('active');
                // Smooth scroll to active line
                line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                line.classList.remove('active');
            }
        });
    }
}
function onLoaded() { if (audio) $('#totalTime').textContent = formatTime(audio.duration); }
function onEnded() {
    if (loopMode === 2) { audio.currentTime = 0; audio.play().catch(() => {}); }
    else if (currentMode === 'local') { if (loopMode === 1 || localIndex < localTracks.length - 1) nextLocalTrack(); else updatePlayState(); }
    else { if (loopMode >= 1) { audio.currentTime = 0; audio.play().catch(() => {}); } else updatePlayState(); }
}

function toggleShuffle() { shuffle = !shuffle; $('#shuffleBtn').classList.toggle('active', shuffle); }
function toggleLoop() {
    loopMode = (loopMode + 1) % 3;
    const el = $('#loopBtn');
    el.classList.remove('active');
    if (loopMode === 0) el.textContent = '🔁';
    else if (loopMode === 1) { el.textContent = '🔁'; el.classList.add('active'); }
    else { el.textContent = '🔂'; el.classList.add('active'); }
}

// ====== Player Tab Switching ======
$$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.ptab;
        $$('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        if (target === 'local') {
            currentMode = 'local';
            $('#tabLocal').style.display = '';
            $('#tabOnline').style.display = 'none';
            $('#searchBar').style.display = 'none';
        } else {
            currentMode = 'online';
            $('#tabLocal').style.display = 'none';
            $('#tabOnline').style.display = '';
            $('#searchBar').style.display = 'flex';
            $('#searchInput').focus();
        }
    });
});

// ====== Search ======
async function searchNCM(keywords) {
    $('#searchLoading').style.display = 'block';
    $('#searchEmpty').style.display = 'none';
    $('#searchResults').innerHTML = '';

    try {
        const res = await fetch(`${API}/search?keywords=${encodeURIComponent(keywords)}&limit=15`);
        const data = await res.json();
        $('#searchLoading').style.display = 'none';

        if (data.code !== 200 || !data.result?.songs?.length) {
            $('#searchEmpty').innerHTML = '没找到结果 😢<br><small>换个关键词试试</small>';
            $('#searchEmpty').style.display = 'block';
            return;
        }

        $('#searchResults').innerHTML = data.result.songs.filter(s => s && s.id).map(song => {
            const name = song.name || '未知';
            const artists = (song.ar && song.ar.length) ? song.ar.map(a => a.name || '?').join('/') : '未知';
            const album = song.al?.name || '';
            const coverURL = song.al?.picUrl || '';
            const dur = song.dt ? formatTime(song.dt / 1000) : '--:--';
            const fee = song.fee ?? 1;
            const badge = (fee === 0 || fee === 8) ? '<span class="item-badge free">免费</span>' : '<span class="item-badge">VIP</span>';
            return `<li class="result-item" data-ncm-id="${song.id}" data-free="${fee === 0 || fee === 8}"
                data-cover="${esc(coverURL)}" data-title="${esc(name)}" data-artist="${esc(artists)}" data-duration="${dur}">
                <img src="${coverURL || svgCover()}" loading="lazy" onerror="this.src='${svgCover()}'">
                <div class="item-info"><span class="item-title">${name}</span><span class="item-artist">${artists}${album ? ' · ' + album : ''}</span></div>
                ${badge}<span class="item-duration">${dur}</span></li>`;
        }).join('');
    } catch (e) {
        $('#searchLoading').style.display = 'none';
        $('#searchEmpty').innerHTML = '搜索失败 😢<br><small>请确认 API 服务是否启动</small>';
        $('#searchEmpty').style.display = 'block';
    }
}

$('#searchInput').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const kw = $('#searchInput').value.trim();
    if (!kw) { $('#searchResults').innerHTML = ''; $('#searchEmpty').style.display = 'block'; return; }
    searchTimeout = setTimeout(() => searchNCM(kw), 400);
});
$('#searchBtn').addEventListener('click', () => { const kw = $('#searchInput').value.trim(); if (kw) searchNCM(kw); });
$('#searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') { const kw = $('#searchInput').value.trim(); if (kw) searchNCM(kw); } });

$('#searchResults').addEventListener('click', async e => {
    const item = e.target.closest('.result-item');
    if (!item) return;
    await playNCMItem(item);
});

async function playNCMItem(item) {
    const ncmId = item.dataset.ncmId;
    const cover = item.dataset.cover || '';
    const title = item.dataset.title || '未知';
    const artist = item.dataset.artist || '未知';
    const duration = item.dataset.duration || '--:--';

    $('#trackTitle').textContent = title;
    $('#trackArtist').textContent = artist;
    $('#coverImg').src = safeCover(cover);
    $('#totalTime').textContent = duration;
    $('#lyricPanel').innerHTML = '<p class="lyric-line">🎵 正在获取播放链接...</p>';

    try {
        const res = await fetch(`${API}/song/url?id=${ncmId}&level=standard`);
        const data = await res.json();
        if (data.code !== 200 || !data.data?.[0]?.url) {
            $('#lyricPanel').innerHTML = '<p class="lyric-line">⚠️ 这首歌可能需要 VIP 或暂无资源</p>';
            return;
        }
        const track = { title, artist, cover: safeCover(cover), src: data.data[0].url, duration, ncmId: parseInt(ncmId) };
        currentMode = 'online';
        $$('.result-item, .song-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        isPlaying = true;
        loadTrack(track);
    } catch (e) {
        $('#lyricPanel').innerHTML = '<p class="lyric-line">⚠️ 获取播放链接失败</p>';
    }
}

function parseLRC(lrcText) {
    // Parse LRC format: [mm:ss.xx]lyric text
    const lines = lrcText.split('\n');
    const result = [];
    for (const line of lines) {
        const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const ms = parseInt(match[3].padEnd(3, '0'));
            const time = minutes * 60 + seconds + ms / 1000;
            const text = match[4].trim();
            if (text && !text.includes('纯音乐')) {
                result.push({ time, text });
            }
        }
    }
    return result;
}

async function fetchLyrics(ncmId) {
    lyricData = [];
    try {
        const res = await fetch(`${API}/lyric?id=${ncmId}`);
        const data = await res.json();
        if (data.code === 200 && data.lrc?.lyric) {
            lyricData = parseLRC(data.lrc.lyric);
            if (lyricData.length > 0) {
                $('#lyricPanel').innerHTML = lyricData.map(l =>
                    `<p class="lyric-line" data-time="${l.time}">${l.text}</p>`
                ).join('');
            } else {
                $('#lyricPanel').innerHTML = '<p class="lyric-line">🎵 纯音乐 — 享受旋律吧</p>';
            }
        } else {
            $('#lyricPanel').innerHTML = '<p class="lyric-line">🎵 暂无歌词</p>';
        }
    } catch (e) {
        $('#lyricPanel').innerHTML = '<p class="lyric-line">🎵 —</p>';
    }
}

// Local playlist click
$('#localPlaylist').addEventListener('click', e => {
    const item = e.target.closest('.playlist-item');
    if (!item) return;
    const index = +item.dataset.index;
    if (currentMode === 'local' && index === localIndex) { togglePlay(); return; }
    currentMode = 'local'; isPlaying = true; localIndex = index;
    loadTrack(localTracks[index]);
});

// ====== Discovery Page ======
async function loadCategories(cat) {
    $$('.cat-tag').forEach(t => t.classList.remove('active'));
    const activeTag = document.querySelector(`.cat-tag[data-cat="${cat}"]`);
    if (activeTag) activeTag.classList.add('active');

    $('#discoverLoading').style.display = 'block';
    $('#playlistGrid').style.display = '';
    $('#catTags').style.display = '';
    $('#playlistGrid').innerHTML = '';
    $('#playlistDetail').style.display = 'none';

    try {
        const res = await fetch(`${API}/top/playlist?cat=${encodeURIComponent(cat)}&limit=20`);
        const data = await res.json();
        $('#discoverLoading').style.display = 'none';

        if (data.code !== 200 || !data.playlists?.length) {
            $('#playlistGrid').innerHTML = '<p style="color:#888;text-align:center;grid-column:1/-1">暂无歌单</p>';
            return;
        }

        $('#playlistGrid').innerHTML = data.playlists.map(pl => `
            <div class="playlist-card" data-pl-id="${pl.id}" data-pl-name="${esc(pl.name)}" data-pl-cover="${pl.coverImgUrl || ''}">
                <img src="${pl.coverImgUrl || svgCover()}" loading="lazy" onerror="this.src='${svgCover()}'">
                <div class="card-name">${pl.name}</div>
                <div class="card-count">${pl.trackCount || 0} 首</div>
            </div>
        `).join('');
    } catch (e) {
        $('#discoverLoading').style.display = 'none';
        $('#playlistGrid').innerHTML = '<p style="color:#888;text-align:center;grid-column:1/-1">加载失败</p>';
    }
}

// Category tags
function renderCatTags() {
    $('#catTags').innerHTML = CATEGORIES.map(cat =>
        `<button class="cat-tag${cat === '华语' ? ' active' : ''}" data-cat="${cat}">${cat}</button>`
    ).join('');
}
renderCatTags();

$('#catTags').addEventListener('click', e => {
    const tag = e.target.closest('.cat-tag');
    if (!tag) return;
    loadCategories(tag.dataset.cat);
});

// Playlist card click → show songs
$('#playlistGrid').addEventListener('click', async e => {
    const card = e.target.closest('.playlist-card');
    if (!card) return;
    const plId = card.dataset.plId;
    const plName = card.dataset.plName;
    const plCover = card.dataset.plCover;

    $('#discoverLoading').style.display = 'block';
    try {
        const res = await fetch(`${API}/playlist/detail?id=${plId}`);
        const data = await res.json();
        $('#discoverLoading').style.display = 'none';

        if (data.code !== 200 || !data.playlist?.tracks?.length) {
            alert('无法加载歌单');
            return;
        }

        const pl = data.playlist;
        $('#playlistDetailHeader').innerHTML = `
            <img src="${plCover || svgCover()}" onerror="this.src='${svgCover()}'">
            <div class="detail-info"><h3>${plName}</h3><p>${pl.trackCount || 0} 首 · ${pl.creator?.nickname || ''}</p></div>
        `;
        $('#playlistSongs').innerHTML = pl.tracks.filter(t => t && t.id).map((t, i) => {
            const name = t.name || '未知';
            const artists = (t.ar && t.ar.length) ? t.ar.map(a => a.name || '?').join('/') : '未知';
            const album = t.al?.name || '';
            const cover = t.al?.picUrl || '';
            const dur = t.dt ? formatTime(t.dt / 1000) : '--:--';
            return `<li class="song-item" data-ncm-id="${t.id}" data-free="true"
                data-cover="${esc(cover)}" data-title="${esc(name)}" data-artist="${esc(artists)}" data-duration="${dur}">
                <span class="song-index">${i + 1}</span>
                <img src="${cover || svgCover()}" width="36" height="36" style="border-radius:4px;object-fit:cover" onerror="this.src='${svgCover()}'">
                <div class="item-info"><span class="item-title">${name}</span><span class="item-artist">${artists}${album ? ' · ' + album : ''}</span></div>
                <span class="fav-star" data-ncm-id="${t.id}" data-name="${esc(name)}" data-artist="${esc(artists)}" data-cover="${esc(cover)}" data-dur="${dur}" title="收藏">♡</span>
                <span class="item-duration">${dur}</span>
            </li>`;
        }).join('');

        $('#playlistGrid').style.display = 'none';
        $('#catTags').style.display = 'none';
        $('#playlistDetail').style.display = 'block';
    } catch (e) {
        $('#discoverLoading').style.display = 'none';
    }
});

$('#backToDiscover').addEventListener('click', () => {
    $('#playlistDetail').style.display = 'none';
    $('#playlistGrid').style.display = '';
    $('#catTags').style.display = '';
});

// Playlist song click → play
$('#playlistSongs').addEventListener('click', async e => {
    const favStar = e.target.closest('.fav-star');
    if (favStar) {
        e.stopPropagation();
        if (!currentUser) { showAuth('登录'); return; }
        const song = { id: +favStar.dataset.ncmId, name: favStar.dataset.name, artist: favStar.dataset.artist, cover: favStar.dataset.cover, duration: favStar.dataset.dur };
        try {
            const res = await fetch(`${API}/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: currentUser.id, song }),
            });
            const data = await res.json();
            favStar.textContent = data.success ? '❤️' : '♡';
        } catch (err) { /* ignore */ }
        return;
    }

    const item = e.target.closest('.song-item');
    if (!item) return;
    await playNCMItem(item);
});

// ====== Favorites Page ======
async function loadFavorites() {
    if (!currentUser) return;
    $('#favLoading').style.display = 'block';
    $('#favList').innerHTML = '';
    $('#favEmpty').style.display = 'none';

    try {
        const res = await fetch(`${API}/favorites?userId=${currentUser.id}`);
        const data = await res.json();
        $('#favLoading').style.display = 'none';

        if (!data.data?.length) {
            $('#favEmpty').style.display = 'block';
            return;
        }

        $('#favList').innerHTML = data.data.map(f => `
            <li class="song-item" data-ncm-id="${f.song_id}" data-free="true"
                data-cover="${esc(f.cover_url)}" data-title="${esc(f.song_name)}"
                data-artist="${esc(f.artist)}" data-duration="${f.duration || '--:--'}">
                <span class="song-index">❤️</span>
                <img src="${f.cover_url || svgCover()}" width="36" height="36" style="border-radius:4px;object-fit:cover" onerror="this.src='${svgCover()}'">
                <div class="item-info"><span class="item-title">${f.song_name}</span><span class="item-artist">${f.artist}${f.album ? ' · ' + f.album : ''}</span></div>
                <button class="btn-small remove-fav" data-fav-id="${f.id}">删除</button>
                <span class="item-duration">${f.duration || '--:--'}</span>
            </li>
        `).join('');
    } catch (e) {
        $('#favLoading').style.display = 'none';
        $('#favEmpty').innerHTML = '加载失败<br><small>请确认 API 服务是否启动</small>';
        $('#favEmpty').style.display = 'block';
    }
}

$('#favList').addEventListener('click', async e => {
    const removeBtn = e.target.closest('.remove-fav');
    if (removeBtn) {
        const favId = removeBtn.dataset.favId;
        await fetch(`${API}/favorites/${favId}?userId=${currentUser.id}`, { method: 'DELETE' });
        loadFavorites();
        return;
    }
    const item = e.target.closest('.song-item');
    if (!item) return;
    await playNCMItem(item);
});

// ====== Admin Page ======
async function loadAdmin() {
    if (!currentUser || currentUser.username !== 'admin') return;
    try {
        const res = await fetch(`${API}/admin/users`);
        const data = await res.json();
        if (!data.success) return;

        $('#statsCards').innerHTML = `
            <div class="stat-card"><div class="stat-num">${data.stats.userCount}</div><div class="stat-label">注册用户</div></div>
            <div class="stat-card"><div class="stat-num">${data.stats.favCount}</div><div class="stat-label">收藏总数</div></div>
        `;
        $('#userTableBody').innerHTML = data.users.map(u => `
            <tr><td>${u.id}</td><td>${u.username}</td><td>${u.created_at || '—'}</td><td>${u.fav_count}</td></tr>
        `).join('');
    } catch (e) { /* ignore */ }
}

// ====== Progress & Volume & Controls ======
$('#progressBar').addEventListener('click', e => {
    if (!audio || !audio.duration) return;
    const rect = $('#progressBar').getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});

$('#volumeSlider').addEventListener('input', () => {
    if (audio) audio.volume = $('#volumeSlider').value / 100;
    $('#volumeIcon').textContent = $('#volumeSlider').value == 0 ? '🔇' : $('#volumeSlider').value < 30 ? '🔉' : '🔊';
});
$('#volumeIcon').addEventListener('click', () => {
    if ($('#volumeSlider').value > 0) { $('#volumeSlider').dataset.prev = $('#volumeSlider').value; $('#volumeSlider').value = 0; }
    else { $('#volumeSlider').value = $('#volumeSlider').dataset.prev || 50; }
    $('#volumeSlider').dispatchEvent(new Event('input'));
});

$('#playBtn').addEventListener('click', togglePlay);
$('#prevBtn').addEventListener('click', () => { if (currentMode === 'local') prevLocalTrack(); else if (audio) audio.currentTime = 0; });
$('#nextBtn').addEventListener('click', () => { if (currentMode === 'local') nextLocalTrack(); });
$('#shuffleBtn').addEventListener('click', toggleShuffle);
$('#loopBtn').addEventListener('click', toggleLoop);

// Keyboard shortcuts
document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.code) {
        case 'Space': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); if (currentMode === 'local') prevLocalTrack(); else if (audio) audio.currentTime = Math.max(0, audio.currentTime - 5); break;
        case 'ArrowRight': e.preventDefault(); if (currentMode === 'local') nextLocalTrack(); else if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); break;
        case 'ArrowUp': e.preventDefault(); $('#volumeSlider').value = Math.min(100, +$('#volumeSlider').value + 5); $('#volumeSlider').dispatchEvent(new Event('input')); break;
        case 'ArrowDown': e.preventDefault(); $('#volumeSlider').value = Math.max(0, +$('#volumeSlider').value - 5); $('#volumeSlider').dispatchEvent(new Event('input')); break;
        case 'KeyS': toggleShuffle(); break;
        case 'KeyL': toggleLoop(); break;
    }
});

// ====== Background Particles ======
function createParticles() {
    const c = $('#particles');
    for (let i = 0; i < 25; i++) {
        const p = document.createElement('div');
        p.className = 'particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.width = p.style.height = (Math.random() * 4 + 1) + 'px';
        p.style.animationDuration = (Math.random() * 10 + 8) + 's';
        p.style.animationDelay = (Math.random() * 10) + 's';
        p.style.background = Math.random() > 0.5 ? 'var(--primary-glow)' : 'var(--accent)';
        c.appendChild(p);
    }
}

// ====== Init ======
function init() {
    createParticles();
    currentTrack = localTracks[0];
    loadTrack(currentTrack);
    updateUserUI();
    audio.play().then(() => updatePlayState()).catch(() => updatePlayState());
    updateBottomPlayer();
}

// Audio state tracking
const origPlay = Audio.prototype.play;
Audio.prototype.play = function () {
    const r = origPlay.apply(this, arguments);
    if (r && r.then) { r.then(() => { isPlaying = true; updatePlayState(); }).catch(() => { isPlaying = false; updatePlayState(); }); }
    return r;
};
const origPause = Audio.prototype.pause;
Audio.prototype.pause = function () { origPause.apply(this, arguments); isPlaying = false; updatePlayState(); };

init();
