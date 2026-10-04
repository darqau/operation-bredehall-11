const API = '';

/** Relative URL for HA Ingress (base href) and direct port access. */
function relUrl(path) {
  return path.startsWith('/') ? path.slice(1) : path;
}
const CATEGORIES = ['VVS','Trädgård','Ekonomi','Administration','Hus','El','Värme','Annat'];
const FREQUENCIES = ['En gång','Månatlig','Kvartalsvis','Varannan termin','Årlig','Vart 2:a år','Vart 3:e år','Vart 5:e år','Vid behov'];

// Harmonized finance category colors (sync with categorizer.py CATEGORIES)
const FINANCE_CATEGORY_COLORS = {
  'Lön': '#34d399',
  'Bidrag': '#2dd4bf',
  'Ränta/Avkastning': '#10b981',
  'Inkomst (Swish)': '#4ade80',
  'Övrig inkomst': '#6ee7b7',
  'Livsmedel': '#fb923c',
  'Restaurang & Uteät': '#f97316',
  'Systembolaget': '#be123c',
  'Boende & Drift': '#60a5fa',
  'Boende (el)': '#facc15',
  'Hushållstjänster': '#38bdf8',
  'Försäkring': '#818cf8',
  'Skönhet & Tjänster': '#f472b6',
  'Hälsa & Sjukvård': '#fb7185',
  'Träning': '#a78bfa',
  'Shopping & Kläder': '#e879f9',
  'Hem & Fritid': '#22d3ee',
  'Husdjur': '#d4a574',
  'Streaming & Media': '#c084fc',
  'Resor & Semester': '#06b6d4',
  'Kollektivtrafik & Taxi': '#a3e635',
  'Bil & Transport': '#fbbf24',
  'Mobil & Bredband': '#3b82f6',
  'Bankavgifter': '#94a3b8',
  'Sparande': '#eab308',
  'Barn': '#fda4af',
  'Donationer': '#c4b5fd',
  'Swish (privat)': '#5eead4',
  'CSN (Återbetalning)': '#f87171',
  'Bostadsköp (engång)': '#2563eb',
  'Överföring': '#64748b',
  'Övrigt': '#9ca3af',
};
const FINANCE_CATEGORY_FALLBACK = '#94a3b8';
const FINANCE_INCOME_CATEGORIES = new Set([
  'Lön', 'Bidrag', 'Ränta/Avkastning', 'Inkomst (Swish)', 'Övrig inkomst',
]);

const COMPARE_ALL_INCOME = '__all_income__';
const COMPARE_ALL_EXPENSE = '';

function compareFlowType(category) {
  if (!category || category === COMPARE_ALL_EXPENSE) return 'expense';
  if (category === COMPARE_ALL_INCOME) return 'income';
  return FINANCE_INCOME_CATEGORIES.has(category) ? 'income' : 'expense';
}

function compareCategoryParam(category) {
  if (category === COMPARE_ALL_INCOME) {
    return [...FINANCE_INCOME_CATEGORIES].join(',');
  }
  return category || '';
}

function appendCategoryQueryParams(p, catParam) {
  if (!catParam) return;
  if (catParam.includes(',')) p.set('categories', catParam);
  else p.set('category', catParam);
}

/** Category + flow for transaction list — compare dropdown, with sidebar fallback when "alla". */
function resolveTxnCategoryFilter(f) {
  const compareRaw = $('#fin-compare-categories')?.value ?? state.compareView.activeCategory ?? '';
  if (compareRaw === COMPARE_ALL_INCOME) {
    return { catParam: compareCategoryParam(COMPARE_ALL_INCOME), flow: 'income', compareRaw };
  }
  if (!compareRaw || compareRaw === COMPARE_ALL_EXPENSE) {
    const sidebar = (f?.category || '').trim();
    if (sidebar) {
      return {
        catParam: sidebar,
        flow: FINANCE_INCOME_CATEGORIES.has(sidebar) ? 'income' : 'expense',
        compareRaw,
      };
    }
    return { catParam: '', flow: 'expense', compareRaw };
  }
  return { catParam: compareRaw, flow: compareFlowType(compareRaw), compareRaw };
}

function financeCategoryHex(name) {
  return FINANCE_CATEGORY_COLORS[name] || FINANCE_CATEGORY_FALLBACK;
}

function hexToRgba(hex, alpha) {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return `rgba(148,163,184,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function financeCategoryBadge(category) {
  const hex = financeCategoryHex(category);
  return `<span class="badge badge-finance-cat" style="background:${hexToRgba(hex, 0.18)};color:${hex};border:1px solid ${hexToRgba(hex, 0.4)}">${escapeHtml(category)}</span>`;
}

function financeCategoryChartColors(categories) {
  return (categories || []).map(c => {
    const name = typeof c === 'string' ? c : c.category;
    return financeCategoryHex(name);
  });
}

function accountTimelineGradient(chart) {
  const { ctx, chartArea } = chart;
  if (!chartArea) return 'rgba(124,108,255,0.55)';
  const g = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
  g.addColorStop(0, 'rgba(72, 62, 140, 0.35)');
  g.addColorStop(0.4, 'rgba(124, 108, 255, 0.65)');
  g.addColorStop(1, 'rgba(34, 211, 238, 0.92)');
  return g;
}

let state = {
  page: 'home',
  taskView: 'all',
  taskCategory: '',
  taskSearch: '',
  taskYear: new Date().getFullYear(),
  tasks: [],
  stats: null,
  financeDash: null,
  financeHero: null,
  financeLoans: null,
  loanImportPreview: null,
  heroExpRange: 'month',
  heroCategoryPick: localStorage.getItem('bredehall_hero_category') || '',
  financeConfig: null,
  financeMeta: null,
  financeFilters: {
    account: '', year: String(new Date().getFullYear()), category: '', typ: '',
    periodMode: 'month',
    month: new Date().getMonth() + 1,
    dateFrom: '', dateTo: '', search: '',
    excludeOverforing: true, maxAmount: 0, chartMaxAmount: 100000,
    sortBy: 'txn_date', sortDir: 'desc', offset: 0, limit: 50,
  },
  compareView: {
    accountA: '', accountB: '', months: 12, includeTransfers: null,
    selectedMonth: '', monthRange: null, activeCategory: '', activeCategoryParam: '',
    dateFrom: '', dateTo: '', sharePercent: 50, lastChartData: null,
  },
  /** 'global' | 'compare' — senast aktiva källa styr transaktionstabellen. */
  txnViewSource: 'global',
  lastSuggestions: [],
  selectedSuggestions: new Set(),
  editingTask: null,
  charts: {},
  financeCategories: [],
  aiJob: null,
  categoryView: {
    range: 'month',
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    account: '',
    category: '',
    onlyOvrigt: false,
    search: '',
    sortBy: 'txn_date',
    sortDir: 'desc',
    offset: 0,
    limit: 40,
  },
};

// ── Utils ──────────────────────────────────────────────────────────
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatMoney(n) {
  if (n == null) return '–';
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 0 }).format(n);
}

/** Short form for dashboard hero: 1,2 mn kr / 331 tn kr. Full value in title tooltip. */
function formatMoneyCompact(n) {
  if (n == null) return '–';
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const mn = abs / 1_000_000;
    const txt = mn >= 10
      ? `${Math.round(mn)} mn`
      : `${mn.toFixed(1).replace('.', ',')} mn`;
    return `${sign}${txt} kr`;
  }
  if (abs >= 100_000) {
    return `${sign}${Math.round(abs / 1_000)} tn kr`;
  }
  return formatMoney(n);
}

function setMoneyEl(el, value, { compact = false } = {}) {
  if (!el) return;
  const full = formatMoney(value);
  el.textContent = compact ? formatMoneyCompact(value) : full;
  el.title = compact && full !== el.textContent ? full : '';
}

function accountNumbersMap() {
  return state.financeConfig?.account_numbers || state.financeMeta?.account_numbers || {};
}

function getAccountNumber(name, explicit) {
  if (explicit) return String(explicit).trim();
  if (!name) return '';
  const fromMap = accountNumbersMap()[name];
  if (fromMap) return String(fromMap).trim();
  const metaHit = (state.financeMeta?.accounts || []).find(a =>
    (typeof a === 'object' ? a.name : a) === name);
  if (metaHit?.account_number) return metaHit.account_number;
  return '';
}

function normalizeAccountItems(items) {
  return (items || []).map(a =>
    typeof a === 'object'
      ? { name: a.name, account_number: a.account_number || getAccountNumber(a.name) }
      : { name: a, account_number: getAccountNumber(a) });
}

function formatAccountText(name, number) {
  const num = number || getAccountNumber(name);
  return num ? `${name} · ${num}` : name;
}

/** Namn only — kontonummer i title/hover där utrymmet är trångt. */
function formatAccountShort(name) {
  return name || '';
}

function formatAccountFullTitle(name, number) {
  return formatAccountText(name, number || getAccountNumber(name));
}

function formatAccountHoverHtml(name, number) {
  const full = formatAccountFullTitle(name, number);
  if (full === name) return escapeHtml(name);
  return `<span class="acc-hover" title="${escapeHtml(full)}">${escapeHtml(name)}</span>`;
}

function formatAccountInlineHtml(name, number) {
  const num = number || getAccountNumber(name);
  if (!num) return escapeHtml(name);
  return `${escapeHtml(name)}<span class="acc-num-inline"> · ${escapeHtml(num)}</span>`;
}

function formatAccountBlockHtml(name, number) {
  const num = number || getAccountNumber(name);
  if (!num) return `<strong>${escapeHtml(name)}</strong>`;
  return `<strong>${escapeHtml(name)}</strong><span class="acc-num">${escapeHtml(num)}</span>`;
}

function chartAccountLabel(item, full = false) {
  const name = item?.account || item?.name || '';
  if (full) return formatAccountText(name, item?.account_number);
  return formatAccountShort(name);
}

function getApiKey() {
  return localStorage.getItem('bredehall_api_key') || sessionStorage.getItem('bredehall_api_key') || '';
}

function setApiKey(key) {
  if (key) {
    localStorage.setItem('bredehall_api_key', key);
    sessionStorage.setItem('bredehall_api_key', key);
  } else {
    localStorage.removeItem('bredehall_api_key');
    sessionStorage.removeItem('bredehall_api_key');
  }
}

const EXCLUDE_OVERFORING_KEY = 'bredehall_exclude_overforing';

function getExcludeOverforing() {
  const stored = localStorage.getItem(EXCLUDE_OVERFORING_KEY);
  if (stored === null) return true;
  return stored === 'true';
}

function setExcludeOverforing(on) {
  localStorage.setItem(EXCLUDE_OVERFORING_KEY, on ? 'true' : 'false');
  state.financeFilters.excludeOverforing = !!on;
  syncExcludeTransferToggles();
}

/** Keep sidebar + settings checkboxes aligned with stored preference. */
function syncExcludeTransferToggles() {
  const on = getExcludeOverforing();
  const side = $('#fin-filter-exclude-transfers');
  if (side) side.checked = on;
  const cfg = $('#cfg-exclude-overforing');
  if (cfg) cfg.checked = on;
}

/** Global hide transfers, unless user explicitly filters on Överföring. */
function effectiveExcludeOverforing(categoryFilter = '') {
  if (categoryFilter === 'Överföring') return false;
  return getExcludeOverforing();
}

function syncExcludeOverforingFromGlobal() {
  state.financeFilters.excludeOverforing = effectiveExcludeOverforing(state.financeFilters.category);
}

(function migrateApiKeyStorage() {
  const legacy = sessionStorage.getItem('bredehall_api_key');
  if (legacy && !localStorage.getItem('bredehall_api_key')) {
    localStorage.setItem('bredehall_api_key', legacy);
  }
})();

async function ensureApiKey() {
  const status = await fetch(relUrl('api/auth/status')).then(r => r.json()).catch(() => ({ auth_required: false }));
  if (!status.auth_required) return true;
  if (getApiKey()) return true;
  const key = prompt('API-nyckel krävs (samma som app_api_key i Home Assistant add-on):\n\nAnge nyckeln — den sparas i webbläsaren.');
  if (!key) return false;
  setApiKey(key.trim());
  return true;
}

function showToast(msg, isError = false) {
  let el = $('#app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'app-toast hidden';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), 5000);
}

async function apiFetch(path, opts = {}) {
  if (!(await ensureApiKey())) throw new Error('API-nyckel saknas');
  const headers = { ...(opts.headers || {}) };
  const key = getApiKey();
  if (key) headers['X-API-Key'] = key;
  return fetch(relUrl(path.startsWith('/') ? path.slice(1) : path), { cache: 'no-store', ...opts, headers });
}

async function api(path, opts = {}) {
  const r = await apiFetch(API + path, opts);
  if (r.status === 401) {
    setApiKey('');
    if (await ensureApiKey()) return api(path, opts);
    throw new Error('401 Ogiltig API-nyckel');
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(r.status + ' ' + (t || r.statusText));
  }
  if (r.status === 204) return null;
  return r.json();
}

/** api() with user-visible error toast */
async function apiCall(path, opts = {}, errEl = null) {
  try {
    return await api(path, opts);
  } catch (e) {
    const msg = e.message || String(e);
    if (errEl) errEl.textContent = msg;
    else showToast(msg, true);
    throw e;
  }
}

function updateAiUiState() {
  const enabled = !!state.financeConfig?.ai_enabled;
  ['#btn-recategorize-ai', '#btn-loan-import'].forEach(sel => {
    const el = $(sel);
    if (el) {
      el.disabled = !enabled;
      el.title = enabled ? el.dataset.titleDefault || el.title : 'AI är avstängd i inställningar';
    }
  });
}

// ── Navigation ───────────────────────────────────────────────────────
function setPage(page) {
  state.page = page;
  $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === page));
  $$('.nav-item[data-page]').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  const titles = {
    home: ['Översikt', 'Villa & ekonomi i ett'],
    maintenance: ['Underhåll', 'Planera och följ upp uppgifter'],
    finance: ['Ekonomi', 'Importera och analysera transaktioner'],
    'finance-log': ['Aktivitetslogg', 'Uppladdningar, AI-kategorisering och manuella poster'],
    categories: ['Kategorier', 'Justera och analysera utgiftskategorier'],
    settings: ['Inställningar', 'Datakällor och konfiguration'],
  };
  const [h, sub] = titles[page] || ['', ''];
  $('#page-title').textContent = h;
  $('#page-subtitle').textContent = sub;
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('open');
  const fab = $('#filter-fab');
  if (fab) fab.classList.add('hidden');
  if (page === 'home') loadHome();
  if (page === 'maintenance') loadTasks();
  if (page === 'finance') loadFinance();
  if (page === 'finance-log') loadFinanceLog();
  if (page === 'categories') loadCategoriesPage();
  if (page === 'settings') loadSettings();
}

$$('.nav-item[data-page]').forEach(btn => {
  btn.addEventListener('click', () => setPage(btn.dataset.page));
});

$('#menu-toggle')?.addEventListener('click', () => {
  $('#sidebar').classList.toggle('open');
  $('#sidebar-overlay').classList.toggle('open');
});
$('#sidebar-overlay')?.addEventListener('click', () => {
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('open');
});

// ── Home ─────────────────────────────────────────────────────────────
async function loadHome() {
  try {
    const [stats, hero] = await Promise.all([
      api('/api/tasks/stats/summary'),
      api('/api/finance/hero'),
    ]);
    state.stats = stats;
    state.financeHero = hero;
    $('#home-stats').innerHTML = `
      <div class="card"><div class="stat-value stat-accent">${stats.total}</div><div class="stat-label">Uppgifter totalt</div></div>
      <div class="card"><div class="stat-value stat-danger">${stats.overdue}</div><div class="stat-label">Försenade</div></div>
      <div class="card"><div class="stat-value stat-warn">${stats.due_this_week}</div><div class="stat-label">Denna vecka</div></div>
      <div class="card"><div class="stat-value stat-success">${formatMoney(hero.total_assets)}</div><div class="stat-label">Tillgångar</div></div>`;
    const recent = hero.recent_transactions || [];
    $('#home-recent-finance').innerHTML = recent.length
      ? recent.map(t => `<div class="task-item" style="cursor:default">
          <div><p class="task-title">${escapeHtml(t.description)}</p>
          <p class="task-meta">${formatAccountInlineHtml(t.account, t.account_number)} · ${formatDate(t.txn_date)}</p></div>
          <span class="${t.amount >= 0 ? 'amount-pos' : 'amount-neg'}">${formatMoney(t.amount)}</span></div>`).join('')
      : '<p class="empty">Inga transaktioner än. Importera CSV-filer under Ekonomi.</p>';
  } catch (e) {
    $('#home-stats').innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

// ── Maintenance ──────────────────────────────────────────────────────
async function loadTasks() {
  const list = $('#task-list');
  const log = $('#completion-log');
  if (state.taskView === 'log') {
    list.classList.add('hidden');
    log.classList.remove('hidden');
    return loadCompletionLog();
  }
  log.classList.add('hidden');
  list.classList.remove('hidden');
  list.innerHTML = '<p class="loading">Laddar…</p>';
  try {
    let url = `/api/tasks?view=${state.taskView === 'all' ? '' : state.taskView}`;
    if (state.taskView === 'this_year') url += `&year=${state.taskYear}`;
    if (state.taskCategory) url += `&category=${encodeURIComponent(state.taskCategory)}`;
    if (state.taskSearch) url += `&search=${encodeURIComponent(state.taskSearch)}`;
    state.tasks = await api(url);
    if (!state.tasks.length) {
      list.innerHTML = '<p class="empty">Inga uppgifter i denna vy.</p>';
      return;
    }
    const today = new Date(); today.setHours(0,0,0,0);
    list.innerHTML = state.tasks.map(t => {
      const overdue = t.next_deadline && new Date(t.next_deadline + 'T12:00:00') < today;
      return `<div class="task-item ${overdue ? 'overdue' : ''}" data-id="${t.id}">
        <div><p class="task-title">${escapeHtml(t.title)}</p>
        <p class="task-meta"><span class="badge">${escapeHtml(t.category)}</span> ${escapeHtml(t.frequency)}</p>
        ${t.next_deadline ? `<p class="task-deadline">Deadline: ${formatDate(t.next_deadline)}</p>` : ''}</div>
      </div>`;
    }).join('');
    list.querySelectorAll('.task-item').forEach(el => {
      el.addEventListener('click', () => openTaskModal(state.tasks.find(x => x.id === +el.dataset.id)));
    });
  } catch (e) {
    list.innerHTML = `<p class="error">Kunde inte ladda: ${escapeHtml(e.message)}</p>`;
  }
}

function formatDateTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadCompletionLog() {
  const log = $('#completion-log');
  log.innerHTML = '<p class="loading">Laddar logg…</p>';
  try {
    const url = '/api/tasks/completions' + (state.taskSearch ? '?search=' + encodeURIComponent(state.taskSearch) : '');
    const items = await api(url);
    if (!items.length) {
      log.innerHTML = '<p class="empty">Inga avslutade uppgifter loggade än. Markera en uppgift som klar för att börja.</p>';
      return;
    }
    log.innerHTML = items.map(c => `
      <div class="log-item">
        <div>
          <p class="log-title">✓ ${escapeHtml(c.task_title)}</p>
          <p class="log-meta">${c.category ? `<span class="badge">${escapeHtml(c.category)}</span> ` : ''}Utförd av <span class="log-who">${escapeHtml(c.completed_by)}</span>${c.note ? ` · ${escapeHtml(c.note)}` : ''}</p>
        </div>
        <span class="log-when">${formatDateTime(c.completed_at)}</span>
      </div>`).join('');
  } catch (e) {
    log.innerHTML = `<p class="error">Kunde inte ladda logg: ${escapeHtml(e.message)}</p>`;
  }
}

function completeTaskFlow(task) {
  const lastBy = localStorage.getItem('bredehall_last_completed_by') || '';
  openModal(`
    <p style="font-size:0.9rem;margin:0 0 1rem">Markera <strong>${escapeHtml(task.title)}</strong> som klar.</p>
    <form id="complete-form">
      <div class="field"><label class="label">Vem utförde den?</label><input class="input" name="completed_by" value="${escapeHtml(lastBy)}" placeholder="t.ex. Patrik" required></div>
      <div class="field"><label class="label">Datum</label><input class="input" type="date" name="completed_at" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label class="label">Anteckning (valfritt)</label><textarea class="textarea" name="note" rows="2" placeholder="t.ex. bytte filter, allt ok"></textarea></div>
    </form>`,
    'Markera som klar',
    `<button class="btn" id="btn-cancel-complete">Avbryt</button>
     <button class="btn btn-success" id="btn-confirm-complete">Spara</button>`
  );
  $('#btn-cancel-complete').onclick = closeModal;
  $('#btn-confirm-complete').onclick = async () => {
    const fd = new FormData($('#complete-form'));
    const body = Object.fromEntries(fd.entries());
    if (!body.completed_by?.trim()) return alert('Ange vem som utförde uppgiften');
    localStorage.setItem('bredehall_last_completed_by', body.completed_by.trim());
    body.completed_at = body.completed_at || null;
    body.note = body.note?.trim() || null;
    await api(`/api/tasks/${task.id}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal();
    loadTasks();
  };
}

