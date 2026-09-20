import type { Context, Next } from "hono";
import type { EdgeEnv } from "../auth/atlassian";

export function createRateLimiter(maxRequests: number = 60, windowSeconds: number = 60) {
  return async (c: Context<{ Bindings: EdgeEnv }>, next: Next) => {
    // If running in test or without KV, pass through
    if (!c.env?.OAUTH_KV) {
      return await next();
    }

    const ip = c.req.header("cf-connecting-ip") || "127.0.0.1";
    const windowBucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const rateLimitKey = `rate:${ip}:${windowBucket}`;

    const currentStr = await c.env.OAUTH_KV.get(rateLimitKey);
    const count = currentStr ? parseInt(currentStr, 10) : 0;

    if (count >= maxRequests) {
      c.header("Retry-After", String(windowSeconds));
      return c.json({ error: "Rate limit exceeded. Try again later." }, 429);
    }

    await c.env.OAUTH_KV.put(rateLimitKey, String(count + 1), { expirationTtl: windowSeconds * 2 });
    return await next();
  };
}
