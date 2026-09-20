// Daybreak — air quality, UV, temperature and pollen for your city.
// Data: Open-Meteo (forecast + air-quality, no key required) and
// BigDataCloud (free reverse geocoding, no key required).

const $ = (sel) => document.querySelector(sel);

// Bumped to v2 when the cached shape changed (added 5-day trends + Celsius).
// A new key means any old saved reading is ignored instead of shown as-is.
const CACHE_KEY = 'daybreak_v2';
const FORECAST_DAYS = 5;

const WEATHER_CODE_MAP = {
  0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Foggy',
  51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  56: 'Freezing Drizzle', 57: 'Freezing Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  66: 'Freezing Rain', 67: 'Freezing Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
  80: 'Rain Showers', 81: 'Rain Showers', 82: 'Heavy Showers',
  85: 'Snow Showers', 86: 'Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm'
};

const ICON_CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.4 12.4l2.3 2.3L16 9.6"/></svg>';
const ICON_WARN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21 19.5H3L12 3.5Z"/><path d="M12 9.5v4.2M12 16.7h.01"/></svg>';

// ---------- Weather icons (by code group) ----------
function weatherGroup(code) {
  if (code === 0 || code === 1) return 'sun';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloud';
}
function weatherIconSvg(code, size) {
  const s = size || 26;
  const open = `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">`;
  const paths = {
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/>',
    partly: '<circle cx="8" cy="8" r="3"/><path d="M8 2.5v1.5M2.5 8h1.5M4.3 4.3l1 1M11.7 4.3l-1 1"/><path d="M9.5 15.5h7a3.2 3.2 0 0 0 .4-6.38A4.6 4.6 0 0 0 8.2 9.9"/>',
    cloud: '<path d="M7 18h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 9.6 3.5 3.5 0 0 0 7 18Z"/>',
    rain: '<path d="M7 15h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 6.6 3.5 3.5 0 0 0 7 15Z"/><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/>',
    snow: '<path d="M7 15h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 6.6 3.5 3.5 0 0 0 7 15Z"/><path d="M9 19h.01M12 20h.01M15 19h.01"/>',
    fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
    thunder: '<path d="M7 14h9.5a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 7.2 5.6 3.5 3.5 0 0 0 7 14Z"/><path d="M12 13l-2 3.5h3L11 20"/>'
  };
  return open + (paths[weatherGroup(code)] || paths.cloud) + '</svg>';
}

let lastAttempt = null;   // { lat, lon, name, source }
let activeTab = 'home';   // home | trends | settings
let appState = 'init';    // init | loading | error | permission | search | ready
let refreshing = false;
let latest = null;        // { cityName, data, days }

// ---------- Cache ----------
function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
}
function saveCache(obj) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch (e) { /* storage unavailable */ }
}

// ---------- Visibility ----------
function showEl(sel) { const el = $(sel); if (el) el.hidden = false; }
function hideEl(sel) { const el = $(sel); if (el) el.hidden = true; }

const PANELS = ['#content', '#trendsContent', '#settingsContent', '#loading', '#errorState', '#permissionCard', '#searchCard'];

// Single source of truth for what's on screen: hide everything, then show the
// one panel the current appState + activeTab call for. No panel can stack.
function render() {
  PANELS.forEach(hideEl);
  if (appState === 'loading') { showEl('#loading'); return; }
  if (appState === 'error') { showEl('#errorState'); return; }
  if (appState === 'permission') { showEl('#permissionCard'); return; }
  if (appState === 'search') { showEl('#searchCard'); return; }
  // ready
  if (activeTab === 'trends') showEl('#trendsContent');
  else if (activeTab === 'settings') showEl('#settingsContent');
  else showEl('#content');
}
function setState(s) { appState = s; render(); }
function setStale(isStale) { const el = $('#staleNote'); if (el) el.hidden = !isStale; }

function setRefreshing(on) {
  refreshing = on;
  const btn = $('#refreshBtn');
  if (btn) { btn.classList.toggle('spinning', on); btn.disabled = on; }
}

