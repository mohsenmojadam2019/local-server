import crypto from "node:crypto";

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const hashToken = (value) => crypto.createHash("sha256").update(value).digest("hex");
export const timingSafeEqual = (a, b) => {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
export function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (e, key) => e ? reject(e) : resolve(`${salt}:${key.toString("hex")}`)));
}
export async function passwordVerify(password, encoded) {
  const [salt, expected] = String(encoded).split(":");
  if (!salt || !expected) return false;
  const actual = (await passwordHash(password, salt)).split(":")[1];
  return timingSafeEqual(actual, expected);
}
export const cleanText = (value) => String(value ?? "").replaceAll("\0", "");
export function bounded(value, maxBytes) {
  const text = cleanText(typeof value === "string" ? value : JSON.stringify(value));
  const bytes = Buffer.from(text);
  if (bytes.byteLength <= maxBytes) return text;
  const marker = Buffer.from("\n[truncated]");
  if (maxBytes <= marker.byteLength) return marker.subarray(0, maxBytes).toString("utf8");
  return `${bytes.subarray(0, maxBytes - marker.byteLength).toString("utf8")}${marker.toString()}`;
}
