'use strict';

const $ = selector => document.querySelector(selector);
const el = id => document.getElementById(id);
const video = el('video');
const shell = el('videoShell');
const clockFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const state = {
  channels: [], guide: {}, epgStatus: 'loading',
  activeId: null, focusedId: null, group: 'Все каналы',
  navigationZone: 'channels', focusedGroup: 'Все каналы', focusedProgramIndex: 0, popupOpen: false,
  menuOpen: false, settingsOpen: false, fontPx: 12,
  favorites: new Set(),
  guideOpen: false, hls: null, hlsErrorCount: 0, playing: false,
  failed: false, retryTimer: null, startupTimer: null, session: 0,
  playerMode: '—', videoCodec: 'Не определён', audioCodec: 'Не определён',
  lastError: null, initialAutoplay: false, epgDetails: { status: 'Ожидание', error: '', source: '—', updatedAt: 0, lastAttemptAt: 0, matched: 0, programmes: 0, seenChannelIds: 0, earliest: null, latest: null, progress: '' }
};

function loadStorageJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch (_) { return fallback; }
}
state.favorites = new Set(loadStorageJSON('aqua:favorites', []));
const SETTINGS_ITEM = '__settings__';
// Pixel size is user-controlled. Migrate the former five presets if present.
const OLD_FONT_PX = {small:10, medium:11, normal:12, large:14, huge:16};
try {
  const raw = localStorage.getItem('aqua:fontPx');
  const old = localStorage.getItem('aqua:fontSize');
  const value = raw !== null ? Number(raw) : (OLD_FONT_PX[old] || 12);
  state.fontPx = Number.isFinite(value) ? Math.max(8, Math.min(40, Math.round(value))) : 12;
} catch (_) { state.fontPx = 12; }
function applyFontSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  const px = Math.max(8, Math.min(40, Math.round(numeric)));
  state.fontPx = px;
  document.documentElement.style.setProperty('--font-px', `${px}px`);
  document.documentElement.style.setProperty('--font-scale', String(px / 12));
  if (el('fontSizePx')) el('fontSizePx').value = String(px);
  try { localStorage.setItem('aqua:fontPx', String(px)); } catch (_) {}
  if (state.channels.length) {
    renderChannels();
    requestAnimationFrame(refreshChannelLayout);
  }
}
function openFontSettings() {
  closeProgramPopup();
  state.settingsOpen = true;
  el('fontSettings').hidden = false;
  el('fontSizePx').value = String(state.fontPx);
  el('fontSizePx').focus({preventScroll:true});
  el('fontSizePx').select();
}
function closeFontSettings() {
  state.settingsOpen = false;
  el('fontSettings').hidden = true;
  if (state.menuOpen) focusCategory(SETTINGS_ITEM);
}
function chooseFontSize(value) {
  if (!Number.isFinite(Number(value)) || Number(value) < 8 || Number(value) > 40) {
    toast('Введите размер шрифта от 8 до 40 пикселей.');
    return;
  }
  applyFontSize(value);
  closeFontSettings();
  toast(`Размер шрифта: ${state.fontPx} px`);
}
function openCategoryMenu() {
  if (state.menuOpen || !state.guideOpen) return;
  closeProgramPopup();
  state.menuOpen = true;
  state.navigationZone = 'categories';
  el('guideLayout').classList.add('menu-open');
  el('categoriesPanel').inert = false;
  el('categoriesPanel').setAttribute('aria-hidden','false');
  el('categoryList').querySelectorAll('.category-button').forEach(b=> b.tabIndex = -1);
  focusCategory(categories().includes(state.focusedGroup) ? state.focusedGroup : state.group);
  syncChannelFocus();
  refreshMarquee();
}
function closeCategoryMenu(restoreFocus = true) {
  if (!state.menuOpen) return;
  state.menuOpen = false;
  state.navigationZone = 'channels';
  el('guideLayout').classList.remove('menu-open');
  el('categoriesPanel').inert = true;
  el('categoriesPanel').setAttribute('aria-hidden','true');
  el('categoryList').querySelectorAll('.category-button').forEach(b=>b.tabIndex=-1);
  el('openSettings').tabIndex=-1;
  syncChannelFocus();
  if (restoreFocus) {
    const list = visibleChannels();
    const wanted = list.some(c=>c.id === state.focusedId) ? state.focusedId : list[0]?.id;
    if (wanted) focusChannel(wanted);
    else el('channelList').focus({preventScroll:true});
  }
}


