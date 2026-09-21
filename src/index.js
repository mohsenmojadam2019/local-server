const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const { spawn } = require('child_process');
const { APP_NAME, APP_VERSION, DATA_DIR } = require('./constants');
const { ConfigStore } = require('./config-store');
const { ProjectManager } = require('./project-manager');
const { ProxyManager } = require('./proxy-manager');
const { CloudflareManager } = require('./cloudflare-manager');
const { getLanAddresses, normalizeHost } = require('./utils');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

const store = new ConfigStore();
const projects = new ProjectManager(store);
const cloudflare = new CloudflareManager(store);
const proxy = new ProxyManager(store, projects);
const sseClients = new Set();

function apiError(res, error, status = 400) {
  res.status(status).json({ ok: false, error: error?.message || String(error) });
}

function emitSse(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) client.write(payload);
}

projects.on('projects', (data) => emitSse('projects', data));
projects.on('log', (data) => emitSse('log', data));
projects.on('metrics', (data) => emitSse('metrics', data));
cloudflare.on('log', (data) => emitSse('cloudflare-log', data));
store.on('change', () => cloudflare.writeConfig().catch(() => {}));

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: hello\ndata: ${JSON.stringify({ version: APP_VERSION })}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.get('/api/status', async (req, res) => {
  const settings = store.get().settings;
  res.json({
    ok: true,
    app: { name: APP_NAME, version: APP_VERSION, dataDir: DATA_DIR, platform: process.platform, node: process.version },
    settings,
    projects: projects.list(),
    lan: getLanAddresses(),
    proxy: { url: `http://${settings.proxyHost}:${settings.proxyPort}`, port: settings.proxyPort },
    cloudflare: await cloudflare.status(),
  });
});

app.get('/api/projects', (req, res) => res.json({ ok: true, projects: projects.list() }));
app.post('/api/projects/detect', async (req, res) => {
  try { res.json({ ok: true, detected: await projects.detect(req.body.path, Number(req.body.port) || undefined) }); }
  catch (error) { apiError(res, error); }
});
app.post('/api/projects', async (req, res) => {
  try { res.status(201).json({ ok: true, project: await projects.create(req.body) }); }
  catch (error) { apiError(res, error); }
});
app.put('/api/projects/:id', async (req, res) => {
  try { res.json({ ok: true, project: await projects.update(req.params.id, req.body) }); }
  catch (error) { apiError(res, error); }
});
app.delete('/api/projects/:id', async (req, res) => {
  try { await projects.remove(req.params.id); res.json({ ok: true }); }
  catch (error) { apiError(res, error); }
});
for (const action of ['start', 'stop', 'restart']) {
  app.post(`/api/projects/:id/${action}`, async (req, res) => {
    try {
      const result = await projects[action](req.params.id);
      res.json({ ok: true, project: result || projects.list().find((p) => p.id === req.params.id) || null });
    } catch (error) { apiError(res, error); }
  });
}
app.get('/api/projects/:id/logs', (req, res) => res.json({ ok: true, logs: projects.getLogs(req.params.id, req.query.limit) }));

app.get('/api/settings', (req, res) => res.json({ ok: true, settings: store.get().settings }));
app.put('/api/settings', async (req, res) => {
  const before = { ...store.get().settings };
  try {
    const allowed = ['adminHost', 'adminPort', 'proxyHost', 'proxyPort', 'autoOpenBrowser', 'allowLanProxy', 'defaultCdnPreset', 'logLimitPerProject'];
    await store.mutate((data) => {
      for (const key of allowed) if (Object.hasOwn(req.body, key)) data.settings[key] = req.body[key];
      data.settings.adminPort = Number(data.settings.adminPort);
      data.settings.proxyPort = Number(data.settings.proxyPort);
    });
    const changedProxy = before.proxyPort !== store.get().settings.proxyPort || before.proxyHost !== store.get().settings.proxyHost || before.allowLanProxy !== store.get().settings.allowLanProxy;
    if (changedProxy) await proxy.restart();
    res.json({ ok: true, settings: store.get().settings });
  } catch (error) {
    await store.mutate((data) => { data.settings = before; });
    apiError(res, error);
  }
});

