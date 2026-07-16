#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const tokenFile = process.argv[2];
if (!tokenFile) {
  console.error("Usage: node scripts/telegram-chat-id.mjs <path-to-bot-token-file>");
  process.exit(1);
}
const file = path.resolve(tokenFile);
if (!existsSync(file)) throw new Error(`Token file not found: ${file}`);
const token = readFileSync(file, "utf8").trim();
if (!token) throw new Error("Token file is empty.");

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const body = await response.json();
if (!response.ok || !body.ok) throw new Error(body.description || `Telegram HTTP ${response.status}`);

const chats = new Map();
for (const update of body.result || []) {
  const chat = update.message?.chat || update.edited_message?.chat || update.channel_post?.chat;
  if (chat) chats.set(String(chat.id), chat);
}
if (!chats.size) {
  console.log("No chats found. Send /start to the bot in Telegram, then run this command again.");
} else {
  console.table([...chats.values()].map((chat) => ({
    chatId: chat.id,
    type: chat.type,
    name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "",
  })));
}
