const state = {
  status: null,
  projects: [],
  cloudflare: null,
  page: 'dashboard',
  projectFilter: 'all',
  browserPath: '',
  logProjectId: '',
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v = '') => String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const fmtBytes = (n) => !n ? '—' : n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n > 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(0)} MB` : `${(n / 1024).toFixed(0)} KB`;
const fmtUptime = (ms) => {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}س ${m}د` : `${m} دقیقه`;
};

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  const data = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toastHost').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function openModal(id) { $(`#${id}`).classList.add('open'); }
function closeModal(id) { $(`#${id}`).classList.remove('open'); }

const pageMeta = {
  dashboard: ['داشبورد', 'کنترل پروژه‌ها، دامنه‌ها، تونل و وضعیت سرویس‌ها'],
  projects: ['پروژه‌ها', 'اجرا، توقف، مانیتورینگ و تنظیم هر پروژه'],
  domains: ['دامنه و CDN', 'Route دامنه‌های عمومی و محلی به پروژه‌ها'],
  cloudflare: ['Cloudflare Tunnel', 'انتشار امن پروژه‌های لوکال روی اینترنت'],
  logs: ['لاگ زنده', 'مشاهده خروجی پردازش پروژه‌ها در لحظه'],
  settings: ['تنظیمات', 'Reverse Proxy، شبکه و رفتار پنل'],
};

function go(page) {
  state.page = page;
  $$('.page').forEach((el) => el.classList.toggle('active', el.id === `page-${page}`));
  $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
  const meta = pageMeta[page];
  $('#pageTitle').textContent = meta[0];
  $('#pageSubtitle').textContent = meta[1];
  if (page === 'logs') refreshLogs();
}

function runtimeBadge(project) {
  const status = project.runtime?.status || 'stopped';
  const label = status === 'running' ? 'فعال' : status === 'starting' ? 'در حال اجرا' : status === 'stopping' ? 'در حال توقف' : 'متوقف';
  return `<span class="badge ${status}">${status === 'running' ? '●' : '○'} ${label}</span>`;
}

function projectCard(project) {
  const running = project.runtime?.status === 'running' || project.runtime?.status === 'starting';
  const health = project.runtime?.health || {};
  const metric = project.runtime?.metrics;
  const proxyPort = state.status?.settings?.proxyPort || 8787;
  const localUrl = `http://${project.localHost}:${proxyPort}`;
  return `<article class="project-card ${running ? 'running' : ''}" data-id="${esc(project.id)}">
    <div class="project-top">
      <div class="project-name"><h4>${esc(project.name)}</h4><small>${esc(project.framework || 'custom')} · PID ${project.runtime?.pid || '—'}</small></div>
      ${runtimeBadge(project)}
    </div>
    <div class="project-meta">
      <div class="meta"><span>Local Domain</span><code title="${esc(localUrl)}">${esc(project.localHost)}</code></div>
      <div class="meta"><span>Public Domain</span><code>${esc(project.publicHost || '—')}</code></div>
      <div class="meta"><span>Port</span><b>${esc(project.port)}</b></div>
      <div class="meta"><span>CPU / RAM</span><b>${metric ? `${metric.cpu}% · ${fmtBytes(metric.memory)}` : '—'}</b></div>
      <div class="meta"><span>Uptime</span><b>${fmtUptime(metric?.elapsed)}</b></div>
    </div>
    <div class="health"><span>Health Check</span><b class="${health.ok ? 'ok' : 'bad'}">${health.ok ? `HTTP ${health.status || 'OK'}` : running ? 'در انتظار پاسخ' : 'Offline'}</b></div>
    <div class="project-actions">
      ${running ? `<button class="btn danger" data-action="stop">■ توقف</button><button class="btn ghost" data-action="restart">↻ Restart</button>` : `<button class="btn success" data-action="start">▶ اجرا</button>`}
      <button class="btn ghost" data-action="open">↗ باز کردن</button>
      <label class="switch-field compact-switch"><div><b>Auto Start</b></div><input type="checkbox" data-autostart ${project.autoStart ? 'checked' : ''} /></label>
      <button class="btn ghost project-more" data-action="edit">•••</button>
    </div>
  </article>`;
}

