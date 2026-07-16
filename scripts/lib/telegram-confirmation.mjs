import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { envVar } from "./facebook.mjs";

const execFileAsync = promisify(execFile);

export async function sendTelegramConfirmation({ root, topic, date, mediaKind, permalinkUrl }) {
  const target = envVar(root, "TELEGRAM_CHAT_ID");
  if (!target) return { sent: false, skipped: true, reason: "TELEGRAM_CHAT_ID is not configured" };

  const bin = envVar(root, "OPENCLAW_BIN") || (process.platform === "win32" ? "openclaw.cmd" : "openclaw");
  const lines = [
    "Facebook post published",
    `Topic: ${topic}`,
    `Date: ${date}`,
    `Media: ${mediaKind}`,
  ];
  if (permalinkUrl) lines.push(`Post: ${permalinkUrl}`);

  try {
    const { stdout } = await execFileAsync(bin, [
      "message", "send",
      "--channel", "telegram",
      "--target", target,
      "--message", lines.join("\n"),
      "--json",
    ], { cwd: root, timeout: 20_000, windowsHide: true });
    return { sent: true, output: stdout.trim() };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      reason: error.stderr?.trim() || error.stdout?.trim() || error.message,
    };
  }
}