function bindTaskFilters() {
  $$('.task-view-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      state.taskView = chip.dataset.view;
      $$('.task-view-chip').forEach(c => c.classList.toggle('active', c === chip));
      loadTasks();
    });
  });
  $('#task-search')?.addEventListener('input', debounce(e => {
    state.taskSearch = e.target.value;
    loadTasks();
  }, 300));
  $('#task-category-filter')?.addEventListener('change', e => {
    state.taskCategory = e.target.value;
    loadTasks();
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function openModal(html, title, actions = '') {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-actions').innerHTML = actions;
  $('#modal-backdrop').classList.add('open');
}

function closeModal() {
  $('#modal-backdrop').classList.remove('open');
  state.editingTask = null;
}

$('#modal-close')?.addEventListener('click', closeModal);
$('#modal-backdrop')?.addEventListener('click', e => { if (e.target.id === 'modal-backdrop') closeModal(); });

function openTaskModal(task, edit = false) {
  state.editingTask = task;
  if (edit) {
    openModal(`
      <form id="edit-form">
        <div class="field"><label class="label">Titel</label><input class="input" name="title" value="${escapeHtml(task.title)}" required></div>
        <div class="field"><label class="label">Kategori</label><select class="select" name="category">${CATEGORIES.map(c => `<option ${c===task.category?'selected':''}>${c}</option>`).join('')}</select></div>
        <div class="field"><label class="label">Frekvens</label><select class="select" name="frequency">${FREQUENCIES.map(f => `<option ${f===task.frequency?'selected':''}>${f}</option>`).join('')}</select></div>
        <div class="field"><label class="label">Nästa deadline</label><input class="input" type="date" name="next_deadline" value="${task.next_deadline || ''}"></div>
        <div class="field"><label class="label">Senast utförd</label><input class="input" type="date" name="last_done" value="${task.last_done || ''}"></div>
        <div class="field"><label class="label">Motivering</label><textarea class="textarea" name="reason" rows="2">${escapeHtml(task.reason||'')}</textarea></div>
        <div class="field"><label class="label">Beskrivning</label><textarea class="textarea" name="description" rows="3">${escapeHtml(task.description||'')}</textarea></div>
      </form>`,
      'Redigera uppgift',
      `<button class="btn btn-danger" id="btn-delete-task">Ta bort</button>
       <button class="btn btn-success" id="btn-complete-task">Markera klar</button>
       <button class="btn btn-primary" id="btn-save-task">Spara</button>`
    );
    $('#btn-save-task').onclick = async () => {
      const fd = new FormData($('#edit-form'));
      const body = Object.fromEntries(fd.entries());
      body.next_deadline = body.next_deadline || null;
      body.last_done = body.last_done || null;
      await api(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      closeModal(); loadTasks();
    };
    $('#btn-complete-task').onclick = () => { closeModal(); completeTaskFlow(task); };
    $('#btn-delete-task').onclick = async () => {
      if (!confirm('Ta bort uppgift?')) return;
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      closeModal(); loadTasks();
    };
    return;
  }
  openModal(`
    <dl style="font-size:0.875rem;line-height:1.7">
      <dt class="label">Kategori</dt><dd>${escapeHtml(task.category)}</dd>
      <dt class="label">Frekvens</dt><dd>${escapeHtml(task.frequency)}</dd>
      <dt class="label">Senast utförd</dt><dd>${task.last_done ? formatDate(task.last_done) : '–'}</dd>
      <dt class="label">Nästa deadline</dt><dd>${task.next_deadline ? formatDate(task.next_deadline) : '–'}</dd>
      ${task.reason ? `<dt class="label">Varför</dt><dd>${escapeHtml(task.reason)}</dd>` : ''}
      ${task.description ? `<dt class="label">Beskrivning</dt><dd style="white-space:pre-wrap">${escapeHtml(task.description)}</dd>` : ''}
    </dl>`,
    task.title,
    `<button class="btn btn-success" id="btn-quick-complete">Markera klar</button>
     <button class="btn btn-primary" id="btn-edit-task">Redigera</button>`
  );
  $('#btn-edit-task').onclick = () => openTaskModal(task, true);
  $('#btn-quick-complete').onclick = () => { closeModal(); completeTaskFlow(task); };
}

function openNewTaskModal() {
  openModal(`
    <form id="new-form">
      <div class="field"><label class="label">Titel</label><input class="input" name="title" required placeholder="t.ex. Rensa hängrännor"></div>
      <div class="field"><label class="label">Kategori</label><select class="select" name="category">${CATEGORIES.map(c => `<option>${c}</option>`).join('')}</select></div>
      <div class="field"><label class="label">Frekvens</label><select class="select" name="frequency">${FREQUENCIES.map(f => `<option>${f}</option>`).join('')}</select></div>
      <div class="field"><label class="label">Nästa deadline</label><input class="input" type="date" name="next_deadline"></div>
      <div class="field"><label class="label">Motivering</label><textarea class="textarea" name="reason" rows="2"></textarea></div>
      <div class="field"><label class="label">Beskrivning</label><textarea class="textarea" name="description" rows="3"></textarea></div>
    </form>`,
    'Ny uppgift',
    `<button class="btn btn-primary" id="btn-create-task">Spara</button>`
  );
  $('#btn-create-task').onclick = async () => {
    const fd = new FormData($('#new-form'));
    const body = Object.fromEntries(fd.entries());
    body.next_deadline = body.next_deadline || null;
    body.reason = body.reason?.trim() || null;
    body.description = body.description?.trim() || null;
    if (!body.title?.trim()) return alert('Ange titel');
    await api('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal(); loadTasks();
  };
}

$('#btn-new-task')?.addEventListener('click', openNewTaskModal);

// AI
async function runAnalyze() {
  const el = $('#ai-result');
  el.classList.remove('hidden');
  el.textContent = 'Analyserar…';
  $('#ai-suggestions-wrap').classList.add('hidden');
  try {
    const data = await api('/api/ai/analyze-plan', { method: 'POST' });
    if (!data.ok) { el.textContent = 'Fel: ' + (data.error || ''); return; }
    state.lastSuggestions = data.suggestions || [];
    state.selectedSuggestions = new Set(state.lastSuggestions.map((_, i) => i));
    el.textContent = data.analysis || '';
    if (state.lastSuggestions.length) {
      $('#ai-suggestions-wrap').classList.remove('hidden');
      $('#ai-suggestions-list').innerHTML = state.lastSuggestions.map((s, i) =>
        `<li><input type="checkbox" data-idx="${i}" checked> ${escapeHtml(s.title)} <span class="task-meta">(${escapeHtml(s.category)})</span></li>`
      ).join('');
      $$('#ai-suggestions-list input').forEach(cb => {
        cb.addEventListener('change', () => {
          if (cb.checked) state.selectedSuggestions.add(+cb.dataset.idx);
          else state.selectedSuggestions.delete(+cb.dataset.idx);
        });
      });
    }
  } catch (e) { el.textContent = 'Fel: ' + e.message; }
}

async function runGrants() {
  const el = $('#ai-result');
  el.classList.remove('hidden');
  el.textContent = 'Söker…';
  $('#ai-suggestions-wrap').classList.add('hidden');
  try {
    const data = await api('/api/ai/search-grants', { method: 'POST' });
    el.innerHTML = data.ok
      ? `<p class="ai-disclaimer" style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem">⚠ AI-genererat svar — verifiera mot officiella källor (Boverket, Skatteverket m.fl.)</p><div>${escapeHtml(data.text || '')}</div>`
      : ('Fel: ' + escapeHtml(data.error || ''));
  } catch (e) { el.textContent = 'Fel: ' + e.message; }
}

async function addSelectedSuggestions() {
  const items = [...state.selectedSuggestions].map(i => state.lastSuggestions[i]).filter(Boolean);
  if (!items.length) return;
  const body = items.map(s => ({ title: s.title, category: s.category || 'Annat', frequency: s.frequency || 'Årlig', reason: s.reason || null }));
  const data = await api('/api/ai/add-suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  $('#ai-result').textContent += `\n\n✓ ${data.added} uppgifter tillagda.`;
  $('#ai-suggestions-wrap').classList.add('hidden');
  loadTasks();
}

$('#btn-analyze')?.addEventListener('click', runAnalyze);
$('#btn-grants')?.addEventListener('click', runGrants);
$('#btn-add-suggestions')?.addEventListener('click', addSelectedSuggestions);

// ── Finance ──────────────────────────────────────────────────────────
function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

function financeQueryString(extra = {}) {
  syncFinancePeriodToQuery();
  const f = { ...state.financeFilters, ...extra };
  const p = new URLSearchParams();
  if (f.account) p.set('account', f.account);
  // Custom date range wins over year filter (avoid AND of both).
  if (f.year && !(f.dateFrom || f.dateTo)) p.set('year', f.year);
  if (f.category) p.set('category', f.category);
  if (f.typ) p.set('typ', f.typ);
  if (f.dateFrom) p.set('date_from', f.dateFrom);
  if (f.dateTo) p.set('date_to', f.dateTo);
  if (f.search) p.set('search', f.search);
  if (f.excludeOverforing) p.set('exclude_overforing', 'true');
  if (f.maxAmount) p.set('max_amount', String(f.maxAmount));
  if (f.chartMaxAmount) p.set('chart_max_amount', String(f.chartMaxAmount));
  if (f.sortBy) p.set('sort_by', f.sortBy);
  if (f.sortDir) p.set('sort_dir', f.sortDir);
  if (f.offset != null) p.set('offset', String(f.offset));
  if (f.limit != null) p.set('limit', String(f.limit));
  return p.toString();
}

/** Tabellen styrs av senast valda källa: globalfilter eller jämför-konton. */
function isCompareTxnMode() {
  if (state.txnViewSource !== 'compare') return false;
  const a = $('#fin-compare-a')?.value || state.compareView.accountA;
  const b = $('#fin-compare-b')?.value || state.compareView.accountB;
  return !!(a && b && a !== b);
}

function setTxnViewSource(source, { resetOffset = true } = {}) {
  state.txnViewSource = source === 'compare' ? 'compare' : 'global';
  if (resetOffset) state.financeFilters.offset = 0;
}

function syncCompareAccountsFromUi() {
  const a = $('#fin-compare-a')?.value || state.compareView.accountA;
  const b = $('#fin-compare-b')?.value || state.compareView.accountB;
  if (a) state.compareView.accountA = a;
  if (b) state.compareView.accountB = b;
  return { a: state.compareView.accountA, b: state.compareView.accountB };
}

function formatGlobalPeriodLabel() {
  const f = state.financeFilters;
  if (f.periodMode === 'custom' || f.dateFrom || f.dateTo) {
    if (f.dateFrom && f.dateTo) return `${f.dateFrom} – ${f.dateTo}`;
    if (f.dateFrom) return `från ${f.dateFrom}`;
    if (f.dateTo) return `till ${f.dateTo}`;
    return 'eget intervall';
  }
  const mode = f.periodMode || 'all';
  if (mode === 'month' && f.year && f.month) {
    const names = ['', 'jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    return `${names[f.month] || f.month} ${f.year}`;
  }
  if (mode === 'year' && f.year) return `år ${f.year}`;
  return 'alla perioder';
}

function formatComparePeriodLabel() {
  if (state.compareView.selectedMonth) return state.compareView.selectedMonth;
  const from = state.compareView.dateFrom || $('#fin-compare-from')?.value || '';
  const to = state.compareView.dateTo || $('#fin-compare-to')?.value || '';
  if (from || to) {
    if (from && to) return `${from} – ${to}`;
    if (from) return `från ${from}`;
    return `till ${to}`;
  }
  const span = $('#fin-compare-span')?.value || '12';
  if (span === 'year') return `år ${state.financeFilters.year || new Date().getFullYear()}`;
  if (span === 'custom') return 'eget intervall';
  if (state.compareView.monthRange) {
    return `${state.compareView.monthRange.from.slice(0, 7)} – ${state.compareView.monthRange.to.slice(0, 7)}`;
  }
  return `senaste ${span} mån`;
}

function formatCompareCategoryLabel() {
  const { catParam, compareRaw } = resolveTxnCategoryFilter(state.financeFilters);
  if (compareRaw === COMPARE_ALL_INCOME) return 'alla inkomster';
  if (compareRaw && compareRaw !== COMPARE_ALL_EXPENSE) return compareRaw;
  if (catParam) return catParam;
  return 'alla utgifter';
}

function compareMonthRangeFromSeries(series) {
  if (!series?.length) return null;
  const first = series[0].month;
  const last = series[series.length - 1].month;
  const [y, m] = last.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    from: `${first}-01`,
    to: `${last}-${String(lastDay).padStart(2, '0')}`,
    months: series.map(r => r.month),
  };
}

function buildCompareTxnQueryString(extra = {}) {
  const a = state.compareView.accountA;
  const b = state.compareView.accountB;
  const f = { ...state.financeFilters, ...extra };
  const { catParam, flow } = resolveTxnCategoryFilter(f);
  const p = new URLSearchParams();
  p.set('accounts', `${a},${b}`);
  appendCategoryQueryParams(p, catParam);
  if (flow === 'expense') {
    p.set('flow', 'expense');
    p.set('chart_max_amount', '100000');
  } else if (flow === 'income') {
    p.set('flow', 'income');
  }
  if (!compareIncludesTransfers()) p.set('exclude_overforing', 'true');
  p.set('chart_exclusions', 'true');

  const sel = state.compareView.selectedMonth;
  const dateFrom = state.compareView.dateFrom || $('#fin-compare-from')?.value || '';
  const dateTo = state.compareView.dateTo || $('#fin-compare-to')?.value || '';
  if (sel) {
    const [y, m] = sel.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    p.set('date_from', `${sel}-01`);
    p.set('date_to', `${sel}-${String(last).padStart(2, '0')}`);
  } else if (dateFrom || dateTo) {
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
  } else if (state.compareView.monthRange) {
    p.set('date_from', state.compareView.monthRange.from);
    p.set('date_to', state.compareView.monthRange.to);
  } else if (($('#fin-compare-span')?.value || '') === 'year') {
    p.set('year', String(state.financeFilters.year || new Date().getFullYear()));
  }

  if (f.search) p.set('search', f.search);
  if (f.sortBy) p.set('sort_by', f.sortBy);
  if (f.sortDir) p.set('sort_dir', f.sortDir);
  if (f.offset != null) p.set('offset', String(f.offset));
  if (f.limit != null) p.set('limit', String(f.limit));
  return p.toString();
}

function financeTxnQueryString(extra = {}) {
  return isCompareTxnMode() ? buildCompareTxnQueryString(extra) : financeQueryString(extra);
}

async function loadFinanceTransactions() {
  readFinanceFiltersFromUI();
  if (state.txnViewSource === 'compare') syncCompareAccountsFromUi();
  try {
    const data = await api('/api/finance/transactions?' + financeTxnQueryString());
    renderTransactionTable(data.items || [], data.total || 0);
    updateTxnContextLabel();
  } catch (e) {
    renderTransactionTable([], 0);
    const el = $('#txn-context');
    if (el) {
      el.textContent = 'Kunde inte ladda transaktioner.';
      el.hidden = false;
    }
  }
}

function updateTxnContextLabel() {
  const el = $('#txn-context');
  if (!el) return;
  const compareReady = (() => {
    const a = $('#fin-compare-a')?.value || state.compareView.accountA;
    const b = $('#fin-compare-b')?.value || state.compareView.accountB;
    return !!(a && b && a !== b);
  })();

  if (isCompareTxnMode()) {
    const a = formatAccountShort(state.compareView.accountA);
    const b = formatAccountShort(state.compareView.accountB);
    const parts = [
      '<span class="fin-txn-source">Jämförelse</span>',
      `<strong>${escapeHtml(a)}</strong> + <strong>${escapeHtml(b)}</strong>`,
      escapeHtml(formatCompareCategoryLabel()),
      escapeHtml(formatComparePeriodLabel()),
    ];
    if (!compareIncludesTransfers()) parts.push('exkl. interna överföringar');
    else parts.push('inkl. interna överföringar');
    el.innerHTML = parts.join(' · ')
      + ' · <button type="button" class="btn-link" id="txn-use-global">Använd globalfilter</button>';
    el.hidden = false;
    $('#txn-use-global')?.addEventListener('click', () => {
      setTxnViewSource('global');
      state.compareView.selectedMonth = '';
      const chartData = state.compareView.lastChartData;
      if (chartData) {
        renderCompareChart(chartData);
        updateCompareSettlement(chartData);
      }
      loadFinanceTransactions();
    });
    return;
  }

  syncFinancePeriodToQuery();
  const f = state.financeFilters;
  const parts = [
    '<span class="fin-txn-source">Globalfilter</span>',
    escapeHtml(formatGlobalPeriodLabel()),
    `<strong>${escapeHtml(f.account ? formatAccountShort(f.account) : 'Alla konton')}</strong>`,
  ];
  if (f.category) parts.push(escapeHtml(f.category));
  if (f.typ) parts.push(escapeHtml(f.typ));
  if (f.search) parts.push(`sök “${escapeHtml(f.search)}”`);
  if (f.excludeOverforing) parts.push('exkl. interna överföringar');
  else parts.push('inkl. interna överföringar');
  if (f.maxAmount) parts.push(`max ${formatMoney(f.maxAmount)}`);
  let html = parts.join(' · ');
  if (compareReady) {
    html += ' · <button type="button" class="btn-link" id="txn-use-compare">Använd jämförelse</button>';
  }
  el.innerHTML = html;
  el.hidden = false;
  $('#txn-use-compare')?.addEventListener('click', () => {
    setTxnViewSource('compare');
    loadAccountCompare();
  });
}

function syncFinancePeriodToQuery() {
  const f = state.financeFilters;
  const fromEl = $('#fin-filter-from')?.value || '';
  const toEl = $('#fin-filter-to')?.value || '';
  if (f.periodMode === 'custom' || fromEl || toEl) {
    if (fromEl || toEl) f.periodMode = 'custom';
    f.dateFrom = fromEl;
    f.dateTo = toEl;
    return;
  }
  const mode = f.periodMode || 'all';
  if (mode === 'month') {
    const y = +(f.year || new Date().getFullYear());
    const m = +(f.month || new Date().getMonth() + 1);
    f.year = String(y);
    f.month = m;
    const last = new Date(y, m, 0).getDate();
    f.dateFrom = `${y}-${String(m).padStart(2, '0')}-01`;
    f.dateTo = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  } else if (mode === 'year') {
    f.dateFrom = '';
    f.dateTo = '';
    if (!f.year) f.year = String(new Date().getFullYear());
  } else {
    f.year = '';
    f.dateFrom = '';
    f.dateTo = '';
  }
}

function readFinanceFiltersFromUI() {
  state.financeFilters.account = $('#fin-filter-account')?.value || '';
  state.financeFilters.year = $('#fin-filter-year')?.value || '';
  state.financeFilters.month = +($('#fin-filter-month')?.value || state.financeFilters.month || 1);
  state.financeFilters.category = $('#fin-filter-category')?.value || '';
  state.financeFilters.typ = $('#fin-filter-typ')?.value || '';
  state.financeFilters.dateFrom = $('#fin-filter-from')?.value || '';
  state.financeFilters.dateTo = $('#fin-filter-to')?.value || '';
  state.financeFilters.search = $('#fin-filter-search')?.value?.trim() || '';
  state.financeFilters.excludeOverforing = effectiveExcludeOverforing(state.financeFilters.category);
  state.financeFilters.maxAmount = $('#fin-filter-cap')?.checked ? 100000 : 0;
}

function updateFinancePeriodUi() {
  const mode = state.financeFilters.periodMode || 'all';
  ['all', 'year', 'month', 'custom'].forEach(m => {
    $(`#fin-range-${m}`)?.classList.toggle('active', mode === m);
  });
  const picks = $('#fin-period-picks');
  const custom = $('#fin-period-custom');
  if (picks) picks.classList.toggle('hidden', mode === 'all' || mode === 'custom');
  if (custom) custom.classList.toggle('hidden', mode !== 'custom');
  $('#fin-filter-month')?.classList.toggle('hidden', mode !== 'month');
  $('#fin-filter-year')?.classList.toggle('hidden', mode === 'all' || mode === 'custom');
}

function updateCompareDateUi() {
  const span = $('#fin-compare-span')?.value || '12';
  const wrap = $('#fin-compare-dates');
  if (wrap) wrap.classList.toggle('hidden', span !== 'custom');
}

function initFinancePeriodControls() {
  const monthSel = $('#fin-filter-month');
  if (!monthSel || monthSel.dataset.inited) return;
  monthSel.dataset.inited = '1';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
  monthSel.innerHTML = months.map((m, i) =>
    `<option value="${i + 1}">${m}</option>`
  ).join('');
  monthSel.value = String(state.financeFilters.month);

  const setMode = (mode) => {
    state.financeFilters.periodMode = mode;
    if (mode === 'month' && !state.financeFilters.year) {
      state.financeFilters.year = String(new Date().getFullYear());
    }
    if (mode === 'year' && !state.financeFilters.year) {
      state.financeFilters.year = String(new Date().getFullYear());
    }
    if (mode !== 'custom') {
      if ($('#fin-filter-from')) $('#fin-filter-from').value = '';
      if ($('#fin-filter-to')) $('#fin-filter-to').value = '';
      state.financeFilters.dateFrom = '';
      state.financeFilters.dateTo = '';
    } else if (!$('#fin-filter-from')?.value && !$('#fin-filter-to')?.value) {
      // Sensible default: first day of current month → today
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth() + 1;
      const from = `${y}-${String(m).padStart(2, '0')}-01`;
      const to = now.toISOString().slice(0, 10);
      if ($('#fin-filter-from')) $('#fin-filter-from').value = from;
      if ($('#fin-filter-to')) $('#fin-filter-to').value = to;
    }
    updateFinancePeriodUi();
    applyFilters();
  };
  $('#fin-range-all')?.addEventListener('click', () => setMode('all'));
  $('#fin-range-year')?.addEventListener('click', () => setMode('year'));
  $('#fin-range-month')?.addEventListener('click', () => setMode('month'));
  $('#fin-range-custom')?.addEventListener('click', () => setMode('custom'));
  monthSel.addEventListener('change', () => {
    state.financeFilters.month = +monthSel.value;
    applyFilters();
  });
  ['fin-filter-from', 'fin-filter-to'].forEach(id => {
    $('#' + id)?.addEventListener('change', () => {
      state.financeFilters.periodMode = 'custom';
      updateFinancePeriodUi();
      applyFilters();
    });
  });
  updateFinancePeriodUi();
}

function compareIncludesTransfers() {
  const cat = $('#fin-compare-categories')?.value || '';
  const el = $('#fin-compare-include-transfers');
  if (state.compareView.includeTransfers != null) return state.compareView.includeTransfers;
  if (cat === 'Överföring') return true;
  return !getExcludeOverforing();
}

function syncCompareTransferToggle() {
  const el = $('#fin-compare-include-transfers');
  if (!el) return;
  const cat = $('#fin-compare-categories')?.value || '';
  if (cat === 'Överföring' && state.compareView.includeTransfers == null) {
    el.checked = true;
  } else if (state.compareView.includeTransfers != null) {
    el.checked = state.compareView.includeTransfers;
  } else {
    el.checked = !getExcludeOverforing();
  }
  updateCompareExcludeNote();
}

function updateCompareExcludeNote() {
  const el = $('#fin-compare-exclude-note');
  if (!el) return;
  const cat = $('#fin-compare-categories')?.value || '';
  const flow = compareFlowType(cat);
  const parts = [];
  if (!compareIncludesTransfers()) parts.push('interna överföringar');
  if (flow === 'expense') parts.push('poster > 100 000 kr');
  el.textContent = parts.length ? `Exkl. ${parts.join(' och ')}` : 'Inga exkluderingar i jämförelsen';
}

function populateCompareControls(meta) {
  const accounts = normalizeAccountItems(meta?.accounts || []);
  const fill = (sel, keep) => {
    if (!sel) return;
    sel.innerHTML = accounts.map(a => {
      const full = formatAccountFullTitle(a.name, a.account_number);
      return `<option value="${escapeHtml(a.name)}" title="${escapeHtml(full)}" ${a.name === keep ? 'selected' : ''}>${escapeHtml(formatAccountShort(a.name))}</option>`;
    }).join('');
  };
  const cv = state.compareView;
  if (!cv.accountA && accounts[0]) cv.accountA = accounts[0].name;
  if (!cv.accountB && accounts[1]) cv.accountB = accounts[1].name;
  fill($('#fin-compare-a'), cv.accountA);
  fill($('#fin-compare-b'), cv.accountB);
  const catSel = $('#fin-compare-categories');
  if (catSel && !catSel.dataset.inited) {
    catSel.dataset.inited = '1';
    const cur = catSel.value;
    catSel.innerHTML = [
      '<option value="">Alla utgifter</option>',
      `<option value="${COMPARE_ALL_INCOME}">Alla inkomster</option>`,
      '<option disabled>──────────</option>',
      ...sortCategoryList(meta?.categories || []).map(c =>
        `<option value="${escapeHtml(c)}" ${c === cur ? 'selected' : ''}>${escapeHtml(c)}</option>`
      ),
    ].join('');
  }
  syncCompareTransferToggle();
}

async function loadAccountCompare() {
  const a = $('#fin-compare-a')?.value || state.compareView.accountA;
  const b = $('#fin-compare-b')?.value || state.compareView.accountB;
  const metaEl = $('#fin-compare-meta');
  if (!a || !b) {
    if (metaEl) metaEl.textContent = 'Välj två konton att jämföra.';
    state.compareView.monthRange = null;
    state.compareView.selectedMonth = '';
    state.compareView.lastChartData = null;
    destroyChart('compare');
    updateCompareSettlement(null);
    await loadFinanceTransactions();
    return;
  }
  if (a === b) {
    if (metaEl) metaEl.textContent = 'Välj två olika konton.';
    state.compareView.monthRange = null;
    state.compareView.selectedMonth = '';
    state.compareView.lastChartData = null;
    destroyChart('compare');
    updateCompareSettlement(null);
    await loadFinanceTransactions();
    return;
  }
  state.compareView.accountA = a;
  state.compareView.accountB = b;
  const span = $('#fin-compare-span')?.value || '12';
  const dateFrom = $('#fin-compare-from')?.value || '';
  const dateTo = $('#fin-compare-to')?.value || '';
  state.compareView.dateFrom = dateFrom;
  state.compareView.dateTo = dateTo;
  updateCompareDateUi();
  const catRaw = $('#fin-compare-categories')?.value || '';
  const catParam = compareCategoryParam(catRaw);
  state.compareView.activeCategory = catRaw;
  state.compareView.activeCategoryParam = catParam;
  const flow = compareFlowType(catRaw);
  const params = new URLSearchParams({ account_a: a, account_b: b });
  if (flow === 'expense') params.set('chart_max_amount', '100000');
  else params.set('chart_max_amount', '0');
  if (catParam) params.set('categories', catParam);
  if (!compareIncludesTransfers()) params.set('exclude_overforing', 'true');

  const useCustom = span === 'custom' || !!(dateFrom && dateTo);
  if (useCustom && (dateFrom || dateTo)) {
    if (dateFrom) params.set('month_from', dateFrom.slice(0, 7));
    if (dateTo) params.set('month_to', dateTo.slice(0, 7));
    // Ensure both ends so backend month filter activates
    if (dateFrom && !dateTo) params.set('month_to', dateFrom.slice(0, 7));
    if (dateTo && !dateFrom) params.set('month_from', dateTo.slice(0, 7));
  } else if (span === 'year') {
    const y = state.financeFilters.year || new Date().getFullYear();
    params.set('year', String(y));
  } else if (span !== 'custom') {
    params.set('months', span);
  }

  try {
    const data = await api('/api/finance/compare?' + params);
    state.compareView.monthRange = compareMonthRangeFromSeries(data.series);
    // Prefer explicit day-level range for txn list when custom dates set
    if (dateFrom || dateTo) {
      state.compareView.monthRange = {
        from: dateFrom || (state.compareView.monthRange?.from || ''),
        to: dateTo || (state.compareView.monthRange?.to || ''),
        months: data.months || state.compareView.monthRange?.months || [],
      };
    }
    const monthKeys = data.months || state.compareView.monthRange?.months || [];
    if (state.compareView.selectedMonth && !monthKeys.includes(state.compareView.selectedMonth)) {
      state.compareView.selectedMonth = '';
    }
    state.compareView.lastChartData = data;
    renderCompareChart(data);
    updateCompareSettlement(data);
    const catLabel = catRaw === COMPARE_ALL_INCOME ? 'alla inkomster'
      : (data.categories?.length ? data.categories.join(', ') : 'alla utgifter');
    const isIncome = data.flow === 'income';
    const fmtTotal = (n) => formatMoney(isIncome ? n : -n);
    const meta = $('#fin-compare-meta');
    if (meta) {
      meta.innerHTML = `${formatAccountHoverHtml(data.account_a, getAccountNumber(data.account_a))} ${fmtTotal(data.totals.a)} · ${formatAccountHoverHtml(data.account_b, getAccountNumber(data.account_b))} ${fmtTotal(data.totals.b)} <span class="fin-compare-meta-cat">(${escapeHtml(catLabel)})</span>`;
    }
    updateCompareExcludeNote();
    await loadFinanceTransactions();
  } catch (e) {
    $('#fin-compare-meta').textContent = e.message || 'Kunde inte jämföra konton';
    state.compareView.lastChartData = null;
    destroyChart('compare');
    updateCompareSettlement(null);
    await loadFinanceTransactions();
  }
}

/** Absolute expense amounts for settlement — selected month or full compare totals. */
function compareSpendTotals(data) {
  const selected = state.compareView.selectedMonth;
  if (selected && data?.series?.length) {
    const row = data.series.find(r => r.month === selected);
    if (row) return { a: Math.abs(Number(row.a) || 0), b: Math.abs(Number(row.b) || 0) };
  }
  return {
    a: Math.abs(Number(data?.totals?.a) || 0),
    b: Math.abs(Number(data?.totals?.b) || 0),
  };
}

function getCompareSharePercent() {
  const el = $('#fin-compare-share');
  if (el) {
    const v = Number(el.value);
    if (Number.isFinite(v)) return Math.min(100, Math.max(0, Math.round(v)));
  }
  const stored = Number(state.compareView.sharePercent);
  return Number.isFinite(stored) ? Math.min(100, Math.max(0, Math.round(stored))) : 50;
}

function compareSettleCategoryLabel() {
  const catRaw = state.compareView.activeCategory || '';
  if (catRaw === COMPARE_ALL_INCOME) return 'alla inkomster';
  if (catRaw && catRaw !== COMPARE_ALL_EXPENSE) return catRaw;
  return 'alla utgifter';
}

function updateCompareSettlement(data) {
  const panel = $('#fin-compare-settle');
  if (!panel) return;
  data = data || state.compareView.lastChartData;
  if (!data || data.flow === 'income') {
    panel.hidden = true;
    return;
  }
  const nameA = data.account_a || state.compareView.accountA;
  const nameB = data.account_b || state.compareView.accountB;
  if (!nameA || !nameB) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const shortA = formatAccountShort(nameA);
  const shortB = formatAccountShort(nameB);
  const shareA = getCompareSharePercent();
  state.compareView.sharePercent = shareA;
  const shareB = 100 - shareA;

  const shareInput = $('#fin-compare-share');
  if (shareInput && Number(shareInput.value) !== shareA) shareInput.value = String(shareA);

  const labelA = $('#fin-compare-share-label-a');
  const labelB = $('#fin-compare-share-label-b');
  if (labelA) labelA.textContent = shortA;
  if (labelB) labelB.textContent = shortB;
  const pctEl = $('#fin-compare-share-pct');
  if (pctEl) pctEl.textContent = `${shareA} / ${shareB}`;
  const endA = $('#fin-compare-share-a-end');
  const endB = $('#fin-compare-share-b-end');
  if (endA) endA.textContent = `${shareA}% ${shortA}`;
  if (endB) endB.textContent = `${shareB}% ${shortB}`;

  const periodEl = $('#fin-compare-settle-period');
  if (periodEl) {
    periodEl.textContent = `${formatComparePeriodLabel()} · ${compareSettleCategoryLabel()}`;
  }

  const { a: spentA, b: spentB } = compareSpendTotals(data);
  const total = spentA + spentB;
  const resultEl = $('#fin-compare-settle-result');
  if (!resultEl) return;

  if (total < 0.005) {
    resultEl.innerHTML = '<p class="fin-compare-settle-verdict">Inga utgifter i perioden.</p>';
    return;
  }

  const targetA = total * (shareA / 100);
  const targetB = total - targetA;
  let transfer = 0;
  let fromName = '';
  let toName = '';
  if (spentA > targetA + 0.005) {
    transfer = spentA - targetA;
    fromName = shortB;
    toName = shortA;
  } else if (spentB > targetB + 0.005) {
    transfer = spentB - targetB;
    fromName = shortA;
    toName = shortB;
  }

  const verdict = transfer < 1
    ? 'Redan jämnt (skillnad under 1 kr)'
    : `${escapeHtml(fromName)} ska föra över ${formatMoney(transfer)} till ${escapeHtml(toName)}`;

  resultEl.innerHTML = `
    <p class="fin-compare-settle-verdict">${verdict}</p>
    <dl class="fin-compare-settle-breakdown">
      <div><dt>${escapeHtml(shortA)}</dt><dd>spenderat ${formatMoney(spentA)} · mål ${formatMoney(targetA)}</dd></div>
      <div><dt>${escapeHtml(shortB)}</dt><dd>spenderat ${formatMoney(spentB)} · mål ${formatMoney(targetB)}</dd></div>
      <div><dt>Totalt</dt><dd>${formatMoney(total)}</dd></div>
    </dl>
  `;
}

function renderCompareChart(data) {
  if (typeof Chart === 'undefined') return;
  destroyChart('compare');
  const ctx = document.getElementById('chart-compare');
  if (!ctx) return;
  if (!data?.series?.length) {
    destroyChart('compare');
    return;
  }
  const labels = data.series.map(r => r.month);
  const selected = state.compareView.selectedMonth;
  const isIncome = data.flow === 'income';
  const labelA = formatAccountShort(data.account_a);
  const labelB = formatAccountShort(data.account_b);
  const fullA = formatAccountFullTitle(data.account_a, getAccountNumber(data.account_a));
  const fullB = formatAccountFullTitle(data.account_b, getAccountNumber(data.account_b));
  const colorA = (idx) => {
    const base = isIncome ? 'rgba(52,211,153,' : 'rgba(124,108,255,';
    const alpha = selected && labels[idx] !== selected ? '0.28)' : '0.85)';
    return base + alpha;
  };
  const colorB = (idx) => {
    const base = isIncome ? 'rgba(45,212,191,' : 'rgba(34,211,238,';
    const alpha = selected && labels[idx] !== selected ? '0.22)' : '0.85)';
    return base + alpha;
  };
  state.charts.compare = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: labelA,
          data: data.series.map(r => r.a),
          backgroundColor: data.series.map((_, i) => colorA(i)),
          borderRadius: 4,
        },
        {
          label: labelB,
          data: data.series.map(r => r.b),
          backgroundColor: data.series.map((_, i) => colorB(i)),
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!elements?.length) return;
        const idx = elements[0].index;
        const month = labels[idx];
        state.compareView.selectedMonth = state.compareView.selectedMonth === month ? '' : month;
        setTxnViewSource('compare');
        renderCompareChart(data);
        updateCompareSettlement(data);
        loadFinanceTransactions();
      },
      plugins: {
        legend: { labels: { color: '#8b93a8' } },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.label || '',
            label: (ctx) => {
              const full = ctx.datasetIndex === 0 ? fullA : fullB;
              return `${full}: ${formatMoney(ctx.parsed.y)}`;
            },
            afterBody: () => (selected ? 'Klicka för att växla månadsfilter' : 'Klicka en månad för att filtrera transaktioner'),
          },
        },
      },
      scales: {
        x: { ticks: { color: '#8b93a8', maxRotation: 45 }, grid: { display: false } },
        y: {
          ticks: { color: '#8b93a8', callback: v => new Intl.NumberFormat('sv-SE', { notation: 'compact' }).format(v) },
          grid: { color: 'rgba(255,255,255,0.05)' },
          beginAtZero: true,
        },
      },
    },
  });
}

