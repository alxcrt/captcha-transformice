import http from "http";
import https from "https";
import fs from "fs";
import path from "path";

interface CacheEntry {
  cachedAt: string;
  size: number;
  contentType: string;
}

export interface HttpProxyConfig {
  port: number;
  cacheDir: string;
  offlineMode: boolean;
}


const DEFAULT_CONFIG: HttpProxyConfig = {
  port: 8081,
  cacheDir: "transformice_cache",
  offlineMode: false,
};

export class HttpProxy {
  private _server: http.Server | null = null;
  private cacheIndex: Record<string, CacheEntry> = {};
  private config: HttpProxyConfig;

  /** Expose the HTTP server so WebSocket upgrades can be attached */
  get server(): http.Server | null {
    return this._server;
  }

  constructor(config: Partial<HttpProxyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    this.initCacheDirectories();
    this.loadCacheIndex();

    this._server = http.createServer((req, res) => {
      this.addCorsHeaders(res);

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return;
      }

      const url = req.url || "/";

      if (url === "/cache-status") {
        this.handleCacheStatus(res);
        return;
      }

      this.handleProxyRequest(url, res);
    });

    this._server.listen(this.config.port, () => {
      console.log(
        `[HttpProxy] HTTP proxy listening on port ${this.config.port} (mode: ${this.config.offlineMode ? "offline" : "online"})`
      );
    });
  }

  stop(): void {
    if (this._server) {
      this._server.close(() => {
        console.log("[HttpProxy] Server stopped");
      });
      this._server = null;
    }
  }

  private initCacheDirectories(): void {
    const subdirs = ["images", "langues", "swf"];
    for (const sub of subdirs) {
      const dir = path.join(this.config.cacheDir, sub);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[HttpProxy] Created cache directory: ${dir}`);
      }
    }
  }

  private get cacheIndexPath(): string {
    return path.join(this.config.cacheDir, "cache_index.json");
  }

  private loadCacheIndex(): void {
    try {
      if (fs.existsSync(this.cacheIndexPath)) {
        const data = fs.readFileSync(this.cacheIndexPath, "utf-8");
        this.cacheIndex = JSON.parse(data);
        const count = Object.keys(this.cacheIndex).length;
        console.log(`[HttpProxy] Loaded cache index with ${count} entries`);
      } else {
        this.cacheIndex = {};
        console.log("[HttpProxy] No existing cache index found, starting fresh");
      }
    } catch (err) {
      console.error("[HttpProxy] Failed to load cache index:", err);
      this.cacheIndex = {};
    }
  }

  private saveCacheIndex(): void {
    try {
      fs.writeFileSync(
        this.cacheIndexPath,
        JSON.stringify(this.cacheIndex, null, 2),
        "utf-8"
      );
    } catch (err) {
      console.error("[HttpProxy] Failed to save cache index:", err);
    }
  }

  private addCorsHeaders(res: http.ServerResponse): void {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }

  private getCacheSubdir(urlPath: string): string {
    if (urlPath.includes("images")) return "images";
    if (urlPath.includes("langues")) return "langues";
    if (urlPath.includes("swf") || urlPath.endsWith(".swf")) return "swf";
    return "swf";
  }

  private getCacheFilePath(urlPath: string): string {
    const sanitized = urlPath.replace(/^\//, "").replace(/[/?]/g, "_");
    const subdir = this.getCacheSubdir(urlPath);
    return path.join(this.config.cacheDir, subdir, sanitized);
  }

  private detectContentType(urlPath: string): string {
    const lower = urlPath.toLowerCase();
    if (lower.endsWith(".swf")) return "application/x-shockwave-flash";
    if (lower.endsWith(".gz")) return "application/gzip";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
      return "image/jpeg";
    return "application/octet-stream";
  }

  private handleCacheStatus(res: http.ServerResponse): void {
    const files = Object.keys(this.cacheIndex);
    const body = JSON.stringify(
      {
        mode: this.config.offlineMode ? "offline" : "online",
        cachedFiles: files.length,
        files: files.map((key) => ({
          path: key,
          ...this.cacheIndex[key],
        })),
      },
      null,
      2
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(body);
  }

  private normalizeUrlPath(urlPath: string): string {
    // Strip SWF URL padding prefix (e.g. /aaaaa/langues/ -> /langues/)
    return urlPath.replace(/\/aaaaa\//, "/");
  }

  private handleProxyRequest(urlPath: string, res: http.ServerResponse): void {
    urlPath = this.normalizeUrlPath(urlPath);
    const cacheFile = this.getCacheFilePath(urlPath);

    // Try serving from cache first
    if (this.cacheIndex[urlPath] && fs.existsSync(cacheFile)) {
      console.log(`[HttpProxy] Cache hit: ${urlPath}`);
      const entry = this.cacheIndex[urlPath];
      const data = fs.readFileSync(cacheFile);
      res.writeHead(200, { "Content-Type": entry.contentType });
      res.end(data);
      return;
    }

    // In offline mode, return 404 for uncached files
    if (this.config.offlineMode) {
      console.log(`[HttpProxy] Cache miss (offline mode): ${urlPath}`);
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found in cache (offline mode)");
      return;
    }

    // Fetch from upstream
    const targetUrl = `http://www.transformice.com${urlPath}`;
    console.log(`[HttpProxy] Fetching: ${targetUrl}`);

    http
      .get(targetUrl, (upstream) => {
        const chunks: Buffer[] = [];

        upstream.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        upstream.on("end", () => {
          const body = Buffer.concat(chunks);
          const contentType =
            upstream.headers["content-type"] ||
            this.detectContentType(urlPath);

          // Cache the response
          try {
            fs.writeFileSync(cacheFile, body);
            this.cacheIndex[urlPath] = {
              cachedAt: new Date().toISOString(),
              size: body.length,
              contentType,
            };
            this.saveCacheIndex();
            console.log(
              `[HttpProxy] Cached: ${urlPath} (${body.length} bytes)`
            );
          } catch (err) {
            console.error(`[HttpProxy] Failed to cache ${urlPath}:`, err);
          }

          res.writeHead(upstream.statusCode || 200, {
            "Content-Type": contentType,
          });
          res.end(body);
        });

        upstream.on("error", (err) => {
          console.error(`[HttpProxy] Upstream read error for ${urlPath}:`, err);
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Bad Gateway");
        });
      })
      .on("error", (err) => {
        console.error(`[HttpProxy] Fetch error for ${targetUrl}:`, err);
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad Gateway");
      });
  }
}
