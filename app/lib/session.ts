import { getToken } from "next-auth/jwt";

export async function authenticatedAccount(request: Request) {
  const secureCookie = new URL(request.url).protocol === "https:";
  const cookieName = secureCookie ? "__Secure-authjs.session-token" : "authjs.session-token";
  const token = await getToken({ req: request, secret: process.env.AUTH_SECRET, secureCookie, cookieName, salt: cookieName });
  if (!token || typeof token.email !== "string") return undefined;
  return { id: typeof token.id === "string" ? token.id : token.sub || "", email: token.email, name: typeof token.name === "string" ? token.name : "" };
}

export async function authenticatedBackendContext(request: Request) {
  const account = await authenticatedAccount(request);
  if (!account) return undefined;
  const internalSecret = process.env.AMPLIFIER_INTERNAL_SECRET;
  if (!internalSecret) throw new Error("Amplifier internal authentication is not configured");
  return {
    account,
    headers: { "X-Amplifier-Account": account.id, "X-Amplifier-Internal-Secret": internalSecret },
  };
}
