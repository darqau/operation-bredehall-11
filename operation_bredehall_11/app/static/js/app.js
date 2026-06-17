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
  financeConfig: null,
  financeMeta: null,
  financeFilters: {
    account: '', year: '', category: '', typ: '',
    dateFrom: '', dateTo: '', search: '',
    excludeOverforing: true,
    sortBy: 'txn_date', sortDir: 'desc', offset: 0, limit: 50,
  },
  lastSuggestions: [],
  selectedSuggestions: new Set(),
  editingTask: null,
  charts: {},
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
    settings: ['Inställningar', 'Datakällor och konfiguration'],
  };
  const [h, sub] = titles[page] || ['', ''];
  $('#page-title').textContent = h;
  $('#page-subtitle').textContent = sub;
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.remove('open');
  if (page === 'home') loadHome();
  if (page === 'maintenance') loadTasks();
  if (page === 'finance') loadFinance();
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
          <p class="task-meta">${escapeHtml(t.account)} · ${formatDate(t.txn_date)}</p></div>
          <span class="${t.amount >= 0 ? 'amount-pos' : 'amount-neg'}">${formatMoney(t.amount)}</span></div>`).join('')
      : '<p class="empty">Inga transaktioner än. Importera CSV-filer under Ekonomi.</p>';
  } catch (e) {
    $('#home-stats').innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

// ── Maintenance ──────────────────────────────────────────────────────
async function loadTasks() {
  const list = $('#task-list');
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
    $('#btn-complete-task').onclick = async () => {
      await api(`/api/tasks/${task.id}/complete`, { method: 'POST' });
      closeModal(); loadTasks();
    };
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
  $('#btn-quick-complete').onclick = async () => {
    await api(`/api/tasks/${task.id}/complete`, { method: 'POST' });
    closeModal(); loadTasks();
  };
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
  fill($('#fin-filter-account'), meta.accounts || [], state.financeFilters.account);
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
  try {
    state.financeConfig = await api('/api/finance/config');
    const qs = financeQueryString();
    const [foldersResp, dash, meta, txnsResp] = await Promise.all([
      api('/api/finance/folders'),
      api('/api/finance/dashboard' + (qs ? '?' + qs : '')),
      api('/api/finance/meta'),
      api('/api/finance/transactions?' + financeQueryString()),
    ]);
    state.financeDash = dash;
    state.financeMeta = meta;
    populateFinanceFilterDropdowns(meta);
    renderFolderGrid(foldersResp.folders || []);
    const d = state.financeDash;
    const pending = (foldersResp.folders || []).reduce((s, f) => s + (f.pending_files || 0), 0);
    $('#finance-total').textContent = formatMoney(d.total_balance);
    $('#finance-txn-count').textContent = d.transaction_count;
    if (pending > 0) {
      $('#process-result').textContent = `${pending} CSV-fil(er) väntar i inbox. Klicka "Importera CSV" för att bearbeta.`;
    }

    const s = d.summary || {};
    $('#fin-summary').innerHTML = `
      <div class="card"><div class="stat-value stat-success">${formatMoney(s.income)}</div><div class="stat-label">Inkomst (filter)</div></div>
      <div class="card"><div class="stat-value stat-danger">${formatMoney(s.expense)}</div><div class="stat-label">Utgift (filter)</div></div>
      <div class="card"><div class="stat-value stat-accent">${formatMoney(s.net)}</div><div class="stat-label">Netto (filter)</div></div>
      <div class="card"><div class="stat-value">${s.count ?? 0}</div><div class="stat-label">Transaktioner (filter)</div></div>`;

    $('#account-list').innerHTML = (d.accounts || []).map(a =>
      `<div class="account-pill ${state.financeFilters.account === a.name ? 'active' : ''}" data-account="${escapeHtml(a.name)}">
        <strong>${escapeHtml(a.name)}</strong><span>${formatMoney(a.balance)}</span></div>`
    ).join('') || '<p class="empty">Inga konton med saldo än.</p>';
    $$('#account-list .account-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        state.financeFilters.account = state.financeFilters.account === pill.dataset.account ? '' : pill.dataset.account;
        if ($('#fin-filter-account')) $('#fin-filter-account').value = state.financeFilters.account;
        loadFinance();
      });
    });

    renderFinanceCharts(d);
    renderTransactionTable(txnsResp.items || [], txnsResp.total || 0);
  } catch (e) {
    $('#finance-total').textContent = '–';
    $('#finance-error').textContent = e.message;
  }
}

function renderFinanceCharts(d) {
  if (typeof Chart === 'undefined') return;
  destroyChart('net');
  destroyChart('expenses');
  destroyChart('incomeExpense');
  destroyChart('categories');

  const opts = chartOptions();
  const optsLegend = { ...opts, plugins: { ...opts.plugins, legend: { display: true, labels: { color: '#8b93a8' } } } };

  const netCtx = $('#chart-net');
  if (netCtx) {
    state.charts.net = new Chart(netCtx, {
      type: 'line',
      data: {
        labels: (d.net_income_over_time || []).map(x => x.month),
        datasets: [{
          label: 'Netto',
          data: (d.net_income_over_time || []).map(x => x.amount),
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
    state.charts.incomeExpense = new Chart(ieCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [
          { label: 'Inkomst', data: months.map(m => (d.monthly_income || []).find(x => x.month === m)?.amount || 0), backgroundColor: 'rgba(52,211,153,0.7)', borderRadius: 4 },
          { label: 'Utgift', data: months.map(m => Math.abs((d.monthly_expenses || []).find(x => x.month === m)?.amount || 0)), backgroundColor: 'rgba(248,113,113,0.7)', borderRadius: 4 },
        ],
      },
      options: optsLegend,
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
    state.charts.expenses = new Chart(expCtx, {
      type: 'bar',
      data: {
        labels: (d.monthly_expenses || []).map(x => x.month),
        datasets: [{
          label: 'Utgifter',
          data: (d.monthly_expenses || []).map(x => Math.abs(x.amount)),
          backgroundColor: 'rgba(244,114,182,0.7)',
          borderRadius: 6,
        }],
      },
      options: opts,
    });
  }
}

function chartOptions() {
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
    },
    scales: {
      x: { ticks: { color: '#8b93a8', maxRotation: 45 }, grid: { color: 'rgba(255,255,255,0.05)' } },
      y: {
        ticks: {
          color: '#8b93a8',
          callback: (v) => new Intl.NumberFormat('sv-SE', { notation: 'compact', maximumFractionDigits: 1 }).format(v),
        },
        grid: { color: 'rgba(255,255,255,0.05)' },
        beginAtZero: true,
      },
    },
  };
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
      <td>${escapeHtml(t.account)}</td>
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
      el.textContent = `✨ AI klar: ${data.changed} poster uppdaterade (av ${data.processed || 0} okategoriserade).` + (data.errors?.length ? '\n' + data.errors.join('\n') : '');
    } else {
      el.textContent = `↻ Klart: ${data.changed} poster omkategoriserade enligt regler.`;
    }
    loadFinance();
  } catch (e) {
    let msg = e.message;
    try { const j = JSON.parse(msg.substring(msg.indexOf('{'))); msg = j.detail?.message || msg; } catch (_) {}
    el.textContent = 'Fel: ' + msg + (method === 'ai' ? ' — kontrollera att LM Studio-servern körs och att AI är aktiverat i Inställningar.' : '');
  }
}

$('#btn-recategorize')?.addEventListener('click', () => recategorize('rules'));
$('#btn-recategorize-ai')?.addEventListener('click', () => recategorize('ai'));

$('#fin-filter-apply')?.addEventListener('click', () => { readFinanceFiltersFromUI(); loadFinance(); });
$('#fin-filter-reset')?.addEventListener('click', () => {
  state.financeFilters = { account: '', year: '', category: '', typ: '', dateFrom: '', dateTo: '', search: '', excludeOverforing: true, sortBy: 'txn_date', sortDir: 'desc', offset: 0, limit: 50 };
  ['fin-filter-account','fin-filter-year','fin-filter-category','fin-filter-typ','fin-filter-from','fin-filter-to','fin-filter-search'].forEach(id => { const el = $('#' + id); if (el) el.value = ''; });
  if ($('#fin-filter-no-transfer')) $('#fin-filter-no-transfer').checked = true;
  loadFinance();
});
$('#fin-filter-search')?.addEventListener('keydown', e => { if (e.key === 'Enter') { readFinanceFiltersFromUI(); loadFinance(); } });

async function processBankFiles() {
  const el = $('#process-result');
  el.textContent = 'Importerar…';
  try {
    const data = await api('/api/finance/process', { method: 'POST' });
    el.textContent = `Klart (${data.mode}): ${data.files_processed} filer, ${data.transactions_added} transaktioner.\n${(data.processed||[]).join('\n')}${data.errors?.length ? '\nFel:\n' + data.errors.join('\n') : ''}`;
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
      <datalist id="account-list-dl">${accounts.map(a => `<option value="${escapeHtml(a)}">`).join('')}</datalist>
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

function renderFolderGrid(folders) {
  const el = $('#folder-grid');
  if (!el) return;
  if (!folders.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = folders.map(f =>
    `<div class="folder-chip" data-account="${escapeHtml(f.name)}" title="Släpp fil här">
      <strong>📁 ${escapeHtml(f.name)}</strong>
      <span>${f.pending_files ? f.pending_files + ' fil(er) väntar' : 'Tom inbox'}</span>
    </div>`
  ).join('');
  el.querySelectorAll('.folder-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('#file-input').dataset.targetAccount = chip.dataset.account;
      $('#file-input').click();
    });
    chip.addEventListener('dragover', e => { e.preventDefault(); chip.style.borderColor = 'var(--accent-2)'; });
    chip.addEventListener('dragleave', () => { chip.style.borderColor = ''; });
    chip.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      chip.style.borderColor = '';
      handleDroppedFiles(e.dataTransfer.files, chip.dataset.account);
    });
  });
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
        <span>${escapeHtml(acc)}${isSuggested ? ' ✓ föreslagen' : ''}</span>
        ${hit ? `<span class="score">${Math.round(hit.score * 100)}%</span>` : ''}
      </button>`;
    }).join('');

    openModal(`
      <p style="font-size:0.875rem;color:var(--text-muted);margin:0 0 0.75rem">
        Fil: <strong>${escapeHtml(file.name)}</strong>
        ${detection.auto_detected ? `<br>Auto-detekterat: <strong>${escapeHtml(detection.detected_account)}</strong> (${Math.round(detection.confidence * 100)}%)` : '<br>Kunde inte avgöra konto automatiskt.'}
      </p>
      <div class="account-pick-list" id="account-pick-list">${candidateBtns}</div>
      <div class="create-folder-row">
        <input class="input" id="new-folder-name" placeholder="Nytt kontonamn…">
        <button type="button" class="btn btn-sm" id="btn-create-folder-pick">Skapa</button>
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
      msg += `\n${res.process.transactions_added} transaktioner importerade.`;
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
    mapEl.innerHTML = entries.map(([name, id], i) =>
      `<div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
        <input class="input" data-map-name="${i}" value="${escapeHtml(name)}" placeholder="Kontonamn">
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
  for (let i = 0; i < count; i++) {
    const name = $(`[data-map-name="${i}"]`)?.value?.trim();
    const id = $(`[data-map-id="${i}"]`)?.value?.trim();
    if (name) folder_map[name] = id || '';
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
    `<div class="field" style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem">
      <input class="input" data-map-name="${i}" placeholder="Kontonamn">
      <input class="input" data-map-id="${i}" placeholder="Mapp-ID">
    </div>`);
  mapEl.dataset.count = i + 1;
});

// ── Init ─────────────────────────────────────────────────────────────
bindTaskFilters();
setPage('home');
