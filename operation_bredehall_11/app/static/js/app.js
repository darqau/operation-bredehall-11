const API = '';
const CATEGORIES = ['VVS','Trädgård','Ekonomi','Administration','Hus','El','Värme','Annat'];
const FREQUENCIES = ['En gång','Månatlig','Kvartalsvis','Varannan termin','Årlig','Vart 2:a år','Vart 3:e år','Vart 5:e år','Vid behov'];

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
  financeConfig: null,
  financeMeta: null,
  financeFilters: {
    account: '', year: '', category: '', typ: '',
    dateFrom: '', dateTo: '', search: '',
    excludeOverforing: true, maxAmount: 0, chartMaxAmount: 100000,
    sortBy: 'txn_date', sortDir: 'desc', offset: 0, limit: 50,
  },
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
    category: '',
    onlyOvrigt: false,
    search: '',
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

function chartAccountLabel(item) {
  const name = item?.account || item?.name || '';
  return formatAccountText(name, item?.account_number);
}

async function api(path, opts = {}) {
  const r = await fetch(API + path, { cache: 'no-store', ...opts });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(r.status + ' ' + (t || r.statusText));
  }
  if (r.status === 204) return null;
  return r.json();
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
    categories: ['Kategorier', 'Justera och analysera utgiftskategorier'],
    settings: ['Inställningar', 'Datakällor och konfiguration'],
  };
  const [h, sub] = titles[page] || ['', ''];
  $('#page-title').textContent = h;
  $('#page-subtitle').textContent = sub;
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('open');
  const fab = $('#filter-fab');
  if (fab) fab.classList.toggle('hidden', page !== 'finance');
  if (page !== 'finance') closeFilterDrawer?.();
  if (page === 'home') loadHome();
  if (page === 'maintenance') loadTasks();
  if (page === 'finance') loadFinance();
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
    const [stats, fin] = await Promise.all([
      api('/api/tasks/stats/summary'),
      api('/api/finance/dashboard'),
    ]);
    state.stats = stats;
    state.financeDash = fin;
    $('#home-stats').innerHTML = `
      <div class="card"><div class="stat-value stat-accent">${stats.total}</div><div class="stat-label">Uppgifter totalt</div></div>
      <div class="card"><div class="stat-value stat-danger">${stats.overdue}</div><div class="stat-label">Försenade</div></div>
      <div class="card"><div class="stat-value stat-warn">${stats.due_this_week}</div><div class="stat-label">Denna vecka</div></div>
      <div class="card"><div class="stat-value stat-success">${formatMoney(fin.total_balance)}</div><div class="stat-label">Totalt saldo</div></div>`;
    const recent = fin.recent_transactions?.slice(0, 5) || [];
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
    el.textContent = data.ok ? (data.text || '') : ('Fel: ' + data.error);
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
  const f = { ...state.financeFilters, ...extra };
  const p = new URLSearchParams();
  if (f.account) p.set('account', f.account);
  if (f.year) p.set('year', f.year);
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

function readFinanceFiltersFromUI() {
  state.financeFilters.account = $('#fin-filter-account')?.value || '';
  state.financeFilters.year = $('#fin-filter-year')?.value || '';
  state.financeFilters.category = $('#fin-filter-category')?.value || '';
  state.financeFilters.typ = $('#fin-filter-typ')?.value || '';
  state.financeFilters.dateFrom = $('#fin-filter-from')?.value || '';
  state.financeFilters.dateTo = $('#fin-filter-to')?.value || '';
  state.financeFilters.search = $('#fin-filter-search')?.value?.trim() || '';
  state.financeFilters.excludeOverforing = $('#fin-filter-no-transfer')?.checked ?? true;
  state.financeFilters.maxAmount = $('#fin-filter-cap')?.checked ? 100000 : 0;
  state.financeFilters.offset = 0;
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
  fill($('#fin-filter-category'), meta.categories || [], state.financeFilters.category);
  fill($('#fin-filter-typ'), meta.typs || [], state.financeFilters.typ);
  const yearSel = $('#fin-filter-year');
  if (yearSel) {
    const keep = state.financeFilters.year;
    yearSel.innerHTML = `<option value="">Alla år</option>` + (meta.years || []).map(y =>
      `<option value="${y}" ${String(y) === keep ? 'selected' : ''}>${y}</option>`
    ).join('');
  }
}

