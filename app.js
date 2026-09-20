// Daybreak — air quality, UV, temperature and pollen for your city.
// Data: Open-Meteo (forecast + air-quality, no key required) and
// BigDataCloud (free reverse geocoding, no key required).

const $ = (sel) => document.querySelector(sel);

const CACHE_KEY = 'daybreak_v1';

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

let lastAttempt = null; // { lat, lon, name, source }

// ---------- Cache ----------
function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
}
function saveCache(obj) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch (e) { /* storage unavailable */ }
}

// ---------- Visibility helpers ----------
function showEl(sel) { $(sel).hidden = false; }
function hideEl(sel) { $(sel).hidden = true; }

// Each show* function clears every other transient panel, so panels can
// never stack on top of one another regardless of call order.
function showLoading(message) {
  if (message) $('#loading p').textContent = message;
  showEl('#loading');
  hideEl('#errorState');
  hideEl('#permissionCard');
  hideEl('#searchCard');
}
function hideLoading() { hideEl('#loading'); }
function showContent() { showEl('#content'); hideEl('#loading'); hideEl('#errorState'); }
function showPermissionCard() {
  showEl('#permissionCard');
  hideEl('#searchCard');
  hideEl('#loading');
  hideEl('#errorState');
}
function hidePermissionCard() { hideEl('#permissionCard'); }
function showSearchCard() {
  showEl('#searchCard');
  hideEl('#permissionCard');
  hideEl('#loading');
  hideEl('#errorState');
  $('#citySearchInput').focus();
}
function hideSearchCard() {
  hideEl('#searchCard');
  $('#citySearchResults').innerHTML = '';
  $('#citySearchInput').value = '';
}
function showError(message) {
  $('#errorText').textContent = message;
  showEl('#errorState');
  hideEl('#loading');
  hideEl('#permissionCard');
  hideEl('#searchCard');
}
function hideError() { hideEl('#errorState'); }
function setStale(isStale) { $('#staleNote').hidden = !isStale; }

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
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,uv_index_max` +
    `&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Forecast request failed');
  return res.json();
}

async function fetchAirQuality(lat, lon) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    `&hourly=us_aqi,grass_pollen,birch_pollen,ragweed_pollen&timezone=auto`;
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
  return { value: val, label, badge, detail: `Today's peak UV index is ${val}. ${uvAdvice(label)}` };
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
  const riskNote = label === 'Low' ? 'Low risk for most allergy sufferers.' : 'Sensitive individuals may notice symptoms today.';
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

function buildViewModel(forecast, air) {
  const temp = Math.round(forecast.current.temperature_2m);
  const unitSymbol = (forecast.current_units && forecast.current_units.temperature_2m) || '°C';
  const high = Math.round(forecast.daily.temperature_2m_max[0]);
  const low = Math.round(forecast.daily.temperature_2m_min[0]);
  const uvMax = forecast.daily.uv_index_max ? forecast.daily.uv_index_max[0] : null;
  const condition = WEATHER_CODE_MAP[forecast.current.weather_code] || 'Unknown';

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

  return { temp, unitSymbol, high, low, condition, aqi, uv, pollen, recommendation };
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

function renderAll(cityName, data) {
  $('#cityName').textContent = cityName;
  $('#greeting').textContent = formatGreeting();
  $('#dateline').textContent = formatDateline();

  $('#temp').textContent = `${data.temp}${data.unitSymbol}`;
  $('#condition').textContent = data.condition;
  $('#hilo').innerHTML = `H:${data.high}°&nbsp;&nbsp;L:${data.low}°`;

  setMetric('air', data.aqi, data.aqi.value === '—' ? 'AQI —' : `AQI ${data.aqi.value}`);
  setMetric('uv', data.uv, data.uv.value === '—' ? 'Index —' : `Index ${data.uv.value}`);
  setMetric('pollen', data.pollen, `Level ${data.pollen.value}`);

  const rec = data.recommendation;
  $('#recText').textContent = rec.text;
  $('#recommendation').className = 'recommendation badge-' + rec.badge;
  $('#recIcon').innerHTML = rec.badge === 'green' ? ICON_CHECK : ICON_WARN;
}

// ---------- Location flow ----------
async function loadForLocation(lat, lon, name, source) {
  lastAttempt = { lat, lon, name, source };
  hidePermissionCard();
  hideSearchCard();
  hideError();
  if (!loadCache()) showLoading();

  try {
    const [forecast, air] = await Promise.all([
      fetchForecast(lat, lon),
      fetchAirQuality(lat, lon)
    ]);
    const data = buildViewModel(forecast, air);
    renderAll(name, data);
    showContent();
    setStale(false);
    saveCache({ lat, lon, cityName: name, data, source, timestamp: Date.now() });
  } catch (err) {
    const cache = loadCache();
    if (cache) {
      hideLoading();
      showContent();
      setStale(true);
    } else {
      showError("Couldn't load today's conditions. Check your connection and try again.");
    }
  }
}

function tryGeolocation() {
  if (!('geolocation' in navigator)) {
    if (!loadCache()) showPermissionCard();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      let name = 'Your area';
      try { name = await reverseGeocode(latitude, longitude); } catch (e) { /* keep fallback name */ }
      await loadForLocation(latitude, longitude, name, 'geo');
    },
    () => {
      if (!loadCache()) showPermissionCard();
      else { hideLoading(); showContent(); setStale(true); }
    },
    { timeout: 10000, maximumAge: 5 * 60 * 1000 }
  );
}

function renderSearchResults(results) {
  const ul = $('#citySearchResults');
  ul.innerHTML = '';
  results.forEach((r) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
    btn.addEventListener('click', () => {
      loadForLocation(r.latitude, r.longitude, r.name, 'manual');
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
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

  const tabs = { tabHome: $('#tabHome'), tabTrends: $('#tabTrends'), tabSettings: $('#tabSettings') };
  Object.values(tabs).forEach((btn) => {
    btn.addEventListener('click', () => {
      Object.values(tabs).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  $('#cityButton').addEventListener('click', showSearchCard);
  $('#allowLocationBtn').addEventListener('click', () => { showLoading(); tryGeolocation(); });
  $('#manualCityBtn').addEventListener('click', showSearchCard);
  $('#closeSearchBtn').addEventListener('click', () => {
    hideSearchCard();
    if (!loadCache()) showPermissionCard();
  });

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
    hideError();
    if (lastAttempt) loadForLocation(lastAttempt.lat, lastAttempt.lon, lastAttempt.name, lastAttempt.source);
    else init();
  });

  window.addEventListener('online', () => {
    if (lastAttempt && $('#errorState') && !$('#errorState').hidden) {
      loadForLocation(lastAttempt.lat, lastAttempt.lon, lastAttempt.name, lastAttempt.source);
    }
  });
}

// ---------- Init ----------
async function init() {
  const cache = loadCache();
  if (cache) {
    renderAll(cache.cityName, cache.data);
    showContent();
    setStale(true);
  }
  // No cache yet: stay blank rather than flashing a loading spinner —
  // we don't show "fetching" or "try again" UI until we actually know
  // a location and have started a real request for it (see tryGeolocation
  // and loadForLocation below).

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