function renderProjects() {
  const q = ($('#projectSearch')?.value || '').trim().toLowerCase();
  const filtered = state.projects.filter((p) => {
    const s = p.runtime?.status || 'stopped';
    if (state.projectFilter === 'running' && !['running', 'starting'].includes(s)) return false;
    if (state.projectFilter === 'stopped' && ['running', 'starting'].includes(s)) return false;
    return !q || `${p.name} ${p.path} ${p.framework} ${p.localHost}`.toLowerCase().includes(q);
  });
  const html = filtered.length ? filtered.map(projectCard).join('') : '<div class="empty-state">پروژه‌ای مطابق فیلتر پیدا نشد.</div>';
  $('#projectsGrid').innerHTML = html;
  const active = state.projects.filter((p) => ['running', 'starting'].includes(p.runtime?.status));
  $('#dashboardProjects').innerHTML = active.length ? active.slice(0, 6).map(projectCard).join('') : '<div class="empty-state">فعلاً هیچ پروژه‌ای اجرا نشده است.</div>';
  bindProjectActions();
}

function bindProjectActions() {
  $$('.project-card [data-action]').forEach((button) => {
    button.onclick = async () => {
      const card = button.closest('.project-card');
      const id = card.dataset.id;
      const action = button.dataset.action;
      const project = state.projects.find((p) => p.id === id);
      if (!project) return;
      if (action === 'open') {
        window.open(`http://${project.localHost}:${state.status.settings.proxyPort}`, '_blank');
        return;
      }
      if (action === 'edit') { fillProjectModal(project); openModal('projectModal'); return; }
      button.disabled = true;
      try {
        await api(`/api/projects/${id}/${action}`, { method: 'POST' });
        toast(action === 'start' ? 'پروژه اجرا شد.' : action === 'stop' ? 'فرمان توقف ارسال شد.' : 'پروژه Restart شد.');
        setTimeout(loadStatus, 500);
      } catch (e) { toast(e.message, 'error'); }
      finally { button.disabled = false; }
    };
  });
  $$('.project-card [data-autostart]').forEach((toggle) => {
    toggle.onchange = async () => {
      const card = toggle.closest('.project-card');
      const id = card.dataset.id;
      toggle.disabled = true;
      try {
        await api(`/api/projects/${id}`, { method: 'PUT', body: { autoStart: toggle.checked } });
        toast(toggle.checked ? 'اجرای خودکار فعال شد.' : 'اجرای خودکار غیرفعال شد.');
        await loadStatus();
      } catch (e) {
        toggle.checked = !toggle.checked;
        toast(e.message, 'error');
      } finally {
        toggle.disabled = false;
      }
    };
  });
}