function populateFinanceFilterDropdowns(meta) {
  const fill = (sel, items, cur) => {
    if (!sel) return;
    const keep = sel.value || cur || '';
    sel.innerHTML = `<option value="">Alla</option>` + items.map(v =>
      `<option value="${escapeHtml(String(v))}" ${v === keep ? 'selected' : ''}>${escapeHtml(String(v))}</option>`
    ).join('');
  };
  const accountSel = $('#fin-filter-account');
  if (accountSel) {
    const keep = state.financeFilters.account;
    const accounts = normalizeAccountItems(meta.accounts);
    accountSel.innerHTML = `<option value="">Alla konton</option>` + accounts.map(a =>
      `<option value="${escapeHtml(a.name)}" ${a.name === keep ? 'selected' : ''}>${escapeHtml(formatAccountText(a.name, a.account_number))}</option>`
    ).join('');
  }
  fill($('#fin-filter-category'), sortCategoryList(meta.categories || []), state.financeFilters.category);
  fill($('#fin-filter-typ'), meta.typs || [], state.financeFilters.typ);
  const yearSel = $('#fin-filter-year');
  if (yearSel) {
    const keep = state.financeFilters.year;
    yearSel.innerHTML = `<option value="">Alla år</option>` + (meta.years || []).map(y =>
      `<option value="${y}" ${String(y) === keep ? 'selected' : ''}>${y}</option>`
    ).join('');
  }
  const monthSel = $('#fin-filter-month');
  if (monthSel && state.financeFilters.month) {
    monthSel.value = String(state.financeFilters.month);
  }
  updateFinancePeriodUi();
}

