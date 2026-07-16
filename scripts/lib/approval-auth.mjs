import { createHmac, timingSafeEqual } from "node:crypto";
import { envVar } from "./facebook.mjs";

const COOKIE_NAME = "fdt_approval_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function equalText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function signature(secret, expires) {
  return createHmac("sha256", secret).update(String(expires)).digest("base64url");
}

function cookieValue(req) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export function approvalAuthConfig(root) {
  return {
    password: envVar(root, "APPROVAL_PASSWORD"),
    secret: envVar(root, "APPROVAL_SESSION_SECRET"),
  };
}

export function approvalAuthReady(root) {
  const config = approvalAuthConfig(root);
  return Boolean(config.password && config.secret && config.secret.length >= 32);
}

export function verifyApprovalPassword(root, candidate) {
  const { password } = approvalAuthConfig(root);
  return Boolean(password) && equalText(password, candidate);
}

export function isApprovalAuthenticated(root, req) {
  const { secret } = approvalAuthConfig(root);
  if (!secret) return false;
  const raw = cookieValue(req);
  if (!raw) return false;
  const [expiresText, supplied] = raw.split(".");
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires <= Math.floor(Date.now() / 1000)) return false;
  return equalText(signature(secret, expires), supplied);
}

function usesHttps(req) {
  return Boolean(req.socket.encrypted) || String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

export function approvalSessionCookie(root, req) {
  const { secret } = approvalAuthConfig(root);
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const value = `${expires}.${signature(secret, expires)}`;
  const secure = usesHttps(req) ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearApprovalSessionCookie(req) {
  const secure = usesHttps(req) ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}