// ---------- Formatting ----------
function formatGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Still up?';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function formatDateline() {
  const now = new Date();
  const datePart = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const timePart = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

// ---------- Data fetching ----------
async function fetchForecast(lat, lon) {
  // No temperature_unit param — Open-Meteo defaults to Celsius.
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min,weather_code,uv_index_max` +
    `&timezone=auto&forecast_days=${FORECAST_DAYS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Forecast request failed');
  return res.json();
}

async function fetchAirQuality(lat, lon) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&hourly=us_aqi,grass_pollen,birch_pollen,ragweed_pollen&timezone=auto&forecast_days=${FORECAST_DAYS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Air quality request failed');
  return res.json();
}

async function reverseGeocode(lat, lon) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Reverse geocoding failed');
  const data = await res.json();
  return data.city || data.locality || data.principalSubdivision || 'Your area';
}

async function searchCity(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('City search failed');
  const data = await res.json();
  return data.results || [];
}

function findHourIndex(timesArr, targetIso) {
  if (!Array.isArray(timesArr) || !timesArr.length) return -1;
  const exact = timesArr.indexOf(targetIso);
  if (exact !== -1) return exact;
  const target = new Date(targetIso).getTime();
  let best = 0, bestDiff = Infinity;
  timesArr.forEach((t, i) => {
    const diff = Math.abs(new Date(t).getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  });
  return best;
}

// ---------- Classification ----------
function classifyAqi(v) {
  if (v === null || v === undefined || isNaN(v)) {
    return { value: '—', label: 'Unavailable', badge: 'grey', detail: 'Air quality data is unavailable right now.' };
  }
  const val = Math.round(v);
  let label, badge, note;
  if (val <= 50) { label = 'Good'; badge = 'green'; note = 'Air quality is satisfactory, posing little or no risk.'; }
  else if (val <= 100) { label = 'Moderate'; badge = 'yellow'; note = 'Acceptable, though a small risk for unusually sensitive people.'; }
  else if (val <= 150) { label = 'USG'; badge = 'orange'; note = 'Sensitive groups may experience health effects.'; }
  else if (val <= 200) { label = 'Unhealthy'; badge = 'red'; note = 'Everyone may begin to experience health effects.'; }
  else if (val <= 300) { label = 'Very Unhealthy'; badge = 'red'; note = 'Health alert — everyone may experience more serious effects.'; }
  else { label = 'Hazardous'; badge = 'red'; note = 'Health warning of emergency conditions.'; }
  return { value: val, label, badge, detail: `US AQI ${val}. ${note}` };
}

function uvAdvice(label) {
  switch (label) {
    case 'Low': return 'Minimal protection needed for most people.';
    case 'Moderate': return 'Seek shade during midday hours and wear sunscreen.';
    case 'High': return 'Reduce sun exposure between 10am and 4pm; wear SPF 30+.';
    case 'Very High':
    case 'Extreme': return 'Avoid the sun during midday — SPF 30+ and shade are strongly advised.';
    default: return '';
  }
}
function classifyUv(v) {
  if (v === null || v === undefined || isNaN(v)) {
    return { value: '—', label: 'Unavailable', badge: 'grey', detail: 'UV data is unavailable right now.' };
  }
  const val = Math.round(v);
  let label, badge;
  if (val <= 2) { label = 'Low'; badge = 'green'; }
  else if (val <= 5) { label = 'Moderate'; badge = 'yellow'; }
  else if (val <= 7) { label = 'High'; badge = 'orange'; }
  else if (val <= 10) { label = 'Very High'; badge = 'red'; }
  else { label = 'Extreme'; badge = 'red'; }
  return { value: val, label, badge, detail: `Peak UV index is ${val}. ${uvAdvice(label)}` };
}

function classifyPollen(maxVal, available, source) {
  if (!available) {
    return { value: '—', label: 'Unavailable', badge: 'grey', detail: 'Pollen forecasts currently cover Europe only — not available for this location.' };
  }
  let label, badge;
  if (maxVal < 10) { label = 'Low'; badge = 'green'; }
  else if (maxVal < 50) { label = 'Moderate'; badge = 'yellow'; }
  else if (maxVal < 150) { label = 'High'; badge = 'orange'; }
  else { label = 'Very High'; badge = 'red'; }
  const sourceLabel = source === 'tree' ? 'tree pollen' : source === 'ragweed' ? 'ragweed' : 'grass pollen';
  const riskNote = label === 'Low' ? 'Low risk for most allergy sufferers.' : 'Sensitive individuals may notice symptoms.';
  return { value: label, label, badge, detail: `Dominant source: ${sourceLabel}. ${riskNote}` };
}

const SEVERITY_RANK = { grey: 0, green: 1, yellow: 2, orange: 3, red: 4 };
function buildRecommendation(aqi, uv, pollen) {
  const worst = [aqi, uv, pollen].reduce((a, b) => (SEVERITY_RANK[b.badge] > SEVERITY_RANK[a.badge] ? b : a));
  if (worst.badge === 'red' && aqi.badge === 'red') {
    return { text: 'Air quality is poor today — consider a mask outside and limit exertion.', badge: 'red' };
  }
  if (worst.badge === 'red' && uv.badge === 'red') {
    return { text: 'UV is very high today — avoid the sun at midday and wear SPF 30+.', badge: 'red' };
  }
  if (worst.badge === 'red' && pollen.badge === 'red') {
    return { text: 'Pollen is very high today — sensitive allergy sufferers should limit time outside.', badge: 'red' };
  }
  if (worst.badge === 'orange') {
    return { text: 'Sensitive groups should take it easy outside today.', badge: 'orange' };
  }
  if (worst.badge === 'yellow') {
    return { text: 'Generally fine outside — a little extra care if you are sensitive.', badge: 'yellow' };
  }
  if (worst.badge === 'grey') {
    return { text: 'Some data is unavailable for this location right now.', badge: 'grey' };
  }
  return { text: 'Great conditions all around — enjoy your day outside.', badge: 'green' };
}

// Aggregate one calendar day's hourly air-quality into daily figures.
function aggregateAirForDate(air, date) {
  const times = (air.hourly && air.hourly.time) ? air.hourly.time : [];
  let aqiMax = null, anyAqi = false;
  let grassMax = 0, birchMax = 0, ragMax = 0, anyPollen = false;
  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(date)) continue;
    const a = air.hourly.us_aqi ? air.hourly.us_aqi[i] : null;
    if (a !== null && a !== undefined && !isNaN(a)) { anyAqi = true; if (aqiMax === null || a > aqiMax) aqiMax = a; }
    const g = air.hourly.grass_pollen ? air.hourly.grass_pollen[i] : null;
    const b = air.hourly.birch_pollen ? air.hourly.birch_pollen[i] : null;
    const r = air.hourly.ragweed_pollen ? air.hourly.ragweed_pollen[i] : null;
    if (g !== null && g !== undefined) { anyPollen = true; grassMax = Math.max(grassMax, g); }
    if (b !== null && b !== undefined) { anyPollen = true; birchMax = Math.max(birchMax, b); }
    if (r !== null && r !== undefined) { anyPollen = true; ragMax = Math.max(ragMax, r); }
  }
  let pollenSource = 'grass';
  if (birchMax >= grassMax && birchMax >= ragMax) pollenSource = 'tree';
  else if (ragMax >= grassMax && ragMax >= birchMax) pollenSource = 'ragweed';
  return {
    aqiMax: anyAqi ? aqiMax : null,
    pollenMax: anyPollen ? Math.max(grassMax, birchMax, ragMax) : null,
    pollenAvailable: anyPollen,
    pollenSource
  };
}