async function loadFinance() {
  const errEl = $('#finance-error');
  if (errEl) errEl.textContent = '';
  const qs = financeQueryString();
  const excl = state.financeFilters.excludeOverforing ? 'true' : 'false';

  // Resilient: one failed call must not blank the whole filter UI.
  const [cfgR, foldersR, dashR, metaR, txnsR, heroR, loansR] = await Promise.allSettled([
    api('/api/finance/config'),
    api('/api/finance/folders'),
    api('/api/finance/dashboard' + (qs ? '?' + qs : '')),
    api('/api/finance/meta'),
    api('/api/finance/transactions?' + qs),
    api('/api/finance/hero?exclude_internal=' + excl),
    api('/api/finance/loans'),
  ]);

  const failures = [];

  if (cfgR.status === 'fulfilled') state.financeConfig = cfgR.value;
  else failures.push('konfiguration');

  // Meta drives the filter dropdowns — populate even if other calls failed.
  if (metaR.status === 'fulfilled') {
    state.financeMeta = metaR.value;
    populateFinanceFilterDropdowns(metaR.value);
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
    const hasActiveFilters = !!(f.account || f.year || f.category || f.typ || f.dateFrom || f.dateTo || f.search || f.maxAmount);
    const sumWrap = $('#fin-summary-wrap');
    if (sumWrap) {
      sumWrap.classList.toggle('hidden', !hasActiveFilters);
      if (hasActiveFilters) {
        const s = d.summary || {};
        sumWrap.innerHTML = `
          <div class="card"><div class="stat-value stat-success">${formatMoney(s.income)}</div><div class="stat-label">Inkomst (filter)</div></div>
          <div class="card"><div class="stat-value stat-danger">${formatMoney(s.expense)}</div><div class="stat-label">Utgift (filter)</div></div>
          <div class="card"><div class="stat-value stat-accent">${formatMoney(s.net)}</div><div class="stat-label">Netto (filter)</div></div>
          <div class="card"><div class="stat-value">${s.count ?? 0}</div><div class="stat-label">Träffar</div></div>`;
      }
    }
    $('#account-list').innerHTML = (d.accounts || []).map(a =>
      `<div class="account-pill ${state.financeFilters.account === a.name ? 'active' : ''}" data-account="${escapeHtml(a.name)}">
        <div class="account-pill-name">${formatAccountBlockHtml(a.name, a.account_number)}</div>
        <span class="account-pill-balance">${formatMoney(a.balance)}</span></div>`
    ).join('') || '<p class="empty">Inga konton med saldo än.</p>';
    $$('#account-list .account-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        state.financeFilters.account = state.financeFilters.account === pill.dataset.account ? '' : pill.dataset.account;
        if ($('#fin-filter-account')) $('#fin-filter-account').value = state.financeFilters.account;
        loadFinance();
      });
    });
    renderFinanceCharts(d);
  } else {
    failures.push('dashboard');
  }

  if (txnsR.status === 'fulfilled') {
    renderTransactionTable(txnsR.value.items || [], txnsR.value.total || 0);
  } else {
    failures.push('transaktioner');
  }

  updateActiveFilterSummary();

  if (failures.length && errEl) {
    errEl.textContent = `Kunde inte ladda: ${failures.join(', ')}. Övriga delar uppdaterades. Försök igen.`;
  }
}

