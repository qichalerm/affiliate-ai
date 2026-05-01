/**
 * Proxy pool — rotates Webshare residential proxies.
 *
 * Strategy:
 *  - Round-robin by default (avoid same-IP burst on Shopee)
 *  - Sticky session for related calls (e.g. detail + reviews of same product)
 *  - Per-proxy health tracking: exclude on 3 consecutive failures
 *  - Auto-refill from Webshare API daily
 *
 * Falls back to direct connection if no proxy configured (Phase 1 OK without).
 */

import { env } from "../../lib/env.ts";
import { child } from "../../lib/logger.ts";
import { errMsg } from "../../lib/retry.ts";

const log = child("proxy.pool");

interface Proxy {
  id: string;
  url: string;        // http://user:pass@host:port
  host: string;
  port: number;
  failures: number;
  lastFailure: number;
  lastSuccess: number;
}

class ProxyPool {
  private pool: Proxy[] = [];
  private idx = 0;
  private lastRefresh = 0;
  private refreshing = false;
  private sessionMap = new Map<string, Proxy>(); // sessionId → proxy

  enabled(): boolean {
    return Boolean(env.WEBSHARE_API_KEY);
  }

  async ensureLoaded(): Promise<void> {
    if (!this.enabled()) return;
    const now = Date.now();
    if (this.pool.length > 0 && now - this.lastRefresh < 24 * 60 * 60_000) return;
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this.refreshFromWebshare();
      this.lastRefresh = now;
    } catch (err) {
      log.warn({ err: errMsg(err) }, "proxy refresh failed; using direct connection");
    } finally {
      this.refreshing = false;
    }
  }

  private async refreshFromWebshare(): Promise<void> {
    const res = await fetch(
      "https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page_size=100",
      { headers: { Authorization: `Token ${env.WEBSHARE_API_KEY}` } },
    );
    if (!res.ok) {
      throw new Error(`webshare api ${res.status}`);
    }
    const data = (await res.json()) as {
      results?: Array<{
        proxy_address: string;
        port: number;
        username: string;
        password: string;
      }>;
    };
    const fresh: Proxy[] = (data.results ?? []).map((p) => ({
      id: `${p.proxy_address}:${p.port}`,
      url: `http://${p.username}:${p.password}@${p.proxy_address}:${p.port}`,
      host: p.proxy_address,
      port: p.port,
      failures: 0,
      lastFailure: 0,
      lastSuccess: 0,
    }));
    this.pool = fresh;
    log.info({ count: fresh.length }, "proxy pool refreshed");
  }

  /**
   * Get a proxy for a specific session id (sticky), or round-robin if no session.
   */
  async pick(sessionId?: string): Promise<Proxy | null> {
    await this.ensureLoaded();
    if (this.pool.length === 0) return null;

    if (sessionId && this.sessionMap.has(sessionId)) {
      const p = this.sessionMap.get(sessionId)!;
      if (p.failures < 3) return p;
      this.sessionMap.delete(sessionId);
    }

    const healthy = this.pool.filter((p) => p.failures < 3);
    if (healthy.length === 0) {
      log.warn("all proxies exhausted; using direct connection");
      return null;
    }

    const proxy = healthy[this.idx % healthy.length]!;
    this.idx++;
    if (sessionId) this.sessionMap.set(sessionId, proxy);
    return proxy;
  }

  recordResult(proxyId: string, ok: boolean): void {
    const proxy = this.pool.find((p) => p.id === proxyId);
    if (!proxy) return;
    if (ok) {
      proxy.failures = 0;
      proxy.lastSuccess = Date.now();
    } else {
      proxy.failures++;
      proxy.lastFailure = Date.now();
      if (proxy.failures >= 3) {
        log.warn({ proxyId }, "proxy disabled after 3 consecutive failures");
        // sticky sessions on this proxy get released
        for (const [sid, p] of this.sessionMap) {
          if (p.id === proxyId) this.sessionMap.delete(sid);
        }
      }
    }
  }

  stats(): { total: number; healthy: number; sessions: number } {
    return {
      total: this.pool.length,
      healthy: this.pool.filter((p) => p.failures < 3).length,
      sessions: this.sessionMap.size,
    };
  }
}

export const proxyPool = new ProxyPool();

/**
 * Build fetch options that route through a proxy, if available.
 *
 * Note: Bun supports `proxy:` option natively. For Node, would need undici Agent.
 */
export async function withProxy<T>(
  sessionId: string | undefined,
  doFetch: (proxy: { url: string; id: string } | null) => Promise<T>,
): Promise<T> {
  const p = await proxyPool.pick(sessionId);
  try {
    const result = await doFetch(p ? { url: p.url, id: p.id } : null);
    if (p) proxyPool.recordResult(p.id, true);
    return result;
  } catch (err) {
    if (p) proxyPool.recordResult(p.id, false);
    throw err;
  }
}
