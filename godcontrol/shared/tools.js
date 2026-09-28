'use strict';

const oauth = (scopes) => [{ type: 'oauth2', scopes }];

function tool(name, description, scope, inputSchema, annotations) {
  const securitySchemes = oauth([scope]);
  return {
    name,
    description,
    inputSchema,
    securitySchemes,
    annotations,
    _meta: { securitySchemes },
  };
}

const RO = { readOnlyHint: true, openWorldHint: false, destructiveHint: false };
const WRITE = { readOnlyHint: false, openWorldHint: false, destructiveHint: false };
const DESTRUCTIVE = { readOnlyHint: false, openWorldHint: false, destructiveHint: true };

const deviceProp = {
  deviceId: { type: 'string', minLength: 1, maxLength: 128, description: 'Target enrolled device ID.' },
};

const TOOLS = [
  tool('whoami', 'Return the authenticated GodControl account profile.', 'profile:read',
    { type: 'object', properties: {}, additionalProperties: false }, RO),
  tool('devices_list', 'List devices enrolled to the authenticated GodControl account.', 'devices:read',
    { type: 'object', properties: {}, additionalProperties: false }, RO),
  tool('device_ping', 'Check whether one enrolled device is reachable.', 'devices:read',
    { type: 'object', properties: deviceProp, required: ['deviceId'], additionalProperties: false }, RO),
  tool('system_info', 'Read operating-system and runtime information from one enrolled device.', 'system:read',
    { type: 'object', properties: deviceProp, required: ['deviceId'], additionalProperties: false }, RO),
  tool('list_directory', 'List files and directories inside an agent-approved root.', 'files:read',
    { type: 'object', properties: { ...deviceProp, path: { type: 'string' }, depth: { type: 'integer', minimum: 1, maximum: 4, default: 1 } }, required: ['deviceId', 'path'], additionalProperties: false }, RO),
  tool('get_file_info', 'Read metadata for a file or directory inside an agent-approved root.', 'files:read',
    { type: 'object', properties: { ...deviceProp, path: { type: 'string' } }, required: ['deviceId', 'path'], additionalProperties: false }, RO),
  tool('fs_read', 'Read a bounded amount of a file inside an agent-approved root.', 'files:read',
    { type: 'object', properties: { ...deviceProp, path: { type: 'string' }, maxBytes: { type: 'integer', minimum: 1, maximum: 2000000, default: 200000 } }, required: ['deviceId', 'path'], additionalProperties: false }, RO),
  tool('search', 'Search filenames or file content inside an agent-approved root.', 'files:read',
    { type: 'object', properties: { ...deviceProp, root: { type: 'string' }, pattern: { type: 'string', minLength: 1, maxLength: 1000 }, mode: { type: 'string', enum: ['files', 'content'], default: 'content' }, fileGlob: { type: 'string', maxLength: 300 }, maxResults: { type: 'integer', minimum: 1, maximum: 1000, default: 100 } }, required: ['deviceId', 'root', 'pattern'], additionalProperties: false }, RO),
  tool('git_status', 'Read git working-tree status for a repository inside an agent-approved root.', 'git:read',
    { type: 'object', properties: { ...deviceProp, repoPath: { type: 'string' } }, required: ['deviceId', 'repoPath'], additionalProperties: false }, RO),
  tool('git_diff', 'Read the git diff for a repository inside an agent-approved root.', 'git:read',
    { type: 'object', properties: { ...deviceProp, repoPath: { type: 'string' }, staged: { type: 'boolean', default: false } }, required: ['deviceId', 'repoPath'], additionalProperties: false }, RO),
  tool('process_start', 'Start a process only when its executable and cwd are allowed by the device policy.', 'process:run',
    { type: 'object', properties: { ...deviceProp, command: { type: 'string', minLength: 1, maxLength: 5000 }, cwd: { type: 'string' } }, required: ['deviceId', 'command'], additionalProperties: false }, WRITE),
  tool('process_read', 'Read bounded output from a previously started process session.', 'process:run',
    { type: 'object', properties: { ...deviceProp, session_id: { type: 'string' }, wait_ms: { type: 'integer', minimum: 0, maximum: 5000, default: 0 }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: 1000000, default: 100000 }, tail: { type: 'boolean', default: true } }, required: ['deviceId', 'session_id'], additionalProperties: false }, RO),
  tool('file_write', 'Create or update a text file inside an agent-approved writable root.', 'files:write',
    { type: 'object', properties: { ...deviceProp, path: { type: 'string' }, content: { type: 'string', maxLength: 1000000 }, mode: { type: 'string', enum: ['rewrite', 'append'], default: 'rewrite' } }, required: ['deviceId', 'path', 'content'], additionalProperties: false }, WRITE),
  tool('file_edit', 'Replace one exact text block in a file inside an agent-approved writable root.', 'files:write',
    { type: 'object', properties: { ...deviceProp, path: { type: 'string' }, old_text: { type: 'string', minLength: 1 }, new_text: { type: 'string' } }, required: ['deviceId', 'path', 'old_text', 'new_text'], additionalProperties: false }, WRITE),
  tool('file_remove', 'Remove one path inside an agent-approved writable root.', 'files:write',
    { type: 'object', properties: { ...deviceProp, path: { type: 'string' } }, required: ['deviceId', 'path'], additionalProperties: false }, DESTRUCTIVE),
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

const LOCAL_MAPPING = {
  device_ping: { localTool: 'ping', stripDevice: true },
  system_info: { localTool: 'system_info', stripDevice: true },
  list_directory: { localTool: 'fs_list', stripDevice: true },
  get_file_info: { localTool: 'fs_info', stripDevice: true },
  fs_read: { localTool: 'fs_read', stripDevice: true },
  git_status: { localTool: 'git_status', stripDevice: true },
  git_diff: { localTool: 'git_diff', stripDevice: true },
  process_start: { localTool: 'start_process', stripDevice: true },
  process_read: { localTool: 'read_process_output', stripDevice: true },
  file_write: { localTool: 'fs_write', stripDevice: true },
  file_edit: { localTool: 'edit_block', stripDevice: true },
  file_remove: { localTool: 'remove_path', stripDevice: true },
};

module.exports = { TOOLS, BY_NAME, LOCAL_MAPPING };
