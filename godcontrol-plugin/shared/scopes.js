export const SCOPES = ["openid", "email", "godcontrol.devices.read", "godcontrol.fs.read", "godcontrol.fs.write", "godcontrol.git.read", "godcontrol.process"];
export const WRITE_SCOPES = new Set(["godcontrol.fs.write", "godcontrol.process"]);
export function parseScopes(value) { return [...new Set(String(value ?? "").split(/[\s,]+/).filter(Boolean))].filter(x => SCOPES.includes(x)); }
export function requireScopes(granted, required) { return required.every(scope => granted.includes(scope)); }