// ---------- View models ----------
function buildViewModel(forecast, air) {
  const temp = Math.round(forecast.current.temperature_2m);
  const unitSymbol = (forecast.current_units && forecast.current_units.temperature_2m) || '°C';
  const high = Math.round(forecast.daily.temperature_2m_max[0]);
  const low = Math.round(forecast.daily.temperature_2m_min[0]);
  const uvMax = forecast.daily.uv_index_max ? forecast.daily.uv_index_max[0] : null;
  const condition = WEATHER_CODE_MAP[forecast.current.weather_code] || 'Unknown';
  const code = forecast.current.weather_code;

  const idx = findHourIndex(air.hourly.time, forecast.current.time);
  const aqiVal = idx >= 0 && air.hourly.us_aqi ? air.hourly.us_aqi[idx] : null;

  const grass = idx >= 0 && air.hourly.grass_pollen ? air.hourly.grass_pollen[idx] : null;
  const birch = idx >= 0 && air.hourly.birch_pollen ? air.hourly.birch_pollen[idx] : null;
  const ragweed = idx >= 0 && air.hourly.ragweed_pollen ? air.hourly.ragweed_pollen[idx] : null;
  const pollenAvailable = [grass, birch, ragweed].some((v) => v !== null && v !== undefined);
  const pollenMax = pollenAvailable ? Math.max(grass || 0, birch || 0, ragweed || 0) : null;
  let pollenSource = 'grass';
  if (pollenAvailable) {
    if ((birch || 0) >= (grass || 0) && (birch || 0) >= (ragweed || 0)) pollenSource = 'tree';
    else if ((ragweed || 0) >= (grass || 0) && (ragweed || 0) >= (birch || 0)) pollenSource = 'ragweed';
  }

  const aqi = classifyAqi(aqiVal);
  const uv = classifyUv(uvMax);
  const pollen = classifyPollen(pollenMax, pollenAvailable, pollenSource);
  const recommendation = buildRecommendation(aqi, uv, pollen);

  return { temp, unitSymbol, high, low, condition, code, aqi, uv, pollen, recommendation };
}

