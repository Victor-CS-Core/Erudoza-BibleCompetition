import process from "node:process";
import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function recoverySql({ organizationId, userId, password }) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!uuid.test(organizationId) || !uuid.test(userId)) throw new Error("Explicit organization and user UUIDs are required.");
  if (typeof password !== "string" || password.length < 8 || password.length > 256) throw new Error("Password must contain 8 to 256 characters.");
  const salt = randomBytes(16);
  const hash = `pbkdf2:${salt.toString("base64")}:${pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("base64")}`;
  // One atomic update: authenticate checks credential_version on every request.
  // No change to role, active flag, organization, history, or another user's credentials.
  return `UPDATE Users SET password_hash='${hash}', credential_version='${randomUUID()}' WHERE id='${userId.toLowerCase()}' AND org_id='${organizationId.toLowerCase()}' AND active=1 AND kind='Adult' AND role IN ('Owner','Admin') RETURNING id, org_id, user_name, role;\n`;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== "--organization" || args[2] !== "--user" || args[4] !== "--out") {
    throw new Error("Usage: node scripts/native-admin-recovery.mjs --organization UUID --user UUID --out PRIVATE.sql (password on stdin)");
  }
  if (process.stdin.isTTY) throw new Error("Supply the password through stdin, never a command-line argument.");
  const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  const sql = recoverySql({ organizationId: args[1], userId: args[3], password });
  const file = resolve(args[5]);
  writeFileSync(file, sql, { flag: "wx", mode: 0o600 });
  process.stdout.write(`Recovery SQL written to ${file}. No database was contacted. Applying it must return exactly one administrator row.\n`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
