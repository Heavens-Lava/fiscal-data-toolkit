#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env");
const password = process.env.APPROVAL_PASSWORD;
if (!password || password.length < 12) {
  console.error("Set APPROVAL_PASSWORD to a password of at least 12 characters for this command.");
  process.exit(1);
}

function setEnvValues(values) {
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const lines = current.split(/\r?\n/).filter((line) => line.length);
  for (const [name, value] of Object.entries(values)) {
    const next = `${name}=${String(value).replace(/[\r\n]/g, "")}`;
    const index = lines.findIndex((line) => line.startsWith(`${name}=`));
    if (index >= 0) lines[index] = next;
    else lines.push(next);
  }
  writeFileSync(ENV_FILE, `${lines.join("\n")}\n`);
}

setEnvValues({
  APPROVAL_PASSWORD: password,
  APPROVAL_SESSION_SECRET: randomBytes(32).toString("base64url"),
});
console.log("Approval login configured in .env. Refresh the Approvals page to use it.");
