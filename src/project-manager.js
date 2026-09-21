const EventEmitter = require('events');
const path = require('path');
const { spawn } = require('child_process');
const kill = require('tree-kill');
const pidusage = require('pidusage');
const { detectProject } = require('./project-detector');
const { safeProjectId, slugify, pathExists, findAvailablePort, requestHealth, normalizeHost } = require('./utils');

class ProjectManager extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.processes = new Map();
    this.logs = new Map();
    this.metrics = new Map();
    this.healthTimers = new Map();
    this.metricTimer = null;
  }

  startMetricLoop() {
    if (this.metricTimer) return;
    this.metricTimer = setInterval(() => this.collectMetrics(), 2500);
    this.metricTimer.unref?.();
  }

  async collectMetrics() {
    for (const [id, info] of this.processes.entries()) {
      if (!info.child?.pid) continue;
      try {
        const stat = await pidusage(info.child.pid);
        this.metrics.set(id, { cpu: Number(stat.cpu.toFixed(1)), memory: stat.memory, elapsed: Date.now() - info.startedAt });
      } catch {
        this.metrics.delete(id);
      }
    }
    this.emit('metrics', this.metricsSnapshot());
  }

  metricsSnapshot() {
    const out = {};
    for (const [id, stat] of this.metrics.entries()) out[id] = stat;
    return out;
  }

  list() {
    const projects = this.store.get().projects || [];
    return projects.map((p) => this.publicProject(p));
  }

  get(id) {
    return (this.store.get().projects || []).find((p) => p.id === id) || null;
  }

  publicProject(p) {
    const processInfo = this.processes.get(p.id);
    return {
      ...p,
      runtime: {
        status: processInfo?.status || 'stopped',
        pid: processInfo?.child?.pid || null,
        startedAt: processInfo?.startedAt || null,
        lastExitCode: processInfo?.lastExitCode ?? null,
        health: processInfo?.health || { ok: false, status: null, checkedAt: null },
        metrics: this.metrics.get(p.id) || null,
      },
    };
  }

  allHostsForProject(project) {
    const localHost = normalizeHost(project.localHost || `${project.slug}.localhost`);
    const custom = Array.isArray(project.domains) ? project.domains.map((d) => normalizeHost(d.hostname || d)).filter(Boolean) : [];
    return [localHost, ...custom];
  }

  validateUniqueHosts(candidate, excludingId = null) {
    const wanted = new Set(this.allHostsForProject(candidate));
    for (const project of this.store.get().projects || []) {
      if (project.id === excludingId) continue;
      for (const host of this.allHostsForProject(project)) {
        if (wanted.has(host)) throw new Error(`دامنه ${host} قبلاً برای پروژه «${project.name}» استفاده شده است.`);
      }
    }
  }

  async detect(projectPath, port) {
    if (!projectPath || !(await pathExists(projectPath))) throw new Error('مسیر پروژه وجود ندارد.');
    return detectProject(projectPath, port);
  }

  async create(input) {
    const projectPath = path.resolve(String(input.path || '').trim());
    if (!(await pathExists(projectPath))) throw new Error('پوشه پروژه پیدا نشد.');
    const detected = detectProject(projectPath, Number(input.port) || undefined);
    const port = Number(input.port) || await findAvailablePort(detected.suggestedPort || 3000);
    const slug = slugify(input.slug || input.name || path.basename(projectPath));
    const project = {
      id: safeProjectId(),
      name: String(input.name || path.basename(projectPath)).trim(),
      slug,
      path: projectPath,
      framework: input.framework || detected.framework,
      command: String(input.command || detected.command || '').trim(),
      port,
      localHost: normalizeHost(input.localHost || `${slug}.localhost`),
      domains: Array.isArray(input.domains) ? input.domains : [],
      autoStart: Boolean(input.autoStart),
      autoRestart: input.autoRestart !== false,
      healthPath: String(input.healthPath || '/'),
      cdnPreset: input.cdnPreset || this.store.get().settings.defaultCdnPreset || 'standard',
      env: input.env && typeof input.env === 'object' ? input.env : {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (!project.command) throw new Error('دستور اجرای پروژه مشخص نیست.');
    this.validateUniqueHosts(project);
    await this.store.mutate((data) => data.projects.push(project));
    this.emit('projects', this.list());
    return this.publicProject(project);
  }

  async update(id, patch) {
    const current = this.get(id);
    if (!current) throw new Error('پروژه پیدا نشد.');
    if (this.processes.has(id) && (patch.port || patch.command || patch.path)) throw new Error('برای تغییر مسیر، پورت یا دستور ابتدا پروژه را متوقف کنید.');
    const next = {
      ...current,
      ...patch,
      id: current.id,
      path: patch.path ? path.resolve(String(patch.path)) : current.path,
      port: patch.port ? Number(patch.port) : current.port,
      slug: patch.slug ? slugify(patch.slug) : current.slug,
      localHost: normalizeHost(patch.localHost || current.localHost),
      domains: Array.isArray(patch.domains) ? patch.domains : current.domains,
      env: patch.env && typeof patch.env === 'object' ? patch.env : current.env,
      updatedAt: new Date().toISOString(),
    };
    this.validateUniqueHosts(next, id);
    await this.store.mutate((data) => {
      const index = data.projects.findIndex((p) => p.id === id);
      data.projects[index] = next;
    });
    this.emit('projects', this.list());
    return this.publicProject(next);
  }

  async remove(id) {
    if (this.processes.has(id)) await this.stop(id);
    await this.store.mutate((data) => { data.projects = data.projects.filter((p) => p.id !== id); });
    this.logs.delete(id);
    this.metrics.delete(id);
    this.emit('projects', this.list());
  }

  appendLog(id, stream, chunk) {
    const limit = this.store.get().settings.logLimitPerProject || 1500;
    const lines = String(chunk).replace(/\r/g, '').split('\n').filter((line) => line.length > 0);
    const bucket = this.logs.get(id) || [];
    for (const line of lines) bucket.push({ at: Date.now(), stream, line });
    if (bucket.length > limit) bucket.splice(0, bucket.length - limit);
    this.logs.set(id, bucket);
    this.emit('log', { id, items: lines.map((line) => ({ at: Date.now(), stream, line })) });
  }

  getLogs(id, limit = 300) {
    return (this.logs.get(id) || []).slice(-Math.max(1, Math.min(Number(limit) || 300, 2000)));
  }

  resolveCommand(project) {
    return project.command.replaceAll('{port}', String(project.port)).replaceAll('{host}', '127.0.0.1');
  }

  async start(id) {
    const project = this.get(id);
    if (!project) throw new Error('پروژه پیدا نشد.');
    if (this.processes.has(id)) return this.publicProject(project);
    if (!(await pathExists(project.path))) throw new Error('مسیر پروژه دیگر وجود ندارد.');
    const command = this.resolveCommand(project);
    const child = spawn(command, {
      cwd: project.path,
      shell: true,
      env: { ...process.env, PORT: String(project.port), ...project.env },
      windowsHide: true,
    });
    const info = { child, status: 'starting', startedAt: Date.now(), lastExitCode: null, health: { ok: false, status: null, checkedAt: null } };
    this.processes.set(id, info);
    this.appendLog(id, 'system', `▶ ${command}`);
    child.stdout?.on('data', (chunk) => this.appendLog(id, 'stdout', chunk));
    child.stderr?.on('data', (chunk) => this.appendLog(id, 'stderr', chunk));
    child.on('error', (error) => this.appendLog(id, 'system', `خطا: ${error.message}`));
    child.on('exit', (code, signal) => {
      const current = this.processes.get(id);
      if (!current || current.child !== child) return;
      current.lastExitCode = code;
      this.appendLog(id, 'system', `■ پردازش متوقف شد (code=${code ?? '-'}, signal=${signal ?? '-'})`);
      this.processes.delete(id);
      this.metrics.delete(id);
      this.stopHealthLoop(id);
      this.emit('projects', this.list());
      if (!current.manualStop && project.autoRestart) {
        setTimeout(() => { if (!this.processes.has(id) && this.get(id)) this.start(id).catch(() => {}); }, 2000).unref?.();
      }
    });
    setTimeout(() => {
      const current = this.processes.get(id);
      if (current && current.status === 'starting') current.status = 'running';
      this.emit('projects', this.list());
    }, 700).unref?.();
    this.startHealthLoop(project);
    this.startMetricLoop();
    this.emit('projects', this.list());
    return this.publicProject(project);
  }

  startHealthLoop(project) {
    this.stopHealthLoop(project.id);
    const check = async () => {
      const current = this.processes.get(project.id);
      if (!current) return;
      const pathName = project.healthPath.startsWith('/') ? project.healthPath : `/${project.healthPath}`;
      const health = await requestHealth(`http://127.0.0.1:${project.port}${pathName}`);
      current.health = { ...health, checkedAt: Date.now() };
      if (health.ok && current.status === 'starting') current.status = 'running';
      this.emit('projects', this.list());
    };
    check();
    const timer = setInterval(check, 5000);
    timer.unref?.();
    this.healthTimers.set(project.id, timer);
  }

  stopHealthLoop(id) {
    const timer = this.healthTimers.get(id);
    if (timer) clearInterval(timer);
    this.healthTimers.delete(id);
  }

  async stop(id) {
    const info = this.processes.get(id);
    if (!info) return;
    info.manualStop = true;
    info.status = 'stopping';
    this.emit('projects', this.list());
    const pid = info.child.pid;
    await new Promise((resolve) => {
      if (!pid) return resolve();
      kill(pid, 'SIGTERM', () => resolve());
    });
    setTimeout(() => {
      const current = this.processes.get(id);
      if (current && current.child.pid === pid) kill(pid, 'SIGKILL', () => {});
    }, 2500).unref?.();
  }

  async restart(id) {
    await this.stop(id);
    for (let i = 0; i < 20 && this.processes.has(id); i += 1) await new Promise((r) => setTimeout(r, 150));
    return this.start(id);
  }

  async startAutoProjects() {
    for (const project of this.store.get().projects || []) {
      if (project.autoStart) this.start(project.id).catch((error) => this.appendLog(project.id, 'system', error.message));
    }
  }

  async shutdown() {
    const ids = [...this.processes.keys()];
    await Promise.allSettled(ids.map((id) => this.stop(id)));
    if (this.metricTimer) clearInterval(this.metricTimer);
  }
}

module.exports = { ProjectManager };