function buildDays(forecast, air) {
  const days = [];
  const dTime = (forecast.daily && forecast.daily.time) ? forecast.daily.time : [];
  const n = Math.min(FORECAST_DAYS, dTime.length);
  for (let d = 0; d < n; d++) {
    const date = dTime[d];
    const high = Math.round(forecast.daily.temperature_2m_max[d]);
    const low = Math.round(forecast.daily.temperature_2m_min[d]);
    const code = forecast.daily.weather_code ? forecast.daily.weather_code[d] : null;
    const uv = classifyUv(forecast.daily.uv_index_max ? forecast.daily.uv_index_max[d] : null);
    const agg = aggregateAirForDate(air, date);
    const aqi = classifyAqi(agg.aqiMax);
    const pollen = classifyPollen(agg.pollenMax, agg.pollenAvailable, agg.pollenSource);
    days.push({ date, high, low, code, uv, aqi, pollen });
  }
  return days;
}

// ---------- Rendering ----------
function setMetric(key, info, subText) {
  $(`#${key}Sub`).textContent = subText;
  const badgeEl = $(`#${key}Badge`);
  badgeEl.textContent = info.label;
  badgeEl.className = 'mcard-badge badge-' + info.badge;
  $(`#${key}IconWrap`).className = 'mcard-icon badge-' + info.badge;
  $(`#${key}Detail`).textContent = info.detail;
}

