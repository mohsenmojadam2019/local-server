'use strict';

const fs = require('fs');
const path = require('path');

function splitList(value) {
  return String(value || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function startsWithin(target, root) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

async function canonicalExistingOrParent(inputPath) {
  const absolute = path.resolve(inputPath);
  try { return await fs.promises.realpath(absolute); }
  catch {
    const parent = await fs.promises.realpath(path.dirname(absolute));
    return path.join(parent, path.basename(absolute));
  }
}

class Policy {
  constructor(env = process.env) {
    this.readRoots = splitList(env.GODCONTROL_READ_ROOTS);
    this.writeRoots = splitList(env.GODCONTROL_WRITE_ROOTS);
    this.commands = new Set(splitList(env.GODCONTROL_ALLOWED_COMMANDS));
    this.maxFileBytes = Number(env.GODCONTROL_MAX_FILE_BYTES || 2_000_000);
    this.maxOutputBytes = Number(env.GODCONTROL_MAX_OUTPUT_BYTES || 1_000_000);
  }

  async assertPath(inputPath, write = false) {
    if (!inputPath) throw new Error('Path is required');
    const target = await canonicalExistingOrParent(inputPath);
    const roots = write ? this.writeRoots : [...new Set([...this.readRoots, ...this.writeRoots])];
    if (!roots.length) throw new Error('No allowed roots configured');
    for (const rootInput of roots) {
      const root = await fs.promises.realpath(path.resolve(rootInput));
      if (startsWithin(target, root)) return target;
    }
    throw new Error('Path is outside the configured policy roots');
  }

  assertCommand(command) {
    const first = String(command || '').trim().split(/\s+/)[0];
    if (!first || !this.commands.has(first)) throw new Error('Command is not allowed by device policy');
    return true;
  }
}

module.exports = { Policy, startsWithin, canonicalExistingOrParent };