function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
function safeUrl(value) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) ? escapeHtml(u.href) : '';
  } catch (_) { return ''; }
}
function logoMarkup(channel, className = 'row-logo') {
  const logo = safeUrl(channel?.logo);
  const fallback = escapeHtml((channel?.name || 'TV').trim().slice(0, 2).toUpperCase());
  if (!logo) return `<span class="${className}"><span class="row-logo-fallback">${fallback}</span></span>`;
  // The fallback must not be painted behind transparent channel artwork.
  // Display it only if the actual image fails to load.
  return `<span class="${className}"><img loading="lazy" src="${logo}" alt="" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="row-logo-fallback" hidden>${fallback}</span></span>`;
}
function activeChannel() { return state.channels.find(c => c.id === state.activeId) || null; }
// The guide follows the channel under the pointer/keyboard cursor, not the
// stream playing in the video element. Never call playChannel from a focus move.
function guideChannel() {
  return (state.guideOpen && state.channels.find(c => c.id === state.focusedId)) || activeChannel();
}
function getPrograms(channel) { return (channel && state.guide[channel.tvgId?.toLowerCase().trim()]) || []; }
function currentProgram(channel, at = Date.now()) { return getPrograms(channel).find(p => p.start <= at && p.stop > at) || null; }
function nextProgram(channel, at = Date.now()) { return getPrograms(channel).find(p => p.start > at) || null; }
function fmt(time) { return Number.isFinite(time) ? clockFormat.format(new Date(time)) : '—'; }
function progress(p, now = Date.now()) {
  return p ? progressBetween(p.start, p.stop, now) : 0;
}
function progressBetween(start, stop, now = Date.now()) {
  return Math.max(0, Math.min(100, (now - start) / Math.max(1, stop - start) * 100));
}
// Bars update once a second without recreating the channel list or player.
let selectedBoundaryAt = Infinity;
let listBoundaryAt = Infinity;
function upcomingBoundary(now, ...programs) {
  return programs.reduce((min, p) => {
    if (!p) return min;
    if (p.start > now) min = Math.min(min, p.start);
    if (p.stop > now) min = Math.min(min, p.stop);
    return min;
  }, Infinity);
}
function setProgressBar(node, program, now = Date.now()) {
  node.dataset.epgStart = program ? String(program.start) : '';
  node.dataset.epgStop = program ? String(program.stop) : '';
  node.style.width = progress(program, now) + '%';
}
function tickLiveEPG() {
  if (!state.channels.length || document.hidden) return;
  const now = Date.now();
  // EPG titles/times switch automatically at the exact programme boundary.
  if (now >= selectedBoundaryAt || (state.guideOpen && now >= listBoundaryAt)) {
    renderNow();
    if (state.guideOpen) { renderChannels(); renderSchedule(); updateProgramFocus(); if (state.popupOpen) closeProgramPopup(); }
  }
  document.querySelectorAll('.epg-progress').forEach(bar => {
    const { epgStart, epgStop } = bar.dataset;
    if (epgStart && epgStop) {
      bar.style.width = progressBetween(Number(epgStart), Number(epgStop), now) + '%';
    } else if (bar.style.width !== '0%') {
      bar.style.width = '0%';
    }
  });
  if (state.guideOpen) el('currentLeft').textContent = minsLeft(currentProgram(guideChannel(), now), now);
  else el('infoBarRemaining').textContent = minsLeft(currentProgram(activeChannel(), now), now);
}
function minsLeft(p, at = Date.now()) {
  if (!p) return 'Нет данных';
  const remaining = Math.max(0, Math.ceil((p.stop - at) / 60_000));
  if (remaining < 60) return `${remaining} мин до конца`;
  const hours = Math.floor(remaining / 60);
  const minutes = remaining % 60;
  return `${hours} ч${minutes ? ` ${minutes} мин` : ''} до конца`;
}
function timeRange(p) { return p ? `${fmt(p.start)} – ${fmt(p.stop)}` : '—'; }
let toastTimer;
function toast(message) {
  el('toast').textContent = message;
  el('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el('toast').classList.remove('visible'), 4700);
}
// TV infobar: appear instantly, stay for five seconds after a channel or
// programme change, then disappear instantly. No fades or sliding effects.
const INFOBAR_VISIBLE_MS = 5000;
let infoBarHideTimer = null;
let lastPlayingProgrammeKey = null;
function hideInfoBar() {
  clearTimeout(infoBarHideTimer);
  infoBarHideTimer = null;
  el('fullscreenInfoBar').classList.remove('is-visible');
}
function revealInfoBar() {
  if (state.guideOpen) return;
  clearTimeout(infoBarHideTimer);
  const bar = el('fullscreenInfoBar');
  bar.classList.add('is-visible');
  infoBarHideTimer = setTimeout(() => {
    bar.classList.remove('is-visible');
    infoBarHideTimer = null;
  }, INFOBAR_VISIBLE_MS);
}
function updateVideoQuality() {
  const width = video.videoWidth || 0;
  const height = video.videoHeight || 0;
  el('infoBarResolution').textContent = width && height ? `${width} × ${height}` : '—';
  const bigger = Math.max(width, height);
  const smaller = Math.min(width, height);
  el('infoBarQuality').textContent = !bigger ? '—'
    : smaller >= 2160 ? 'UHD'
    : smaller >= 720 ? 'HD' : 'SD';
}
function clockTick() {
  const time = fmt(Date.now());
  el('guideClock').textContent = time;
}
function playStatus(message, problem = false) {
  el('placeholderMessage').textContent = message;
  if (problem) { el('playerPlaceholder').hidden = false; el('centerPlay').hidden = false; }
}
function renderNow() {
  const playingChannel = activeChannel();
  const browsingChannel = guideChannel();
  const now = Date.now();
  const playing = currentProgram(playingChannel, now);
  const browsing = currentProgram(browsingChannel, now);
  selectedBoundaryAt = upcomingBoundary(now, playing, nextProgram(playingChannel, now),
    browsing, nextProgram(browsingChannel, now));
  const titleOf = p => p?.title || (state.epgStatus === 'loading' || state.epgStatus === 'updating'
    ? 'Загружаем телепрограмму…' : 'Программа пока недоступна');
  // The fullscreen info bar always reflects the PLAYING stream, even when
  // keyboard focus is browsing a different channel in the guide.
  el('infoBarLogo').innerHTML = playingChannel ? logoMarkup(playingChannel, 'infobar-logo') : '';
  el('infoBarName').textContent = playingChannel?.name || 'AQUA TV';
  el('infoBarNow').textContent = titleOf(playing);
  el('infoBarNext').textContent = nextProgram(playingChannel, now)?.title || 'Следующая передача неизвестна';
  el('infoBarRemaining').textContent = minsLeft(playing, now);
  setProgressBar(el('infoBarProgress'), playing, now);
  const programmeKey = playingChannel?.id + ':' + (playing?.start ?? 'no-programme');
  if (lastPlayingProgrammeKey !== null && programmeKey !== lastPlayingProgrammeKey) revealInfoBar();
  lastPlayingProgrammeKey = programmeKey;
  // The right-hand EPG, including favourite action, follows guide focus.
  el('favoriteButton').textContent = browsingChannel && state.favorites.has(browsingChannel.id) ? '★' : '☆';
  el('favoriteButton').classList.toggle('active', Boolean(browsingChannel && state.favorites.has(browsingChannel.id)));
  el('currentProgram').textContent = titleOf(browsing);
  el('currentTimes').textContent = timeRange(browsing);
  el('currentLeft').textContent = minsLeft(browsing, now);
  setProgressBar(el('nowProgressFill'), browsing, now);
  const playingElsewhere = browsingChannel && playingChannel && browsingChannel.id !== playingChannel.id;
  el('previewSlot').title = playingElsewhere
    ? `Воспроизводится: ${playingChannel.name}. Программа справа: ${browsingChannel.name}. Нажмите Enter на канале, чтобы переключить видео.`
    : 'Нажмите для просмотра на весь экран';
}
function categoryIcon(name) {
  const lookup = {
    'Все каналы':'▦','Избранное':'★','Детские':'☀','Музыка':'♫','Новостные':'◉',
    'Общие':'▣','Познавательные':'✦','Спорт':'⚑','Фильмы':'▤','Развлекательные':'✳',
    'Документальные':'◇','Региональные':'⌂'
  };
  return lookup[name] || '◈';
}
function categories() {
  return ['Все каналы', 'Избранное', ...new Set(state.channels.map(c => c.group))];
}
function visibleChannels() {
  return state.channels.filter(c => {
    if (state.group === 'Избранное' && !state.favorites.has(c.id)) return false;
    if (state.group !== 'Избранное' && state.group !== 'Все каналы' && c.group !== state.group) return false;
    return true;
  });
}
function renderCategories() {
  el('categoryList').innerHTML = categories().map(name => `<button type="button" class="category-button ${state.group === name ? 'active' : ''} ${state.menuOpen && state.navigationZone === 'categories' && state.focusedGroup === name ? 'keyboard-focused' : ''}"
      data-group="${escapeHtml(name)}" aria-pressed="${state.group === name}" tabindex="${state.menuOpen && state.navigationZone === 'categories' && state.focusedGroup === name ? '0' : '-1'}">
      <span class="cat-icon">${categoryIcon(name)}</span><span>${escapeHtml(name)}</span></button>`).join('');
  requestAnimationFrame(syncCategoryConnection);
}
// The link between the active category and the central white panel stays
// aligned even when the categories are scrolled inside their own viewport.
function syncCategoryConnection() {
  const panel = document.querySelector('.categories-panel');
  const nav = el('categoryList');
  const active = nav?.querySelector('.category-button.active');
  if (!panel || !nav || !active || window.matchMedia('(max-width: 520px)').matches) {
    panel?.style.setProperty('--tab-height', '0px');
    return;
  }
  const frame = panel.getBoundingClientRect();
  const viewport = nav.getBoundingClientRect();
  const tab = active.getBoundingClientRect();
  const top = Math.max(tab.top, viewport.top);
  const bottom = Math.min(tab.bottom, viewport.bottom);
  panel.style.setProperty('--tab-top', `${top - frame.top}px`);
  panel.style.setProperty('--tab-height', `${Math.max(0, bottom - top)}px`);
}
// The longest channel name across the entire playlist determines a common
// boundary. Canvas measures the actual selected font rather than guessing by
// character count. Small viewports reserve room for EPG text.
function refreshChannelLayout() {
  const parent = el('channelList');
  if (!parent || !state.channels.length || !parent.clientWidth) return;
  const reference = parent.querySelector('.row-name');
  const style = reference ? getComputedStyle(reference) : null;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return;
  const size = style?.fontSize || `${state.fontPx}px`;
  const family = style?.fontFamily || 'Arial, sans-serif';
  context.font = `800 ${size} ${family}`;
  const longest = Math.max(0, ...state.channels.map(channel => context.measureText(channel.name).width));
  const logo = parent.querySelector('.row-logo');
  const logoWidth = logo?.getBoundingClientRect().width || 27;
  const desired = Math.ceil(longest + logoWidth + 13 + 5);
  const maxWidth = Math.max(90, Math.floor(parent.clientWidth * 0.58));
  parent.style.setProperty('--channel-col-width', `${Math.min(maxWidth, Math.max(90, desired))}px`);
  refreshMarquee();
}
function refreshMarquee() {
  const parent = el('channelList');
  if (!parent) return;
  const enabled = state.guideOpen && state.navigationZone === 'channels' && !state.menuOpen && !state.settingsOpen;
  for (const row of parent.querySelectorAll('.channel-row')) {
    const focused = enabled && row.dataset.channelId === state.focusedId;
    const hovered = enabled && row.matches(':hover');
    const animate = focused || hovered;
    for (const [viewportClass, trackClass, flagClass] of [
      ['.row-scroll-window', '.row-scroll-track', 'epg-marquee'],
      ['.row-name', '.row-name-track', 'name-marquee']
    ]) {
      const viewport = row.querySelector(viewportClass);
      const track = row.querySelector(trackClass);
      if (!viewport || !track) continue;
      const distance = Math.max(0, Math.ceil(track.scrollWidth - viewport.clientWidth));
      track.style.setProperty('--marquee-shift', `${-distance}px`);
      track.style.setProperty('--marquee-duration', `${Math.max(5, Math.min(23, distance / 19 + 5))}s`);
      row.classList.toggle(flagClass, animate && distance > 3);
    }
  }
}

function renderChannels() {
  const list = visibleChannels();
  const now = Date.now();
  listBoundaryAt = Infinity;
  const parent = el('channelList');
  const previousScroll = parent.scrollTop;
  const hadKeyboardFocus = document.activeElement?.classList?.contains('channel-row');
  if (!list.some(c => c.id === state.focusedId)) {
    state.focusedId = list.some(c => c.id === state.activeId) ? state.activeId : list[0]?.id || null;
  }
  if (!list.length) {
    parent.innerHTML = `<div class="empty-list">${state.group === 'Избранное' ? 'Пока нет избранных каналов. Добавьте их звёздочкой ☆' : 'По вашему запросу каналы не найдены.'}</div>`;
    return;
  }
  parent.innerHTML = list.map(c => {
    const program = currentProgram(c, now);
    const upcoming = nextProgram(c, now);
    listBoundaryAt = Math.min(listBoundaryAt, upcomingBoundary(now, program, upcoming));
    const active = state.activeId === c.id;
    const focused = state.focusedId === c.id;
    const keyboardFocused = focused && state.navigationZone === 'channels' && !state.menuOpen;
    const currentTitle = program?.title || 'Нет данных EPG';
    const upcomingTitle = upcoming?.title || 'Нет следующей передачи';
    return `<div class="channel-row ${active ? 'active' : ''} ${focused ? 'focused' : ''} ${keyboardFocused ? 'keyboard-focused' : ''}" role="button" tabindex="${keyboardFocused ? '0' : '-1'}"
      aria-label="${escapeHtml(c.name)}: ${active ? 'сейчас воспроизводится' : 'нажмите Enter для просмотра'}" aria-current="${active ? 'true' : 'false'}" data-channel-id="${escapeHtml(c.id)}">
      <div class="row-channel-info">${logoMarkup(c)}<div class="row-text"><div class="row-name" title="${escapeHtml(c.name)}"><span class="row-name-track">${escapeHtml(c.name)} ${state.favorites.has(c.id) ? '<span class="row-star">★</span>' : ''}</span></div></div></div>
      <div class="row-right">
        <div class="row-scroll-window" title="Сейчас: ${escapeHtml(currentTitle)} · Далее: ${escapeHtml(upcomingTitle)}">
          <div class="row-scroll-track"><span class="row-program-now">${escapeHtml(currentTitle)}</span><span class="row-program-next">${escapeHtml(upcomingTitle)}</span></div>
        </div>
        <div class="row-bar" title="${escapeHtml(timeRange(program))}"><div class="epg-progress" data-epg-start="${program ? program.start : ''}" data-epg-stop="${program ? program.stop : ''}" style="width:${progress(program, now)}%"></div></div>
      </div>
    </div>`;
  }).join('');
  parent.scrollTop = previousScroll;
  syncChannelFocus();
  requestAnimationFrame(refreshChannelLayout);
  if (hadKeyboardFocus) {
    const focused = [...parent.querySelectorAll('.channel-row')].find(row => row.dataset.channelId === state.focusedId);
    focused?.focus({ preventScroll: true });
  }
}
function renderSchedule() {
  const channel = guideChannel();
  const now = Date.now();
  // The active programme is shown above, so this list contains only what is next.
  const matching = getPrograms(channel).filter(p => p.start > now && p.start < now + 36 * 3600000).slice(0, 30);
  const panel = el('programList');
  if (!matching.length) {
    panel.innerHTML = `<div class="no-guide">${state.epgStatus === 'loading' || state.epgStatus === 'updating' ? 'Получаем программу передач. Она появится здесь автоматически.' : `Нет ближайших передач для tvg-id «${escapeHtml(channel?.tvgId || 'не указан')}». Диагностика EPG доступна по клавише G.`}</div>`;
    updateProgramFocus();
    return;
  }
  // A fine rule marks the boundary of a new calendar day; omit date labels.
  // Start from today's local day so the first show tomorrow also gets a rule.
  let lastDay = new Date(now).toDateString();
  panel.innerHTML = matching.map((p, i) => {
    const day = new Date(p.start).toDateString();
    const separator = day !== lastDay ? '<div class="schedule-day-divider" role="separator" aria-label="Следующий день"></div>' : '';
    lastDay = day;
    return separator + `<div class="schedule-row programme-focus-item ${i === 0 ? 'next' : ''}" role="button" tabindex="-1" data-program-index="${i + 1}" aria-label="${escapeHtml(p.title)}, Enter — описание"><time class="schedule-time">${fmt(p.start)}</time><div class="schedule-copy"><b title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</b></div></div>`;
  }).join('');
  updateProgramFocus();
}
function renderAll() { renderCategories(); renderChannels(); renderNow(); renderSchedule(); updateProgramFocus(); }
function setGuide(open) {
  if (state.guideOpen === open) return;
  closeProgramPopup();
  if (!open) {
    if (state.settingsOpen) closeFontSettings();
    if (state.menuOpen) closeCategoryMenu(false);
  }
  state.guideOpen = open;
  if (open) {
    hideInfoBar();
    state.navigationZone = 'channels';
    state.focusedProgramIndex = 0;
    state.focusedGroup = state.group;
    el('guideView').hidden = false;
    el('previewSlot').appendChild(shell); // move one video instead of restarting the HLS stream
    el('fullscreenStage').hidden = true;
    state.focusedId = state.activeId;
    renderAll();
    requestAnimationFrame(() => {
      const selected = el('channelList').querySelector('.channel-row.focused');
      selected?.scrollIntoView({ block: 'nearest' });
      selected?.focus({ preventScroll: true });
    });
  } else {
    el('fullscreenStage').hidden = false;
    el('fullscreenStage').prepend(shell);
    el('guideView').hidden = true;
    revealInfoBar();
  }
}
function syncMuteButton() {
  video.dataset.muted = String(video.muted);
}
function tryPlay(initial = false) {
  if (!state.activeId) return;
  const attempt = video.play();
  if (!attempt?.catch) return;
  attempt.catch(async err => {
    if (err.name === 'AbortError') return; // another channel was chosen
    if (!video.muted) {
      video.muted = true;
      syncMuteButton();
      try { await video.play(); toast('Браузер ограничил автозапуск со звуком. Включите звук кнопкой ♫.'); return; }
      catch (_) { /* user interaction required */ }
    }
    el('centerPlay').hidden = false;
    if (initial) playStatus('Нажмите ▶ для начала просмотра');
  });
}
// Native Safari HLS can support formats that MediaSource/hls.js cannot.
// Browser limitations (CORS, HTTPS, missing codecs) cannot be bypassed by JS.
function streamUrl(channel) { return channel.url; }
function codecName(value) {
  const codec = String(value || '').toLowerCase();
  if (!codec) return 'Не определён';
  if (/^(avc1|avc3)/.test(codec)) return `H.264 / AVC (${value})`;
  if (/^(hev1|hvc1)/.test(codec)) return `H.265 / HEVC (${value})`;
  if (/^(dvh1|dvhe)/.test(codec)) return `Dolby Vision (${value})`;
  if (/^av01/.test(codec)) return `AV1 (${value})`;
  if (/^mp4a\.40/.test(codec)) return `AAC (${value})`;
  if (/^(ac-3|dac3)/.test(codec)) return `Dolby Digital / AC-3 (${value})`;
  if (/^(ec-3|dec3)/.test(codec)) return `Dolby Digital Plus / E-AC-3 (${value})`;
  if (/^mp4a\.69|^mp4a\.6b/.test(codec)) return `MP3 (${value})`;
  return value;
}
function observeCodecs(videoCodec, audioCodec) {
  if (videoCodec) state.videoCodec = codecName(videoCodec);
  if (audioCodec) state.audioCodec = codecName(audioCodec);
  updateDiagnostics();
}
function diagAdvice() {
  if (state.lastError?.category === 'codec') return 'Возможно, браузер не поддерживает этот кодек. Проверьте поток в VLC; если там он работает — используйте H.264/AAC-версию или браузер/устройство с поддержкой кодека.';
  if (state.lastError?.category === 'mixed') return 'На GitHub Pages (HTTPS) нужен HTTPS-видеопоток. HTTP-ссылку браузер может блокировать.';
  if (state.lastError?.category === 'http') return 'Источник ответил ошибкой HTTP. Проверьте работоспособность адреса, права доступа и срок действия ссылки.';
  if (state.lastError?.category === 'network') return 'Проверьте доступность потока, CORS у .m3u8 и у сегментов .ts/.m4s. Без разрешения со стороны видеосервера HTML не сможет устранить CORS.';
  if (state.lastError?.category === 'format') return 'Проверьте, действительно ли по ссылке приходит корректный HLS-плейлист, а не HTML-страница или другой формат.';
  if (state.lastError?.category === 'timeout') return 'Сервер или декодер слишком долго не выдаёт видео. Попробуйте повторить и проверьте вкладку Network (F12).';
  if (/H.265|HEVC|Dolby Vision/.test(state.videoCodec)) return 'Обнаружен HEVC или Dolby Vision. Поддержка зависит от браузера, ОС и аппаратного декодера; H.264 обычно совместимее.';
  if (/AC-3|E-AC-3/.test(state.audioCodec)) return 'AC-3/E-AC-3 может не воспроизводиться в отдельных браузерах; лучше AAC.';
  return 'Если канал не работает, откройте его ссылку в VLC, а в браузере посмотрите F12 → Network/Console. Проверяйте и .m3u8, и вложенные сегменты.';
}
function alternateChannel() {
  const current = activeChannel();
  if (!current?.tvgId) return null;
  const others = state.channels.filter(c => c.id !== current.id &&
    c.tvgId.trim().toLowerCase() === current.tvgId.trim().toLowerCase());
  // Prefer a version without HD/4K/UHD in its title, usually the compatible SD feed.
  others.sort((a, b) => Number(/\b(?:UHD|4K|HD)\b/i.test(a.name)) - Number(/\b(?:UHD|4K|HD)\b/i.test(b.name)));
  return others[0] || null;
}
function updateDiagnostics() {
  if (!el('diagChannel')) return;
  const current = activeChannel();
  el('diagChannel').textContent = current?.name || '—';
  el('diagUrl').textContent = current?.url || '—';
  el('diagMode').textContent = state.playerMode;
  el('diagVideo').textContent = state.videoCodec;
  el('diagAudio').textContent = state.audioCodec;
  el('diagError').textContent = state.lastError?.message || (state.playing ? 'Нет ошибок' : 'Ожидаем видеопоток…');
  el('diagTechnical').textContent = state.lastError?.technical || '—';
  el('diagAdvice').textContent = diagAdvice();
  const alt = alternateChannel();
  el('tryAlternate').hidden = !alt;
  if (alt) el('tryAlternate').textContent = `Другой поток: ${alt.name}`;
}
function playerReport() {
  return [
    'AQUA TV — отчёт диагностики',
    `Дата: ${new Date().toISOString()}`,
    `Канал: ${activeChannel()?.name || '—'}`,
    `URL: ${activeChannel()?.url || '—'}`,
    `Страница: ${location.origin}`,
    `Плеер: ${state.playerMode}`,
    `Видео: ${state.videoCodec}`,
    `Аудио: ${state.audioCodec}`,
    `Ошибка: ${state.lastError?.message || '—'}`,
    `Технические данные: ${state.lastError?.technical || '—'}`,
    `Браузер: ${navigator.userAgent}`
  ].join('\n');
}
function recordIssue(category, message, technical = '', fatal = true) {
  const issue = { category, message, technical };
  state.lastError = issue;
  if (fatal) {
    state.failed = true;
    clearTimeout(state.startupTimer);
    playStatus(message, true);
  }
  updateDiagnostics();
  if (fatal) console.warn('[AQUA TV]', message, technical);
}
function startPlaybackWatchdog(session) {
  clearTimeout(state.startupTimer);
  state.startupTimer = setTimeout(() => {
    if (state.session !== session || state.playing || state.failed) return;
    recordIssue('timeout', 'Нет изображения более 35 секунд. Откройте диагностику.',
      'Таймаут ожидания первых кадров; проверьте Network, сегменты и поддержку кодека.');
    // Не уничтожаем поток: иногда он запускается с задержкой.
  }, 35000);
}
function hlsErrorCategory(data) {
  const detail = String(data.details || '');
  if (/manifestParsingError/i.test(detail)) return 'format';
  if (/Codec|codec|demux|Parsing|parsing|Remux|remux|Decrypt|decrypt/.test(detail) || data.type === window.Hls?.ErrorTypes.MEDIA_ERROR) return 'codec';
  if (data.type === window.Hls?.ErrorTypes.NETWORK_ERROR) return 'network';
  return 'format';
}
function hlsErrorMessage(data) {
  const detail = String(data.details || 'unknownError');
  const code = Number(data.response?.code || data.response?.status || 0);
  if (code >= 400) return { category: 'http', message: `Сервер вернул HTTP ${code} (${detail}).` };
  if (/Codec|codec/.test(detail)) return { category: 'codec', message: 'Браузер не поддерживает кодек этого потока.' };
  if (/fragParsing|demux|remux|decrypt/i.test(detail)) return { category: 'codec', message: 'Ошибка разбора или декодирования видеопотока.' };
  if (/manifestParsing/i.test(detail)) return { category: 'format', message: 'HLS-плейлист содержит ошибку или неподдерживаемый формат.' };
  if (/fragLoad|partLoad|keyLoad/i.test(detail)) return { category: 'network', message: 'Не удалось загрузить сегмент видео или ключ потока.' };
  if (/manifestLoad|levelLoad|audioTrackLoad/i.test(detail)) return { category: 'network', message: 'Не удалось загрузить HLS-плейлист канала.' };
  if (data.type === window.Hls?.ErrorTypes.MEDIA_ERROR) return { category: 'codec', message: 'Ошибка декодирования или обработки видео браузером.' };
  return { category: 'network', message: 'Ошибка воспроизведения потока.' };
}
function hlsErrorTechnical(data) {
  const safe = value => String(value ?? '').slice(0, 600);
  return [data.details, data.type, data.response?.code && `HTTP ${data.response.code}`,
    data.reason, data.error?.message, data.url && `URL ${data.url}`].filter(Boolean).map(safe).join(' · ');
}
function playChannel(channel, initial = false) {
  if (!channel) return;
  state.session++;
  const session = state.session;
  clearTimeout(state.retryTimer);
  clearTimeout(state.startupTimer);
  state.activeId = channel.id;
  state.hlsErrorCount = 0;
  state.playing = false;
  state.failed = false;
  state.playerMode = 'Определяем…';
  state.videoCodec = 'Не определён';
  state.audioCodec = 'Не определён';
  state.lastError = null;
  state.initialAutoplay = initial;
  // Do not show stale dimensions from the previously playing stream.
  el('infoBarResolution').textContent = '—';
  el('infoBarQuality').textContent = '—';
  localStorage.setItem('aqua:lastChannelId', channel.id);
  localStorage.setItem('aqua:lastChannelUrl', channel.url);
  el('placeholderTitle').textContent = channel.name;
  el('playerPlaceholder').hidden = false;
  el('centerPlay').hidden = true;
  playStatus('Подключаемся к трансляции…');
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  video.pause();
  video.removeAttribute('src');
  video.load();
  renderNow();
  // A retry of the same channel should reveal the infobar too.
  revealInfoBar();
  renderEPGPanel();
  if (state.guideOpen) { renderChannels(); renderSchedule(); updateProgramFocus(); }
  updateDiagnostics();
  const src = streamUrl(channel);
  if (location.protocol === 'https:' && new URL(src).protocol === 'http:') {
    recordIssue('mixed', 'HTTP-поток на HTTPS-странице может блокироваться браузером.',
      'Mixed content: страница открыта по HTTPS, поток указан по HTTP.');
    return;
  }

  // Dynamic URLs without an extension can also return HLS manifests.
  const isHls = !/\.(mp4|webm|ogv|mpd|ts)(?:[?#]|$)/i.test(src);
  const canNativeHls = Boolean(video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL'));
  const isAppleHls = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR/i.test(navigator.userAgent));
  // Prefer native HLS on Safari/iOS. Chromium may report 'maybe' yet work better via hls.js.
  const preferNativeHls = canNativeHls && (isAppleHls || !window.Hls?.isSupported());
  if (isHls && preferNativeHls) {
    state.playerMode = 'HLS браузера (нативный)';
    video.src = src;
    startPlaybackWatchdog(session);
  } else if (isHls && window.Hls?.isSupported()) {
    state.playerMode = 'hls.js (MediaSource)';
    const hls = new window.Hls({
      enableWorker: true, lowLatencyMode: false, liveSyncDurationCount: 3,
      maxBufferLength: 30, maxBufferSize: 40 * 1000 * 1000
    });
    state.hls = hls;
    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => { if (session === state.session) hls.loadSource(src); });
    hls.on(window.Hls.Events.MANIFEST_PARSED, (_event, data) => {
      if (session !== state.session) return;
      const level = data.levels?.[0] || hls.levels?.[0];
      if (level) observeCodecs(level.videoCodec, level.audioCodec);
      tryPlay(initial);
    });
    hls.on(window.Hls.Events.FRAG_PARSING_INIT_SEGMENT, (_event, data) => {
      if (session !== state.session) return;
      observeCodecs(data.tracks?.video?.codec || data.tracks?.video?.levelCodec,
        data.tracks?.audio?.codec || data.tracks?.audio?.levelCodec);
    });
    hls.on(window.Hls.Events.ERROR, (_event, data) => {
      if (hls !== state.hls || session !== state.session) return;
      const explained = hlsErrorMessage(data);
      const technical = hlsErrorTechnical(data);
      if (!data.fatal) {
        // hls.js may resolve nonfatal fragment/segment errors by itself.
        state.lastError = { ...explained, technical };
        updateDiagnostics();
        return;
      }
      const responseCode = Number(data.response?.code || data.response?.status || 0);
      const unrecoverable = explained.category === 'codec' && /Codec|codec|parsing|Parsing|decrypt|Decrypt/.test(String(data.details)) ||
        responseCode === 401 || responseCode === 403 || responseCode === 404 || responseCode === 410;
      state.hlsErrorCount++;
      if (!unrecoverable && data.type === window.Hls.ErrorTypes.MEDIA_ERROR && state.hlsErrorCount <= 2) {
        playStatus('Исправляем ошибку декодера…');
        state.lastError = { ...explained, technical };
        updateDiagnostics();
        hls.recoverMediaError();
      } else if (!unrecoverable && data.type === window.Hls.ErrorTypes.NETWORK_ERROR && state.hlsErrorCount <= 3) {
        playStatus('Переподключаемся к потоку…');
        state.lastError = { ...explained, technical };
        updateDiagnostics();
        state.retryTimer = setTimeout(() => {
          if (session === state.session && hls === state.hls && !state.failed) hls.startLoad();
        }, state.hlsErrorCount * 1400);
      } else {
        recordIssue(explained.category, explained.message + ' Нажмите «Диагностика» для подробностей.', technical);
      }
    });
    hls.attachMedia(video);
    startPlaybackWatchdog(session);
  } else if (!isHls && /\.(mp4|webm|ogv)(?:[?#]|$)/i.test(src)) {
    state.playerMode = 'HTML5 Video';
    video.src = src;
    startPlaybackWatchdog(session);
  } else {
    recordIssue('format', isHls
      ? 'HLS недоступен: hls.js не загрузился или MediaSource не поддерживается.'
      : 'Этот формат не воспроизводится напрямую в HTML5-плеере.',
      isHls ? 'Попробуйте другой браузер или проверьте загрузку hls.js (F12 → Network).' : src);
  }
  updateDiagnostics();
}

// Static-site utilities. No /api endpoints, no server-side dependencies.
const APP_CONFIG = Object.freeze({
  playlistUrl: String(window.AQUA_CONFIG?.playlistUrl || './playlist.m3u'),
  epgUrl: String(window.AQUA_CONFIG?.epgUrl || ''),
  epgFallbackUrl: String(window.AQUA_CONFIG?.epgFallbackUrl || ''),
  epgMetaUrl: String(window.AQUA_CONFIG?.epgMetaUrl || ''),
  epgCheckMinutes: Math.max(5, Number(window.AQUA_CONFIG?.epgCheckMinutes) || 15),
  epgPreferLocal: window.AQUA_CONFIG?.epgPreferLocal !== false,
  epgCacheHours: Math.max(1, Number(window.AQUA_CONFIG?.epgCacheHours) || 24),
  epgDaysAhead: Math.max(1, Number(window.AQUA_CONFIG?.epgDaysAhead) || 3),
  requestTimeoutMs: Math.max(5000, Number(window.AQUA_CONFIG?.requestTimeoutMs) || 90000)
});

function playlistItems(m3u, baseUrl) {
  const channels = [];
  const lines = m3u.replace(/^\uFEFF/, '').split(/\r?\n/);
  let pending = null;
  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) {
      let quoted = false;
      let comma = -1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        else if (line[i] === ',' && !quoted) { comma = i; break; }
      }
      const attrsPart = comma < 0 ? line : line.slice(0, comma);
      const name = comma < 0 ? 'Без названия' : line.slice(comma + 1).trim();
      const attrs = {};
      const re = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
      let match;
      while ((match = re.exec(attrsPart))) attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
      pending = {
        name: name || attrs['tvg-name'] || 'Без названия',
        group: attrs['group-title'] || 'Без категории',
        tvgId: (attrs['tvg-id'] || '').trim(),
        logo: attrs['tvg-logo'] || ''
      };
    } else if (!line.startsWith('#') && pending) {
      try {
        const url = new URL(line, baseUrl);
        if (!['http:', 'https:'].includes(url.protocol)) { pending = null; continue; }
        const channel = { ...pending, url: url.href };
        // URL + display name distinguishes HD/SD channels with shared tvg-id.
        channel.id = `${channel.url}||${channel.name}`;
        channels.push(channel);
      } catch (error) { console.warn('Пропущена неправильная ссылка M3U:', line, error); }
      pending = null;
    }
  }
  return channels;
}

async function download(url, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), APP_CONFIG.requestTimeoutMs);
  if (externalSignal) externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return response;
  } finally { clearTimeout(timer); }
}