function renderHome(cityName, data) {
  $('#cityName').textContent = cityName;
  $('#greeting').textContent = formatGreeting();
  $('#dateline').textContent = formatDateline();

  $('#temp').textContent = `${data.temp}${data.unitSymbol}`;
  $('#condition').textContent = data.condition;
  $('#hilo').innerHTML = `H:${data.high}°&nbsp;&nbsp;L:${data.low}°`;
  if (typeof data.code === 'number') $('#weatherIcon').innerHTML = weatherIconSvg(data.code, 26);

  setMetric('air', data.aqi, data.aqi.value === '—' ? 'AQI —' : `AQI ${data.aqi.value}`);
  setMetric('uv', data.uv, data.uv.value === '—' ? 'Index —' : `Index ${data.uv.value}`);
  setMetric('pollen', data.pollen, `Level ${data.pollen.value}`);

  const rec = data.recommendation;
  $('#recText').textContent = rec.text;
  $('#recommendation').className = 'recommendation badge-' + rec.badge;
  $('#recIcon').innerHTML = rec.badge === 'green' ? ICON_CHECK : ICON_WARN;
}

function dayLabel(dateStr, index) {
  if (index === 0) return 'Today';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}
function dayDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function makeChip(label, info) {
  const el = document.createElement('div');
  el.className = 'daychip badge-' + info.badge;
  el.textContent = `${label} ${info.value}`;
  return el;
}

function renderTrends(cityName, days) {
  $('#trendsCity').textContent = cityName;
  const list = $('#trendsList');
  list.innerHTML = '';

  if (!days || !days.length) {
    const empty = document.createElement('p');
    empty.className = 'trends-empty';
    empty.textContent = 'Forecast unavailable right now.';
    list.appendChild(empty);
    return;
  }

  days.forEach((day, i) => {
    const card = document.createElement('div');
    card.className = 'day-card';

    const top = document.createElement('div');
    top.className = 'day-top';

    const icon = document.createElement('div');
    icon.className = 'day-icon';
    icon.innerHTML = weatherIconSvg(day.code, 26);

    const labelWrap = document.createElement('div');
    labelWrap.className = 'day-label';
    const dname = document.createElement('div');
    dname.className = 'day-name';
    dname.textContent = dayLabel(day.date, i);
    const ddate = document.createElement('div');
    ddate.className = 'day-date';
    ddate.textContent = dayDate(day.date);
    labelWrap.appendChild(dname);
    labelWrap.appendChild(ddate);

    const temp = document.createElement('div');
    temp.className = 'day-temp';
    const hi = document.createElement('span');
    hi.className = 'day-hi';
    hi.textContent = `${day.high}°`;
    const lo = document.createElement('span');
    lo.className = 'day-lo';
    lo.textContent = `${day.low}°`;
    temp.appendChild(hi);
    temp.appendChild(lo);

    top.appendChild(icon);
    top.appendChild(labelWrap);
    top.appendChild(temp);

    const metrics = document.createElement('div');
    metrics.className = 'day-metrics';
    metrics.appendChild(makeChip('AQI', day.aqi));
    metrics.appendChild(makeChip('UV', day.uv));
    metrics.appendChild(makeChip('Pollen', day.pollen));

    card.appendChild(top);
    card.appendChild(metrics);
    list.appendChild(card);
  });
}

function renderData() {
  if (!latest) return;
  renderHome(latest.cityName, latest.data);
  renderTrends(latest.cityName, latest.days);
}

// ---------- Location flow ----------
async function loadForLocation(lat, lon, name, source, isRefresh) {
  lastAttempt = { lat, lon, name, source };
  if (isRefresh) {
    setRefreshing(true);
  } else if (!latest) {
    setState('loading');
  }

  try {
    const [forecast, air] = await Promise.all([
      fetchForecast(lat, lon),
      fetchAirQuality(lat, lon)
    ]);
    const data = buildViewModel(forecast, air);
    const days = buildDays(forecast, air);
    latest = { cityName: name, data, days };
    renderData();
    setStale(false);
    appState = 'ready';
    render();
    saveCache({ lat, lon, cityName: name, data, days, source, timestamp: Date.now() });
  } catch (err) {
    if (latest) {
      // Keep showing the data we have; just flag it as not-fresh.
      appState = 'ready';
      render();
      setStale(true);
    } else {
      setState('error');
    }
  } finally {
    if (isRefresh) setRefreshing(false);
  }
}