function updateActiveFilterSummary() {
  const el = $('#active-filter-summary');
  if (!el) return;
  const f = state.financeFilters;
  const parts = [];
  if (f.account) parts.push(formatAccountText(f.account));
  if (f.year) parts.push(String(f.year));
  if (f.category) parts.push(f.category);
  if (f.typ) parts.push(f.typ);
  if (f.dateFrom || f.dateTo) parts.push(`${f.dateFrom || '…'} → ${f.dateTo || '…'}`);
  if (f.search) parts.push(`"${f.search}"`);
  if (f.excludeOverforing) parts.push('exkl. överföringar');
  if (f.maxAmount) parts.push('exkl. >100k');
  el.textContent = parts.length ? 'Aktiva filter: ' + parts.join(' · ') : 'Inga aktiva filter';
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
}

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
  list.innerHTML = items.map(i => `
    <li>
      <span class="hero-exp-name">${escapeHtml(i.category)}</span>
      <span class="hero-exp-bar"><span style="width:${Math.round((i.amount / max) * 100)}%"></span></span>
      <span class="hero-exp-amount">${formatMoney(i.amount)}</span>
    </li>`).join('');
}

$('#hero-exp-month')?.addEventListener('click', () => { state.heroExpRange = 'month'; renderHeroExpenses(); });
$('#hero-exp-year')?.addEventListener('click', () => { state.heroExpRange = 'year'; renderHeroExpenses(); });

function loanRowHtml(loan, { actions = true, preview = false } = {}) {
  const actionBtns = actions ? `
      <div class="loan-actions">
        <button type="button" class="btn btn-sm loan-edit" data-id="${loan.id}">✎</button>
        <button type="button" class="btn btn-sm loan-delete" data-id="${loan.id}">✕</button>
      </div>` : '';
  return `
    <div class="loan-row ${preview ? 'loan-preview-row' : ''}" data-id="${loan.id || ''}">
      <div class="loan-icon" aria-hidden="true">🏠</div>
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
        const r = await fetch(API + '/api/finance/loans/parse-image', { method: 'POST', body: fd });
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
  }

  const catCtx = $('#chart-categories');
  if (catCtx && (d.expenses_by_category || []).length) {
    const cats = d.expenses_by_category.slice(0, 10);
    state.charts.categories = new Chart(catCtx, {
      type: 'doughnut',
      data: {
        labels: cats.map(c => c.category),
        datasets: [{
          data: cats.map(c => Math.abs(c.amount)),
          backgroundColor: ['#7c6cff','#22d3ee','#f472b6','#34d399','#fbbf24','#fb923c','#a78bfa','#60a5fa','#f87171','#94a3b8'],
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#8b93a8', boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatMoney(ctx.parsed)}` } },
        },
      },
    });
  } else if (catCtx) {
    catCtx.getContext('2d').clearRect(0, 0, catCtx.width, catCtx.height);
  }

  const expCtx = $('#chart-expenses');
  if (expCtx) {
    const expData = (d.monthly_expenses || []).map(x => Math.abs(x.amount));
    state.charts.expenses = new Chart(expCtx, {
      type: 'bar',
      data: {
        labels: (d.monthly_expenses || []).map(x => x.month),
        datasets: [{
          label: 'Utgifter',
          data: expData,
          backgroundColor: 'rgba(244,114,182,0.7)',
          borderRadius: 6,
        }],
      },
      options: chartOptions(chartDataMax(expData)),
    });
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

const ACCOUNT_COLORS = ['#7c6cff', '#22d3ee', '#34d399', '#f59e0b', '#f472b6', '#60a5fa', '#a78bfa', '#fb923c', '#f87171', '#94a3b8'];

function tsToYearMonth(ts) {
  const dt = new Date(ts);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

// Inline plugin: draw a rounded "saldo" chip at the end of each horizontal bar.
const balanceChipPlugin = {
  id: 'balanceChips',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const chips = chart.$balanceChips || [];
    if (!meta || !meta.data) return;
    ctx.save();
    ctx.font = '600 11px "DM Sans", system-ui, sans-serif';
    meta.data.forEach((bar, i) => {
      const label = chips[i];
      if (!label) return;
      const textW = ctx.measureText(label).width;
      const padX = 7, h = 18;
      const w = textW + padX * 2;
      let x = bar.x + 8;            // just past the bar's end
      const y = bar.y - h / 2;
      // keep chip inside the canvas
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
      ctx.strokeStyle = bar.options?.backgroundColor || 'rgba(124,108,255,0.8)';
      ctx.stroke();
      ctx.fillStyle = '#f0f2f8';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + padX, y + h / 2 + 0.5);
    });
    ctx.restore();
  },
};

