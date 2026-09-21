const http = require('http');
const httpProxy = require('http-proxy');
const { normalizeHost } = require('./utils');

const STATIC_EXTENSIONS = /\.(?:css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|mp4|webm|mp3|ogg|pdf)$/i;

class ProxyManager {
  constructor(store, projectManager) {
    this.store = store;
    this.projectManager = projectManager;
    this.server = null;
    this.proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: false, xfwd: true });
    this.proxy.on('error', (error, req, res) => {
      if (res && !res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`Local Server Pro: upstream unavailable\n${error.message}`);
      }
    });
    this.proxy.on('proxyReq', (proxyReq, req) => {
      proxyReq.setHeader('x-local-server-pro', '1');
      proxyReq.setHeader('x-forwarded-host', req.headers.host || '');
      proxyReq.setHeader('x-forwarded-proto', req.headers['cf-visitor'] ? 'https' : 'http');
    });
    this.proxy.on('proxyRes', (proxyRes, req) => {
      const project = req.__lspProject;
      if (!project) return;
      const preset = project.cdnPreset || 'standard';
      if (preset === 'off') return;
      if (STATIC_EXTENSIONS.test(req.url || '')) {
        if (preset === 'aggressive') {
          proxyRes.headers['cache-control'] = 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400';
        } else {
          proxyRes.headers['cache-control'] = proxyRes.headers['cache-control'] || 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600';
        }
      } else if (preset === 'aggressive' && !proxyRes.headers['cache-control']) {
        proxyRes.headers['cache-control'] = 'public, max-age=60, s-maxage=300, stale-while-revalidate=60';
      }
    });
  }

  resolveProject(hostHeader) {
    const host = normalizeHost(hostHeader || '');
    for (const project of this.store.get().projects || []) {
      const hosts = this.projectManager.allHostsForProject(project);
      if (hosts.includes(host)) return project;
    }
    return null;
  }

  handler(req, res) {
    const project = this.resolveProject(req.headers.host);
    if (!project) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html dir="rtl" lang="fa"><meta charset="utf-8"><title>دامنه ناشناخته</title><body style="font-family:Tahoma;background:#07111f;color:#fff;padding:48px"><h1>دامنه در Local Server Pro تعریف نشده است</h1><p>${String(req.headers.host || '')}</p></body></html>`);
      return;
    }
    req.__lspProject = project;
    this.proxy.web(req, res, { target: `http://127.0.0.1:${project.port}` });
  }

  async start() {
    if (this.server) return;
    const settings = this.store.get().settings;
    const host = settings.allowLanProxy ? '0.0.0.0' : settings.proxyHost;
    this.server = http.createServer((req, res) => this.handler(req, res));
    this.server.on('upgrade', (req, socket, head) => {
      const project = this.resolveProject(req.headers.host);
      if (!project) return socket.destroy();
      req.__lspProject = project;
      this.proxy.ws(req, socket, head, { target: `http://127.0.0.1:${project.port}` });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(settings.proxyPort, host, resolve);
    });
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

module.exports = { ProxyManager };
