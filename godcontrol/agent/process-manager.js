'use strict';

const crypto = require('crypto');
const { spawn } = require('child_process');

class SafeProcessManager {
  constructor({ maxOutputBytes = 1_000_000, timeoutMs = 120_000, envAllowlist } = {}) {
    this.maxOutputBytes = maxOutputBytes;
    this.timeoutMs = timeoutMs;
    this.envAllowlist = envAllowlist || ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'USER', 'TMPDIR'];
    this.sessions = new Map();
  }

  childEnv() {
    const env = {};
    for (const key of this.envAllowlist) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return env;
  }

  start({ program, args = [], cwd, policy }) {
    policy.assertProgram(program);
    const sessionId = crypto.randomUUID();
    const child = spawn(program, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: this.childEnv(),
    });

    const session = {
      id: sessionId,
      pid: child.pid,
      program,
      args,
      cwd,
      startedAt: Date.now(),
      status: 'running',
      exitCode: null,
      signal: null,
      output: Buffer.alloc(0),
    };
    this.sessions.set(sessionId, session);

    const append = (chunk) => {
      const next = Buffer.concat([session.output, Buffer.from(chunk)]);
      session.output = next.length > this.maxOutputBytes
        ? next.subarray(next.length - this.maxOutputBytes)
        : next;
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => {
      append(Buffer.from('\n[process error] ' + error.message + '\n'));
      session.status = 'error';
    });
    child.on('exit', (code, signal) => {
      session.status = 'exited';
      session.exitCode = code;
      session.signal = signal;
      clearTimeout(session.timer);
    });

    session.timer = setTimeout(() => {
      if (session.status === 'running') {
        session.status = 'timed_out';
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 1500).unref();
      }
    }, this.timeoutMs);
    session.timer.unref();

    return {
      session_id: sessionId,
      pid: child.pid,
      status: session.status,
      program,
      args,
      cwd,
    };
  }

  read({ session_id, offset = 0, length = 100000, tail = true }) {
    const session = this.sessions.get(session_id);
    if (!session) throw new Error('Unknown process session');
    const text = session.output.toString('utf8');
    let start = Math.max(0, Number(offset) || 0);
    const maxLength = Math.max(1, Math.min(Number(length) || 100000, this.maxOutputBytes));
    if (tail) start = Math.max(0, text.length - maxLength);
    const output = text.slice(start, start + maxLength);
    return {
      session_id,
      pid: session.pid,
      status: session.status,
      exit_code: session.exitCode,
      signal: session.signal,
      offset: start,
      next_offset: start + output.length,
      output,
    };
  }
}

module.exports = { SafeProcessManager };