// Format XMLTV: 20261024201500 +0300. JS timestamp is in milliseconds UTC.
function parseXMLTVTime(value) {
  const m = String(value || '').trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!m) return NaN;
  const [ , y, mo, d, h, minute, sec, sign, tzHour, tzMin] = m;
  const nums = [y, mo, d, h, minute, sec || 0].map(Number);
  if (!sign) return new Date(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5]).getTime();
  const displacement = (Number(tzHour) * 60 + Number(tzMin)) * (sign === '+' ? 1 : -1);
  return Date.UTC(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5]) - displacement * 60_000;
}
function xmlEntities(value) {
  return String(value || '').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, encoded => {
    const key = encoded.slice(1, -1).toLowerCase();
    const fixed = { amp:'&', lt:'<', gt:'>', quot:'"', apos:"'" };
    if (Object.hasOwn(fixed, key)) return fixed[key];
    const n = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : encoded;
  });
}
function xmlAttribute(attrs, key) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return xmlEntities(m?.[1] ?? m?.[2] ?? '');
}
function xmlTag(inner, tag) {
  const m = inner.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i'));
  return xmlEntities((m?.[1] || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim());
}

// XMLTV parser accepts browser responses and uploaded File objects.
// The incoming body may be plain XML or raw gzip; HTTP Content-Encoding decompression
// (if present) has already happened in fetch, so only inspect the actual bytes.
async function streamXMLTV(sourceObject, wantedIds, onProgress = () => {}) {
  const body = sourceObject.body || sourceObject.stream?.();
  if (!body) throw new Error('Невозможно прочитать EPG. Нужен современный браузер.');
  const networkReader = body.getReader();
  const first = await networkReader.read();
  if (first.done || !first.value?.length) throw new Error('EPG-файл пуст.');
  let bytesRead = first.value.byteLength;
  const totalBytes = Number(sourceObject.headers?.get('Content-Length') || sourceObject.size || 0);
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(first.value); },
    async pull(controller) {
      const chunk = await networkReader.read();
      if (chunk.done) { controller.close(); return; }
      bytesRead += chunk.value.byteLength;
      onProgress(bytesRead, totalBytes);
      controller.enqueue(chunk.value);
    },
    cancel(reason) { return networkReader.cancel(reason); }
  });
  onProgress(bytesRead, totalBytes);
  const gzip = first.value[0] === 0x1f && first.value[1] === 0x8b;
  if (gzip && !('DecompressionStream' in window)) throw new Error('Firefox устарел: не поддерживается распаковка gzip. Обновите браузер.');
  const decodedStream = gzip ? stream.pipeThrough(new DecompressionStream('gzip')) : stream;
  const reader = decodedStream.getReader();
  const decoder = new TextDecoder('utf-8');
  const now = Date.now();
  const earliestAllowed = now - 12 * 60 * 60 * 1000;
  const latestAllowed = now + APP_CONFIG.epgDaysAhead * 24 * 3600_000;
  const guide = Object.create(null);
  const channelIds = new Set();
  let totalProgrammes = 0, keptProgrammes = 0, firstStart = Infinity, lastStop = -Infinity;
  let hasTvTag = false;
  let buffer = '';
  const consume = () => {
    if (!hasTvTag && /<tv(?:\s|>)/i.test(buffer)) hasTvTag = true;
    while (true) {
      const begin = buffer.search(/<programme(?=[\s>])/i);
      if (begin < 0) { buffer = buffer.slice(-80); break; }
      if (begin > 0) buffer = buffer.slice(begin);
      const ending = buffer.search(/<\/programme\s*>/i);
      if (ending < 0) {
        if (buffer.length > 4_000_000) throw new Error('EPG содержит слишком длинную/повреждённую XMLTV-запись.');
        break;
      }
      const closing = buffer.slice(ending).match(/^<\/programme\s*>/i)?.[0]?.length || 12;
      const block = buffer.slice(0, ending + closing);
      buffer = buffer.slice(ending + closing);
      totalProgrammes++;
      const open = block.match(/^<programme\b([^>]*)>/i);
      if (!open) continue;
      const id = xmlAttribute(open[1], 'channel').trim().toLowerCase();
      if (!wantedIds.has(id)) continue;
      channelIds.add(id);
      const start = parseXMLTVTime(xmlAttribute(open[1], 'start'));
      const stop = parseXMLTVTime(xmlAttribute(open[1], 'stop'));
      if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start || stop <= earliestAllowed || start >= latestAllowed) continue;
      const title = xmlTag(block, 'title');
      if (!title) continue;
      (guide[id] ||= []).push({start, stop, title, desc: xmlTag(block, 'desc').slice(0, 500)});
      keptProgrammes++;
      firstStart = Math.min(firstStart, start);
      lastStop = Math.max(lastStop, stop);
    }
  };
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, {stream:true});
    consume();
  }
  buffer += decoder.decode();
  consume();
  if (!hasTvTag || totalProgrammes === 0) throw new Error('В ответе нет телегида XMLTV. Возможно, сервер вернул HTML вместо EPG.');
  for (const programmes of Object.values(guide)) {
    programmes.sort((a,b) => a.start - b.start);
    if (programmes.length > 500) programmes.length = 500;
  }
  return {
    guide, programmes: keptProgrammes, matched: Object.keys(guide).length,
    totalProgrammes, seenChannelIds: channelIds.size,
    earliest: Number.isFinite(firstStart) ? firstStart : null,
    latest: Number.isFinite(lastStop) ? lastStop : null
  };
}