async function loadFinance() {
  const errEl = $('#finance-error');
  if (errEl) errEl.textContent = '';
  syncExcludeTransferToggles();
  readFinanceFiltersFromUI();
  syncExcludeOverforingFromGlobal();
  initFinancePeriodControls();
  syncFinancePeriodToQuery();
  updateCompareDateUi();
  const qs = financeQueryString();
  const excl = state.financeFilters.excludeOverforing ? 'true' : 'false';

  // Resilient: one failed call must not blank the whole filter UI.
  const [cfgR, foldersR, dashR, metaR, heroR, loansR] = await Promise.allSettled([
    api('/api/finance/config'),
    api('/api/finance/folders'),
    api('/api/finance/dashboard' + (qs ? '?' + qs : '')),
    api('/api/finance/meta'),
    api('/api/finance/hero?exclude_internal=' + excl),
    api('/api/finance/loans'),
  ]);

  const failures = [];

  if (cfgR.status === 'fulfilled') {
    state.financeConfig = cfgR.value;
    updateAiUiState();
  } else failures.push('konfiguration');

  // Meta drives the filter dropdowns — populate even if other calls failed.
  if (metaR.status === 'fulfilled') {
    state.financeMeta = metaR.value;
    populateFinanceFilterDropdowns(metaR.value);
    populateCompareControls(metaR.value);
  } else {
    failures.push('filteralternativ');
  }

  if (foldersR.status === 'fulfilled') {
    state.financeFolders = foldersR.value.folders || [];
    renderKnownAccounts(state.financeFolders);
    const pending = state.financeFolders.reduce((s, f) => s + (f.pending_files || 0), 0);
    if (pending > 0) {
      $('#process-result').textContent = `${pending} CSV-fil(er) väntar i inbox. Klicka "Importera CSV" för att bearbeta.`;
    }
  } else {
    failures.push('konton');
  }

  if (heroR.status === 'fulfilled') { state.financeHero = heroR.value; renderHero(heroR.value); }
  else failures.push('översikt');

  if (loansR.status === 'fulfilled') { state.financeLoans = loansR.value; renderLoans(loansR.value); }
  else failures.push('lån');

  if (dashR.status === 'fulfilled') {
    const d = state.financeDash = dashR.value;
    const f = state.financeFilters;
    const showSummary = (f.periodMode && f.periodMode !== 'all')
      || !!(f.account || f.category || f.typ || f.search || f.maxAmount || f.dateFrom);
    const sumWrap = $('#fin-summary-wrap');
    if (sumWrap) {
      if (showSummary) {
        const s = d.summary || {};
        const chartExp = s.chart_expense ?? s.expense;
        sumWrap.innerHTML = `
          <div class="fin-kpi"><span class="fin-kpi-value stat-success">${formatMoney(s.income)}</span><span class="fin-kpi-label">Inkomst</span></div>
          <div class="fin-kpi"><span class="fin-kpi-value stat-danger">${formatMoney(chartExp)}</span><span class="fin-kpi-label">Utgift</span></div>
          <div class="fin-kpi"><span class="fin-kpi-value stat-accent">${formatMoney(s.net)}</span><span class="fin-kpi-label">Netto</span></div>
          <div class="fin-kpi"><span class="fin-kpi-value">${s.count ?? 0}</span><span class="fin-kpi-label">Poster</span></div>`;
      } else {
        sumWrap.innerHTML = '<p class="chart-hint" style="grid-column:1/-1;margin:0">Välj period — siffror uppdateras här bredvid diagrammen.</p>';
      }
    }
    renderMonthExpenseBreakdown(d);
    const acctWrap = $('#account-list');
    if (acctWrap) {
      const accounts = d.accounts || [];
      acctWrap.innerHTML = accounts.length ? accounts.map(a => {
        const active = state.financeFilters.account === a.name;
        const num = a.account_number ? `<small>${escapeHtml(a.account_number)}</small>` : '';
        return `<button type="button" class="account-chip${active ? ' active' : ''}" role="option" aria-selected="${active}" data-account="${escapeHtml(a.name)}">
          <span class="account-chip-name">${escapeHtml(a.name)}${num}</span>
          <span class="account-chip-balance">${formatMoney(a.balance)}</span>
        </button>`;
      }).join('') + `<button type="button" class="account-chip${!state.financeFilters.account ? ' active' : ''}" role="option" aria-selected="${!state.financeFilters.account}" data-account="">
          <span class="account-chip-name">Alla konton</span>
          <span class="account-chip-balance">–</span>
        </button>` : '<p class="empty">Inga konton än.</p>';
      acctWrap.querySelectorAll('.account-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          state.financeFilters.account = chip.dataset.account || '';
          if ($('#fin-filter-account')) $('#fin-filter-account').value = state.financeFilters.account;
          setTxnViewSource('global');
          loadFinance();
        });
      });
    }
    renderFinanceCharts(d);
  } else {
    failures.push('dashboard');
  }

  updateActiveFilterSummary();
  await loadAccountCompare();

  if (failures.length && errEl) {
    errEl.textContent = `Kunde inte ladda: ${failures.join(', ')}. Övriga delar uppdaterades. Försök igen.`;
  }
}

function updateActiveFilterSummary() {
  /* Filter state shown via sidebar KPI + breakdown — no separate summary line. */
}

function signedMoneyClass(n) {
  return (n || 0) >= 0 ? 'pos' : 'neg';
}

function renderHero(hero) {
  if (!hero) return;
  setMoneyEl($('#hero-assets'), hero.total_assets, { compact: true });
  const nwEl = $('#hero-net-worth');
  setMoneyEl(nwEl, hero.net_worth, { compact: true });
  if (nwEl) {
    nwEl.classList.remove('pos', 'neg', 'stat-success', 'stat-danger');
    nwEl.classList.add(signedMoneyClass(hero.net_worth));
  }

  const net = hero.net_income || {};
  const setNet = (id, val) => {
    const el = $(id);
    if (!el) return;
    setMoneyEl(el, val, { compact: Math.abs(val || 0) >= 100_000 });
    el.classList.remove('pos', 'neg');
    el.classList.add(signedMoneyClass(val));
  };
  setNet('#hero-net-total', net.avg_total);
  setNet('#hero-net-3m', net.avg_3m);
  setNet('#hero-net-12m', net.avg_12m);

  renderHeroExpenses();
  renderHeroCategoryRolling(hero);
}

function renderHeroCategoryRolling(hero) {
  const sel = $('#hero-category-pick');
  const avgs = hero?.category_averages || {};
  const cats = Object.keys(avgs).sort(
    (a, b) => (avgs[b]?.avg_12m || 0) - (avgs[a]?.avg_12m || 0)
  );
  if (!sel) return;

  if (!cats.length) {
    sel.innerHTML = '<option value="">Inga utgifter</option>';
    ['#hero-cat-total', '#hero-cat-3m', '#hero-cat-12m'].forEach(id => { const el = $(id); if (el) el.textContent = '–'; });
    if ($('#hero-cat-sub')) $('#hero-cat-sub').textContent = 'Ingen utgiftsdata ännu';
    return;
  }

  if (!state.heroCategoryPick || !avgs[state.heroCategoryPick]) {
    state.heroCategoryPick = cats[0];
  }

  sel.innerHTML = cats.map(c =>
    `<option value="${escapeHtml(c)}" ${c === state.heroCategoryPick ? 'selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');

  const pick = avgs[state.heroCategoryPick] || avgs[cats[0]];
  const setExp = (id, val) => {
    const el = $(id);
    if (!el) return;
    setMoneyEl(el, val, { compact: (val || 0) >= 100_000 });
  };
  setExp('#hero-cat-total', pick.avg_total);
  setExp('#hero-cat-3m', pick.avg_3m);
  setExp('#hero-cat-12m', pick.avg_12m);

  const sub = $('#hero-cat-sub');
  if (sub) {
    const excl = getExcludeOverforing() ? ', exkl. interna överföringar' : '';
    sub.textContent = `Månadssnitt för ${state.heroCategoryPick} (${pick.months || 0} månader med data${excl})`;
  }
}

$('#hero-category-pick')?.addEventListener('change', () => {
  state.heroCategoryPick = $('#hero-category-pick')?.value || '';
  localStorage.setItem('bredehall_hero_category', state.heroCategoryPick);
  if (state.financeHero) renderHeroCategoryRolling(state.financeHero);
});

function renderHeroExpenses() {
  const hero = state.financeHero;
  const list = $('#hero-expenses');
  if (!hero || !list) return;
  const range = state.heroExpRange;
  const items = (range === 'year' ? hero.top_expenses_year : hero.top_expenses_month) || [];
  $('#hero-exp-month')?.classList.toggle('active', range === 'month');
  $('#hero-exp-year')?.classList.toggle('active', range === 'year');
  $('#hero-exp-range').textContent = (range === 'year' ? hero.year_label : hero.month_label) || '';

  if (!items.length) {
    list.innerHTML = '<li style="color:var(--text-muted)">Inga utgifter i perioden.</li>';
    return;
  }
  const max = Math.max(...items.map(i => i.amount), 1);
  list.innerHTML = items.map((i, idx) => {
    const hex = financeCategoryHex(i.category);
    return `<li>
      <span class="hero-exp-rank" style="background:${hexToRgba(hex, 0.22)};color:${hex}">${idx + 1}</span>
      <span class="hero-exp-name">${escapeHtml(i.category)}</span>
      <span class="hero-exp-bar"><span style="width:${Math.round((i.amount / max) * 100)}%;background:${hex}"></span></span>
      <span class="hero-exp-amount" style="color:${hex}">${formatMoney(i.amount)}</span>
    </li>`;
  }).join('');
}

$('#hero-exp-month')?.addEventListener('click', () => { state.heroExpRange = 'month'; renderHeroExpenses(); });
$('#hero-exp-year')?.addEventListener('click', () => { state.heroExpRange = 'year'; renderHeroExpenses(); });

function loanRowHtml(loan, { actions = true, preview = false } = {}) {
  const loanIcon = window.BredehallIcons?.iconSvg('building', 'icon') || '';
  const actionBtns = actions ? `
      <div class="loan-actions">
        <button type="button" class="btn btn-sm loan-edit" data-id="${loan.id}">✎</button>
        <button type="button" class="btn btn-sm loan-delete" data-id="${loan.id}">✕</button>
      </div>` : '';
  return `
    <div class="loan-row ${preview ? 'loan-preview-row' : ''}" data-id="${loan.id || ''}">
      <div class="loan-icon" aria-hidden="true">${loanIcon}</div>
      <div class="loan-main">
        <div class="loan-label">${escapeHtml(loan.label || 'Bolån')}</div>
        <div class="loan-number">${escapeHtml(loan.account_number || '')}</div>
        ${loan.typ ? `<div class="loan-meta">${escapeHtml(loan.typ)}</div>` : ''}
      </div>
      <div class="loan-amount">${formatMoney(loan.amount)}</div>
      ${actionBtns}
    </div>`;
}

function bindLoanRowActions(listEl, items) {
  if (!listEl) return;
  listEl.querySelectorAll('.loan-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const loan = items.find(l => String(l.id) === btn.dataset.id);
      if (loan) openLoanModal(loan);
    });
  });
  listEl.querySelectorAll('.loan-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Ta bort detta lån?')) return;
      await api('/api/finance/loans/' + btn.dataset.id, { method: 'DELETE' });
      loadFinance();
    });
  });
}

function renderLoans(data) {
  const items = data?.items || [];
  const total = formatMoney(data?.total_debt ?? 0);
  const totalCompact = formatMoneyCompact(data?.total_debt ?? 0);
  const metaEl = $('#loan-summary-meta');
  if (metaEl) {
    metaEl.innerHTML = items.length
      ? `${items.length} lån · <strong title="${escapeHtml(total)}">${escapeHtml(totalCompact)}</strong>`
      : 'Inga lån registrerade';
  }

  const listEl = $('#loan-list');
  if (!listEl) return;
  listEl.innerHTML = !items.length
    ? '<p class="loan-empty">Lägg till manuellt eller importera från skärmdump.</p>'
    : items.map(loan => loanRowHtml(loan)).join('');
  if (items.length) bindLoanRowActions(listEl, items);
}

function openLoanModal(loan = null) {
  const isEdit = !!loan;
  openModal(`
    <form id="loan-form">
      <div class="field"><label class="label">Namn</label><input class="input" name="label" required value="${escapeHtml(loan?.label || 'Bolån Nordea')}"></div>
      <div class="field"><label class="label">Kontonummer</label><input class="input" name="account_number" required placeholder="3993 65 18128" value="${escapeHtml(loan?.account_number || '')}"></div>
      <div class="field"><label class="label">Belopp (SEK)</label><input class="input" type="number" step="0.01" min="0.01" name="amount" required value="${loan?.amount ?? ''}"></div>
      <div class="field"><label class="label">Typ</label><input class="input" name="typ" value="${escapeHtml(loan?.typ || 'bolån')}"></div>
      <div class="field"><label class="label">Anteckningar</label><textarea class="textarea" name="notes" rows="2">${escapeHtml(loan?.notes || '')}</textarea></div>
    </form>`,
    isEdit ? 'Redigera lån' : 'Nytt lån',
    `<button class="btn btn-primary" id="btn-save-loan">Spara</button>`
  );
  $('#btn-save-loan').onclick = async () => {
    const fd = new FormData($('#loan-form'));
    const body = Object.fromEntries(fd.entries());
    body.amount = parseFloat(body.amount);
    body.notes = body.notes || null;
    if (isEdit) {
      await api('/api/finance/loans/' + loan.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } else {
      await api('/api/finance/loans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    closeModal();
    loadFinance();
  };
}

function renderLoanImportPreview(loans) {
  if (!loans?.length) {
    return '<p class="loan-empty">Inga lån hittades.</p>';
  }
  return `<div class="loan-preview-list">${loans.map(loan => loanRowHtml(loan, { actions: false, preview: true })).join('')}</div>`;
}

function openLoanImportModal() {
  state.loanImportPreview = null;
  openModal(`
    <p class="chart-hint">Ladda upp en skärmdump från bankappen (t.ex. Nordea bolån) eller klistra in text. AI tolkar lånen — granska innan du sparar.</p>
    <div class="field">
      <label class="label">Skärmdump</label>
      <input class="input" type="file" id="loan-image-input" accept="image/*">
    </div>
    <div class="field">
      <label class="label">Eller klistra in text</label>
      <textarea class="textarea" id="loan-paste-text" rows="5" placeholder="Bolån&#10;3993 65 18128 — 1 352 200,00&#10;..."></textarea>
    </div>
    <p class="error hidden" id="loan-import-error"></p>
    <div id="loan-import-preview"></div>`,
    'Importera lån',
    `<button class="btn" id="btn-loan-parse">Tolka</button><button class="btn btn-primary hidden" id="btn-loan-save-import">Spara lån</button>`
  );

  const errEl = $('#loan-import-error');
  const previewEl = $('#loan-import-preview');
  const saveBtn = $('#btn-loan-save-import');

  $('#btn-loan-parse').onclick = async () => {
    errEl.classList.add('hidden');
    errEl.textContent = '';
    previewEl.innerHTML = '<p class="chart-hint">Tolkar…</p>';
    saveBtn.classList.add('hidden');
    state.loanImportPreview = null;

    try {
      const file = $('#loan-image-input')?.files?.[0];
      const text = $('#loan-paste-text')?.value?.trim() || '';
      let result;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        const r = await apiFetch('api/finance/loans/parse-image', { method: 'POST', body: fd });
        if (!r.ok) throw new Error(await r.text() || r.statusText);
        result = await r.json();
      } else if (text) {
        result = await api('/api/finance/loans/parse-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
      } else {
        throw new Error('Välj en bild eller klistra in text.');
      }

      if (!result.ok || !result.loans?.length) {
        throw new Error((result.errors || []).join(' ') || 'Kunde inte tolka lån.');
      }
      state.loanImportPreview = result.loans;
      previewEl.innerHTML = '<h4 class="section-title" style="margin:0.75rem 0 0.5rem">Förhandsgranskning</h4>' + renderLoanImportPreview(result.loans);
      saveBtn.classList.remove('hidden');
    } catch (e) {
      previewEl.innerHTML = '';
      errEl.textContent = e.message;
      errEl.classList.remove('hidden');
    }
  };

  saveBtn.onclick = async () => {
    if (!state.loanImportPreview?.length) return;
    await api('/api/finance/loans/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loans: state.loanImportPreview }),
    });
    closeModal();
    loadFinance();
  };
}

$('#btn-loan-add')?.addEventListener('click', () => openLoanModal());
$('#btn-loan-import')?.addEventListener('click', openLoanImportModal);

function renderFinanceCharts(d) {
  if (typeof Chart === 'undefined') return;
  destroyChart('net');
  destroyChart('expenses');
  destroyChart('incomeExpense');
  destroyChart('categories');
  destroyChart('timeline');

  updateChartExcludeNotes(d);

  const netData = (d.net_income_over_time || []).map(x => x.amount);
  const opts = chartOptions(chartDataMax(netData));
  const optsLegend = { ...opts, plugins: { ...opts.plugins, legend: { display: true, labels: { color: '#8b93a8' } } } };

  const netCtx = $('#chart-net');
  if (netCtx) {
    state.charts.net = new Chart(netCtx, {
      type: 'line',
      data: {
        labels: (d.net_income_over_time || []).map(x => x.month),
        datasets: [{
          label: 'Netto',
          data: netData,
          borderColor: '#7c6cff',
          backgroundColor: 'rgba(124,108,255,0.15)',
          fill: true,
          tension: 0.35,
        }],
      },
      options: opts,
    });
  }

  const ieCtx = $('#chart-income-expense');
  if (ieCtx) {
    const months = [...new Set([
      ...(d.monthly_income || []).map(x => x.month),
      ...(d.monthly_expenses || []).map(x => x.month),
    ])].sort();
    const incomeData = months.map(m => (d.monthly_income || []).find(x => x.month === m)?.amount || 0);
    const expenseData = months.map(m => Math.abs((d.monthly_expenses || []).find(x => x.month === m)?.amount || 0));
    const ieOpts = chartOptions(chartDataMax(incomeData, expenseData));
    ieOpts.plugins = { ...ieOpts.plugins, legend: { display: true, labels: { color: '#8b93a8' } } };
    ieOpts.onClick = chartPickLabel(applyFinanceMonthFromChart);
    state.charts.incomeExpense = new Chart(ieCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          { label: 'Inkomst', data: incomeData, backgroundColor: 'rgba(52,211,153,0.7)', borderRadius: 4 },
          { label: 'Utgift', data: expenseData, backgroundColor: 'rgba(248,113,113,0.7)', borderRadius: 4 },
        ],
      },
      options: ieOpts,
    });
    state.charts.incomeExpense.options.onHover = chartPointerHover(state.charts.incomeExpense);
  }

  const catCtx = $('#chart-categories');
  if (catCtx && (d.expenses_by_category || []).length) {
    const cats = d.expenses_by_category.slice(0, 10);
    const catChartOpts = {
      responsive: true,
      maintainAspectRatio: false,
      onClick: chartPickLabel(applyFinanceCategoryFromChart),
      plugins: {
        legend: { position: 'right', labels: { color: '#8b93a8', boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatMoney(ctx.parsed)}` } },
      },
    };
    state.charts.categories = new Chart(catCtx, {
      type: 'doughnut',
      data: {
        labels: cats.map(c => c.category),
        datasets: [{
          data: cats.map(c => Math.abs(c.amount)),
          backgroundColor: financeCategoryChartColors(cats.map(c => c.category)),
        }],
      },
      options: catChartOpts,
    });
    state.charts.categories.options.onHover = chartPointerHover(state.charts.categories);
  } else if (catCtx) {
    catCtx.getContext('2d').clearRect(0, 0, catCtx.width, catCtx.height);
  }

  const expCtx = $('#chart-expenses');
  if (expCtx) {
    const expRows = d.monthly_expenses || [];
    const expData = expRows.map(x => Math.abs(x.amount));
    const expOpts = chartOptions(chartDataMax(expData));
    expOpts.onClick = chartPickLabel(applyFinanceMonthFromChart);
    expOpts.plugins = {
      ...expOpts.plugins,
      tooltip: {
        callbacks: {
          label(ctx) {
            const row = expRows[ctx.dataIndex];
            const lines = [`Utgifter: ${formatMoney(-Math.abs(row?.amount || ctx.parsed.y))}`];
            if (row?.count) lines.push(`${row.count} transaktioner`);
            for (const c of (row?.by_category || []).slice(0, 4)) {
              lines.push(`  ${c.category}: ${formatMoney(c.amount)}`);
            }
            lines.push('Klicka för att filtrera transaktionslistan');
            return lines;
          },
        },
      },
    };
    state.charts.expenses = new Chart(expCtx, {
      type: 'bar',
      data: {
        labels: expRows.map(x => x.month),
        datasets: [{
          label: 'Utgifter',
          data: expData,
          backgroundColor: 'rgba(244,114,182,0.7)',
          borderRadius: 6,
        }],
      },
      options: expOpts,
    });
    state.charts.expenses.options.onHover = chartPointerHover(state.charts.expenses);
  }

  renderBalanceChart(d);

  // Reset-zoom buttons + double-click to reset
  $$('.chart-reset').forEach(btn => {
    btn.onclick = () => state.charts[btn.dataset.chart]?.resetZoom?.();
  });
  ['net', 'incomeExpense', 'expenses'].forEach(key => {
    const c = state.charts[key];
    if (c?.canvas) c.canvas.ondblclick = () => c.resetZoom?.();
  });
}

