import { SignJWT, jwtVerify } from "jose";
import { nanoid } from "nanoid";
import type { Context } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { env } from "./env.js";
import {
  getRedis,
  refreshKey,
  adminRefreshKey,
  REFRESH_TTL_SECONDS,
} from "./redis.js";

const secret = new TextEncoder().encode(env.JWT_SECRET);

export const TENANT_REFRESH_COOKIE = "finbiz_refresh";
export const ADMIN_REFRESH_COOKIE = "finbiz_admin_refresh";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  type: "access";
  scope: "tenant" | "platform";
}

export interface RefreshTokenRecord {
  userId: string;
  scope: "tenant" | "platform";
}

export async function signAccessToken(payload: {
  userId: string;
  email: string;
  scope: "tenant" | "platform";
}): Promise<string> {
  return new SignJWT({
    email: payload.email,
    type: "access",
    scope: payload.scope,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, secret);
  if (payload.type !== "access") {
    throw new Error("Invalid token type");
  }
  return {
    sub: payload.sub as string,
    email: payload.email as string,
    type: "access",
    scope: payload.scope as "tenant" | "platform",
  };
}

export async function issueRefreshToken(
  userId: string,
  scope: "tenant" | "platform",
): Promise<string> {
  const tokenId = nanoid(32);
  const key =
    scope === "platform" ? adminRefreshKey(tokenId) : refreshKey(tokenId);
  const record: RefreshTokenRecord = { userId, scope };
  await getRedis().set(key, JSON.stringify(record), "EX", REFRESH_TTL_SECONDS);
  return tokenId;
}

export async function rotateRefreshToken(
  tokenId: string,
  scope: "tenant" | "platform",
): Promise<{ userId: string; newTokenId: string }> {
  const key =
    scope === "platform" ? adminRefreshKey(tokenId) : refreshKey(tokenId);
  const raw = await getRedis().get(key);
  if (!raw) {
    throw new Error("Refresh token not found");
  }
  const record = JSON.parse(raw) as RefreshTokenRecord;
  await getRedis().del(key);
  const newTokenId = await issueRefreshToken(record.userId, scope);
  return { userId: record.userId, newTokenId };
}

export async function revokeRefreshToken(
  tokenId: string,
  scope: "tenant" | "platform",
): Promise<void> {
  const key =
    scope === "platform" ? adminRefreshKey(tokenId) : refreshKey(tokenId);
  await getRedis().del(key);
}

export function setRefreshCookie(
  c: Context,
  tokenId: string,
  scope: "tenant" | "platform",
): void {
  const name =
    scope === "platform" ? ADMIN_REFRESH_COOKIE : TENANT_REFRESH_COOKIE;
  setCookie(c, name, tokenId, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "Lax",
    path: "/",
    maxAge: REFRESH_TTL_SECONDS,
  });
}

export function clearRefreshCookie(
  c: Context,
  scope: "tenant" | "platform",
): void {
  const name =
    scope === "platform" ? ADMIN_REFRESH_COOKIE : TENANT_REFRESH_COOKIE;
  deleteCookie(c, name, { path: "/" });
}

export function getRefreshTokenFromCookie(
  c: Context,
  scope: "tenant" | "platform",
): string | undefined {
  const name =
    scope === "platform" ? ADMIN_REFRESH_COOKIE : TENANT_REFRESH_COOKIE;
  return getCookie(c, name);
}

export function getBearerToken(c: Context): string | undefined {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  return header.slice(7);
}