function renderDomains() {
  const rows = [];
  for (const project of state.projects) {
    rows.push(`<tr><td><code class="domain-name">${esc(project.localHost)}</code></td><td>${esc(project.name)}</td><td><span class="badge">Local</span></td><td>${esc(project.cdnPreset || 'standard')}</td><td><span class="badge running">● آماده</span></td><td></td></tr>`);
    if (project.publicHost) {
      const managedPublic = (state.cloudflare?.domains || []).includes(project.publicHost);
      rows.push(`<tr><td><code class="domain-name">${esc(project.publicHost)}</code></td><td>${esc(project.name)}</td><td><span class="badge">Public</span></td><td>${esc(project.cdnPreset || 'standard')}</td><td><span class="badge ${managedPublic ? 'running' : ''}">${project.publishEnabled ? (managedPublic ? '● Route شده' : '○ آماده Route') : '○ انتشار خاموش'}</span></td><td></td></tr>`);
    }
    for (const item of project.domains || []) {
      const host = item.hostname || item;
      const managed = (state.cloudflare?.domains || []).includes(host);
      rows.push(`<tr><td><code class="domain-name">${esc(host)}</code></td><td>${esc(project.name)}</td><td><span class="badge">Public</span></td><td>${esc(project.cdnPreset || 'standard')}</td><td><span class="badge ${managed ? 'running' : ''}">${managed ? '● Route شده' : '○ فقط در Proxy'}</span></td><td><button class="link-btn" data-remove-domain="${esc(host)}" data-project="${esc(project.id)}">حذف</button></td></tr>`);
    }
  }
  $('#domainsTable').innerHTML = rows.join('') || '<tr><td colspan="6">هنوز دامنه‌ای تعریف نشده است.</td></tr>';
  $$('[data-remove-domain]').forEach((btn) => btn.onclick = async () => {
    if (!confirm(`دامنه ${btn.dataset.removeDomain} از پروژه حذف شود؟\nتوجه: DNS Record ایجادشده در Cloudflare به‌صورت خودکار حذف نمی‌شود.`)) return;
    try {
      await api('/api/cloudflare/domain', { method: 'DELETE', body: { projectId: btn.dataset.project, hostname: btn.dataset.removeDomain } });
      toast('دامنه از Local Server Pro حذف شد.');
      await loadStatus();
    } catch (e) { toast(e.message, 'error'); }
  });
  $('#domainProject').innerHTML = state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
}

function renderCloudflare() {
  const cf = state.cloudflare || {};
  $('#cfInstalled').textContent = cf.installed ? cf.version : 'نصب نیست';
  $('#cfTunnelName').textContent = cf.tunnelName || '—';
  $('#cfTunnelId').textContent = cf.tunnelId || '—';
  $('#cfProcess').textContent = cf.running ? `Running · PID ${cf.pid}` : 'Stopped';
  $('#cfBadge').textContent = cf.running ? 'CONNECTED' : cf.installed ? 'READY' : 'NOT INSTALLED';
  $('#cfBadge').className = `badge ${cf.running ? 'running' : ''}`;
  $('#cfDot').className = `status-dot ${cf.running ? 'on' : cf.installed ? 'warn' : ''}`;
  $('#cfLabel').textContent = cf.running ? 'Tunnel متصل' : cf.installed ? 'آماده اتصال' : 'cloudflared نصب نیست';
  const lines = cf.logs || [];
  $('#cfLog').textContent = lines.length ? lines.map((x) => `[${new Date(x.at).toLocaleTimeString('fa-IR')}] ${x.stream}> ${x.line}`).join('\n') : 'هنوز لاگی ثبت نشده است.';
  $('#cfLog').scrollTop = $('#cfLog').scrollHeight;
}

function renderDashboard() {
  const settings = state.status?.settings || {};
  const running = state.projects.filter((p) => ['running', 'starting'].includes(p.runtime?.status)).length;
  const publicDomains = state.projects.reduce((sum, p) => sum + (p.domains?.length || 0) + (p.publicHost ? 1 : 0), 0);
  $('#statProjects').textContent = state.projects.length;
  $('#statRunning').textContent = running;
  $('#statDomains').textContent = state.projects.length + publicDomains;
  $('#statTunnel').textContent = state.cloudflare?.running ? 'متصل' : 'خاموش';
  $('#statTunnelSub').textContent = state.cloudflare?.installed ? (state.cloudflare?.tunnelId ? 'Tunnel تنظیم شده' : 'نیاز به ساخت Tunnel') : 'cloudflared نصب نیست';
  $('#proxyEndpoint').textContent = `http://${settings.proxyHost || '127.0.0.1'}:${settings.proxyPort || 8787}`;
  $('#proxyDot').className = 'status-dot on';
  $('#proxyLabel').textContent = `Port ${settings.proxyPort || 8787}`;
  const lan = state.status?.lan || [];
  const rows = [
    `<div class="kv-row"><span>Proxy Local</span><code>127.0.0.1:${settings.proxyPort || 8787}</code></div>`,
    ...lan.map((x) => `<div class="kv-row"><span>${esc(x.name)}</span><code>${esc(x.address)}:${settings.proxyPort || 8787}</code></div>`),
  ];
  $('#networkList').innerHTML = rows.join('');
}