const balanceChipPlugin = {
  id: 'balanceChips',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const chips = chart.$balanceChips || [];
    const endLabels = chart.$timelineEndLabels || [];
    if (!meta || !meta.data) return;
    ctx.save();
    ctx.font = '600 11px "DM Sans", system-ui, sans-serif';
    meta.data.forEach((bar, i) => {
      const label = chips[i];
      if (!label) return;
      const textW = ctx.measureText(label).width;
      const padX = 7, h = 18;
      const w = textW + padX * 2;
      let x = bar.x + 8;
      const y = bar.y - h / 2;
      if (x + w > chart.chartArea.right) x = Math.max(chart.chartArea.left, bar.x - w - 8);
      const r = 9;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fillStyle = 'rgba(15,17,23,0.92)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
      ctx.stroke();
      ctx.fillStyle = '#f0f2f8';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + padX, y + h / 2 + 0.5);

      const endLabel = endLabels[i];
      if (endLabel) {
        ctx.font = '500 10px "DM Sans", system-ui, sans-serif';
        ctx.fillStyle = '#8b93a8';
        ctx.textAlign = 'center';
        ctx.fillText(endLabel, bar.x, bar.y + bar.height / 2 + 14);
        ctx.textAlign = 'left';
        ctx.font = '600 11px "DM Sans", system-ui, sans-serif';
      }
    });
    ctx.restore();
  },
};

function tsToYearMonth(ts) {
  const dt = new Date(ts);
  return dt.toLocaleDateString('sv-SE', { year: 'numeric', month: 'short' });
}

function timelineLogTs(ts) {
  // Compress early years, expand recent months on the axis.
  const DAY = 86400000;
  const epoch = new Date('2000-01-01T12:00:00').getTime();
  return Math.log(Math.max(ts - epoch, DAY));
}

function timelineLogToTs(logVal) {
  const epoch = new Date('2000-01-01T12:00:00').getTime();
  return epoch + Math.exp(logVal);
}

function renderBalanceChart(d) {
  const ctx = $('#chart-timeline');
  if (!ctx) return;
  destroyChart('timeline');
  const items = (d.account_timeline || []).filter(a => a.first_date && a.last_date);
  if (!items.length) {
    ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
    return;
  }
  items.sort((a, b) => a.last_date.localeCompare(b.last_date));

  const DAY = 86400000;
  const ends = items.map(a => new Date(a.last_date + 'T12:00:00').getTime());
  const dataMax = Math.max(...ends);
  const dataMin = Math.min(...items.map(a => new Date(a.first_date + 'T12:00:00').getTime()));
  // All bars start at the same left anchor (earliest known data) — missing history is implied.
  const anchorTs = dataMin;
  const xMin = timelineLogTs(anchorTs);
  const xMax = timelineLogTs(dataMax) + 0.08;

  const bars = items.map(a => [timelineLogTs(anchorTs), timelineLogTs(new Date(a.last_date + 'T12:00:00').getTime())]);

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map(a => chartAccountLabel(a)),
      datasets: [{
        data: bars,
        backgroundColor(c) { return accountTimelineGradient(c.chart); },
        borderColor: 'rgba(34, 211, 238, 0.45)',
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
        barThickness: 24,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 12, bottom: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (c) => chartAccountLabel(items[c[0].dataIndex], true),
            label: (c) => {
              const a = items[c.dataIndex];
              return [
                `Senaste transaktion: ${formatDate(a.last_date)}`,
                `Första kända: ${formatDate(a.first_date)}`,
                `Saldo: ${formatMoney(a.balance)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: xMin,
          max: xMax,
          ticks: {
            color: '#8b93a8',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            callback: (v) => {
              const ts = timelineLogToTs(v);
              if (!Number.isFinite(ts)) return '';
              return tsToYearMonth(ts);
            },
          },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: { ticks: { color: '#8b93a8', font: { size: 11 } }, grid: { display: false } },
      },
    },
    plugins: [balanceChipPlugin],
  });
  chart.$balanceChips = items.map(a => a.balance != null ? formatMoney(a.balance) : '');
  chart.$timelineEndLabels = items.map(a => {
    const d2 = new Date(a.last_date + 'T12:00:00');
    return d2.toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' });
  });
  state.charts.timeline = chart;
}

function chartOptions(dataMax = null) {
  const yScale = {
    ticks: {
      color: '#8b93a8',
      callback: (v) => new Intl.NumberFormat('sv-SE', { notation: 'compact', maximumFractionDigits: 1 }).format(v),
    },
    grid: { color: 'rgba(255,255,255,0.05)' },
    beginAtZero: true,
  };
  if (dataMax != null && dataMax > 0) {
    yScale.suggestedMax = Math.ceil(dataMax * 1.15);
  }
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label || ''}: ${formatMoney(ctx.parsed.y)}`,
        },
      },
      zoom: {
        pan: { enabled: true, mode: 'x' },
        zoom: {
          wheel: { enabled: true },
          pinch: { enabled: true },
          drag: { enabled: false },
          mode: 'x',
        },
        limits: { x: { minRange: 2 } },
      },
    },
    scales: {
      x: { ticks: { color: '#8b93a8', maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: yScale,
    },
  };
}

function chartPointerHover(chart) {
  return (event, elements) => {
    if (chart?.canvas) chart.canvas.style.cursor = elements?.length ? 'pointer' : 'default';
  };
}

function chartPickLabel(onPick) {
  return (event, elements, chart) => {
    if (!elements?.length || !chart?.data?.labels) return;
    const label = chart.data.labels[elements[0].index];
    if (label) onPick(label);
  };
}

function applyCategoryFilterFromChart(category) {
  state.categoryView.category = category;
  state.categoryView.onlyOvrigt = false;
  state.categoryView.offset = 0;
  const sel = $('#cat-filter-category');
  if (sel) sel.value = category;
  const ovrigt = $('#cat-only-ovrigt');
  if (ovrigt) ovrigt.checked = false;
  loadCategoryTransactions();
}

function applyFinanceCategoryFromChart(category) {
  state.financeFilters.category = category;
  state.financeFilters.offset = 0;
  state.financeFilters.excludeOverforing = effectiveExcludeOverforing(category);
  const catSel = $('#fin-filter-category');
  if (catSel) catSel.value = category;
  loadFinance();
}

function applyFinanceMonthFromChart(monthLabel) {
  const m = String(monthLabel || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return;
  const y = +m[1];
  const mo = +m[2];
  state.financeFilters.periodMode = 'month';
  state.financeFilters.year = String(y);
  state.financeFilters.month = mo;
  state.financeFilters.offset = 0;
  $('#fin-filter-from').value = '';
  $('#fin-filter-to').value = '';
  const yearSel = $('#fin-filter-year');
  if (yearSel) yearSel.value = String(y);
  const monthSel = $('#fin-filter-month');
  if (monthSel) monthSel.value = String(mo);
  updateFinancePeriodUi();
  loadFinance();
}

function chartDataMax(...datasets) {
  let max = 0;
  for (const ds of datasets) {
    for (const v of ds) {
      const n = Math.abs(Number(v) || 0);
      if (n > max) max = n;
    }
  }
  return max;
}

function updateChartExcludeNotes(d) {
  const ex = d?.chart_excludes;
  const parts = [];
  if (getExcludeOverforing()) parts.push('interna överföringar');
  if (ex?.chart_max_amount > 0) parts.push(`poster > ${formatMoney(ex.chart_max_amount).replace(' kr', '')} kr`);
  if (ex?.dedup_removed) parts.push(`${ex.dedup_removed} dubblett(er)`);
  const text = parts.length
    ? `Från diagram: exkl. ${parts.join(', ')}`
    : '';
  ['#chart-exclude-note-net', '#chart-exclude-note-ie', '#chart-exclude-note-exp'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  });
}

function renderMonthExpenseBreakdown(d) {
  const el = $('#month-expense-breakdown');
  if (!el) return;
  const f = state.financeFilters;
  let monthKey = '';
  if (f.periodMode === 'month' && f.dateFrom) {
    monthKey = f.dateFrom.slice(0, 7);
  } else if (f.dateFrom && f.dateTo && f.dateFrom.slice(0, 7) === f.dateTo.slice(0, 7)) {
    monthKey = f.dateFrom.slice(0, 7);
  }
  if (!monthKey) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  const row = (d.monthly_expenses || []).find(x => x.month === monthKey);
  const cats = row?.by_category?.length ? row.by_category : (d.expenses_by_category || []).slice(0, 8);
  if (!row && !cats.length) {
    el.classList.add('hidden');
    return;
  }
  const total = row ? Math.abs(row.amount) : Math.abs((d.summary?.chart_expense ?? d.summary?.expense) || 0);
  const count = row?.count ?? 0;
  el.classList.remove('hidden');
  el.innerHTML = `
    <h4>${escapeHtml(monthKey)}</h4>
    <div class="fin-breakdown-total">Summa: ${formatMoney(-total)}${count ? ` · ${count} poster` : ''}</div>
    <ul class="fin-breakdown-list">${cats.map(c =>
      `<li><span>${escapeHtml(c.category)}</span><span>${formatMoney(c.amount)}</span></li>`
    ).join('')}</ul>`;
}

function reloadTxnTable() {
  loadFinanceTransactions();
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function exportFilteredTransactionsCsv() {
  const btn = $('#btn-txn-export');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Exporterar…';
  }
  try {
    readFinanceFiltersFromUI();
    if (state.txnViewSource === 'compare') syncCompareAccountsFromUi();
    const pageSize = 500;
    let offset = 0;
    let total = Infinity;
    const rows = [];
    while (offset < total) {
      const qs = financeTxnQueryString({ offset, limit: pageSize });
      const data = await api('/api/finance/transactions?' + qs);
      total = data.total ?? 0;
      const batch = data.items || [];
      rows.push(...batch);
      if (!batch.length) break;
      offset += pageSize;
      if (rows.length >= total) break;
    }
    const header = ['Datum', 'Beskrivning', 'Konto', 'Kontonummer', 'Kategori', 'Belopp', 'Typ'];
    const lines = [header.map(csvEscape).join(';')];
    for (const t of rows) {
      lines.push([
        t.txn_date || '',
        t.description || '',
        t.account || '',
        t.account_number || getAccountNumber(t.account) || '',
        t.category || '',
        t.amount != null ? String(t.amount).replace('.', ',') : '',
        t.typ || '',
      ].map(csvEscape).join(';'));
    }
    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    const src = isCompareTxnMode() ? 'jamforelse' : 'global';
    a.href = url;
    a.download = `bredehall-transaktioner-${src}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`Exporterade ${rows.length} transaktioner`);
  } catch (e) {
    alert('Export misslyckades: ' + (e.message || e));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Exportera CSV';
    }
  }
}

function renderTransactionTable(rows, total) {
  const wrap = $('#txn-table-wrap');
  const f = state.financeFilters;
  $('#txn-count-label').textContent = total ? `(${total} st)` : '';
  if (!rows.length) { wrap.innerHTML = '<p class="empty">Inga transaktioner matchar filtret.</p>'; $('#txn-pagination').innerHTML = ''; return; }

  const sortClass = (col) => `sortable ${f.sortBy === col ? 'sorted-' + f.sortDir : ''}`;
  wrap.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th class="${sortClass('txn_date')}" data-sort="txn_date">Datum</th>
      <th class="${sortClass('description')}" data-sort="description">Beskrivning</th>
      <th class="${sortClass('account')}" data-sort="account">Konto</th>
      <th class="${sortClass('category')}" data-sort="category">Kategori</th>
      <th class="${sortClass('amount')}" data-sort="amount">Belopp</th>
    </tr></thead>
    <tbody>${rows.map(t => `<tr>
      <td>${formatDate(t.txn_date)}</td>
      <td>${escapeHtml(t.description)}</td>
      <td>${formatAccountInlineHtml(t.account, t.account_number)}</td>
      <td>${financeCategoryBadge(t.category)}</td>
      <td class="${t.amount >= 0 ? 'amount-pos' : 'amount-neg'}">${formatMoney(t.amount)}</td>
    </tr>`).join('')}</tbody></table></div>`;

  wrap.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (f.sortBy === col) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
      else { f.sortBy = col; f.sortDir = 'desc'; }
      reloadTxnTable();
    });
  });

  const pages = Math.ceil(total / f.limit);
  const page = Math.floor(f.offset / f.limit) + 1;
  const pag = $('#txn-pagination');
  if (pages <= 1) { pag.innerHTML = ''; return; }
  pag.innerHTML = `
    <button class="btn btn-sm" ${page <= 1 ? 'disabled' : ''} id="txn-prev">← Föreg</button>
    <span style="font-size:0.8rem;color:var(--text-muted);align-self:center">Sida ${page}/${pages}</span>
    <button class="btn btn-sm" ${page >= pages ? 'disabled' : ''} id="txn-next">Nästa →</button>`;
  $('#txn-prev')?.addEventListener('click', () => { f.offset = Math.max(0, f.offset - f.limit); reloadTxnTable(); });
  $('#txn-next')?.addEventListener('click', () => { f.offset += f.limit; reloadTxnTable(); });
}

async function recategorize(method) {
  const el = $('#process-result');
  el.textContent = method === 'ai' ? 'AI kategoriserar… (kan ta en stund med lokal modell)' : 'Kategoriserar om…';
  try {
    const data = await api('/api/finance/recategorize?method=' + method, { method: 'POST' });
    if (method === 'ai') {
      const breakdown = formatCategoryBreakdown(data.by_category);
      el.textContent = `AI klar: ${data.changed} poster uppdaterade (av ${data.processed || 0} okategoriserade).`
        + (data.skipped_uncertain ? ` ${data.skipped_uncertain} lämnades som Övrigt (osäkra).` : '')
        + breakdown
        + (data.errors?.length ? '\n' + data.errors.join('\n') : '');
    } else {
      el.textContent = `Klart: ${data.changed} poster omkategoriserade enligt regler.`
        + (data.el_retagged ? ` (${data.el_retagged} el/elbolag → Boende (el)).` : '')
        + (data.internal_transfers ? ` ${data.internal_transfers} interna överföringar identifierade.` : '');
    }
    loadFinance();
  } catch (e) {
    let msg = e.message;
    try { const j = JSON.parse(msg.substring(msg.indexOf('{'))); msg = j.detail?.message || msg; } catch (_) {}
    el.textContent = 'Fel: ' + msg + (method === 'ai' ? ' — kontrollera att LM Studio-servern körs och att AI är aktiverat i Inställningar.' : '');
  }
}

function formatCategoryBreakdown(byCategory) {
  if (!byCategory || !Object.keys(byCategory).length) return '';
  const lines = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([c, n]) => `  ${c}: ${n}`);
  return '\n\nPer kategori:\n' + lines.join('\n');
}

function sortCategoryList(cats) {
  return [...(cats || [])].sort((a, b) => a.localeCompare(b, 'sv', { sensitivity: 'base' }));
}

async function ensureFinanceCategories(force = false) {
  if (!force && state.financeCategories.length) return state.financeCategories;
  let fromApi = [];
  let fromStatic = [];
  try {
    fromApi = (await api('/api/finance/categories')).categories || [];
  } catch (_) { /* API may be unavailable or stale */ }
  try {
    const r = await fetch(relUrl('static/data/finance-categories.json?_=' + Date.now()), { cache: 'no-store' });
    if (r.ok) fromStatic = (await r.json()).categories || [];
  } catch (_) { /* static fallback optional */ }
  const merged = [...new Set([...fromStatic, ...fromApi])];
  state.financeCategories = sortCategoryList(merged.length ? merged : ['Övrigt']);
  return state.financeCategories;
}