function renderBalanceChart(d) {
  const ctx = $('#chart-timeline');
  if (!ctx) return;
  destroyChart('timeline');
  const items = (d.account_timeline || []).filter(a => a.first_date && a.last_date);
  if (!items.length) {
    ctx.getContext('2d').clearRect(0, 0, ctx.width, ctx.height);
    return;
  }
  // Sort by first activity so the timeline reads top→bottom chronologically.
  items.sort((a, b) => a.first_date.localeCompare(b.first_date));

  const DAY = 86400000;
  const starts = items.map(a => new Date(a.first_date + 'T12:00:00').getTime());
  const ends = items.map(a => new Date(a.last_date + 'T12:00:00').getTime());
  const dataMin = Math.min(...starts);
  const dataMax = Math.max(...ends);
  const span = Math.max(dataMax - dataMin, DAY * 30);
  // Explicit bounds so the bar value-axis does NOT snap to 0 (the old 1970 bug).
  const xMin = dataMin - span * 0.02;
  const xMax = dataMax + span * 0.18; // headroom for the saldo chips

  const colors = items.map((_, i) => ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]);
  const bars = items.map((a, i) => {
    let s = starts[i], e = ends[i];
    if (e - s < DAY * 14) e = s + DAY * 14; // keep very short spans visible
    return [s, e];
  });

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: items.map(a => chartAccountLabel(a)),
      datasets: [{
        data: bars,
        backgroundColor: colors.map(c => c + 'cc'),
        borderColor: colors,
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
      layout: { padding: { right: 12 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (c) => chartAccountLabel(items[c[0].dataIndex]),
            label: (c) => {
              const a = items[c.dataIndex];
              return [
                `Period: ${formatDate(a.first_date)} → ${formatDate(a.last_date)}`,
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
          ticks: { color: '#8b93a8', callback: (v) => tsToYearMonth(v), maxRotation: 45, autoSkip: true, maxTicksLimit: 9 },
          grid: { color: 'rgba(255,255,255,0.05)' },
        },
        y: { ticks: { color: '#8b93a8', font: { size: 11 } }, grid: { display: false } },
      },
    },
    plugins: [balanceChipPlugin],
  });
  chart.$balanceChips = items.map(a => a.balance != null ? formatMoney(a.balance) : '');
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
  const active = ex && ex.chart_max_amount > 0;
  const text = active
    ? 'Stora engångsköp och överföringar exkluderade från graf'
    : '';
  ['#chart-exclude-note-net', '#chart-exclude-note-ie', '#chart-exclude-note-exp'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('hidden', !text);
  });
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
      <td><span class="badge">${escapeHtml(t.category)}</span></td>
      <td class="${t.amount >= 0 ? 'amount-pos' : 'amount-neg'}">${formatMoney(t.amount)}</td>
    </tr>`).join('')}</tbody></table></div>`;

  wrap.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (f.sortBy === col) f.sortDir = f.sortDir === 'asc' ? 'desc' : 'asc';
      else { f.sortBy = col; f.sortDir = 'desc'; }
      loadFinance();
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
  $('#txn-prev')?.addEventListener('click', () => { f.offset = Math.max(0, f.offset - f.limit); loadFinance(); });
  $('#txn-next')?.addEventListener('click', () => { f.offset += f.limit; loadFinance(); });
}

