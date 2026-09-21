const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const YAML = require('yaml');
const { CLOUDFLARE_DIR, PORTABLE_CLOUDFLARED } = require('./constants');
const { ensureDir, normalizeHost, pathExists } = require('./utils');

class CloudflareManager extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.process = null;
    this.logs = [];
  }

  binary() {
    return fs.existsSync(PORTABLE_CLOUDFLARED) ? PORTABLE_CLOUDFLARED : 'cloudflared';
  }

  runCapture(args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary(), args, { shell: true, windowsHide: true, ...options });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => { stdout += d.toString(); });
      child.stderr?.on('data', (d) => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve({ stdout, stderr, code });
        else reject(new Error((stderr || stdout || `cloudflared exited with ${code}`).trim()));
      });
    });
  }

  async status() {
    let version = null;
    try {
      const result = await this.runCapture(['--version']);
      version = (result.stdout || result.stderr).trim();
    } catch {}
    const cf = this.store.get().cloudflare;
    return {
      installed: Boolean(version),
      version,
      running: Boolean(this.process),
      pid: this.process?.pid || null,
      tunnelName: cf.tunnelName,
      tunnelId: cf.tunnelId,
      credentialsFile: cf.credentialsFile,
      configFile: path.join(CLOUDFLARE_DIR, 'config.yml'),
      domains: cf.managedDomains || [],
      logs: this.logs.slice(-120),
    };
  }

  appendLog(stream, text) {
    for (const line of String(text).replace(/\r/g, '').split('\n').filter(Boolean)) {
      this.logs.push({ at: Date.now(), stream, line });
    }
    if (this.logs.length > 1000) this.logs.splice(0, this.logs.length - 1000);
    this.emit('log', this.logs.slice(-1)[0]);
  }

  async login() {
    const child = spawn(this.binary(), ['tunnel', 'login'], { shell: true, stdio: 'inherit', windowsHide: false });
    return { pid: child.pid, message: 'مرورگر برای ورود Cloudflare باز می‌شود. پس از تأیید، دوباره وضعیت را بررسی کنید.' };
  }

  async listTunnels() {
    const result = await this.runCapture(['tunnel', 'list', '--output', 'json']);
    try { return JSON.parse(result.stdout || '[]'); } catch { return []; }
  }

  async createTunnel(name) {
    const tunnelName = String(name || this.store.get().cloudflare.tunnelName || 'local-server-pro').trim();
    await ensureDir(CLOUDFLARE_DIR);
    const result = await this.runCapture(['tunnel', 'create', tunnelName]);
    const combined = `${result.stdout}\n${result.stderr}`;
    const idMatch = combined.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    if (!idMatch) throw new Error('تونل ساخته شد اما شناسه آن از خروجی قابل تشخیص نبود. از بخش لیست تونل‌ها بررسی کنید.');
    const tunnelId = idMatch[0];
    const candidates = [
      path.join(process.env.USERPROFILE || '', '.cloudflared', `${tunnelId}.json`),
      path.join(process.env.HOME || '', '.cloudflared', `${tunnelId}.json`),
    ].filter(Boolean);
    const credentialsFile = candidates.find((p) => fs.existsSync(p)) || candidates[0] || '';
    await this.store.mutate((data) => {
      data.cloudflare.tunnelName = tunnelName;
      data.cloudflare.tunnelId = tunnelId;
      data.cloudflare.credentialsFile = credentialsFile;
    });
    await this.writeConfig();
    return this.status();
  }

  async routeDomain(domain) {
    const hostname = normalizeHost(domain);
    if (!hostname || !hostname.includes('.')) throw new Error('دامنه معتبر نیست.');
    const cf = this.store.get().cloudflare;
    if (!cf.tunnelName) throw new Error('ابتدا تونل Cloudflare را ایجاد کنید.');
    await this.runCapture(['tunnel', 'route', 'dns', cf.tunnelName, hostname]);
    await this.store.mutate((data) => {
      const domains = new Set(data.cloudflare.managedDomains || []);
      domains.add(hostname);
      data.cloudflare.managedDomains = [...domains];
    });
    await this.writeConfig();
    return this.status();
  }

  async unmanageDomain(domain) {
    const hostname = normalizeHost(domain);
    await this.store.mutate((data) => {
      data.cloudflare.managedDomains = (data.cloudflare.managedDomains || []).filter((d) => normalizeHost(d) !== hostname);
    });
    await this.writeConfig();
  }

  async writeConfig() {
    await ensureDir(CLOUDFLARE_DIR);
    const data = this.store.get();
    const cf = data.cloudflare;
    if (!cf.tunnelId || !cf.credentialsFile) return null;
    const projectDomains = [];
    for (const project of data.projects || []) {
      const publicHost = normalizeHost(project.publicHost || '');
      if (project.publishEnabled && publicHost && (cf.managedDomains || []).includes(publicHost)) {
        projectDomains.push(publicHost);
      }
      for (const domain of project.domains || []) {
        const hostname = normalizeHost(domain.hostname || domain);
        if (hostname && (cf.managedDomains || []).includes(hostname)) projectDomains.push(hostname);
      }
    }
    const unique = [...new Set(projectDomains)];
    const config = {
      tunnel: cf.tunnelId,
      'credentials-file': cf.credentialsFile,
      ingress: [
        ...unique.map((hostname) => ({ hostname, service: `http://127.0.0.1:${data.settings.proxyPort}`, originRequest: { httpHostHeader: hostname } })),
        { service: 'http_status:404' },
      ],
    };
    const file = path.join(CLOUDFLARE_DIR, 'config.yml');
    await fs.promises.writeFile(file, YAML.stringify(config), 'utf8');
    return file;
  }

  async syncPublishedDomains() {
    const cf = this.store.get().cloudflare;
    if (!cf.tunnelId || !cf.tunnelName) return [];
    const published = (this.store.get().projects || [])
      .filter((p) => p.publishEnabled && normalizeHost(p.publicHost || ''))
      .map((p) => normalizeHost(p.publicHost));
    const synced = [];
    for (const hostname of [...new Set(published)]) {
      if ((this.store.get().cloudflare.managedDomains || []).includes(hostname)) continue;
      await this.routeDomain(hostname);
      synced.push(hostname);
    }
    await this.writeConfig();
    return synced;
  }

  async start() {
    if (this.process) return this.status();
    const cf = this.store.get().cloudflare;
    if (!cf.tunnelName || !cf.tunnelId) throw new Error('تونل Cloudflare هنوز تنظیم نشده است.');
    if (cf.credentialsFile && !(await pathExists(cf.credentialsFile))) throw new Error('فایل credentials تونل پیدا نشد. Cloudflare Login را دوباره انجام دهید.');
    const configFile = await this.writeConfig();
    if (!configFile) throw new Error('فایل تنظیمات Cloudflare ساخته نشد.');
    const child = spawn(this.binary(), ['tunnel', '--config', configFile, 'run', cf.tunnelName], { shell: true, windowsHide: true });
    this.process = child;
    this.appendLog('system', `▶ cloudflared tunnel run ${cf.tunnelName}`);
    child.stdout?.on('data', (d) => this.appendLog('stdout', d));
    child.stderr?.on('data', (d) => this.appendLog('stderr', d));
    child.on('exit', (code) => {
      this.appendLog('system', `■ cloudflared stopped (${code ?? '-'})`);
      if (this.process === child) this.process = null;
    });
    child.on('error', (e) => this.appendLog('system', e.message));
    return this.status();
  }

  async stop() {
    if (!this.process) return this.status();
    const child = this.process;
    this.process = null;
    child.kill('SIGTERM');
    return this.status();
  }
}

module.exports = { CloudflareManager };
