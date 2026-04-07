/* ═══════════════════════════════════════════════════════════════════════════
   Walletim — app.js
   Personal digital voucher wallet. Single-file vanilla JS, no dependencies.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ─── A. Constants ───────────────────────────────────────────────────────── */

const LS_CARDS       = 'walletim_cards';
const LS_SYNC        = 'walletim_sync';
const GIST_API       = 'https://api.github.com/gists';
const GIST_FILENAME  = 'walletim.json';
const SYNC_DEBOUNCE  = 2000; // ms

/* ─── B. State ───────────────────────────────────────────────────────────── */

const state = {
  cards:      [],
  sync:       { pat: '', gistId: '', lastSynced: null },
  route:      { screen: 'list', param: null },
  syncStatus: 'idle',
  syncTimer:  null,
};

/* ─── C. Storage Layer ───────────────────────────────────────────────────── */

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_CARDS);
    state.cards = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(state.cards)) state.cards = [];
  } catch {
    state.cards = [];
  }
  try {
    const raw = localStorage.getItem(LS_SYNC);
    const s   = raw ? JSON.parse(raw) : {};
    state.sync = {
      pat:        s.pat        || '',
      gistId:     s.gistId     || '',
      lastSynced: s.lastSynced || null,
    };
  } catch {
    state.sync = { pat: '', gistId: '', lastSynced: null };
  }
}

function persistCards() {
  localStorage.setItem(LS_CARDS, JSON.stringify(state.cards));
}

function persistSync() {
  localStorage.setItem(LS_SYNC, JSON.stringify(state.sync));
}

/* ─── D. Router ──────────────────────────────────────────────────────────── */

const SCREENS = {
  list:     () => document.getElementById('screen-list'),
  detail:   () => document.getElementById('screen-detail'),
  form:     () => document.getElementById('screen-form'),
  settings: () => document.getElementById('screen-settings'),
};