function renderSettings() {
  const s = state.status?.settings || {};
  $('#settingProxyPort').value = s.proxyPort || 8787;
  $('#settingAdminPort').value = s.adminPort || 8788;
  $('#settingLanProxy').checked = Boolean(s.allowLanProxy);
  $('#settingOpenBrowser').checked = Boolean(s.autoOpenBrowser);
  $('#settingCdn').value = s.defaultCdnPreset || 'standard';
}

function renderLogSelect() {
  const current = state.logProjectId || $('#logProjectSelect').value;
  $('#logProjectSelect').innerHTML = '<option value="">انتخاب پروژه...</option>' + state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (state.projects.some((p) => p.id === current)) $('#logProjectSelect').value = current;
}

function renderAll() {
  renderDashboard();
  renderProjects();
  renderDomains();
  renderCloudflare();
  renderSettings();
  renderLogSelect();
}

async function loadStatus() {
  try {
    const data = await api('/api/status');
    state.status = data;
    state.projects = data.projects || [];
    state.cloudflare = data.cloudflare || {};
    renderAll();
  } catch (e) { toast(`خطا در اتصال به سرویس: ${e.message}`, 'error'); }
}

function fillProjectModal(project = null) {
  $('#projectModalTitle').textContent = project ? 'ویرایش پروژه' : 'افزودن پروژه';
  $('#projectId').value = project?.id || '';
  $('#projectName').value = project?.name || '';
  $('#projectSlug').value = project?.slug || '';
  $('#projectPath').value = project?.path || '';
  $('#projectCommand').value = project?.command || '';
  $('#projectPort').value = project?.port || '';
  $('#projectFramework').value = project?.framework || '';
  $('#projectLocalHost').value = project?.localHost || '';
  $('#projectPublicHost').value = project?.publicHost || '';
  $('#projectPublishEnabled').checked = Boolean(project?.publishEnabled);
  $('#projectCdn').value = project?.cdnPreset || state.status?.settings?.defaultCdnPreset || 'standard';
  $('#projectAutoStart').checked = Boolean(project?.autoStart);
  $('#projectAutoRestart').checked = project ? project.autoRestart !== false : true;
}

async function submitProject(e) {
  e.preventDefault();
  const id = $('#projectId').value;
  const body = {
    name: $('#projectName').value,
    slug: $('#projectSlug').value,
    path: $('#projectPath').value,
    command: $('#projectCommand').value,
    port: Number($('#projectPort').value) || undefined,
    framework: $('#projectFramework').value,
    localHost: $('#projectLocalHost').value,
    publicHost: $('#projectPublicHost').value,
    publishEnabled: $('#projectPublishEnabled').checked,
    cdnPreset: $('#projectCdn').value,
    autoStart: $('#projectAutoStart').checked,
    autoRestart: $('#projectAutoRestart').checked,
  };
  try {
    const result = id
      ? await api(`/api/projects/${id}`, { method: 'PUT', body })
      : await api('/api/projects', { method: 'POST', body });
    toast(id ? 'پروژه ویرایش شد.' : 'پروژه اضافه شد.');
    if (result.publicationWarning) toast(`پروژه ذخیره شد، اما Route دامنه انجام نشد: ${result.publicationWarning}`, 'error');
    closeModal('projectModal');
    await loadStatus();
  } catch (error) { toast(error.message, 'error'); }
}