function tryGeolocation() {
  if (!('geolocation' in navigator)) {
    if (!latest) setState('permission');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      let name = 'Your area';
      try { name = await reverseGeocode(latitude, longitude); } catch (e) { /* keep fallback */ }
      await loadForLocation(latitude, longitude, name, 'geo');
    },
    () => {
      if (!latest) setState('permission');
      else { appState = 'ready'; render(); setStale(true); }
    },
    { timeout: 10000, maximumAge: 5 * 60 * 1000 }
  );
}

function refresh() {
  if (refreshing) return;
  if (lastAttempt) {
    loadForLocation(lastAttempt.lat, lastAttempt.lon, lastAttempt.name, lastAttempt.source, true);
  } else {
    init();
  }
}

// ---------- Search ----------
function renderSearchResults(results) {
  const ul = $('#citySearchResults');
  ul.innerHTML = '';
  results.forEach((r) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
    btn.addEventListener('click', () => {
      $('#citySearchInput').value = '';
      ul.innerHTML = '';
      loadForLocation(r.latitude, r.longitude, r.name, 'manual');
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}
function openSearch() { setState('search'); const inp = $('#citySearchInput'); if (inp) inp.focus(); }
function closeSearch() {
  $('#citySearchInput').value = '';
  $('#citySearchResults').innerHTML = '';
  if (latest) { appState = 'ready'; render(); }
  else setState('permission');
}

// ---------- Tabs ----------
function setActiveTab(tab) {
  activeTab = tab;
  ['tabHome', 'tabTrends', 'tabSettings'].forEach((id) => {
    $(`#${id}`).classList.toggle('active', id.toLowerCase() === 'tab' + tab);
  });
  if (appState === 'ready') render();
}

// ---------- Wiring ----------
function wireUi() {
  ['cardAir', 'cardUv', 'cardPollen'].forEach((id) => {
    $(`#${id}`).addEventListener('click', () => {
      const el = $(`#${id}`);
      const expanded = el.getAttribute('aria-expanded') === 'true';
      el.setAttribute('aria-expanded', String(!expanded));
    });
  });

  $('#tabHome').addEventListener('click', () => setActiveTab('home'));
  $('#tabTrends').addEventListener('click', () => setActiveTab('trends'));
  $('#tabSettings').addEventListener('click', () => setActiveTab('settings'));

  $('#refreshBtn').addEventListener('click', refresh);
  $('#cityButton').addEventListener('click', openSearch);
  $('#allowLocationBtn').addEventListener('click', () => { setState('loading'); tryGeolocation(); });
  $('#manualCityBtn').addEventListener('click', openSearch);
  $('#closeSearchBtn').addEventListener('click', closeSearch);

  let searchTimer;
  $('#citySearchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#citySearchResults').innerHTML = ''; return; }
    searchTimer = setTimeout(() => {
      searchCity(q).then(renderSearchResults).catch(() => {});
    }, 300);
  });

  $('#retryBtn').addEventListener('click', () => {
    if (lastAttempt) loadForLocation(lastAttempt.lat, lastAttempt.lon, lastAttempt.name, lastAttempt.source);
    else init();
  });

  window.addEventListener('online', () => {
    if (appState === 'error' && lastAttempt) {
      loadForLocation(lastAttempt.lat, lastAttempt.lon, lastAttempt.name, lastAttempt.source);
    }
  });
}

// ---------- Init ----------
async function init() {
  const cache = loadCache();
  if (cache && cache.data) {
    latest = { cityName: cache.cityName, data: cache.data, days: cache.days || [] };
    renderData();
    appState = 'ready';
    render();
    setStale(true);
  }
  // No cache: stay blank until a real request starts, so we never flash a
  // loading spinner or a "try again" button before we know a location.

  if (cache && cache.source === 'manual') {
    await loadForLocation(cache.lat, cache.lon, cache.cityName, 'manual');
  } else {
    tryGeolocation();
  }
}

wireUi();
init();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => { /* offline install optional */ });
  });
}
