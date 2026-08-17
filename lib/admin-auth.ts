import { getPlatformEnv } from "@/db/runtime";

const COOKIE_NAME = "ketiengong_admin";
const SESSION_SECONDS = 8 * 60 * 60;
const encoder = new TextEncoder();

function base64Url(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(password: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function configuredPassword() {
  return getPlatformEnv().ADMIN?.trim() || "";
}

export function adminStatus() {
  return { configured: configuredPassword().length >= 8 };
}

export async function verifyAdminPassword(candidate: string) {
  const expected = configuredPassword();
  if (expected.length < 8 || candidate.length < 1) return false;
  const message = encoder.encode("ketiengong-admin-password-check");
  const candidateKey = await signingKey(candidate);
  const candidateSignature = await crypto.subtle.sign("HMAC", candidateKey, message);
  const expectedKey = await signingKey(expected);
  return crypto.subtle.verify("HMAC", expectedKey, candidateSignature, message);
}

export async function createAdminCookie(request: Request) {
  const password = configuredPassword();
  if (password.length < 8) throw new Error("管理者密碼尚未設定");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `admin:${expiresAt}`;
  const key = await signingKey(password);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${expiresAt}.${base64Url(signature)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearAdminCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function requestCookie(request: Request) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return value.join("=");
  }
  return "";
}

export async function isAdminRequest(request: Request) {
  const password = configuredPassword();
  if (password.length < 8) return false;
  const [expiresText, signatureText] = requestCookie(request).split(".");
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000) || !signatureText) {
    return false;
  }
  try {
    const key = await signingKey(password);
    return crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signatureText),
      encoder.encode(`admin:${expiresAt}`),
    );
  } catch {
    return false;
  }
}

export async function requireAdmin(request: Request) {
  if (await isAdminRequest(request)) return null;
  return Response.json({ error: "請先登入管理介面" }, { status: 401 });
}