async function detectProject() {
  try {
    const data = await api('/api/projects/detect', { method: 'POST', body: { path: $('#projectPath').value, port: Number($('#projectPort').value) || undefined } });
    const d = data.detected;
    if (!$('#projectCommand').value) $('#projectCommand').value = d.command || '';
    $('#projectFramework').value = d.framework || 'custom';
    if (!$('#projectPort').value) $('#projectPort').value = d.suggestedPort || '';
    toast(`نوع پروژه تشخیص داده شد: ${d.framework}`);
  } catch (e) { toast(e.message, 'error'); }
}

async function openBrowserPicker(startPath) {
  try {
    const query = startPath ? `?path=${encodeURIComponent(startPath)}` : '';
    const data = await api(`/api/fs/list${query}`);
    state.browserPath = data.path;
    $('#browserPath').textContent = data.path;
    $('#browserUp').dataset.parent = data.parent;
    $('#browserList').innerHTML = data.items.map((x) => `<button class="folder" data-path="${esc(x.path)}">▣ ${esc(x.name)}</button>`).join('') || '<div class="empty-state">زیرپوشه‌ای وجود ندارد.</div>';
    $$('#browserList [data-path]').forEach((el) => el.onclick = () => openBrowserPicker(el.dataset.path));
    openModal('browserModal');
  } catch (e) { toast(e.message, 'error'); }
}

async function refreshLogs() {
  const id = $('#logProjectSelect').value || state.logProjectId;
  state.logProjectId = id;
  if (!id) { $('#projectLog').textContent = 'یک پروژه انتخاب کنید.'; return; }
  const project = state.projects.find((p) => p.id === id);
  $('#logProjectLabel').textContent = project?.name || id;
  try {
    const data = await api(`/api/projects/${id}/logs?limit=800`);
    $('#projectLog').textContent = data.logs.length ? data.logs.map((x) => `[${new Date(x.at).toLocaleTimeString('fa-IR')}] ${x.stream}> ${x.line}`).join('\n') : 'هنوز لاگی ثبت نشده است.';
    $('#projectLog').scrollTop = $('#projectLog').scrollHeight;
  } catch (e) { toast(e.message, 'error'); }
}