async function recategorize(method) {
  const el = $('#process-result');
  el.textContent = method === 'ai' ? 'AI kategoriserar… (kan ta en stund med lokal modell)' : 'Kategoriserar om…';
  try {
    const data = await api('/api/finance/recategorize?method=' + method, { method: 'POST' });
    if (method === 'ai') {
      const breakdown = formatCategoryBreakdown(data.by_category);
      el.textContent = `✨ AI klar: ${data.changed} poster uppdaterade (av ${data.processed || 0} okategoriserade).`
        + (data.skipped_uncertain ? ` ${data.skipped_uncertain} lämnades som Övrigt (osäkra).` : '')
        + breakdown
        + (data.errors?.length ? '\n' + data.errors.join('\n') : '');
    } else {
      el.textContent = `↻ Klart: ${data.changed} poster omkategoriserade enligt regler.`
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

async function ensureFinanceCategories() {
  if (state.financeCategories.length) return state.financeCategories;
  const data = await api('/api/finance/categories');
  state.financeCategories = data.categories || [];
  return state.financeCategories;
}

function categoryOptions(selected = '') {
  const cats = state.financeCategories.length ? state.financeCategories : ['Övrigt'];
  return cats.map(c => `<option value="${escapeHtml(c)}"${c === selected ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
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
    try {
      const batch = await api('/api/finance/ai/batch', { method: 'POST' });
      if (batch.current) $('#ai-current').textContent = 'Kategoriserar: ' + batch.current;
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
      if (batch.errors?.length) aiState.errors.push(...batch.errors);
      aiState.total = Math.max(aiState.total, aiState.processed + (batch.remaining || 0));
      updateAiPanelUI();

      if (batch.done || !batch.batch_size) {
        aiState.running = false;
        $('#ai-current').textContent = 'Klar!';
        renderAiResult();
        loadFinance();
        break;
      }
      if (!batch.ok && batch.errors?.length) {
        aiState.retries += 1;
        $('#ai-current').textContent = `Batchfel — försöker igen (${aiState.retries}/8)…`;
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
      aiState.errors.push(e.message);
      aiState.retries += 1;
      $('#ai-current').textContent = `Fel — försöker igen (${aiState.retries}/8)…`;
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

// ── Filter drawer ─────────────────────────────────────────────────────
function openFilterDrawer() {
  $('#filter-drawer')?.classList.add('open');
  $('#filter-drawer-backdrop')?.classList.add('open');
}
function closeFilterDrawer() {
  $('#filter-drawer')?.classList.remove('open');
  $('#filter-drawer-backdrop')?.classList.remove('open');
}
$('#filter-fab')?.addEventListener('click', openFilterDrawer);
$('#btn-open-filters-top')?.addEventListener('click', openFilterDrawer);
$('#filter-drawer-close')?.addEventListener('click', closeFilterDrawer);
$('#filter-drawer-backdrop')?.addEventListener('click', closeFilterDrawer);

const applyFilters = () => { readFinanceFiltersFromUI(); loadFinance(); };

$('#fin-filter-apply')?.addEventListener('click', () => { applyFilters(); closeFilterDrawer(); });
$('#fin-filter-reset')?.addEventListener('click', () => {
  state.financeFilters = { account: '', year: '', category: '', typ: '', dateFrom: '', dateTo: '', search: '', excludeOverforing: true, maxAmount: 0, chartMaxAmount: 100000, sortBy: 'txn_date', sortDir: 'desc', offset: 0, limit: 50 };
  ['fin-filter-account','fin-filter-year','fin-filter-category','fin-filter-typ','fin-filter-from','fin-filter-to','fin-filter-search'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
  if ($('#fin-filter-no-transfer')) $('#fin-filter-no-transfer').checked = true;
  if ($('#fin-filter-cap')) $('#fin-filter-cap').checked = false;
  loadFinance();
});
// Auto-apply on any filter control change (selects, dates, toggles).
['fin-filter-account','fin-filter-year','fin-filter-category','fin-filter-typ','fin-filter-from','fin-filter-to','fin-filter-no-transfer','fin-filter-cap'].forEach(id => {
  $('#' + id)?.addEventListener('change', applyFilters);
});
$('#fin-filter-search')?.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });
$('#fin-filter-search')?.addEventListener('input', debounce(applyFilters, 400));

function formatImportSummary(proc) {
  if (!proc) return '';
  let s = `${proc.transactions_added} nya transaktioner`;
  if (proc.transactions_skipped) s += `, ${proc.transactions_skipped} dubbletter hoppades över`;
  return s;
}

async function processBankFiles() {
  const el = $('#process-result');
  el.textContent = 'Importerar…';
  try {
    const data = await api('/api/finance/process', { method: 'POST' });
    const summary = formatImportSummary(data);
    el.textContent = `Klart (${data.mode}): ${data.files_processed} filer, ${summary}.\n${(data.processed||[]).join('\n')}${data.errors?.length ? '\nFel:\n' + data.errors.join('\n') : ''}`;
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
    closeModal(); loadFinance();
  };
}

$('#btn-process')?.addEventListener('click', processBankFiles);
$('#btn-manual-txn')?.addEventListener('click', openManualTxnModal);

// ── Drop zone & file upload ───────────────────────────────────────────
let uploadQueue = [];

function renderKnownAccounts(folders) {
  const el = $('#known-accounts');
  if (!el) return;
  if (!(folders || []).length) { el.innerHTML = ''; return; }
  const pending = (folders || []).filter(f => f.pending_files > 0);
  el.innerHTML =
    'Kända konton: ' + folders.map(f => {
      const label = formatAccountText(f.name, f.account_number);
      return `<span class="acc-tag" title="${escapeHtml(label)}">${formatAccountInlineHtml(f.name, f.account_number)}</span>`;
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
  const r = await fetch(API + '/api/finance/detect', { method: 'POST', body: fd });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function uploadFileToAccount(file, account, autoProcess = true) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('account', account);
  fd.append('auto_process', autoProcess ? 'true' : 'false');
  const r = await fetch(API + '/api/finance/upload', { method: 'POST', body: fd });
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
        const useAuto = confirm(
          `Auto-detekterat konto: ${detection.detected_account} (${Math.round(detection.confidence * 100)}%)\n\nOK = ladda upp och importera\nAvbryt = välj manuellt`
        );
        if (useAuto) {
          account = detection.detected_account;
        } else {
          const pick = await openAccountPickerModal(file, detection);
          if (!pick) { resultEl.textContent = 'Uppladdning avbruten.'; return; }
          account = pick.account;
          autoProcess = pick.autoProcess;
        }
      } else {
        const pick = await openAccountPickerModal(file, detection);
        if (!pick) { resultEl.textContent = 'Uppladdning avbruten.'; return; }
        account = pick.account;
        autoProcess = pick.autoProcess;
      }
      resultEl.textContent = `Laddar upp till ${account}…`;
    }

    const res = await uploadFileToAccount(file, account, autoProcess);
    let msg = `✓ ${file.name} → ${res.account}/${res.filename}`;
    if (res.auto_detected) msg += ' (auto-detekterat)';
    if (res.process) {
      msg += `\n${formatImportSummary(res.process)}.`;
    }
    resultEl.textContent = msg;
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
    if ($('#cfg-ai-key')) $('#cfg-ai-key').value = cfg.ai_api_key || '';
    if ($('#cfg-ai-model')) $('#cfg-ai-model').value = cfg.ai_model || '';
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
    ai_api_key: $('#cfg-ai-key')?.value.trim() || '',
    ai_model: $('#cfg-ai-model')?.value.trim() || '',
    folder_map,
    account_numbers,
  };
  await api('/api/finance/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  $('#settings-saved').textContent = 'Sparat ✓';
  setTimeout(() => $('#settings-saved').textContent = '', 2000);
}

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
}

function renderCategoryStatsTable(items) {
  const el = $('#cat-stats-table');
  if (!el) return;
  if (!items?.length) { el.innerHTML = '<p class="empty">Ingen data för vald period.</p>'; return; }
  el.innerHTML = `<div class="cat-stats-grid">${items.map(it => `
    <div class="cat-stat-row">
      <span class="cat-name">${escapeHtml(it.category)}</span>
      <span class="cat-meta">${it.count} st · ${formatMoney(it.total)}</span>
    </div>`).join('')}</div>`;
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
  state.charts.catBreakdown = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Utgifter (kr)',
        data: values,
        backgroundColor: 'rgba(124, 108, 255, 0.65)',
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8b93a8', maxRotation: 55, minRotation: 35, font: { size: 10 } }, grid: { display: false } },
        y: {
          ticks: { color: '#8b93a8', callback: v => new Intl.NumberFormat('sv-SE', { notation: 'compact' }).format(v) },
          grid: { color: 'rgba(255,255,255,0.05)' },
          beginAtZero: true,
        },
      },
    },
  });
}

async function loadCategoryTransactions() {
  const v = state.categoryView;
  const range = catDateRange();
  const params = new URLSearchParams({
    limit: v.limit,
    offset: v.offset,
    sort_by: 'txn_date',
    sort_dir: 'desc',
    exclude_overforing: 'true',
  });
  if (range.year) params.set('year', range.year);
  if (range.date_from) { params.set('date_from', range.date_from); params.set('date_to', range.date_to); }
  if (v.onlyOvrigt) params.set('category', 'Övrigt');
  else if (v.category) params.set('category', v.category);
  if (v.search) params.set('search', v.search);

  const data = await api('/api/finance/transactions?' + params);
  renderCategoryTxnTable(data.items || [], data.total || 0);
}

function renderCategoryTxnTable(rows, total) {
  const wrap = $('#cat-txn-table');
  if (!wrap) return;
  if (!rows.length) {
    wrap.innerHTML = '<p class="empty">Inga transaktioner matchar.</p>';
    $('#cat-pagination').innerHTML = '';
    return;
  }
  wrap.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Datum</th><th>Beskrivning</th><th>Konto</th><th>Kategori</th><th>Belopp</th></tr></thead>
    <tbody>${rows.map(t => `<tr data-txn-id="${t.id}">
      <td>${formatDate(t.txn_date)}</td>
      <td>${escapeHtml(t.description)}</td>
      <td>${formatAccountInlineHtml(t.account, t.account_number)}</td>
      <td><select class="select cat-select" data-cat-edit="${t.id}">${categoryOptions(t.category)}</select></td>
      <td class="${t.amount >= 0 ? 'amount-pos' : 'amount-neg'}">${formatMoney(t.amount)}</td>
    </tr>`).join('')}</tbody></table></div>`;

  wrap.querySelectorAll('[data-cat-edit]').forEach(sel => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.catEdit;
      const category = sel.value;
      try {
        await api(`/api/finance/transactions/${id}/category`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category }),
        });
        sel.closest('tr')?.classList.add('row-saved');
        loadCategoriesPage();
      } catch (e) {
        alert('Kunde inte spara: ' + e.message);
      }
    });
  });

  const v = state.categoryView;
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
  await ensureFinanceCategories();
  const catSel = $('#cat-filter-category');
  if (catSel && !catSel.dataset.filled) {
    catSel.dataset.filled = '1';
    catSel.innerHTML = '<option value="">Alla kategorier</option>' + categoryOptions();
  }

  const v = state.categoryView;
  const range = catDateRange();
  const statsParams = new URLSearchParams({ expenses_only: 'true' });
  if (range.year) statsParams.set('year', range.year);
  if (range.date_from) {
    statsParams.set('year', v.year);
    statsParams.set('month', v.month);
  }

  try {
    if (!skipStats) {
      const stats = await api('/api/finance/categories/stats?' + statsParams);
      const subtitle = v.range === 'month'
        ? `${v.year}-${String(v.month).padStart(2, '0')} (endast utgifter)`
        : `${v.year} (endast utgifter)`;
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
setPage('home');