function parseRoute(hash) {
  const h = (hash || '').replace(/^#/, '').trim();
  if (h.startsWith('card/'))  return { screen: 'detail',   param: h.slice(5)  };
  if (h.startsWith('edit/'))  return { screen: 'form',     param: h.slice(5)  };
  if (h === 'add')            return { screen: 'form',     param: null        };
  if (h === 'settings')       return { screen: 'settings', param: null        };
  return                             { screen: 'list',     param: null        };
}

function navigate(route) {
  window.location.hash = route;
}

function handleRoute() {
  const r = parseRoute(window.location.hash);
  state.route = r;

  Object.values(SCREENS).forEach(fn => { fn().hidden = true; });

  switch (r.screen) {
    case 'list':     renderList();         SCREENS.list().hidden     = false; break;
    case 'detail':   renderDetail(r.param); SCREENS.detail().hidden   = false; break;
    case 'form':     renderForm(r.param);   SCREENS.form().hidden     = false; break;
    case 'settings': renderSettings();      SCREENS.settings().hidden = false; break;
  }
}

window.addEventListener('hashchange', handleRoute);

/* ─── E. UI Helpers ──────────────────────────────────────────────────────── */

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatCardNumber(raw) {
  const digits = String(raw).replace(/\D/g, '');
  return digits.match(/.{1,4}/g)?.join(' ') || digits;
}

function formatBalance(amount) {
  const n = parseFloat(amount);
  if (isNaN(n)) return '₪0.00';
  return '₪' + n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function maskCardNumber(formatted) {
  // Keep last 4 visible: "**** **** **** 3456"
  const parts = formatted.split(' ');
  return parts.map((p, i) => i === parts.length - 1 ? p : p.replace(/./g, '•')).join(' ');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function copyToClipboard(text, btn) {
  const originalText = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for older iOS Safari
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
  btn.textContent = 'הועתק!';
  btn.classList.add('copied');
  setTimeout(() => {
    btn.textContent = originalText;
    btn.classList.remove('copied');
  }, 1500);
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function setSyncStatus(status, message) {
  state.syncStatus = status;
  const indicator = document.getElementById('sync-indicator');
  const statusText = document.getElementById('sync-status-text');
  if (indicator) {
    indicator.className = `sync-indicator ${status}`;
    indicator.title     = message || '';
    indicator.textContent = message || '';
  }
  if (statusText) statusText.textContent = message || '';
}

/* ─── F. Card List Screen ────────────────────────────────────────────────── */

function renderList() {
  const list  = document.getElementById('card-list');
  const empty = document.getElementById('empty-state');

  list.innerHTML = '';

  if (state.cards.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const sorted = [...state.cards].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );

  sorted.forEach(card => {
    const li = document.createElement('li');
    li.className = 'card-list-item';
    li.setAttribute('role', 'listitem');

    const formatted = formatCardNumber(card.cardNumber);
    const masked    = maskCardNumber(formatted);

    li.innerHTML = `
      <div class="card-list-left">
        <div class="card-list-brand">${escapeHtml(card.brandName)}</div>
        <div class="card-list-masked">${escapeHtml(masked)}</div>
      </div>
      <div class="balance-chip">${escapeHtml(formatBalance(card.balance))}</div>
    `;

    li.addEventListener('click', () => navigate(`#card/${card.id}`));
    list.appendChild(li);
  });
}

/* ─── G. Card Detail Screen ──────────────────────────────────────────────── */

function renderDetail(id) {
  const card = state.cards.find(c => c.id === id);
  if (!card) { navigate('#list'); return; }

  const screen = document.getElementById('screen-detail');
  screen.dataset.cardId = id;

  document.getElementById('detail-brand').textContent = card.brandName;
  document.getElementById('vc-brand').textContent     = card.brandName;

  const formatted = formatCardNumber(card.cardNumber);
  document.getElementById('vc-number').textContent  = formatted;
  document.getElementById('vc-expiry').textContent  = card.expiry;
  document.getElementById('vc-cvv').textContent     = card.cvv;
  document.getElementById('vc-balance-display').textContent = formatBalance(card.balance);
  document.getElementById('balance-input').value    = card.balance;

  const meta = document.getElementById('detail-meta');
  meta.innerHTML = '';

  if (card.notes && card.notes.trim()) {
    const p = document.createElement('p');
    p.textContent = card.notes;
    meta.appendChild(p);
  }

  if (card.link && card.link.trim()) {
    const a = document.createElement('a');
    a.href        = card.link;
    a.textContent = card.link;
    a.target      = '_blank';
    a.rel         = 'noopener noreferrer';
    meta.appendChild(a);
  }
}

/* ─── H. Add / Edit Form Screen ─────────────────────────────────────────── */

function renderForm(id) {
  const isEdit = !!id;
  document.getElementById('form-title').textContent = isEdit ? 'ערוך שובר' : 'הוסף שובר';

  const form = document.getElementById('card-form');
  form.dataset.editId = id || '';

  // Clear errors
  document.querySelectorAll('.form-error').forEach(el => el.textContent = '');
  document.querySelectorAll('.form-group input, .form-group textarea')
    .forEach(el => el.classList.remove('error'));

  if (isEdit) {
    const card = state.cards.find(c => c.id === id);
    if (!card) { navigate('#list'); return; }
    document.getElementById('f-brand').value   = card.brandName;
    document.getElementById('f-number').value  = formatCardNumber(card.cardNumber);
    document.getElementById('f-expiry').value  = card.expiry;
    document.getElementById('f-cvv').value     = card.cvv;
    document.getElementById('f-balance').value = card.balance;
    document.getElementById('f-notes').value   = card.notes || '';
    document.getElementById('f-link').value    = card.link  || '';
  } else {
    form.reset();
  }
}

function autoFormatCardNumber() {
  const input = document.getElementById('f-number');
  const raw   = input.value.replace(/\D/g, '').slice(0, 19);
  input.value = raw.match(/.{1,4}/g)?.join(' ') || raw;
}

function autoFormatExpiry() {
  const input = document.getElementById('f-expiry');
  let v = input.value.replace(/\D/g, '').slice(0, 4);
  if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
  input.value = v;
}

function handleFormSubmit(e) {
  e.preventDefault();

  const brand   = document.getElementById('f-brand').value.trim();
  const number  = document.getElementById('f-number').value.replace(/\s/g, '');
  const expiry  = document.getElementById('f-expiry').value.trim();
  const cvv     = document.getElementById('f-cvv').value.trim();
  const balance = parseFloat(document.getElementById('f-balance').value);
  const notes   = document.getElementById('f-notes').value.trim();
  const link    = document.getElementById('f-link').value.trim();

  let valid = true;

  function setError(fieldId, errId, msg) {
    if (msg) {
      document.getElementById(fieldId).classList.add('error');
      document.getElementById(errId).textContent = msg;
      valid = false;
    } else {
      document.getElementById(fieldId).classList.remove('error');
      document.getElementById(errId).textContent = '';
    }
  }

  setError('f-brand',   'err-brand',   !brand ? 'נדרש שם מותג' : '');
  setError('f-number',  'err-number',  number.length < 8 ? 'מספר כרטיס לא תקין (מינימום 8 ספרות)' : '');
  setError('f-expiry',  'err-expiry',  !/^\d{2}\/\d{2}$/.test(expiry) ? 'פורמט לא תקין (MM/YY)' : '');
  setError('f-cvv',     'err-cvv',     cvv.length < 3 ? 'CVV לא תקין (3-4 ספרות)' : '');
  setError('f-balance', 'err-balance', isNaN(balance) || balance < 0 ? 'יתרה לא תקינה' : '');

  if (!valid) return;

  const now    = new Date().toISOString();
  const editId = document.getElementById('card-form').dataset.editId;

  if (editId) {
    const card = state.cards.find(c => c.id === editId);
    if (card) {
      card.brandName   = brand;
      card.cardNumber  = number;
      card.expiry      = expiry;
      card.cvv         = cvv;
      card.balance     = balance;
      card.notes       = notes;
      card.link        = link;
      card.updatedAt   = now;
    }
    persistCards();
    navigate(`#card/${editId}`);
  } else {
    const newCard = {
      id:         generateId(),
      brandName:  brand,
      cardNumber: number,
      expiry,
      cvv,
      balance,
      notes,
      link,
      createdAt:  now,
      updatedAt:  now,
    };
    state.cards.push(newCard);
    persistCards();
    navigate('#list');
  }

  scheduleSyncDebounce();
}

/* ─── I. Settings Screen ─────────────────────────────────────────────────── */

function renderSettings() {
  document.getElementById('s-pat').value     = state.sync.pat;
  document.getElementById('s-gist-id').value = state.sync.gistId || '';

  const statusText = document.getElementById('sync-status-text');
  if (state.sync.lastSynced) {
    const d = new Date(state.sync.lastSynced);
    statusText.textContent = `סונכרן לאחרונה: ${d.toLocaleString('he-IL')}`;
  } else {
    statusText.textContent = 'לא סונכרן עדיין';
  }
}

function exportJSON() {
  const data     = JSON.stringify(state.cards, null, 2);
  const blob     = new Blob([data], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const ts       = new Date().toISOString().slice(0, 10);
  const a        = document.createElement('a');
  a.href         = url;
  a.download     = `walletim-backup-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('הנתונים יוצאו בהצלחה');
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const parsed = JSON.parse(ev.target.result);
      if (!Array.isArray(parsed)) throw new Error('לא מערך');

      const valid = parsed.filter(item =>
        item && typeof item === 'object' &&
        item.id && item.brandName && item.cardNumber
      );

      if (valid.length === 0) {
        showToast('לא נמצאו שוברים תקינים בקובץ');
        return;
      }

      mergeCards(valid);
      persistCards();
      if (state.route.screen === 'list') renderList();
      showToast(`יובאו ${valid.length} שוברים בהצלחה`);
      scheduleSyncDebounce();
    } catch {
      showToast('שגיאה: קובץ לא תקין');
    }
    // Reset file input so same file can be re-imported
    e.target.value = '';
  };
  reader.readAsText(file);
}

/* ─── J. Sync Engine (GitHub Gist) ──────────────────────────────────────── */

function gistHeaders() {
  return {
    'Authorization':        `token ${state.sync.pat}`,
    'Accept':               'application/vnd.github+json',
    'Content-Type':         'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function scheduleSyncDebounce() {
  if (!state.sync.pat) return;
  clearTimeout(state.syncTimer);
  setSyncStatus('syncing', 'שומר...');
  state.syncTimer = setTimeout(syncToGist, SYNC_DEBOUNCE);
}

async function syncToGist() {
  if (!state.sync.pat) return;
  setSyncStatus('syncing', 'מסנכרן...');

  try {
    const content = JSON.stringify(state.cards);
    const body = {
      description: 'Walletim — personal voucher wallet data',
      files: { [GIST_FILENAME]: { content } },
    };

    let response;

    if (state.sync.gistId) {
      response = await fetch(`${GIST_API}/${state.sync.gistId}`, {
        method:  'PATCH',
        headers: gistHeaders(),
        body:    JSON.stringify(body),
      });

      // Gist was deleted on GitHub — re-create
      if (response.status === 404) {
        state.sync.gistId = '';
        persistSync();
        return syncToGist();
      }
    } else {
      body.public = false;
      response = await fetch(GIST_API, {
        method:  'POST',
        headers: gistHeaders(),
        body:    JSON.stringify(body),
      });
    }

    if (response.status === 401) {
      setSyncStatus('error', 'טוקן לא תקין — בדוק הגדרות');
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data           = await response.json();
    state.sync.gistId    = data.id;
    state.sync.lastSynced = new Date().toISOString();
    persistSync();

    const now = new Date().toLocaleTimeString('he-IL');
    setSyncStatus('synced', `סונכרן ב-${now}`);

    // Update settings screen if it's visible
    if (state.route.screen === 'settings') renderSettings();

  } catch (err) {
    setSyncStatus('error', `שגיאת סנכרון: ${err.message}`);
  }
}

async function fetchAndMerge() {
  if (!state.sync.pat || !state.sync.gistId) return;

  try {
    const response = await fetch(`${GIST_API}/${state.sync.gistId}`, {
      headers: gistHeaders(),
    });

    if (response.status === 404) {
      // Gist deleted — wipe gistId, will re-create on next write
      state.sync.gistId = '';
      persistSync();
      return;
    }
    if (!response.ok) return;

    const data    = await response.json();
    const rawFile = data.files?.[GIST_FILENAME]?.content;
    if (!rawFile) return;

    const remote = JSON.parse(rawFile);
    if (!Array.isArray(remote)) return;

    const hadChanges = mergeCards(remote);
    if (hadChanges) {
      persistCards();
      if (state.route.screen === 'list') renderList();
    }

    const now = new Date().toLocaleTimeString('he-IL');
    setSyncStatus('synced', `סונכרן ב-${now}`);
    state.sync.lastSynced = new Date().toISOString();
    persistSync();

  } catch {
    // Silent fail for background fetch — user isn't waiting for this
  }
}

function mergeCards(remoteCards) {
  let changed = false;
  const localMap = new Map(state.cards.map(c => [c.id, c]));

  remoteCards.forEach(remote => {
    if (!remote || !remote.id) return;

    const local = localMap.get(remote.id);
    if (!local) {
      state.cards.push(remote);
      changed = true;
    } else {
      const remoteNewer = new Date(remote.updatedAt) > new Date(local.updatedAt);
      if (remoteNewer) {
        Object.assign(local, remote);
        changed = true;
      }
    }
  });

  return changed;
}

/* ─── K. Event Wiring ────────────────────────────────────────────────────── */

function wireEvents() {

  // ── Navigation ──────────────────────────────────────────
  document.getElementById('btn-settings').addEventListener('click', () => navigate('#settings'));
  document.getElementById('btn-add').addEventListener('click',      () => navigate('#add'));

  document.getElementById('btn-detail-back').addEventListener('click', () => navigate('#list'));
  document.getElementById('btn-detail-edit').addEventListener('click', () => {
    navigate(`#edit/${state.route.param}`);
  });

  document.getElementById('btn-form-back').addEventListener('click', () => {
    // Go back to where we came from
    const editId = document.getElementById('card-form').dataset.editId;
    navigate(editId ? `#card/${editId}` : '#list');
  });

  document.getElementById('btn-settings-back').addEventListener('click', () => navigate('#list'));

  // ── Copy buttons (event delegation on detail screen) ────
  document.getElementById('screen-detail').addEventListener('click', async e => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) return;

    const id   = document.getElementById('screen-detail').dataset.cardId;
    const card = state.cards.find(c => c.id === id);
    if (!card) return;

    const field = btn.dataset.copy;
    let text;
    if (field === 'number') text = formatCardNumber(card.cardNumber);
    else if (field === 'expiry') text = card.expiry;
    else if (field === 'cvv')    text = card.cvv;

    if (text) await copyToClipboard(text, btn);
  });

  // ── Balance save ─────────────────────────────────────────
  document.getElementById('btn-save-balance').addEventListener('click', () => {
    const id   = document.getElementById('screen-detail').dataset.cardId;
    const card = state.cards.find(c => c.id === id);
    if (!card) return;

    const val = parseFloat(document.getElementById('balance-input').value);
    if (isNaN(val) || val < 0) { showToast('יתרה לא תקינה'); return; }

    card.balance   = val;
    card.updatedAt = new Date().toISOString();
    persistCards();

    document.getElementById('vc-balance-display').textContent = formatBalance(card.balance);
    showToast('היתרה עודכנה');
    scheduleSyncDebounce();
  });

  // ── Delete ───────────────────────────────────────────────
  document.getElementById('btn-delete').addEventListener('click', () => {
    const id   = document.getElementById('screen-detail').dataset.cardId;
    const card = state.cards.find(c => c.id === id);
    if (!card) return;
    if (!confirm(`למחוק את השובר "${card.brandName}"? פעולה זו לא ניתנת לביטול.`)) return;
    state.cards = state.cards.filter(c => c.id !== id);
    persistCards();
    navigate('#list');
    scheduleSyncDebounce();
  });

  // ── Auto-format inputs ───────────────────────────────────
  document.getElementById('f-number').addEventListener('input', autoFormatCardNumber);
  document.getElementById('f-expiry').addEventListener('input', autoFormatExpiry);

  // ── Form submit ──────────────────────────────────────────
  document.getElementById('card-form').addEventListener('submit', handleFormSubmit);

  // ── Settings: save & sync ────────────────────────────────
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const pat = document.getElementById('s-pat').value.trim();
    if (!pat) { showToast('נדרש Personal Access Token'); return; }
    state.sync.pat = pat;
    persistSync();
    syncToGist();
    showToast('הגדרות נשמרו, מתחיל סנכרון...');
  });

  document.getElementById('btn-sync-now').addEventListener('click', () => {
    if (!state.sync.pat) { showToast('הגדר Personal Access Token תחילה'); return; }
    syncToGist();
  });

  // ── Export / Import ──────────────────────────────────────
  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', importJSON);

  // ── Clear all ────────────────────────────────────────────
  document.getElementById('btn-clear-all').addEventListener('click', () => {
    if (!confirm('למחוק את כל השוברים? פעולה זו לא ניתנת לביטול.')) return;
    state.cards = [];
    persistCards();
    showToast('כל הנתונים נמחקו');
    navigate('#list');
    scheduleSyncDebounce();
  });
}

/* ─── L. Bootstrap ───────────────────────────────────────────────────────── */

function init() {
  loadFromStorage();
  wireEvents();
  handleRoute();      // Render immediately from localStorage — zero flicker
  fetchAndMerge();    // Background sync — non-blocking

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // SW registration failure is non-fatal
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