function categoryOptions(selected = '') {
  const cats = sortCategoryList(state.financeCategories.length ? state.financeCategories : ['Övrigt']);
  return cats.map(c => `<option value="${escapeHtml(c)}"${c === selected ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

function confirmSimilarCategory(description, otherCount, category) {
  return new Promise(resolve => {
    const finish = (value) => {
      backdrop?.removeEventListener('click', onBackdrop);
      $('#modal-close')?.removeEventListener('click', onCancel);
      resolve(value);
    };
    const onCancel = () => { closeModal(); finish(null); };
    const onBackdrop = (e) => { if (e.target.id === 'modal-backdrop') onCancel(); };
    openModal(
      `<p>Det finns <strong>${otherCount}</strong> andra transaktioner med samma beskrivning:</p>
       <p class="similar-desc">«${escapeHtml(description)}»</p>
       <p>Vill du sätta kategorin <strong>${escapeHtml(category)}</strong> på alla?</p>
       <p class="similar-desc-hint" style="font-size:0.8rem;color:var(--text-muted);margin-top:0.5rem">Framtida transaktioner med samma beskrivning kategoriseras automatiskt.</p>`,
      'Omkategorisera liknande?',
      `<button class="btn" id="btn-cat-similar-no">Bara denna</button>
       <button class="btn btn-primary" id="btn-cat-similar-yes">Alla ${otherCount + 1}</button>`
    );
    const backdrop = $('#modal-backdrop');
    backdrop?.addEventListener('click', onBackdrop);
    $('#modal-close')?.addEventListener('click', onCancel);
    $('#btn-cat-similar-yes').onclick = () => { closeModal(); finish(true); };
    $('#btn-cat-similar-no').onclick = () => { closeModal(); finish(false); };
  });
}

async function saveTransactionCategory(txnId, category, prevCategory) {
  let similar = { description: '', total: 1, others: 0 };
  try {
    similar = await api(`/api/finance/transactions/${txnId}/similar`);
  } catch (e) {
    // Older server builds may lack /similar — still allow single-txn update.
    if (!String(e.message || '').startsWith('404')) throw e;
  }
  let applyToSimilar = false;
  if (similar.others > 0) {
    const choice = await confirmSimilarCategory(similar.description, similar.others, category);
    if (choice === null) return { cancelled: true, prevCategory };
    applyToSimilar = choice;
  }
  const result = await api(`/api/finance/transactions/${txnId}/category`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, apply_to_similar: applyToSimilar }),
  });
  if (result.updated_count > 1) {
    showToast(`${result.updated_count} transaktioner uppdaterade`);
  }
  return { cancelled: false, result };
}

// ── AI categorization (batch + pause) ───────────────────────────────
const aiState = {
  running: false,
  paused: false,
  total: 0,
  processed: 0,
  changed: 0,
  skipped: 0,
  byCategory: {},
  errors: [],
  retries: 0,
};

function showAiPanel(show) {
  $('#ai-categorize-panel')?.classList.toggle('hidden', !show);
}

function updateAiPanelUI() {
  const pct = aiState.total ? Math.round((aiState.processed / aiState.total) * 100) : 0;
  $('#ai-progress-fill').style.width = pct + '%';
  $('#ai-counter').textContent = `${aiState.processed} / ${aiState.total}`;
  $('#ai-remaining').textContent = `${Math.max(0, aiState.total - aiState.processed)} kvar i kö`;
  $('#ai-btn-pause')?.classList.toggle('hidden', !aiState.running || aiState.paused);
  $('#ai-btn-resume')?.classList.toggle('hidden', !aiState.paused);
}

function renderAiResult() {
  const el = $('#ai-result');
  if (!el) return;
  el.classList.remove('hidden');
  const rows = Object.entries(aiState.byCategory).sort((a, b) => b[1] - a[1]);
  const table = rows.length
    ? `<table><thead><tr><th>Kategori</th><th>Antal</th></tr></thead><tbody>${
        rows.map(([c, n]) => `<tr><td>${escapeHtml(c)}</td><td>${n}</td></tr>`).join('')
      }</tbody></table>`
    : '';
  el.innerHTML = `
    <strong>Resultat:</strong> ${aiState.changed} kategoriserade, ${aiState.skipped} lämnades som Övrigt (osäkra).
    ${table}
    ${aiState.errors.length ? `<div class="ai-errors">${escapeHtml(aiState.errors.join('\n'))}</div>` : ''}`;
}

function mergeAiByCategory(src) {
  if (!src) return;
  for (const [c, n] of Object.entries(src)) {
    aiState.byCategory[c] = (aiState.byCategory[c] || 0) + n;
  }
}

async function runAiCategorization() {
  if (aiState.running && !aiState.paused) return;
  await ensureFinanceCategories();
  showAiPanel(true);
  $('#ai-result')?.classList.add('hidden');
  $('#process-result').textContent = '';

  if (aiState.paused) {
    aiState.paused = false;
    aiState.retries = 0;
  } else {
    const queue = await api('/api/finance/ai/queue');
    if (!queue.total) {
      $('#ai-current').textContent = 'Inga okategoriserade transaktioner (alla är Övrigt och ej manuella).';
      aiState.running = false;
      return;
    }
    aiState.total = queue.total;
    aiState.processed = 0;
    aiState.changed = 0;
    aiState.skipped = 0;
    aiState.byCategory = {};
    aiState.errors = [];
    aiState.retries = 0;
  }

  aiState.running = true;
  updateAiPanelUI();

  while (aiState.running && !aiState.paused) {
    const batchStarted = Date.now();
    const tick = setInterval(() => {
      const s = Math.round((Date.now() - batchStarted) / 1000);
      const el = $('#ai-current');
      if (el) el.textContent = `Skickat till LM Studio… (${s}s)`;
    }, 1000);
    $('#ai-current').textContent = 'Skickat till LM Studio…';
    try {
      const batch = await api('/api/finance/ai/batch', { method: 'POST' });
      clearInterval(tick);
      const elapsed = batch.elapsed_seconds != null
        ? ` (${batch.elapsed_seconds}s)`
        : '';
      if (batch.current) {
        $('#ai-current').textContent = 'Kategoriserar: ' + batch.current + elapsed;
      } else if (batch.ok) {
        $('#ai-current').textContent = 'Batch klar' + elapsed;
      }
      if (batch.ok && batch.batch_size) {
        aiState.changed += batch.changed || 0;
        aiState.skipped += (batch.skipped_uncertain || []).length;
        mergeAiByCategory(batch.by_category);
        aiState.retries = 0;
      }
      if (typeof batch.remaining === 'number' && aiState.total) {
        aiState.processed = Math.max(aiState.processed, aiState.total - batch.remaining);
      } else if (batch.ok && batch.batch_size) {
        aiState.processed += batch.batch_size;
      }
      if (batch.errors?.length) {
        aiState.errors.push(...batch.errors);
        const last = batch.errors[batch.errors.length - 1];
        if (!batch.ok) $('#ai-current').textContent = last;
      }
      aiState.total = Math.max(aiState.total, aiState.processed + (batch.remaining || 0));
      updateAiPanelUI();

      if (batch.done || (batch.ok && !batch.batch_size)) {
        aiState.running = false;
        $('#ai-current').textContent = 'Klar!';
        renderAiResult();
        loadFinance();
        break;
      }
      if (!batch.ok && batch.errors?.length) {
        aiState.retries += 1;
        $('#ai-current').textContent = `Batchfel — försöker igen (${aiState.retries}/8)… ${batch.errors[batch.errors.length - 1]}`;
        if (aiState.retries > 8) {
          aiState.running = false;
          $('#ai-current').textContent = 'Stoppad efter upprepade batchfel.';
          renderAiResult();
          loadFinance();
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      clearInterval(tick);
      aiState.errors.push(e.message);
      aiState.retries += 1;
      $('#ai-current').textContent = `Fel — försöker igen (${aiState.retries}/8)… ${e.message}`;
      await new Promise(r => setTimeout(r, 2500));
      if (aiState.retries > 8) {
        aiState.running = false;
        renderAiResult();
        loadFinance();
        break;
      }
    }
  }
}

function pauseAiCategorization() {
  if (!aiState.running) return;
  aiState.paused = true;
  aiState.running = false;
  updateAiPanelUI();
  const saved = aiState.changed;
  const left = Math.max(0, aiState.total - aiState.processed);
  const msg = saved
    ? `${saved} transaktioner är redan sparade. ${left} återstår i kö.\n\nVill du stoppa här? (Sparade ändringar behålls.)`
    : `Inget sparat ännu. ${left} återstår.\n\nVill du avbryta?`;
  if (confirm(msg)) {
    $('#ai-current').textContent = `Pausad — ${saved} sparade, ${left} kvar.`;
    renderAiResult();
    loadFinance();
  } else {
    aiState.paused = false;
    runAiCategorization();
  }
}

$('#btn-recategorize')?.addEventListener('click', () => recategorize('rules'));
$('#btn-recategorize-ai')?.addEventListener('click', () => runAiCategorization());
$('#ai-btn-pause')?.addEventListener('click', pauseAiCategorization);
$('#ai-btn-resume')?.addEventListener('click', () => runAiCategorization());
$('#ai-btn-close')?.addEventListener('click', () => {
  if (aiState.running) {
    if (!confirm('AI-körning pågår — pausa och stäng?')) return;
    aiState.paused = true;
    aiState.running = false;
  }
  showAiPanel(false);
});
$('#btn-go-categories')?.addEventListener('click', () => setPage('categories'));

const applyFilters = () => {
  readFinanceFiltersFromUI();
  setTxnViewSource('global');
  loadFinance();
};

$('#fin-filter-reset')?.addEventListener('click', () => {
  const now = new Date();
  state.financeFilters = {
    account: '', year: String(now.getFullYear()), category: '', typ: '',
    periodMode: 'month', month: now.getMonth() + 1,
    dateFrom: '', dateTo: '', search: '',
    excludeOverforing: getExcludeOverforing(), maxAmount: 0, chartMaxAmount: 100000,
    sortBy: 'txn_date', sortDir: 'desc', offset: 0, limit: 50,
  };
  state.compareView.selectedMonth = '';
  setTxnViewSource('global');
  ['fin-filter-account', 'fin-filter-category', 'fin-filter-typ', 'fin-filter-from', 'fin-filter-to', 'fin-filter-search'].forEach(id => {
    const el = $('#' + id);
    if (el) el.value = '';
  });
  if ($('#fin-filter-year')) $('#fin-filter-year').value = state.financeFilters.year;
  if ($('#fin-filter-month')) $('#fin-filter-month').value = String(state.financeFilters.month);
  if ($('#fin-filter-cap')) $('#fin-filter-cap').checked = false;
  syncExcludeTransferToggles();
  updateFinancePeriodUi();
  loadFinance();
});
['fin-filter-account', 'fin-filter-year', 'fin-filter-category', 'fin-filter-typ', 'fin-filter-cap'].forEach(id => {
  $('#' + id)?.addEventListener('change', applyFilters);
});
$('#fin-filter-search')?.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
$('#fin-filter-search')?.addEventListener('input', debounce(applyFilters, 400));
$('#fin-filter-exclude-transfers')?.addEventListener('change', () => {
  setExcludeOverforing(!!$('#fin-filter-exclude-transfers')?.checked);
  setTxnViewSource('global');
  loadFinance();
});

function activateCompareTxnSource() {
  setTxnViewSource('compare');
  loadAccountCompare();
}

$('#fin-compare-run')?.addEventListener('click', () => {
  state.compareView.selectedMonth = '';
  activateCompareTxnSource();
});
['fin-compare-a', 'fin-compare-b', 'fin-compare-span', 'fin-compare-categories'].forEach(id => {
  $('#' + id)?.addEventListener('change', () => {
    state.compareView.selectedMonth = '';
    if (id === 'fin-compare-span') {
      updateCompareDateUi();
      if ($('#fin-compare-span')?.value === 'custom') {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth() + 1;
        if (!$('#fin-compare-from')?.value && $('#fin-compare-from')) {
          $('#fin-compare-from').value = `${y - 1}-${String(m).padStart(2, '0')}-01`;
        }
        if (!$('#fin-compare-to')?.value && $('#fin-compare-to')) {
          $('#fin-compare-to').value = now.toISOString().slice(0, 10);
        }
      }
    }
    if (id === 'fin-compare-categories' && $('#fin-compare-categories')?.value === 'Överföring') {
      state.compareView.includeTransfers = true;
      syncCompareTransferToggle();
    }
    activateCompareTxnSource();
  });
});
['fin-compare-from', 'fin-compare-to'].forEach(id => {
  $('#' + id)?.addEventListener('change', () => {
    if ($('#fin-compare-span')) $('#fin-compare-span').value = 'custom';
    updateCompareDateUi();
    state.compareView.selectedMonth = '';
    activateCompareTxnSource();
  });
});
$('#fin-compare-include-transfers')?.addEventListener('change', () => {
  state.compareView.includeTransfers = $('#fin-compare-include-transfers')?.checked ?? false;
  state.compareView.selectedMonth = '';
  updateCompareExcludeNote();
  activateCompareTxnSource();
});
$('#fin-compare-share')?.addEventListener('input', () => {
  state.compareView.sharePercent = getCompareSharePercent();
  updateCompareSettlement(state.compareView.lastChartData);
});
$('#btn-txn-export')?.addEventListener('click', exportFilteredTransactionsCsv);

function formatImportSummary(proc) {
  if (!proc) return '';
  const added = proc.transactions_added || 0;
  const skipped = proc.transactions_skipped || 0;
  let s = `${added} nya transaktioner`;
  if (skipped) s += `, ${skipped} dubbletter hoppades över`;
  if (added === 0 && skipped > 0) s += ' (filen var redan importerad)';
  if (added === 0 && skipped === 0 && proc.files_processed > 0) s += ' (inga nya rader i CSV — kontrollera rätt konto)';
  return s;
}

const EVENT_TYPE_LABELS = {
  csv_import: 'CSV-import',
  manual_txn: 'Manuell post',
  account_created: 'Nytt konto',
  batch_process: 'Batch-import',
  ai_categorize: 'AI-kategorisering',
};

function formatLogTimestamp(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
}

const LOG_VIEW_HINTS = {
  activity: 'Sammanfattning av CSV-uppladdningar, nya konton och manuella transaktioner.',
  ai: 'Varje AI-beslut: tidigare kategori → vald kategori, konfidens och om raden låstes (inkl. Övrigt).',
  locked: 'Låsta icke-manuella rader — visar även äldre AI-granskningar som saknar körningslogg. Manuellt låsta rader kan ingå.',
};

function buildImportSummaryHtml(result) {
  const parts = [];
  const byAccount = result?.by_account || [];
  const unknown = result?.unknown_files || [];
  const rerouted = result?.rerouted || [];

  if (byAccount.length) {
    parts.push('<ul class="import-summary-list">');
    for (const row of byAccount) {
      let line = `<li><strong>${escapeHtml(row.account)}</strong>: ${row.added || 0} transaktioner importerade`;
      if (row.skipped) line += ` (${row.skipped} dubbletter hoppades över)`;
      if (row.files?.length) {
        line += `<div class="import-summary-files">${row.files.map(f => escapeHtml(f)).join(', ')}</div>`;
      }
      line += '</li>';
      parts.push(line);
    }
    parts.push('</ul>');
  } else if (result) {
    parts.push(`<p>${escapeHtml(formatImportSummary(result))}</p>`);
    if (result.files_processed) {
      parts.push(`<p class="import-summary-meta">${result.files_processed} fil(er) bearbetade.</p>`);
    }
  }

  if (rerouted.length) {
    parts.push('<p class="import-summary-warn">Filer tilldelades annat konto än inbox-mappen:</p><ul class="import-summary-list">');
    for (const r of rerouted) {
      parts.push(`<li>${escapeHtml(r.filename)}: ${escapeHtml(r.from_account)} → <strong>${escapeHtml(r.to_account)}</strong></li>`);
    }
    parts.push('</ul>');
  }

  if (unknown.length) {
    parts.push(`<p class="import-summary-warn">${unknown.length} fil(er) hade inget känt konto och importerades inte:</p>`);
    parts.push('<ul class="import-summary-list">');
    for (const u of unknown) {
      parts.push(`<li><strong>${escapeHtml(u.filename)}</strong> (i ${escapeHtml(u.inbox_account)}, ${u.row_count || 0} rader)</li>`);
    }
    parts.push('</ul>');
  }

  if (result?.errors?.length) {
    parts.push(`<pre class="import-summary-errors">${result.errors.map(e => escapeHtml(e)).join('\n')}</pre>`);
  }

  return parts.join('');
}

function showImportSummaryModal(result, title = 'Import klar') {
  return new Promise(resolve => {
    const unknown = result?.unknown_files || [];
    const body = buildImportSummaryHtml(result) || '<p>Ingen import genomfördes.</p>';
    const actions = unknown.length
      ? `<button class="btn" id="btn-import-summary-later">Stäng</button><button class="btn btn-primary" id="btn-import-summary-create">Skapa konto för okända filer…</button>`
      : `<button class="btn btn-primary" id="btn-import-summary-ok">OK</button>`;

    openModal(body, title, actions);

    const finish = (value) => { closeModal(); resolve(value); };
    $('#btn-import-summary-ok')?.addEventListener('click', () => finish(null));
    $('#btn-import-summary-later')?.addEventListener('click', () => finish(null));
    $('#btn-import-summary-create')?.addEventListener('click', () => finish('create_unknown'));
  });
}

async function openUnknownAccountsModal(unknownFiles) {
  if (!unknownFiles?.length) return;
  for (const file of unknownFiles) {
    const name = prompt(
      `Skapa konto för "${file.filename}" (${file.row_count || 0} rader)?\n\nAnge kontonamn (Avbryt = hoppa över):`,
      file.detection?.detected_account || ''
    );
    if (!name?.trim()) continue;
    await api('/api/finance/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    showToast(`Konto "${name.trim()}" skapat — flytta filen till dess inbox och kör import igen.`);
  }
}

async function handleImportResult(result, title = 'Import klar') {
  if (!result) return;
  const action = await showImportSummaryModal(result, title);
  if (action === 'create_unknown' && result.unknown_files?.length) {
    await openUnknownAccountsModal(result.unknown_files);
  }
  const el = $('#process-result');
  if (el) {
    el.textContent = result.transactions_added
      ? `Klart: ${formatImportSummary(result)}`
      : (result.unknown_files?.length ? `${result.unknown_files.length} fil(er) väntar på konto.` : 'Import klar (inga nya rader).');
  }
}

async function processBankFiles() {
  const el = $('#process-result');
  el.textContent = 'Importerar…';
  try {
    const data = await api('/api/finance/process', { method: 'POST' });
    await handleImportResult(data, 'Import klar');
    loadFinance();
    if (state.page === 'home') loadHome();
  } catch (e) { el.textContent = 'Fel: ' + e.message; }
}

function openManualTxnModal() {
  const accounts = Object.keys(state.financeConfig?.folder_map || {});
  openModal(`
    <form id="manual-txn-form">
      <div class="field"><label class="label">Datum</label><input class="input" type="date" name="txn_date" required value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="field"><label class="label">Belopp</label><input class="input" type="number" step="0.01" name="amount" required placeholder="45000"></div>
      <div class="field"><label class="label">Konto</label><input class="input" name="account" list="account-list-dl" required placeholder="Lysa Patrik"></div>
      <datalist id="account-list-dl">${accounts.map(a => `<option value="${escapeHtml(a)}" label="${escapeHtml(formatAccountText(a))}">`).join('')}</datalist>
      <div class="field"><label class="label">Beskrivning</label><input class="input" name="description"></div>
      <div class="field"><label class="label">Saldo (valfritt)</label><input class="input" type="number" step="0.01" name="balance"></div>
      <div class="field"><label class="label">Kategori (valfritt)</label><input class="input" name="category" placeholder="Lysa"></div>
    </form>`,
    'Manuell post',
    `<button class="btn btn-primary" id="btn-save-manual">Spara</button>`
  );
  $('#btn-save-manual').onclick = async () => {
    const fd = new FormData($('#manual-txn-form'));
    const body = Object.fromEntries(fd.entries());
    body.amount = parseFloat(body.amount);
    body.balance = body.balance ? parseFloat(body.balance) : null;
    body.category = body.category || null;
    await api('/api/finance/manual', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    closeModal();
    await showImportSummaryModal({
      by_account: [{ account: body.account, added: 1, skipped: 0, files: [] }],
      transactions_added: 1,
      transactions_skipped: 0,
      files_processed: 0,
      unknown_files: [],
      rerouted: [],
      errors: [],
    }, 'Manuell post sparad');
    loadFinance();
  };
}

$('#btn-process')?.addEventListener('click', processBankFiles);
$('#btn-manual-txn')?.addEventListener('click', openManualTxnModal);
$('#btn-finance-log')?.addEventListener('click', () => setPage('finance-log'));

// ── Finance activity log ─────────────────────────────────────────────
state.financeLogOffset = 0;
state.financeLogView = 'activity';
const FINANCE_LOG_LIMIT = 50;

function syncLogViewUi() {
  const view = state.financeLogView || 'activity';
  $$('#log-view-toggle [data-log-view]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.logView === view);
  });
  const hint = $('#finance-log-hint');
  if (hint) hint.textContent = LOG_VIEW_HINTS[view] || LOG_VIEW_HINTS.activity;
  const ovrigtWrap = $('#log-ovrigt-wrap');
  if (ovrigtWrap) ovrigtWrap.classList.toggle('hidden', view === 'activity');
}

function renderLogPagination(pageEl, total) {
  if (!pageEl) return;
  const prev = state.financeLogOffset > 0;
  const next = state.financeLogOffset + FINANCE_LOG_LIMIT < total;
  pageEl.innerHTML = `
    <span class="task-meta">${total} poster</span>
    ${prev ? '<button class="btn btn-sm" id="log-prev">← Tidigare</button>' : ''}
    ${next ? '<button class="btn btn-sm" id="log-next">Senare →</button>' : ''}`;
  $('#log-prev')?.addEventListener('click', () => {
    state.financeLogOffset = Math.max(0, state.financeLogOffset - FINANCE_LOG_LIMIT);
    loadFinanceLog();
  });
  $('#log-next')?.addEventListener('click', () => {
    state.financeLogOffset += FINANCE_LOG_LIMIT;
    loadFinanceLog();
  });
}

function formatLogConfidence(conf) {
  if (conf == null || conf === '') return '–';
  const n = Number(conf);
  if (Number.isNaN(n)) return '–';
  return `${Math.round(n * 100)}%`;
}

function renderAiDecisionRows(items) {
  const onlyOvrigt = $('#log-only-ovrigt')?.checked;
  const filtered = onlyOvrigt ? items.filter(i => i.is_ovrigt || i.category === 'Övrigt') : items;
  if (!filtered.length) {
    return '<p class="chart-hint">Inga AI-beslut att visa' + (onlyOvrigt ? ' (för Övrigt).' : '.') + '</p>';
  }
  return `
    <table class="data-table activity-log-table">
      <thead><tr>
        <th>Tid</th><th>Beskrivning</th><th>Belopp</th><th>Datum</th><th>Konto</th>
        <th>Före</th><th>AI valde</th><th>Konfidens</th><th></th>
      </tr></thead>
      <tbody>
        ${filtered.map(row => {
          const ovrigt = row.is_ovrigt || row.category === 'Övrigt';
          const catCls = ovrigt ? 'log-cat-ovrigt' : '';
          return `<tr class="${ovrigt ? 'log-row-ovrigt' : ''}">
            <td class="nowrap">${formatLogTimestamp(row.created_at)}</td>
            <td class="log-desc">${escapeHtml(row.description || '')}</td>
            <td class="nowrap">${formatMoney(row.amount)}</td>
            <td class="nowrap">${row.txn_date ? escapeHtml(String(row.txn_date).slice(0, 10)) : '–'}</td>
            <td>${row.account ? escapeHtml(row.account) : '–'}</td>
            <td>${escapeHtml(row.previous_category || '–')}</td>
            <td class="${catCls}">${escapeHtml(row.category || '–')}${ovrigt ? '<span class="log-badge">Övrigt</span>' : ''}</td>
            <td class="log-conf">${formatLogConfidence(row.confidence)}</td>
            <td>${row.locked ? 'Låst' : '–'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function loadFinanceLogActivity(tableEl, pageEl) {
  const data = await api(`/api/finance/activity-log?limit=${FINANCE_LOG_LIMIT}&offset=${state.financeLogOffset}`);
  if (!data.items?.length) {
    tableEl.innerHTML = '<p class="chart-hint">Ingen aktivitet loggad ännu.</p>';
    if (pageEl) pageEl.innerHTML = '';
    return;
  }
  tableEl.innerHTML = `
    <table class="data-table activity-log-table">
      <thead><tr>
        <th>Tid</th><th>Händelse</th><th>Konto</th><th>Fil</th><th>Antal</th><th>Sammanfattning</th>
      </tr></thead>
      <tbody>
        ${data.items.map(row => `
          <tr class="${row.event_type === 'ai_categorize' ? 'log-row-ai' : ''}">
            <td class="nowrap">${formatLogTimestamp(row.created_at)}</td>
            <td>${escapeHtml(EVENT_TYPE_LABELS[row.event_type] || row.event_type)}</td>
            <td>${row.account ? escapeHtml(row.account) : '–'}</td>
            <td>${row.filename ? escapeHtml(row.filename) : '–'}</td>
            <td>${row.transaction_count || 0}${row.skipped_count ? ` <span class="muted">(+${row.skipped_count} ${row.event_type === 'ai_categorize' ? 'Övrigt' : 'hoppade'})</span>` : ''}</td>
            <td>${escapeHtml(row.summary || '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  renderLogPagination(pageEl, data.total);
}

async function loadFinanceLogAi(tableEl, pageEl) {
  // Fetch more batch rows so expanded decisions fill the page after Övrigt filter
  const batchLimit = FINANCE_LOG_LIMIT;
  const data = await api(`/api/finance/activity-log?event_type=ai_categorize&limit=${batchLimit}&offset=${state.financeLogOffset}`);
  const expanded = [];
  for (const row of data.items || []) {
    const items = row.details?.items || [];
    if (!items.length) {
      expanded.push({
        created_at: row.created_at,
        description: row.summary,
        amount: null,
        txn_date: null,
        account: row.account,
        previous_category: '–',
        category: '–',
        confidence: null,
        is_ovrigt: false,
        locked: true,
      });
      continue;
    }
    for (const it of items) {
      expanded.push({ ...it, created_at: row.created_at });
    }
  }
  if (!data.items?.length) {
    tableEl.innerHTML = '<p class="chart-hint">Inga AI-körningar loggade ännu. Kör AI under Ekonomi — nya beslut visas här. Äldre låsta rader finns under «Låsta (historik)».</p>';
    if (pageEl) pageEl.innerHTML = '';
    return;
  }
  tableEl.innerHTML = renderAiDecisionRows(expanded);
  renderLogPagination(pageEl, data.total);
}

async function loadFinanceLogLocked(tableEl, pageEl) {
  const onlyOvrigt = $('#log-only-ovrigt')?.checked ? 'true' : 'false';
  const data = await api(
    `/api/finance/ai/reviewed?only_ovrigt=${onlyOvrigt}&limit=${FINANCE_LOG_LIMIT}&offset=${state.financeLogOffset}`
  );
  if (!data.items?.length) {
    tableEl.innerHTML = '<p class="chart-hint">Inga låsta transaktioner att visa.</p>';
    if (pageEl) pageEl.innerHTML = '';
    return;
  }
  tableEl.innerHTML = `
    <table class="data-table activity-log-table">
      <thead><tr>
        <th>ID</th><th>Beskrivning</th><th>Belopp</th><th>Datum</th><th>Konto</th><th>Kategori</th><th></th>
      </tr></thead>
      <tbody>
        ${data.items.map(row => {
          const ovrigt = row.is_ovrigt || row.category === 'Övrigt';
          return `<tr class="${ovrigt ? 'log-row-ovrigt' : ''}">
            <td class="nowrap">${row.id}</td>
            <td class="log-desc">${escapeHtml(row.description || '')}</td>
            <td class="nowrap">${formatMoney(row.amount)}</td>
            <td class="nowrap">${row.txn_date ? escapeHtml(String(row.txn_date).slice(0, 10)) : '–'}</td>
            <td>${escapeHtml(row.account || '')}</td>
            <td class="${ovrigt ? 'log-cat-ovrigt' : ''}">${escapeHtml(row.category || '')}${ovrigt ? '<span class="log-badge">Övrigt</span>' : ''}</td>
            <td>Låst</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  renderLogPagination(pageEl, data.total);
}

async function loadFinanceLog() {
  const tableEl = $('#finance-log-table');
  const pageEl = $('#finance-log-pagination');
  if (!tableEl) return;
  syncLogViewUi();
  tableEl.innerHTML = '<p class="chart-hint">Laddar…</p>';
  try {
    const view = state.financeLogView || 'activity';
    if (view === 'ai') await loadFinanceLogAi(tableEl, pageEl);
    else if (view === 'locked') await loadFinanceLogLocked(tableEl, pageEl);
    else await loadFinanceLogActivity(tableEl, pageEl);
  } catch (e) {
    tableEl.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

$('#btn-log-refresh')?.addEventListener('click', () => { state.financeLogOffset = 0; loadFinanceLog(); });
$('#log-only-ovrigt')?.addEventListener('change', () => { state.financeLogOffset = 0; loadFinanceLog(); });
$$('#log-view-toggle [data-log-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.financeLogView = btn.dataset.logView || 'activity';
    state.financeLogOffset = 0;
    loadFinanceLog();
  });
});

// ── Drop zone & file upload ───────────────────────────────────────────
let uploadQueue = [];

function renderKnownAccounts(folders) {
  const el = $('#known-accounts');
  if (!el) return;
  if (!(folders || []).length) { el.innerHTML = ''; return; }
  const pending = (folders || []).filter(f => f.pending_files > 0);
  el.innerHTML =
    'Kända konton: ' + folders.map(f => {
      const label = formatAccountFullTitle(f.name, f.account_number);
      return `<span class="acc-tag" title="${escapeHtml(label)}">${escapeHtml(formatAccountShort(f.name))}</span>`;
    }).join('') +
    (pending.length ? `<br><span style="color:var(--accent-warm)">${pending.reduce((s, f) => s + f.pending_files, 0)} fil(er) väntar på import</span>` : '');
}

function initDropZone() {
  const zone = $('#drop-zone');
  const input = $('#file-input');
  if (!zone || !input) return;

  zone.addEventListener('click', e => {
    if (e.target.closest('#btn-browse-files') || e.target === zone || e.target.closest('.drop-zone-title') || e.target.closest('.drop-zone-sub') || e.target.closest('.drop-zone-icon')) {
      delete input.dataset.targetAccount;
      input.click();
    }
  });
  $('#btn-browse-files')?.addEventListener('click', e => { e.stopPropagation(); delete input.dataset.targetAccount; input.click(); });

  ['dragenter', 'dragover'].forEach(ev => {
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(ev => {
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('dragover'); });
  });
  zone.addEventListener('drop', e => {
    handleDroppedFiles(e.dataTransfer.files, input.dataset.targetAccount || null);
  });
  input.addEventListener('change', () => {
    if (input.files?.length) handleDroppedFiles(input.files, input.dataset.targetAccount || null);
    input.value = '';
    delete input.dataset.targetAccount;
  });
}

async function handleDroppedFiles(fileList, forcedAccount = null) {
  const files = [...fileList].filter(f => f.name.toLowerCase().endsWith('.csv') || f.type.includes('csv') || f.type === 'text/plain');
  if (!files.length) {
    alert('Endast CSV-filer stöds.');
    return;
  }
  for (const file of files) {
    await processUploadFile(file, forcedAccount);
  }
}

async function detectFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await apiFetch('api/finance/detect', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function uploadFileToAccount(file, account, autoProcess = true) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('account', account);
  fd.append('auto_process', autoProcess ? 'true' : 'false');
  const r = await apiFetch('api/finance/upload', { method: 'POST', body: fd });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.detail?.message || JSON.stringify(err.detail) || r.statusText);
  }
  return r.json();
}

function openAccountPickerModal(file, detection, forcedAccount = null) {
  return new Promise(resolve => {
    const accounts = detection.accounts || Object.keys(state.financeConfig?.folder_map || {});
    const candidates = detection.candidates || [];
    const suggested = forcedAccount || detection.detected_account
      || (candidates[0]?.score >= 0.25 ? candidates[0].account : null);

    const candidateBtns = accounts.map(acc => {
      const hit = candidates.find(c => c.account === acc);
      const isSuggested = acc === suggested;
      return `<button type="button" class="account-pick-btn ${isSuggested ? 'suggested' : ''}" data-account="${escapeHtml(acc)}">
        <span>${formatAccountInlineHtml(acc)}${isSuggested ? ' ✓ föreslagen' : ''}</span>
        ${hit ? `<span class="score">${Math.round(hit.score * 100)}%</span>` : ''}
      </button>`;
    }).join('');

    openModal(`
      <p style="font-size:0.875rem;color:var(--text-muted);margin:0 0 0.75rem">
        Fil: <strong>${escapeHtml(file.name)}</strong>
        ${detection.auto_detected ? `<br>Auto-detekterat: <strong>${escapeHtml(detection.detected_account)}</strong> (${Math.round(detection.confidence * 100)}%)` : '<br>Kunde inte avgöra konto automatiskt.'}
      </p>
      <p class="label" style="margin:0 0 0.35rem">Välj befintligt konto:</p>
      <div class="account-pick-list" id="account-pick-list">${candidateBtns}</div>
      <p class="label" style="margin:0.9rem 0 0.35rem">⚠️ Eller skapa ett <strong>nytt</strong> konto i appen:</p>
      <div class="create-folder-row">
        <input class="input" id="new-folder-name" placeholder="Nytt kontonamn…">
        <button type="button" class="btn btn-sm" id="btn-create-folder-pick">Skapa nytt</button>
      </div>
      <label style="display:flex;align-items:center;gap:0.5rem;margin-top:0.75rem;font-size:0.85rem;color:var(--text-muted)">
        <input type="checkbox" id="upload-auto-process" checked> Importera direkt efter uppladdning
      </label>`,
      'Välj konto-mapp',
      `<button class="btn" id="btn-cancel-upload">Avbryt</button>`
    );

    let picked = suggested && detection.auto_detected ? suggested : null;

    $$('#account-pick-list .account-pick-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        picked = btn.dataset.account;
        const autoProcess = $('#upload-auto-process')?.checked ?? true;
        closeModal();
        resolve({ account: picked, autoProcess });
      });
    });

    $('#btn-create-folder-pick').onclick = async () => {
      const name = $('#new-folder-name')?.value?.trim();
      if (!name) return alert('Ange kontonamn');
      await api('/api/finance/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      picked = name;
      const autoProcess = $('#upload-auto-process')?.checked ?? true;
      closeModal();
      resolve({ account: picked, autoProcess });
    };

    $('#btn-cancel-upload').onclick = () => { closeModal(); resolve(null); };
  });
}

async function processUploadFile(file, forcedAccount = null) {
  const resultEl = $('#process-result');
  resultEl.textContent = `Analyserar ${file.name}…`;
  try {
    let account = forcedAccount;
    let autoProcess = true;

    if (account) {
      resultEl.textContent = `Laddar upp till ${account}…`;
    } else {
      const detection = await detectFile(file);
      if (detection.auto_detected && detection.detected_account) {
        account = detection.detected_account;
        resultEl.textContent = `Laddar upp till ${account} (auto-detekterat)…`;
      } else {
        const pick = await openAccountPickerModal(file, detection);
        if (!pick) { resultEl.textContent = 'Uppladdning avbruten.'; return; }
        account = pick.account;
        autoProcess = pick.autoProcess;
        resultEl.textContent = `Laddar upp till ${account}…`;
      }
    }

    const res = await uploadFileToAccount(file, account, autoProcess);
    if (res.process) {
      await handleImportResult(res.process, `Uppladdning: ${file.name}`);
    } else {
      resultEl.textContent = `✓ ${file.name} sparad i inbox för ${res.account} (väntar på import)`;
    }
    loadFinance();
    if (state.page === 'home') loadHome();
  } catch (e) {
    resultEl.textContent = 'Fel: ' + (e.message || e);
  }
}

initDropZone();

// ── Settings ─────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    state.financeConfig = await api('/api/finance/config');
    const cfg = state.financeConfig;
    $('#storage-local').classList.toggle('active', cfg.storage_mode !== 'gdrive');
    $('#storage-gdrive').classList.toggle('active', cfg.storage_mode === 'gdrive');
    $('#cfg-archive').value = cfg.archive_folder_id || '';
    $('#cfg-regex').value = cfg.own_accounts_regex || '';
    $('#cfg-gdrive-path').value = cfg.gdrive_credentials_path || '';
    if ($('#cfg-ai-enabled')) $('#cfg-ai-enabled').checked = !!cfg.ai_enabled;
    if ($('#cfg-ai-url')) $('#cfg-ai-url').value = cfg.ai_base_url || '';
    const aiKeyEl = $('#cfg-ai-key');
    if (aiKeyEl) {
      aiKeyEl.value = '';
      aiKeyEl.placeholder = cfg.has_ai_api_key ? 'Nyckel sparad — lämna tom för att behålla' : 'lm-studio';
    }
    if ($('#cfg-ai-model')) $('#cfg-ai-model').value = cfg.ai_model || '';
    if ($('#cfg-ai-timeout')) $('#cfg-ai-timeout').value = cfg.ai_timeout_seconds ?? 300;
    if ($('#cfg-ai-batch')) $('#cfg-ai-batch').value = cfg.ai_batch_size ?? 5;
    const excludeEl = $('#cfg-exclude-overforing');
    if (excludeEl) excludeEl.checked = getExcludeOverforing();
    syncExcludeTransferToggles();
    const appKeyEl = $('#cfg-app-api-key');
    if (appKeyEl) {
      appKeyEl.value = getApiKey();
      appKeyEl.placeholder = 'Samma som app_api_key i Home Assistant (sparas i webbläsaren)';
    }
    updateAiUiState();
    const mapEl = $('#folder-map-editor');
    const entries = Object.entries(cfg.folder_map || {});
    const numbers = cfg.account_numbers || {};
    mapEl.innerHTML = entries.map(([name, id], i) =>
      `<div class="field folder-map-row">
        <input class="input" data-map-name="${i}" value="${escapeHtml(name)}" placeholder="Kontonamn">
        <input class="input" data-map-number="${i}" value="${escapeHtml(numbers[name] || '')}" placeholder="Kontonummer (valfritt)">
        <input class="input" data-map-id="${i}" value="${escapeHtml(id)}" placeholder="Mapp-ID / lokal mapp">
      </div>`
    ).join('');
    mapEl.dataset.count = entries.length;
    $('#settings-info').textContent = cfg.storage_mode === 'local'
      ? 'Lokal: lägg CSV i data/finance/inbox/{Kontonamn}/ och klicka Importera.'
      : 'Google Drive: service account JSON i data/gdrive_credentials.json';
  } catch (e) {
    $('#settings-info').textContent = 'Fel: ' + e.message;
  }
}

async function saveSettings() {
  const count = +($('#folder-map-editor').dataset.count || 0);
  const folder_map = {};
  const account_numbers = {};
  for (let i = 0; i < count; i++) {
    const name = $(`[data-map-name="${i}"]`)?.value?.trim();
    const id = $(`[data-map-id="${i}"]`)?.value?.trim();
    const num = $(`[data-map-number="${i}"]`)?.value?.trim();
    if (name) {
      folder_map[name] = id || '';
      if (num) account_numbers[name] = num;
    }
  }
  const body = {
    storage_mode: $('#storage-gdrive').classList.contains('active') ? 'gdrive' : 'local',
    archive_folder_id: $('#cfg-archive').value.trim(),
    own_accounts_regex: $('#cfg-regex').value.trim(),
    gdrive_credentials_path: $('#cfg-gdrive-path').value.trim(),
    ai_enabled: $('#cfg-ai-enabled')?.checked ?? false,
    ai_base_url: $('#cfg-ai-url')?.value.trim() || '',
    ai_model: $('#cfg-ai-model')?.value.trim() || '',
    ai_timeout_seconds: Math.max(60, Math.min(1800, parseInt($('#cfg-ai-timeout')?.value, 10) || 300)),
    ai_batch_size: Math.max(1, Math.min(30, parseInt($('#cfg-ai-batch')?.value, 10) || 5)),
    folder_map,
    account_numbers,
  };
  const aiKey = $('#cfg-ai-key')?.value.trim();
  if (aiKey) body.ai_api_key = aiKey;
  setApiKey($('#cfg-app-api-key')?.value.trim() || '');
  setExcludeOverforing($('#cfg-exclude-overforing')?.checked ?? true);
  await api('/api/finance/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  $('#settings-saved').textContent = 'Sparat ✓';
  setTimeout(() => $('#settings-saved').textContent = '', 2000);
  if (state.page === 'finance') loadFinance();
  if (state.page === 'categories') loadCategoriesPage();
  if (state.page === 'home') loadHome();
}

function applyExcludeOverforingSetting() {
  setExcludeOverforing($('#cfg-exclude-overforing')?.checked ?? true);
  if (state.page === 'finance') loadFinance();
  if (state.page === 'categories') loadCategoriesPage();
  if (state.page === 'home') loadHome();
}

$('#cfg-exclude-overforing')?.addEventListener('change', applyExcludeOverforingSetting);

async function testAiConnection() {
  const el = $('#ai-test-result');
  el.textContent = 'Testar…';
  try {
    await saveSettings();
    const data = await api('/api/finance/ai/test');
    if (data.ok) {
      el.textContent = `✓ Ansluten (${data.base_url}). Modeller: ${(data.models || []).join(', ') || 'okänt'}`;
      el.style.color = 'var(--success)';
    } else {
      el.textContent = '✗ ' + (data.error || 'Misslyckades');
      el.style.color = 'var(--danger)';
    }
  } catch (e) {
    el.textContent = '✗ ' + e.message;
    el.style.color = 'var(--danger)';
  }
}
$('#btn-ai-test')?.addEventListener('click', testAiConnection);

$('#storage-local')?.addEventListener('click', () => {
  $('#storage-local').classList.add('active');
  $('#storage-gdrive').classList.remove('active');
});
$('#storage-gdrive')?.addEventListener('click', () => {
  $('#storage-gdrive').classList.add('active');
  $('#storage-local').classList.remove('active');
});
$('#btn-save-settings')?.addEventListener('click', saveSettings);
$('#btn-add-folder')?.addEventListener('click', () => {
  const mapEl = $('#folder-map-editor');
  const i = +(mapEl.dataset.count || 0);
  mapEl.insertAdjacentHTML('beforeend',
    `<div class="field folder-map-row">
      <input class="input" data-map-name="${i}" placeholder="Kontonamn">
      <input class="input" data-map-number="${i}" placeholder="Kontonummer (valfritt)">
      <input class="input" data-map-id="${i}" placeholder="Mapp-ID">
    </div>`);
  mapEl.dataset.count = i + 1;
});

// ── Categories page ─────────────────────────────────────────────────
function catDateRange() {
  const v = state.categoryView;
  if (v.range === 'month') {
    const last = new Date(v.year, v.month, 0).getDate();
    return {
      date_from: `${v.year}-${String(v.month).padStart(2, '0')}-01`,
      date_to: `${v.year}-${String(v.month).padStart(2, '0')}-${String(last).padStart(2, '0')}`,
    };
  }
  return { year: v.year };
}

const CAT_MONTH_NAMES = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];

function categoryScopeLabel() {
  const v = state.categoryView;
  const period = v.range === 'month'
    ? `${CAT_MONTH_NAMES[v.month - 1]} ${v.year}`
    : `Hela ${v.year}`;
  const filters = [];
  if (v.account) filters.push(formatAccountText(v.account));
  if (v.onlyOvrigt) filters.push('Övrigt');
  else if (v.category) filters.push(v.category);
  if (v.search) filters.push(`sök: «${v.search}»`);
  if (!filters.length) filters.push('alla kategorier');
  return { period, filters: filters.join(' · ') };
}

function renderCategorySumCard(total, sumAmount) {
  const card = $('#cat-sum-card');
  if (!card) return;
  if (!total) {
    card.hidden = true;
    card.innerHTML = '';
    return;
  }
  const { period, filters } = categoryScopeLabel();
  const hex = vCategoryHex();
  const sumClass = sumAmount >= 0 ? 'amount-pos' : 'amount-neg';
  card.hidden = false;
  card.innerHTML = `
    <div class="cat-sum-scope">
      <div>Summa för <strong>${escapeHtml(period)}</strong></div>
      <div>${escapeHtml(filters)}</div>
    </div>
    <div class="cat-sum-figure">
      <div class="cat-sum-value ${sumClass}" style="${hex ? `color:${hex}` : ''}">${formatMoney(sumAmount)}</div>
      <div class="cat-sum-meta">${total} transaktion${total === 1 ? '' : 'er'}</div>
    </div>`;
}

function vCategoryHex() {
  const v = state.categoryView;
  const cat = v.onlyOvrigt ? 'Övrigt' : (v.category || '');
  return cat ? financeCategoryHex(cat) : '';
}

function initCategoryControls() {
  const yearSel = $('#cat-year');
  const monthSel = $('#cat-month');
  if (!yearSel || yearSel.dataset.inited) return;
  yearSel.dataset.inited = '1';
  const now = new Date().getFullYear();
  for (let y = now; y >= now - 8; y--) {
    yearSel.insertAdjacentHTML('beforeend', `<option value="${y}">${y}</option>`);
  }
  const months = ['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
  months.forEach((m, i) => monthSel.insertAdjacentHTML('beforeend', `<option value="${i + 1}">${m}</option>`));
  yearSel.value = state.categoryView.year;
  monthSel.value = state.categoryView.month;

  $('#cat-range-month')?.addEventListener('click', () => {
    state.categoryView.range = 'month';
    $('#cat-range-month')?.classList.add('active');
    $('#cat-range-year')?.classList.remove('active');
    $('#cat-month')?.classList.remove('hidden');
    loadCategoriesPage();
  });
  $('#cat-range-year')?.addEventListener('click', () => {
    state.categoryView.range = 'year';
    $('#cat-range-year')?.classList.add('active');
    $('#cat-range-month')?.classList.remove('active');
    $('#cat-month')?.classList.add('hidden');
    loadCategoriesPage();
  });
  yearSel.addEventListener('change', () => { state.categoryView.year = +yearSel.value; loadCategoriesPage(); });
  monthSel.addEventListener('change', () => { state.categoryView.month = +monthSel.value; loadCategoriesPage(); });
  $('#cat-refresh')?.addEventListener('click', loadCategoriesPage);
  $('#cat-filter-category')?.addEventListener('change', () => {
    state.categoryView.category = $('#cat-filter-category').value;
    state.categoryView.offset = 0;
    loadCategoryTransactions();
  });
  $('#cat-only-ovrigt')?.addEventListener('change', () => {
    state.categoryView.onlyOvrigt = $('#cat-only-ovrigt').checked;
    state.categoryView.offset = 0;
    loadCategoryTransactions();
  });
  $('#cat-search')?.addEventListener('input', debounce(() => {
    state.categoryView.search = $('#cat-search').value.trim();
    state.categoryView.offset = 0;
    loadCategoryTransactions();
  }, 350));
  $('#cat-filter-account')?.addEventListener('change', () => {
    state.categoryView.account = $('#cat-filter-account').value;
    state.categoryView.offset = 0;
    loadCategoriesPage();
  });
}

function renderCategoryStatsTable(items) {
  const el = $('#cat-stats-table');
  if (!el) return;
  if (!items?.length) { el.innerHTML = '<p class="empty">Ingen data för vald period.</p>'; return; }
  el.innerHTML = `<div class="cat-stats-grid">${items.map((it, i) => {
    const hex = financeCategoryHex(it.category);
    return `<div class="cat-stat-row cat-stat-click" data-cat-idx="${i}" role="button" tabindex="0" style="border-left-color:${hex}">
      <span class="cat-name" style="color:${hex}">${escapeHtml(it.category)}</span>
      <span class="cat-meta">${it.count} st · ${formatMoney(it.total)}</span>
    </div>`;
  }).join('')}</div>`;
  el.querySelectorAll('.cat-stat-click').forEach(row => {
    const category = items[+row.dataset.catIdx]?.category;
    if (!category) return;
    const pick = () => applyCategoryFilterFromChart(category);
    row.addEventListener('click', pick);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
}

function renderCategoryBreakdownChart(items, subtitle) {
  if (typeof Chart === 'undefined') return;
  destroyChart('catBreakdown');
  const ctx = document.getElementById('chart-cat-breakdown');
  if (!ctx) return;
  $('#cat-chart-subtitle').textContent = subtitle || '';
  const sorted = [...(items || [])].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  const labels = sorted.map(i => i.category);
  const values = sorted.map(i => Math.abs(i.total));
  const breakdownOpts = {
    responsive: true,
    maintainAspectRatio: false,
    onClick: chartPickLabel(applyCategoryFilterFromChart),
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#8b93a8', maxRotation: 55, minRotation: 35, font: { size: 10 } }, grid: { display: false } },
      y: {
        ticks: { color: '#8b93a8', callback: v => new Intl.NumberFormat('sv-SE', { notation: 'compact' }).format(v) },
        grid: { color: 'rgba(255,255,255,0.05)' },
        beginAtZero: true,
      },
    },
  };
  state.charts.catBreakdown = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Utgifter (kr)',
        data: values,
        backgroundColor: financeCategoryChartColors(labels),
        borderRadius: 4,
      }],
    },
    options: breakdownOpts,
  });
  state.charts.catBreakdown.options.onHover = chartPointerHover(state.charts.catBreakdown);
}

async function loadCategoryTransactions() {
  await ensureFinanceCategories(true);
  const v = state.categoryView;
  const range = catDateRange();
  const params = new URLSearchParams({
    limit: v.limit,
    offset: v.offset,
    sort_by: v.sortBy || 'txn_date',
    sort_dir: v.sortDir || 'desc',
  });
  if (range.year) params.set('year', range.year);
  if (range.date_from) { params.set('date_from', range.date_from); params.set('date_to', range.date_to); }
  if (v.account) params.set('account', v.account);
  if (v.onlyOvrigt) params.set('category', 'Övrigt');
  else if (v.category) params.set('category', v.category);
  if (v.search) params.set('search', v.search);
  const catFilter = v.onlyOvrigt ? 'Övrigt' : v.category;
  if (effectiveExcludeOverforing(catFilter)) params.set('exclude_overforing', 'true');

  const data = await api('/api/finance/transactions?' + params);
  renderCategorySumCard(data.total || 0, data.sum_amount ?? 0);
  renderCategoryTxnTable(data.items || [], data.total || 0);
}

function renderCategoryTxnTable(rows, total) {
  const wrap = $('#cat-txn-table');
  if (!wrap) return;
  const v = state.categoryView;
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty">Inga transaktioner matchar.</p>';
    $('#cat-pagination').innerHTML = '';
    return;
  }
  const sortClass = (col) => `sortable ${v.sortBy === col ? 'sorted-' + v.sortDir : ''}`;
  wrap.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th class="${sortClass('txn_date')}" data-sort="txn_date">Datum</th>
      <th class="${sortClass('description')}" data-sort="description">Beskrivning</th>
      <th class="${sortClass('account')}" data-sort="account">Konto</th>
      <th class="${sortClass('category')}" data-sort="category">Kategori</th>
      <th class="${sortClass('amount')}" data-sort="amount">Belopp</th>
    </tr></thead>
    <tbody>${rows.map(t => `<tr data-txn-id="${t.id}">
      <td>${formatDate(t.txn_date)}</td>
      <td>${escapeHtml(t.description)}</td>
      <td>${formatAccountInlineHtml(t.account, t.account_number)}</td>
      <td><select class="select cat-select" data-cat-edit="${t.id}">${categoryOptions(t.category)}</select></td>
      <td class="${t.amount >= 0 ? 'amount-pos' : 'amount-neg'}">${formatMoney(t.amount)}</td>
    </tr>`).join('')}</tbody></table></div>`;

  wrap.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (v.sortBy === col) v.sortDir = v.sortDir === 'asc' ? 'desc' : 'asc';
      else { v.sortBy = col; v.sortDir = 'desc'; }
      v.offset = 0;
      loadCategoryTransactions();
    });
  });

  wrap.querySelectorAll('[data-cat-edit]').forEach(sel => {
    sel.addEventListener('focus', () => { sel.dataset.prevCategory = sel.value; });
    sel.addEventListener('change', async () => {
      const id = sel.dataset.catEdit;
      const category = sel.value;
      const prevCategory = sel.dataset.prevCategory || category;
      try {
        const saved = await saveTransactionCategory(id, category, prevCategory);
        if (saved.cancelled) {
          sel.value = prevCategory;
          return;
        }
        sel.closest('tr')?.classList.add('row-saved');
        loadCategoriesPage(true);
      } catch (e) {
        sel.value = prevCategory;
        alert('Kunde inte spara: ' + e.message);
      }
    });
  });

  const pages = Math.ceil(total / v.limit);
  const page = Math.floor(v.offset / v.limit) + 1;
  const pag = $('#cat-pagination');
  if (pages <= 1) { pag.innerHTML = ''; return; }
  pag.innerHTML = `
    <button class="btn btn-sm" ${page <= 1 ? 'disabled' : ''} id="cat-prev">← Föreg</button>
    <span style="font-size:0.8rem;color:var(--text-muted);align-self:center">Sida ${page}/${pages} (${total} st)</span>
    <button class="btn btn-sm" ${page >= pages ? 'disabled' : ''} id="cat-next">Nästa →</button>`;
  $('#cat-prev')?.addEventListener('click', () => { v.offset = Math.max(0, v.offset - v.limit); loadCategoryTransactions(); });
  $('#cat-next')?.addEventListener('click', () => { v.offset += v.limit; loadCategoryTransactions(); });
}

async function loadCategoriesPage(skipStats = false) {
  initCategoryControls();
  state.financeCategories = [];
  await ensureFinanceCategories();
  const meta = state.financeMeta || await api('/api/finance/meta').catch(() => ({ accounts: [] }));
  state.financeMeta = meta;
  const acctSel = $('#cat-filter-account');
  if (acctSel) {
    const keep = acctSel.value || state.categoryView.account;
    const accounts = normalizeAccountItems(meta.accounts || []);
    acctSel.innerHTML = '<option value="">Alla konton</option>' + accounts.map(a =>
      `<option value="${escapeHtml(a.name)}" ${a.name === keep ? 'selected' : ''}>${escapeHtml(formatAccountText(a.name, a.account_number))}</option>`
    ).join('');
    acctSel.value = keep;
    state.categoryView.account = keep;
  }
  const catSel = $('#cat-filter-category');
  if (catSel) {
    const cur = catSel.value || state.categoryView.category;
    catSel.innerHTML = '<option value="">Alla kategorier</option>' + categoryOptions();
    catSel.value = cur;
  }

  const v = state.categoryView;
  const range = catDateRange();
  const statsParams = new URLSearchParams({ expenses_only: 'true' });
  if (range.year) statsParams.set('year', range.year);
  if (range.date_from) {
    statsParams.set('year', v.year);
    statsParams.set('month', v.month);
  }
  if (getExcludeOverforing()) statsParams.set('exclude_overforing', 'true');
  if (v.account) statsParams.set('account', v.account);

  try {
    if (!skipStats) {
      const stats = await api('/api/finance/categories/stats?' + statsParams);
      const exclNote = getExcludeOverforing() ? ', exkl. överföringar' : '';
      const acctNote = v.account ? ` · ${formatAccountText(v.account)}` : '';
      const subtitle = v.range === 'month'
        ? `${v.year}-${String(v.month).padStart(2, '0')} (endast utgifter${exclNote}${acctNote})`
        : `${v.year} (endast utgifter${exclNote}${acctNote})`;
      renderCategoryStatsTable(stats.items);
      renderCategoryBreakdownChart(stats.items, subtitle);
    }
    await loadCategoryTransactions();
  } catch (e) {
    $('#cat-stats-table').innerHTML = '<p class="error">Fel: ' + escapeHtml(e.message) + '</p>';
  }
}

// ── Init ─────────────────────────────────────────────────────────────
bindTaskFilters();

async function initApp() {
  window.BredehallIcons?.hydrateIcons();
  try {
    syncExcludeTransferToggles();
    syncExcludeOverforingFromGlobal();
    const [authStatus, shutdownStatus] = await Promise.all([
      fetch(relUrl('api/auth/status')).then(r => r.json()).catch(() => ({ auth_required: false })),
      fetch(relUrl('api/shutdown/status')).then(r => r.json()).catch(() => ({ allowed: false })),
    ]);
    if (authStatus.auth_required && !getApiKey()) {
      showToast('API-nyckel krävs — öppna Inställningar och klistra in samma nyckel som i add-on-konfigurationen.', true);
    }
    const shutdownBtn = $('#btn-shutdown');
    if (shutdownBtn && shutdownStatus.allowed) {
      shutdownBtn.classList.remove('hidden');
    }
  } catch (_) { /* offline or no auth */ }
  setPage('home');
}

async function shutdownApp() {
  if (!confirm('Stoppa servern och stäng appen?')) return;
  try {
    await api('/api/shutdown', { method: 'POST' });
    showToast('Servern stoppas…');
  } catch (e) {
    showToast(e.message || 'Kunde inte stoppa servern', true);
  }
  setTimeout(() => {
    window.open('', '_self');
    window.close();
  }, 400);
}

$('#btn-shutdown')?.addEventListener('click', shutdownApp);

initApp();
