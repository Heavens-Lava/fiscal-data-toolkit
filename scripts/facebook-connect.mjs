#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envVar, listFacebookPages, verifyFacebookPage } from "./lib/facebook.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".env");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function setEnvValues(values) {
  const current = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  let lines = current.split(/\r?\n/).filter((line) => line.length);
  for (const [name, value] of Object.entries(values)) {
    const next = `${name}=${String(value).replace(/[\r\n]/g, "")}`;
    const index = lines.findIndex((line) => line.startsWith(`${name}=`));
    if (index >= 0) lines[index] = next;
    else lines.push(next);
  }
  writeFileSync(ENV_FILE, `${lines.join("\n")}\n`);
}

async function pages() {
  return listFacebookPages({ root: ROOT, userAccessToken: process.env.FB_USER_ACCESS_TOKEN });
}

const command = process.argv[2] || "verify";
try {
  if (command === "list") {
    const found = await pages();
    if (!found.length) console.log("No manageable Pages were returned for this Meta user token.");
    else console.table(found.map((page) => ({ id: page.id, name: page.name, tasks: (page.tasks || []).join(", ") })));
  } else if (command === "connect") {
    const wanted = argValue("--page");
    if (!wanted) throw new Error("Usage: node scripts/facebook-connect.mjs connect --page <Page ID or exact Page name>");
    const found = await pages();
    const page = found.find((item) => String(item.id) === wanted || item.name.toLowerCase() === wanted.toLowerCase());
    if (!page) throw new Error(`Page not found: ${wanted}. Run the list command first.`);
    if ((page.tasks || []).length && !(page.tasks || []).some((task) => String(task).endsWith("CREATE_CONTENT"))) {
      throw new Error(`Meta did not grant CREATE_CONTENT for ${page.name}. Check the app permissions and Page access.`);
    }
    setEnvValues({
      FB_PAGE_ID: page.id,
      FB_PAGE_ACCESS_TOKEN: page.access_token,
      FB_EXPECTED_PAGE_NAME: page.name,
    });
    console.log(`Connected \"${page.name}\" (${page.id}). The token was saved to .env and was not printed.`);
  } else if (command === "verify") {
    const page = await verifyFacebookPage({ root: ROOT });
    console.log(`Verified Facebook Page: ${page.name} (${page.id})${page.link ? `\n${page.link}` : ""}`);
  } else if (command === "status") {
    console.log({
      configured: Boolean(envVar(ROOT, "FB_PAGE_ID") && envVar(ROOT, "FB_PAGE_ACCESS_TOKEN")),
      expectedPage: envVar(ROOT, "FB_EXPECTED_PAGE_NAME") || null,
    });
  } else {
    throw new Error("Commands: status, list, connect --page <id-or-name>, verify");
  }
} catch (error) {
  console.error(`Facebook connection error: ${error.message}`);
  process.exitCode = 1;
}