app.get('/api/fs/list', async (req, res) => {
  try {
    const requested = String(req.query.path || os.homedir());
    const resolved = path.resolve(requested);
    const stat = await fs.promises.stat(resolved);
    if (!stat.isDirectory()) throw new Error('مسیر انتخاب‌شده پوشه نیست.');
    const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
    const items = entries
      .filter((item) => item.isDirectory())
      .slice(0, 500)
      .map((item) => ({ name: item.name, path: path.join(resolved, item.name) }));
    res.json({ ok: true, path: resolved, parent: path.dirname(resolved), items });
  } catch (error) { apiError(res, error); }
});

app.get('/api/cloudflare/status', async (req, res) => res.json({ ok: true, cloudflare: await cloudflare.status() }));
app.post('/api/cloudflare/login', async (req, res) => {
  try { res.json({ ok: true, result: await cloudflare.login() }); } catch (error) { apiError(res, error); }
});
app.get('/api/cloudflare/tunnels', async (req, res) => {
  try { res.json({ ok: true, tunnels: await cloudflare.listTunnels() }); } catch (error) { apiError(res, error); }
});
app.post('/api/cloudflare/tunnel/create', async (req, res) => {
  try { res.json({ ok: true, cloudflare: await cloudflare.createTunnel(req.body.name) }); } catch (error) { apiError(res, error); }
});
app.post('/api/cloudflare/tunnel/start', async (req, res) => {
  try { res.json({ ok: true, cloudflare: await cloudflare.start() }); } catch (error) { apiError(res, error); }
});
app.post('/api/cloudflare/tunnel/stop', async (req, res) => {
  try { res.json({ ok: true, cloudflare: await cloudflare.stop() }); } catch (error) { apiError(res, error); }
});
app.post('/api/cloudflare/domain', async (req, res) => {
  try {
    const project = projects.get(req.body.projectId);
    if (!project) throw new Error('پروژه پیدا نشد.');
    const hostname = normalizeHost(req.body.hostname);
    const domains = Array.isArray(project.domains) ? [...project.domains] : [];
    if (!domains.some((d) => normalizeHost(d.hostname || d) === hostname)) {
      domains.push({ hostname, cdn: true, addedAt: new Date().toISOString() });
      await projects.update(project.id, { domains });
    }
    await cloudflare.routeDomain(hostname);
    res.json({ ok: true, project: projects.list().find((p) => p.id === project.id), cloudflare: await cloudflare.status() });
  } catch (error) { apiError(res, error); }
});
app.delete('/api/cloudflare/domain', async (req, res) => {
  try {
    const project = projects.get(req.body.projectId);
    const hostname = normalizeHost(req.body.hostname);
    if (project) {
      const domains = (project.domains || []).filter((d) => normalizeHost(d.hostname || d) !== hostname);
      await projects.update(project.id, { domains });
    }
    await cloudflare.unmanageDomain(hostname);
    res.json({ ok: true });
  } catch (error) { apiError(res, error); }
});

app.use(express.static(path.join(__dirname, '..', 'public'), { etag: true, maxAge: '5m' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

async function main() {
  await store.load();
  await proxy.start();
  await cloudflare.writeConfig().catch(() => {});
  await projects.startAutoProjects();
  const settings = store.get().settings;
  const server = app.listen(settings.adminPort, settings.adminHost, async () => {
    const url = `http://${settings.adminHost}:${settings.adminPort}`;
    console.log(`${APP_NAME} ${APP_VERSION}`);
    console.log(`Dashboard: ${url}`);
    console.log(`Proxy: http://${settings.proxyHost}:${settings.proxyPort}`);
    if (settings.autoOpenBrowser && process.env.NO_OPEN !== '1') {
      try {
        if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
        else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
        else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
      } catch {}
    }
  });

  const shutdown = async () => {
    console.log('\nShutting down...');
    await cloudflare.stop().catch(() => {});
    await projects.shutdown().catch(() => {});
    await proxy.stop().catch(() => {});
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref?.();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
