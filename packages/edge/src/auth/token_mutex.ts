export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  obtainedAt: number;
  userId: string;
}

export interface RefreshResult {
  accessToken: string;
  fromCache: boolean;
}

export class DistributedTokenMutex {
  private kv: KVNamespace;

  constructor(kv: KVNamespace) {
    this.kv = kv;
  }

  /**
   * Acquires a distributed lock in Cloudflare KV with a 15-second TTL.
   * Uses atomic put with expiration.
   */
  public async acquireLock(userId: string, ttlSeconds: number = 15): Promise<boolean> {
    const lockKey = `lock:refresh:${userId}`;
    const existing = await this.kv.get(lockKey);
    if (existing) {
      return false; // Lock already held by another worker invocation
    }

    const now = Date.now();
    await this.kv.put(lockKey, String(now), { expirationTtl: ttlSeconds });
    return true;
  }

  /**
   * Releases the distributed lock in Cloudflare KV.
   */
  public async releaseLock(userId: string): Promise<void> {
    const lockKey = `lock:refresh:${userId}`;
    await this.kv.delete(lockKey);
  }

  /**
   * Checks the 60-second grace period cache for a recently refreshed access token.
   */
  public async getCachedToken(userId: string): Promise<string | null> {
    const cacheKey = `cache:token:${userId}`;
    return await this.kv.get(cacheKey);
  }

  /**
   * Stores a freshly rotated token in KV persistent storage and in the 60-second grace period cache.
   */
  public async storeToken(userId: string, data: TokenData): Promise<void> {
    const persistentKey = `token:${userId}`;
    const cacheKey = `cache:token:${userId}`;

    // Store primary token
    await this.kv.put(persistentKey, JSON.stringify(data));
    // Store 60-second grace period cache (ADR-003)
    await this.kv.put(cacheKey, data.accessToken, { expirationTtl: 60 });
  }

  /**
   * Safe token rotation with distributed locking and grace-period cache to eliminate Atlassian 3LO race conditions.
   */
  public async rotateTokenWithMutex(
    userId: string,
    refreshFn: (oldRefreshToken: string) => Promise<TokenData>
  ): Promise<RefreshResult> {
    // 1. Check grace-period cache first
    const cached = await this.getCachedToken(userId);
    if (cached) {
      return { accessToken: cached, fromCache: true };
    }

    // 2. Attempt to acquire distributed lock
    const acquired = await this.acquireLock(userId);
    if (!acquired) {
      // Another worker is actively refreshing. Wait up to 3 seconds with backoff polling cache.
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const freshlyCached = await this.getCachedToken(userId);
        if (freshlyCached) {
          return { accessToken: freshlyCached, fromCache: true };
        }
      }
      throw new Error(`Token refresh timeout: lock for user '${userId}' remained active.`);
    }

    try {
      // Re-check cache after acquiring lock
      const doubleCheck = await this.getCachedToken(userId);
      if (doubleCheck) {
        return { accessToken: doubleCheck, fromCache: true };
      }

      // Fetch stored refresh token
      const storedJson = await this.kv.get(`token:${userId}`);
      if (!storedJson) {
        throw new Error(`No OAuth token found for user '${userId}'`);
      }

      const storedData = JSON.parse(storedJson) as TokenData;
      const refreshed = await refreshFn(storedData.refreshToken);
      await this.storeToken(userId, refreshed);

      return { accessToken: refreshed.accessToken, fromCache: false };
    } finally {
      await this.releaseLock(userId);
    }
  }
}