function bindEvents() {
  $('#nav').onclick = (e) => { const btn = e.target.closest('[data-page]'); if (btn) go(btn.dataset.page); };
  $$('[data-go]').forEach((btn) => btn.onclick = () => go(btn.dataset.go));
  $$('[data-close]').forEach((btn) => btn.onclick = () => closeModal(btn.dataset.close));
  $$('.modal-backdrop').forEach((el) => el.onclick = (e) => { if (e.target === el) closeModal(el.id); });
  $('#addProjectBtn').onclick = () => { fillProjectModal(); openModal('projectModal'); };
  $('#projectForm').onsubmit = submitProject;
  $('#detectBtn').onclick = detectProject;
  $('#browseBtn').onclick = () => openBrowserPicker($('#projectPath').value || undefined);
  $('#browserUp').onclick = () => openBrowserPicker($('#browserUp').dataset.parent);
  $('#browserSelect').onclick = () => { $('#projectPath').value = state.browserPath; closeModal('browserModal'); };
  $('#refreshBtn').onclick = loadStatus;
  $('#projectSearch').oninput = renderProjects;
  $$('.chip[data-filter]').forEach((chip) => chip.onclick = () => { $$('.chip[data-filter]').forEach((x) => x.classList.remove('active')); chip.classList.add('active'); state.projectFilter = chip.dataset.filter; renderProjects(); });
  $('#addDomainBtn').onclick = () => { if (!state.projects.length) return toast('ابتدا یک پروژه اضافه کنید.', 'error'); openModal('domainModal'); };
  $('#domainForm').onsubmit = async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    try {
      await api('/api/cloudflare/domain', { method: 'POST', body: { projectId: $('#domainProject').value, hostname: $('#domainHostname').value } });
      toast('دامنه به پروژه متصل و Route شد.');
      $('#domainHostname').value = '';
      closeModal('domainModal');
      await loadStatus();
    } catch (err) { toast(err.message, 'error'); }
    finally { button.disabled = false; }
  };
  $('#cfLoginBtn').onclick = async () => { try { const d = await api('/api/cloudflare/login', { method: 'POST' }); toast(d.result.message); } catch (e) { toast(e.message, 'error'); } };
  $('#cfCreateBtn').onclick = async () => {
    const name = prompt('نام Tunnel:', state.cloudflare?.tunnelName || 'local-server-pro');
    if (!name) return;
    try { await api('/api/cloudflare/tunnel/create', { method: 'POST', body: { name } }); toast('Tunnel ساخته شد.'); await loadStatus(); } catch (e) { toast(e.message, 'error'); }
  };
  $('#cfStartBtn').onclick = async () => { try { await api('/api/cloudflare/tunnel/start', { method: 'POST' }); toast('Cloudflare Tunnel روشن شد.'); await loadStatus(); } catch (e) { toast(e.message, 'error'); } };
  $('#cfStopBtn').onclick = async () => { try { await api('/api/cloudflare/tunnel/stop', { method: 'POST' }); toast('Tunnel متوقف شد.'); await loadStatus(); } catch (e) { toast(e.message, 'error'); } };
  $('#copyWinget').onclick = async () => { await navigator.clipboard.writeText('winget install --id Cloudflare.cloudflared -e'); toast('دستور نصب کپی شد.'); };
  $('#clearCfLog').onclick = () => { $('#cfLog').textContent = 'نمایش لاگ پاک شد؛ لاگ‌های جدید دوباره ظاهر می‌شوند.'; };
  $('#logProjectSelect').onchange = () => { state.logProjectId = $('#logProjectSelect').value; refreshLogs(); };
  $('#reloadLogsBtn').onclick = refreshLogs;
  $('#clearLogView').onclick = () => { $('#projectLog').textContent = 'نمایش پاک شد.'; };
  $('#saveSettingsBtn').onclick = async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: {
        proxyPort: Number($('#settingProxyPort').value),
        allowLanProxy: $('#settingLanProxy').checked,
        autoOpenBrowser: $('#settingOpenBrowser').checked,
        defaultCdnPreset: $('#settingCdn').value,
      }});
      toast('تنظیمات ذخیره شد.');
      await loadStatus();
    } catch (e) { toast(e.message, 'error'); }
  };
}

function connectEvents() {
  const source = new EventSource('/api/events');
  source.addEventListener('projects', (e) => {
    try { state.projects = JSON.parse(e.data); renderProjects(); renderDashboard(); renderDomains(); renderLogSelect(); } catch {}
  });
  source.addEventListener('log', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (state.page === 'logs' && data.id === state.logProjectId) {
        const box = $('#projectLog');
        if (box.textContent === '—' || box.textContent.includes('هنوز لاگی')) box.textContent = '';
        box.textContent += (box.textContent ? '\n' : '') + data.items.map((x) => `[${new Date(x.at).toLocaleTimeString('fa-IR')}] ${x.stream}> ${x.line}`).join('\n');
        box.scrollTop = box.scrollHeight;
      }
    } catch {}
  });
  source.addEventListener('cloudflare-log', (e) => {
    try {
      const x = JSON.parse(e.data);
      const box = $('#cfLog');
      if (box.textContent.includes('هنوز لاگی')) box.textContent = '';
      box.textContent += `${box.textContent ? '\n' : ''}[${new Date(x.at).toLocaleTimeString('fa-IR')}] ${x.stream}> ${x.line}`;
      box.scrollTop = box.scrollHeight;
    } catch {}
  });
  source.onerror = () => setTimeout(loadStatus, 1000);
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  connectEvents();
  await loadStatus();
});
