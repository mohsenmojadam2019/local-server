'use strict';

const oauth = (scopes) => [{ type: 'oauth2', scopes }];

const TITLES = {
  whoami: 'Current profile',
  devices_list: 'List devices',
  device_ping: 'Ping device',
  system_info: 'System information',
  list_directory: 'List directory',
  get_file_info: 'File information',
  fs_read: 'Read file',
  search: 'Search files',
  git_status: 'Git status',
  git_diff: 'Git diff',
  process_start: 'Start approved process',
  process_read: 'Read process output',
  file_write: 'Write file',
  file_edit: 'Edit file',
  file_remove: 'Remove file',
};

function tool(name, description, scope, inputSchema, annotations, extra = {}) {
  const securitySchemes = oauth([scope]);
  return {
    name,
    title: TITLES[name] || name,
    description,
    inputSchema,
    outputSchema: { type: 'object', additionalProperties: true },
    securitySchemes,
    annotations,
    _meta: { securitySchemes },
    ...extra,
  };
}

const RO = { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true };
const WRITE = { readOnlyHint: false, openWorldHint: false, destructiveHint: false };
const DESTRUCTIVE = { readOnlyHint: false, openWorldHint: false, destructiveHint: true };
const IDEMPOTENT_DESTRUCTIVE = { readOnlyHint: false, openWorldHint: false, destructiveHint: true, idempotentHint: true };
const EXECUTE = { readOnlyHint: false, openWorldHint: true, destructiveHint: true, idempotentHint: false };

const deviceProp = {
  deviceId: { type: 'string', minLength: 1, maxLength: 128, description: 'Target enrolled device ID.' },
};

const TOOLS = [
  tool('whoami', 'Return the profile represented by the current authenticated GodControl connection.', 'profile:read',
    { type: 'object', properties: {}, additionalProperties: false }, RO, {
      outputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', minLength: 1, pattern: '\\S', description: 'Stable opaque profile identifier.' },
          name: { type: 'string', description: 'Display name for the authenticated profile.' },
          email: { type: 'string', description: 'Email address for display only.' },
          nickname: { type: 'string', description: 'Optional account label.' },
        },
        required: ['id'],
        additionalProperties: false,
      },
      _meta: { securitySchemes: oauth(['profile:read']), 'openai/profile': true },
    }),
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
    { type: 'object', properties: { ...deviceProp, program: { type: 'string', minLength: 1, maxLength: 128, description: 'Executable name explicitly allowed by the device policy.' }, args: { type: 'array', items: { type: 'string', maxLength: 1000 }, maxItems: 100, default: [] }, cwd: { type: 'string' } }, required: ['deviceId', 'program'], additionalProperties: false }, EXECUTE),
  tool('process_read', 'Read bounded output from a previously started process session.', 'process:run',
    { type: 'object', properties: { ...deviceProp, session_id: { type: 'string' }, wait_ms: { type: 'integer', minimum: 0, maximum: 5000, default: 0 }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: 1000000, default: 100000 }, tail: { type: 'boolean', default: true } }, required: ['deviceId', 'session_id'], additionalProperties: false }, RO),
  tool('file_write', 'Create or fully replace a text file inside an agent-approved writable root.', 'files:write',
    { type: 'object', properties: { ...deviceProp, path: { type: 'string' }, content: { type: 'string', maxLength: 1000000 } }, required: ['deviceId', 'path', 'content'], additionalProperties: false }, IDEMPOTENT_DESTRUCTIVE),
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
  file_write: { localTool: 'fs_write', stripDevice: true },
  file_edit: { localTool: 'edit_block', stripDevice: true },
  file_remove: { localTool: 'remove_path', stripDevice: true },
};

module.exports = { TOOLS, BY_NAME, LOCAL_MAPPING };
