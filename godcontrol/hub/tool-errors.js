'use strict';

/**
 * Translate only known, routine device policy failures to actionable MCP errors.
 * All text coming back from a remote agent is untrusted: never mirror it.
 * Unexpected failures still return the hub's generic Internal error.
 */
function classifyDeviceToolError(error) {
  const message = String(error?.message || '');
  const exact = new Map([
    ['Path is outside the configured policy roots', {
      code: -32012, message: 'Path denied by device policy. Use an approved project root.',
    }],
    ['Program is not allowed by device policy', {
      code: -32013, message: 'Program denied by device allowlist. Use an approved executable.',
    }],
    ['Program must be a bare executable name', {
      code: -32013, message: 'Executable must be an approved bare name, not an absolute path or shell expression.',
    }],
    ['No allowed roots configured', {
      code: -32012, message: 'No approved device paths are configured. Review local agent policy.',
    }],
    ['maxBytes exceeds device policy', {
      code: -32014, message: 'maxBytes is above the device read limit. Request fewer bytes.',
    }],
    ['length exceeds device policy', {
      code: -32014, message: 'Requested output length is above the device limit.',
    }],
    ['Path is required', {
      code: -32602, message: 'A file path is required for this operation.',
    }],
    ['Device call timed out', {
      code: -32015, message: 'Device did not respond before the call timeout. Check connection and load.',
    }],
  ]);
  if (exact.has(message)) return { status: 400, ...exact.get(message) };
  if (/\bmaxBytes\b/i.test(message) && /\b(exceed|size|large|limit|greater)\w*\b/i.test(message)) {
    return { status: 400, code: -32014, message: 'File exceeds requested maxBytes. Check get_file_info and retry with an adequate byte limit within device policy.' };
  }
  return null;
}

module.exports = { classifyDeviceToolError };