async function loadEPGFromUrl(url, wantedIds, onProgress) {
  const controller = new AbortController();
  // Unlike the M3U download, keep this timeout active until parsing and gzip
  // decompression are completely finished (not just until HTTP headers arrive).
  const timeout = setTimeout(() => controller.abort(), APP_CONFIG.requestTimeoutMs);
  try {
    const response = await fetch(new URL(url, location.href), {
      signal: controller.signal, cache: 'no-store'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await streamXMLTV(response, wantedIds, onProgress);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Время загрузки EPG истекло. Проверьте доступность сервера.');
    if (error instanceof TypeError && /fetch|network|cors/i.test(error.message))
      throw new Error('Не удалось получить EPG (возможны CORS, недоступный сервер или сеть).');
    throw error;
  } finally { clearTimeout(timeout); }
}

function epgStats(guide) {
  let programmes = 0, earliest = Infinity, latest = -Infinity;
  for (const list of Object.values(guide || {})) for (const p of list) {
    programmes++;
    earliest = Math.min(earliest, p.start);
    latest = Math.max(latest, p.stop);
  }
  return { matched: Object.keys(guide || {}).length, programmes,
    earliest: Number.isFinite(earliest) ? earliest : null,
    latest: Number.isFinite(latest) ? latest : null };
}

function usefulGuide(result) {
  return result.matched > 0 && result.programmes > 0 && result.latest > Date.now();
}

let dbOpening;
function getDB() {
  if (!dbOpening) dbOpening = new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB недоступна'));
    const request = indexedDB.open('aqua-tv-static', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('epg');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbOpening;
}
async function readCachedEPG(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('epg', 'readonly').objectStore('epg').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function saveCachedEPG(key, value) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('epg', 'readwrite');
    tx.objectStore('epg').put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
function guideCacheKey() {
  let hash = 2166136261;
  const ids = [...new Set(state.channels.map(c => c.tvgId?.toLowerCase()).filter(Boolean))].sort();
  for (const c of ids.join('\u0001')) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return `epg:v2:${APP_CONFIG.epgUrl}:${APP_CONFIG.epgFallbackUrl}:${hash >>> 0}:${APP_CONFIG.epgDaysAhead}`;
}

let guideLoading = false;
let guideFetchedAt = 0;
let lastGuideAttemptAt = 0;
// The one shared metadata file tells all browsers when the central EPG changes.
// Both localhost JS server and GitHub Actions publish it next to epg.xml.gz.
async function readSharedEpgMeta() {
  if (!APP_CONFIG.epgMetaUrl) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(new URL(APP_CONFIG.epgMetaUrl, location.href), {
      cache: 'no-store', signal: controller.signal
    });
    if (!response.ok) return null; // Static web host not yet publishing the EPG.
    const meta = await response.json();
    const updated = Date.parse(meta?.updatedAt);
    return Number.isFinite(updated) && updated <= Date.now() + 300_000 ? updated : null;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}
function guideStatus(status, label, hint = '') {
  state.epgStatus = status;
  state.epgDetails.status = label;
  renderNow();
  renderEPGPanel();
  if (state.guideOpen) { renderChannels(); renderSchedule(); }
}
function renderEPGPanel() {
  if (!el('epgPanel')) return;
  const data = state.epgDetails;
  const current = activeChannel();
  const ids = new Set(state.channels.map(c => c.tvgId?.toLowerCase()).filter(Boolean));
  const present = [...ids].filter(id => (state.guide[id] || []).length > 0).length;
  const programs = getPrograms(current);
  const currentNow = currentProgram(current);
  const displayDate = value => value ? new Date(value).toLocaleString('ru-RU') : '—';
  const plain = (id, value) => { el(id).textContent = String(value ?? '—'); };
  plain('epgInfoStatus', data.status);
  plain('epgInfoSource', data.source);
  plain('epgInfoLast', displayDate(data.updatedAt));
  plain('epgInfoAttempt', displayDate(data.lastAttemptAt));
  plain('epgInfoMatched', `${present} из ${ids.size} уникальных tvg-id`);
  plain('epgInfoProgrammes', epgStats(state.guide).programmes);
  plain('epgInfoRange', `${data.earliest ? displayDate(data.earliest) : '—'} — ${data.latest ? displayDate(data.latest) : '—'}`);
  plain('epgInfoChannel', current ? `${current.name} (tvg-id: ${current.tvgId || 'НЕ УКАЗАН'})` : '—');
  plain('epgInfoChannelCount', `${programs.length} передач, сейчас: ${currentNow?.title || 'нет данных'}`);
  plain('epgInfoError', data.error || 'Нет ошибок');
  plain('epgInfoProgress', data.progress || '—');
  el('epgInfoError').classList.toggle('epg-problem', Boolean(data.error));
}
function acceptGuide(result, source) {
  if (state.popupOpen) closeProgramPopup();
  if (!usefulGuide(result)) {
    throw new Error(result.seenChannelIds === 0
      ? `Источник содержит ${result.totalProgrammes} передач, но совпадений с tvg-id из M3U нет.`
      : `Совпадений tvg-id: ${result.seenChannelIds}, но актуальных передач не найдено (проверьте дату и время).`);
  }
  state.guide = result.guide;
  guideFetchedAt = Date.now();
  Object.assign(state.epgDetails, {
    source, updatedAt: guideFetchedAt, matched: result.matched,
    programmes: result.programmes, seenChannelIds: result.seenChannelIds,
    earliest: result.earliest, latest: result.latest,
    error: '', progress: ''
  });
  guideStatus('ready', `EPG ✓ ${result.matched} каналов`, `${result.programmes} передач`);
}
async function syncGuide(force = false) {
  if (guideLoading || (!APP_CONFIG.epgUrl && !APP_CONFIG.epgFallbackUrl)) {
    if (!APP_CONFIG.epgUrl && !APP_CONFIG.epgFallbackUrl)
      guideStatus('error', 'EPG: URL не задан', 'Заполните epgUrl в config.js или загрузите XMLTV вручную.');
    return;
  }
  // Avoid endless retries when source is down, but always permit a manual click.
  if (!force && lastGuideAttemptAt && Date.now() - lastGuideAttemptAt < 5 * 60_000) return;
  guideLoading = true;
  try {
    const key = guideCacheKey();
    let cached = null;
    try { cached = await readCachedEPG(key); }
    catch (error) { console.warn('EPG-кэш:', error); }
    const sharedUpdatedAt = await readSharedEpgMeta();
    const cacheStats = epgStats(cached?.guide);
    const cacheValid = cached?.guide && usefulGuide(cacheStats);
    if (cacheValid && (!state.epgDetails.updatedAt || !usefulGuide(epgStats(state.guide)))) {
      state.guide = cached.guide;
      guideFetchedAt = cached.updatedAt || 0;
      Object.assign(state.epgDetails, {
        source: cached.source || 'Кэш IndexedDB', updatedAt: cached.sourceUpdatedAt || guideFetchedAt,
        matched: cacheStats.matched, programmes: cacheStats.programmes,
        earliest: cacheStats.earliest, latest: cacheStats.latest
      });
      guideStatus('ready', `EPG ✓ ${cacheStats.matched} каналов (кэш)`);
    }
    const newerSharedGuide = sharedUpdatedAt && (!cached?.sourceUpdatedAt || sharedUpdatedAt > cached.sourceUpdatedAt + 1000);
    const fresh = cacheValid && cached.updatedAt && !newerSharedGuide &&
      Date.now() - cached.updatedAt < APP_CONFIG.epgCacheHours * 3_600_000;
    if (fresh && !force) return;
    lastGuideAttemptAt = Date.now();
    state.epgDetails.lastAttemptAt = lastGuideAttemptAt;
    state.epgDetails.error = '';
    guideStatus(cacheValid ? 'updating' : 'loading', cacheValid ? 'EPG ↻ обновление' : 'EPG ↻ загрузка');
    const wantedIds = new Set(state.channels.map(c => c.tvgId.toLowerCase()).filter(Boolean));
    const urls = [...new Set((APP_CONFIG.epgPreferLocal
      ? [APP_CONFIG.epgFallbackUrl, APP_CONFIG.epgUrl]
      : [APP_CONFIG.epgUrl, APP_CONFIG.epgFallbackUrl]).filter(Boolean))];
    let errors = [];
    let result, source;
    for (const url of urls) {
      const onProgress = (bytes, total) => {
        state.epgDetails.progress = total ? `${(bytes / 1024 / 1024).toFixed(1)} из ${(total / 1024 / 1024).toFixed(1)} МБ` : `${(bytes / 1024 / 1024).toFixed(1)} МБ получено`;
        if (el('epgPanel') && !el('epgPanel').hidden) renderEPGPanel();
      };
      try {
        const candidate = await loadEPGFromUrl(url, wantedIds, onProgress);
        if (!usefulGuide(candidate)) {
          const explanation = candidate.seenChannelIds === 0
            ? `нет совпадений tvg-id среди ${candidate.totalProgrammes} XMLTV-передач`
            : 'совпадения есть, но нет программ на текущую дату';
          throw new Error(explanation);
        }
        result = candidate; source = new URL(url, location.href).href;
        break;
      } catch (error) {
        console.warn('Не удалось загрузить EPG:', url, error);
        errors.push(`${url}: ${error.message}`);
      }
    }
    if (!result) throw new Error(errors.join(' | ') || 'Источники EPG недоступны.');
    const fromSharedFile = APP_CONFIG.epgFallbackUrl && source === new URL(APP_CONFIG.epgFallbackUrl, location.href).href;
    const sourceUpdatedAt = fromSharedFile ? (sharedUpdatedAt || Date.now()) : Date.now();
    acceptGuide(result, source);
    state.epgDetails.updatedAt = sourceUpdatedAt;
    try { await saveCachedEPG(key, { updatedAt: guideFetchedAt, sourceUpdatedAt, source, guide: state.guide }); }
    catch (error) { console.warn('Невозможно сохранить EPG:', error); }
    toast(`Телепрограмма готова: ${result.matched} каналов, ${result.programmes} передач.`);
  } catch (error) {
    state.epgDetails.error = String(error.message);
    state.epgDetails.progress = '';
    const kept = usefulGuide(epgStats(state.guide));
    guideStatus('error', kept ? 'EPG ⚠ старый кэш' : 'EPG ⚠ ошибка', error.message);
    toast(`EPG: ${error.message.slice(0, 190)}`);
  } finally { guideLoading = false; renderEPGPanel(); }
}
async function importEPGFile(file) {
  if (!file) return;
  if (guideLoading) { toast('Подождите завершения текущей загрузки EPG и повторите импорт.'); return; }
  guideLoading = true;
  state.epgDetails.lastAttemptAt = Date.now();
  state.epgDetails.error = '';
  guideStatus('loading', `EPG ↻ файл ${file.name}`);
  try {
    const ids = new Set(state.channels.map(c => c.tvgId.toLowerCase()).filter(Boolean));
    const result = await streamXMLTV(file, ids, (bytes, total) => {
      state.epgDetails.progress = `${Math.round(bytes / 1024)} / ${Math.round(total / 1024)} КБ`;
      if (!el('epgPanel').hidden) renderEPGPanel();
    });
    acceptGuide(result, `Файл: ${file.name}`);
    try {
      await saveCachedEPG(guideCacheKey(), { updatedAt: guideFetchedAt, source: `Файл: ${file.name}`, guide: state.guide });
    } catch (error) { console.warn('EPG загружен, но кэш недоступен:', error); }
    toast(`EPG из файла: ${result.matched} каналов, ${result.programmes} передач`);
  } catch (error) {
    state.epgDetails.error = error.message;
    guideStatus('error', 'EPG ⚠ ошибка файла', error.message);
    toast(`Не удалось прочитать ${file.name}: ${error.message}`);
  } finally { guideLoading = false; renderEPGPanel(); }
}

function toggleFavorite() {
  const id = guideChannel()?.id;
  if (!id) return;
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  localStorage.setItem('aqua:favorites', JSON.stringify([...state.favorites]));
  renderAll();
}
function setCategory(name) {
  closeProgramPopup();
  state.group = name;
  state.focusedGroup = name;
  const options = visibleChannels();
  state.focusedId = options.some(c => c.id === state.activeId) ? state.activeId : options[0]?.id || null;
  el('channelList').scrollTop = 0;
  renderCategories();
  renderChannels();
  refreshBrowsedEPG(true);
  if (state.navigationZone === 'categories') focusCategory(name);
}
function syncChannelFocus() {
  const zoneActive = state.guideOpen && state.navigationZone === 'channels'
    && !state.menuOpen && !state.settingsOpen;
  el('channelList').classList.toggle('zone-channels', zoneActive);
  el('channelList').querySelectorAll('.channel-row').forEach(row => {
    const selected = row.dataset.channelId === state.focusedId;
    row.classList.toggle('focused', selected);
    row.classList.toggle('keyboard-focused', selected && zoneActive);
    row.tabIndex = selected && zoneActive ? 0 : -1;
  });
}
function refreshBrowsedEPG(resetScroll = false) {
  // Only programme DOM changes; do not restart or move the playing video.
  // A DIFFERENT browsed channel always starts its future schedule at the top.
  if (resetScroll) {
    state.focusedProgramIndex = 0;
    closeProgramPopup();
  }
  renderNow();
  renderSchedule();
  if (resetScroll) el('programList').scrollTop = 0;
  updateProgramFocus();
}
function focusChannel(id, shouldFocus = true) {
  const parent = el('channelList');
  const channelChanged = state.focusedId !== id;
  state.focusedId = id;
  syncChannelFocus();
  const row = [...parent.querySelectorAll('.channel-row')].find(r => r.dataset.channelId === id);
  if (shouldFocus && row) {
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'nearest' });
  }
  refreshBrowsedEPG(channelChanged);
  requestAnimationFrame(refreshMarquee);
}
function stepChannel(offset) {
  const options = visibleChannels();
  if (!options.length) return;
  if (!state.guideOpen) {
    const idx = options.findIndex(c => c.id === state.activeId);
    playChannel(options[(idx + offset + options.length) % options.length]);
    return;
  }
  const idx = options.findIndex(c => c.id === state.focusedId);
  const nextIndex = idx < 0 ? (offset > 0 ? 0 : options.length - 1) : (idx + offset + options.length) % options.length;
  focusChannel(options[nextIndex].id);
}
function activateChannel(channel, fromEnter = false) {
  if (!channel) return;
  closeProgramPopup();
  state.focusedId = channel.id;
  syncChannelFocus();
  const alreadyPlaying = state.activeId === channel.id;
  if (!alreadyPlaying) playChannel(channel);
  // Keyboard Enter on the channel list opens fullscreen immediately.
  // Pointer click keeps the prior two-click preview behaviour.
  if (fromEnter || alreadyPlaying) setGuide(false);
}

// Remote-control navigation: focus (arrows) and activation (Enter) are separate.
// The three zones are categories → channels → programmes; changing focus alone
// must never restart a video stream.
function focusCategory(name = state.focusedGroup) {
  const all = [...categories(), SETTINGS_ITEM];
  if (!all.includes(name)) name = state.group;
  state.focusedGroup = name;
  el('categoryList').querySelectorAll('.category-button').forEach(button => {
    const selected = button.dataset.group === name && state.menuOpen;
    button.classList.toggle('keyboard-focused', selected);
    button.tabIndex = selected ? 0 : -1;
  });
  const settingsButton = el('openSettings');
  const settingsSelected = name === SETTINGS_ITEM && state.menuOpen;
  settingsButton.classList.toggle('keyboard-focused', settingsSelected);
  settingsButton.tabIndex = settingsSelected ? 0 : -1;
  const button = settingsSelected ? settingsButton : [...el('categoryList').querySelectorAll('.category-button')]
    .find(item => item.dataset.group === name);
  if (button && state.menuOpen) {
    button.focus({ preventScroll: true });
    button.scrollIntoView({ block: 'nearest' });
  }
}

function futureProgrammes() {
  const now = Date.now();
  return getPrograms(guideChannel()).filter(p => p.start > now && p.start < now + 36 * 3600000).slice(0, 30);
}
function selectedProgramme() {
  return state.focusedProgramIndex === 0
    ? currentProgram(guideChannel())
    : futureProgrammes()[state.focusedProgramIndex - 1] || null;
}
function programmeNodes() {
  return [el('nowProgrammeItem'), ...el('programList').querySelectorAll('[data-program-index]')];
}
function updateProgramFocus(shouldFocus = false) {
  const nodes = programmeNodes();
  state.focusedProgramIndex = Math.min(state.focusedProgramIndex, Math.max(0, nodes.length - 1));
  nodes.forEach((node, index) => {
    const selected = state.navigationZone === 'programmes' && index === state.focusedProgramIndex;
    node.classList.toggle('keyboard-focused', selected);
    node.classList.toggle('popup-linked', selected && state.popupOpen);
    node.tabIndex = selected ? 0 : -1;
    node.setAttribute('aria-selected', String(selected));
  });
  const node = nodes[state.focusedProgramIndex];
  if (shouldFocus && node) {
    node.focus({ preventScroll: true });
    if (state.focusedProgramIndex > 0) node.scrollIntoView({ block: 'nearest' });
  }
}
function closeProgramPopup() {
  state.popupOpen = false;
  el('programPopup').hidden = true;
  el('programConnector').hidden = true;
  document.querySelector('.channels-panel')?.classList.remove('popup-visible');
  document.querySelector('.right-panel')?.classList.remove('popup-target-active');
  document.querySelectorAll('.programme-focus-item.popup-linked').forEach(node => node.classList.remove('popup-linked'));
}
function repositionProgramPopup() {
  if (!state.popupOpen || !state.guideOpen) return;
  const popup = el('programPopup');
  const panel = document.querySelector('.channels-panel');
  const target = programmeNodes()[state.focusedProgramIndex];
  if (!target || !panel) { closeProgramPopup(); return; }
  const panelRect = panel.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const height = popup.offsetHeight;
  const wantedY = targetRect.top + targetRect.height / 2 - panelRect.top;
  const popupTop = Math.max(9, Math.min(wantedY - Math.min(58, height / 2), Math.max(9, panelRect.height - height - 9)));
  popup.style.top = `${popupTop}px`;
  // The bridge is positioned in the layout, not inside the channel scroller:
  // it cannot create a horizontal scrollbar or stretch the popup.
  const connector = el('programConnector');
  const layout = document.querySelector('.guide-layout');
  const popupRect = popup.getBoundingClientRect();
  const itemRect = target.getBoundingClientRect();
  const layoutRect = layout.getBoundingClientRect();
  const midpoint = itemRect.top + itemRect.height / 2;
  const usableTop = popupRect.top + 16;
  const usableBottom = popupRect.bottom - 16;
  const width = itemRect.left - popupRect.right + 2;
  const canConnect = window.innerWidth > 850 && width > 0 && width < 140
    && midpoint >= usableTop && midpoint <= usableBottom;
  connector.hidden = !canConnect;
  if (canConnect) {
    connector.style.left = `${popupRect.right - layoutRect.left - 1}px`;
    connector.style.top = `${midpoint - layoutRect.top - 6}px`;
    connector.style.width = `${width}px`;
  }
}
function openProgramPopup() {
  const programme = selectedProgramme();
  if (!programme) { toast('Для этой передачи нет данных телегида'); return; }
  el('popupTag').textContent = state.focusedProgramIndex === 0 ? 'СЕЙЧАС В ЭФИРЕ' : 'ДАЛЕЕ В ЭФИРЕ';
  el('popupTitle').textContent = programme.title;
  el('popupTime').textContent = `${timeRange(programme)} · ${guideChannel()?.name || 'Телеканал'}`;
  el('popupDescription').textContent = programme.desc?.trim() || 'Описание передачи отсутствует в телегиде.';
  state.popupOpen = true;
  el('programPopup').hidden = false;
  document.querySelector('.channels-panel')?.classList.add('popup-visible');
  document.querySelector('.right-panel')?.classList.add('popup-target-active');
  updateProgramFocus();
  repositionProgramPopup();
}
function switchNavigationZone(zone) {
  if (zone === 'categories') { openCategoryMenu(); return; }
  if (state.menuOpen) closeCategoryMenu(false);
  if (state.navigationZone === zone) return;
  closeProgramPopup();
  state.navigationZone = zone;
  syncChannelFocus();
  if (zone === 'channels') {
    const options = visibleChannels();
    if (options.length) focusChannel(options.some(c => c.id === state.focusedId) ? state.focusedId : options[0].id);
    else el('channelList').focus({ preventScroll: true });
  } else {
    state.focusedProgramIndex = 0;
    updateProgramFocus(true);
  }
  if (zone !== 'programmes') updateProgramFocus();
  refreshMarquee();
}
function navigateGuide(key) {
  if (state.menuOpen) {
    if (key === 'ArrowLeft' || key === 'ArrowRight') { closeCategoryMenu(); return; }
    const delta = key === 'ArrowUp' ? -1 : 1;
    const all = [...categories(), SETTINGS_ITEM];
    const current = all.indexOf(state.focusedGroup);
    focusCategory(all[(current + delta + all.length) % all.length]);
    return;
  }
  if (key === 'ArrowLeft') {
    // Categories are on the left of the channel list.
    if (state.navigationZone === 'channels') openCategoryMenu();
    else switchNavigationZone('channels');
    return;
  }
  if (key === 'ArrowRight') {
    // Programme details are on the right of the channel list.
    if (state.navigationZone === 'channels') switchNavigationZone('programmes');
    else switchNavigationZone('channels');
    return;
  }
  const delta = key === 'ArrowUp' ? -1 : 1;
  if (state.navigationZone === 'channels') stepChannel(delta);
  else {
    closeProgramPopup();
    const count = programmeNodes().length;
    if (count) state.focusedProgramIndex = Math.max(0, Math.min(count - 1, state.focusedProgramIndex + delta));
    updateProgramFocus(true);
  }
}
function enterGuideSelection() {
  if (state.popupOpen) { closeProgramPopup(); updateProgramFocus(true); return; }
  if (state.menuOpen) {
    if (state.focusedGroup === SETTINGS_ITEM) { openFontSettings(); return; }
    setCategory(state.focusedGroup);
    closeCategoryMenu();
  } else if (state.navigationZone === 'channels') {
    activateChannel(state.channels.find(c => c.id === state.focusedId), true);
  } else openProgramPopup();
}

function wireEvents() {
  const diagPanel = el('diagnosticsPanel');
  function toggleDiagnostics(force) {
    diagPanel.hidden = typeof force === 'boolean' ? !force : !diagPanel.hidden;
    updateDiagnostics();
  }
  function toggleEPGPanel(force) {
    const panel = el('epgPanel');
    panel.hidden = typeof force === 'boolean' ? !force : !panel.hidden;
    if (!panel.hidden) { diagPanel.hidden = true; renderEPGPanel(); }
  }
  el('epgClose').addEventListener('click', () => toggleEPGPanel(false));
  el('epgReload').addEventListener('click', () => syncGuide(true));
  el('epgFileButton').addEventListener('click', () => el('epgFile').click());
  el('epgFile').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (file) importEPGFile(file);
    event.target.value = '';
  });
  el('diagnosticsGuide').addEventListener('click', () => toggleDiagnostics());
  el('closeDiagnostics').addEventListener('click', () => toggleDiagnostics(false));
  el('retryStream').addEventListener('click', () => { toggleDiagnostics(false); playChannel(activeChannel()); });
  el('tryAlternate').addEventListener('click', () => {
    const alt = alternateChannel();
    if (!alt) return;
    toggleDiagnostics(false);
    playChannel(alt);
    toast(`Пробуем другой поток: ${alt.name}`);
  });
  el('copyStreamUrl').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(activeChannel()?.url || ''); toast('Ссылка канала скопирована'); }
    catch (_) { toast('Не удалось скопировать ссылку. Выделите URL в окне диагностики.'); }
  });
  el('copyReport').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(playerReport()); toast('Отчёт скопирован (содержит адрес потока)'); }
    catch (_) { toast('Копирование недоступно: откройте страницу через localhost или HTTPS.'); }
  });
  el('previewSlot').addEventListener('click', () => setGuide(false));
  el('previewSlot').addEventListener('keydown', event => {
    if (event.target === el('previewSlot') && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      setGuide(false);
    }
  });
  el('favoriteButton').addEventListener('click', toggleFavorite);
  el('menuBackdrop').addEventListener('click', () => closeCategoryMenu());
  el('openSettings').addEventListener('click', () => { state.focusedGroup = SETTINGS_ITEM; openFontSettings(); });
  el('closeFontSettings').addEventListener('click', closeFontSettings);
  el('fontSettingsBackdrop').addEventListener('click', closeFontSettings);
  el('fontSizeForm').addEventListener('submit', event => {
    event.preventDefault();
    chooseFontSize(el('fontSizePx').value);
  });
  // Resize and pointer focus change the amount of visible text.
  if (window.ResizeObserver) new ResizeObserver(() => refreshChannelLayout()).observe(el('channelList'));
  window.addEventListener('resize', refreshChannelLayout);
  if (document.fonts?.ready) document.fonts.ready.then(refreshChannelLayout);
  el('channelList').addEventListener('pointerover', event => {
    const row = event.target.closest('.channel-row');
    if (!row || row.dataset.channelId === state.focusedId && state.navigationZone === 'channels') {
      refreshMarquee();
      return;
    }
    if (state.menuOpen || state.settingsOpen || !state.guideOpen) return;
    closeProgramPopup();
    state.navigationZone = 'channels';
    updateProgramFocus();
    focusChannel(row.dataset.channelId, false); // No player restart or scroll-jump.
    row.focus({ preventScroll: true }); // Avoid a second, stale :focus-visible ring.
  });
  el('channelList').addEventListener('pointerout', event => {
    if (event.target.closest('.channel-row')) requestAnimationFrame(refreshMarquee);
  });
  el('categoryList').addEventListener('scroll', syncCategoryConnection, { passive: true });
  window.addEventListener('resize', syncCategoryConnection);
  el('categoryList').addEventListener('click', event => {
    const button = event.target.closest('[data-group]');
    if (button) {
      state.navigationZone = 'categories';
      setCategory(button.dataset.group);
      closeCategoryMenu();
    }
  });
  el('channelList').addEventListener('click', event => {
    const row = event.target.closest('[data-channel-id]');
    if (row) {
      state.navigationZone = 'channels';
      focusChannel(row.dataset.channelId, false);
      activateChannel(state.channels.find(c => c.id === row.dataset.channelId));
    }
  });
  el('nowProgrammeItem').addEventListener('click', () => {
    const toggleOff = state.popupOpen && state.navigationZone === 'programmes' && state.focusedProgramIndex === 0;
    closeProgramPopup();
    state.navigationZone = 'programmes';
    state.focusedProgramIndex = 0;
    updateProgramFocus(true);
    if (!toggleOff) openProgramPopup();
  });
  el('programList').addEventListener('click', event => {
    const item = event.target.closest('[data-program-index]');
    if (!item) return;
    const sameItem = state.navigationZone === 'programmes' && state.focusedProgramIndex === Number(item.dataset.programIndex);
    const wasOpen = state.popupOpen;
    closeProgramPopup();
    state.navigationZone = 'programmes';
    state.focusedProgramIndex = Number(item.dataset.programIndex);
    updateProgramFocus(true);
    if (!(sameItem && wasOpen)) openProgramPopup();
  });
  window.addEventListener('resize', repositionProgramPopup);
  el('programList').addEventListener('scroll', repositionProgramPopup, { passive:true });
  el('programPopup').addEventListener('click', () => { closeProgramPopup(); updateProgramFocus(true); });
  el('centerPlay').addEventListener('click', () => {
    if (state.failed) { playChannel(activeChannel()); return; }
    video.muted = false;
    syncMuteButton();
    tryPlay();
  });
  // Fullscreen has no controls; tapping the picture can retry playback.
  el('fullscreenStage').addEventListener('click', () => {
    // A tap always shows the information immediately, even while buffering
    // or when autoplay was blocked by the browser.
    revealInfoBar();
    if (state.failed) playChannel(activeChannel());
    else if (video.paused) tryPlay();
  });
  video.addEventListener('resize', updateVideoQuality);
  video.addEventListener('playing', () => {
    state.playing = true; state.failed = false; state.lastError = null;
    clearTimeout(state.startupTimer);
    el('playerPlaceholder').hidden = true;
    el('centerPlay').hidden = true;
    playStatus('В эфире');
    updateVideoQuality();
    updateDiagnostics();
  });
  video.addEventListener('loadedmetadata', () => {
    updateVideoQuality();
    if (!state.hls && !state.failed) tryPlay(state.initialAutoplay);
  });
  video.addEventListener('waiting', () => { if (state.playing) playStatus('Буферизация…'); });
  video.addEventListener('error', () => {
    if (state.failed || !state.activeId) return;
    const code = video.error?.code;
    const reason = { 1: 'Воспроизведение остановлено браузером.',
      2: 'Сетевая ошибка загрузки видео.', 3: 'Ошибка декодирования видео.',
      4: 'Формат видео не поддерживается или источник недоступен.' }[code] || 'Не удалось открыть видеопоток.';
    // hls.js also emits its own detailed ERROR event; avoid masking that detail.
    if (state.hls && ![3, 4].includes(code)) return;
    recordIssue([3, 4].includes(code) ? 'codec' : 'network', reason,
      `HTMLMediaElement.error.code=${code || 'unknown'}`);
  });
  video.addEventListener('volumechange', syncMuteButton);
  document.addEventListener('keydown', event => {
    const target = event.target;
    const typing = target instanceof HTMLElement && (target.matches('input,textarea,select') || target.isContentEditable);
    if (event.key === 'Escape') {
      if (state.settingsOpen) { event.preventDefault(); closeFontSettings(); return; }
      if (state.menuOpen) { event.preventDefault(); closeCategoryMenu(); return; }
      if (state.popupOpen) { event.preventDefault(); closeProgramPopup(); updateProgramFocus(true); return; }
      if (!el('epgPanel').hidden) { event.preventDefault(); toggleEPGPanel(false); return; }
      if (!diagPanel.hidden) { event.preventDefault(); toggleDiagnostics(false); return; }
      event.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setGuide(!state.guideOpen);
      if (!state.guideOpen && typing) target.blur();
      return;
    }
    if (typing) return;
    if (state.settingsOpen) return;
    if (event.key.toLowerCase() === 'i') { toggleDiagnostics(); return; }
    if (event.key.toLowerCase() === 'g') { toggleEPGPanel(); return; }
    if (state.guideOpen && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(event.key)) {
      // All guide keys are handled once at document level; no accidental native button activation.
      event.preventDefault();
      if (event.key === 'Enter') enterGuideSelection();
      else navigateGuide(event.key);
      return;
    }
    if (!state.guideOpen && event.key === 'Enter') {
      event.preventDefault(); setGuide(true); return;
    }
    if (!state.guideOpen && ['ArrowUp','ArrowDown'].includes(event.key)) {
      event.preventDefault(); stepChannel(event.key === 'ArrowUp' ? 1 : -1);
      return;
    }
    if (event.key.toLowerCase() === 'm') { video.muted = !video.muted; syncMuteButton(); }
    if (event.key.toLowerCase() === 'f' && !state.guideOpen) {
      const operation = document.fullscreenElement ? document.exitFullscreen() : el('fullscreenStage').requestFullscreen();
      operation?.catch(() => toast('Не удалось включить полноэкранный режим браузера.'));
    }
  });
}
async function boot() {
  applyFontSize(state.fontPx);
  wireEvents();
  clockTick();
  syncMuteButton();
  const startupText = el('startupText');
  try {
    const playlistAddress = new URL(APP_CONFIG.playlistUrl, location.href).href;
    const response = await download(playlistAddress);
    const playlist = await response.text();
    state.channels = playlistItems(playlist, playlistAddress);
    if (!state.channels.length) throw new Error('Плейлист не содержит каналов.');
    const lastId = localStorage.getItem('aqua:lastChannelId');
    const lastUrl = localStorage.getItem('aqua:lastChannelUrl');
    const last = state.channels.find(c => c.id === lastId) || state.channels.find(c => c.url === lastUrl);
    const channel = last || state.channels[0];
    // Muted autoplay is permitted by most browsers. Audio can be enabled by the user.
    video.muted = true;
    syncMuteButton();
    playChannel(channel, true);
    el('startup').hidden = true;
    syncGuide();
  } catch (err) {
    startupText.textContent = err.message + ' Проверьте playlistUrl в config.js. При внешнем URL также проверьте CORS.';
    el('startup').querySelector('.startup-spinner').hidden = true;
    el('retryButton').hidden = false;
    el('retryButton').addEventListener('click', () => location.reload(), { once: true });
  }
}
setInterval(clockTick, 10_000);
setInterval(tickLiveEPG, 1_000);
// Refresh as long as the tab is open; an old/current-date-free guide is rechecked.
setInterval(() => { if (state.channels.length) syncGuide(); }, APP_CONFIG.epgCheckMinutes * 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.channels.length) { clockTick(); tickLiveEPG(); syncGuide(); }
});
boot();
