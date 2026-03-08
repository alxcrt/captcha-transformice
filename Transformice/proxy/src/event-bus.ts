import { WebSocketServer, WebSocket } from "ws";

export type GameEventType = "cheese" | "victory";

export interface GameEvent {
  type: GameEventType;
  [key: string]: unknown;
}

export class EventBus {
  /** Maps sessionId → set of event-listener WebSockets */
  private sessions = new Map<string, Set<WebSocket>>();
  private wss: WebSocketServer | null = null;

  /** Start WebSocket server on given port (default 8082), bind to 127.0.0.1 */
  start(port: number = 8082): void {
    if (this.wss) {
      console.log("[EventBus] Server already running");
      return;
    }

    const bindHost = process.env.BIND_HOST || "127.0.0.1";
    this.wss = new WebSocketServer({ port, host: bindHost });

    this.wss.on("listening", () => {
      console.log(`[EventBus] Listening on 127.0.0.1:${port}`);
    });

    this.wss.on("connection", (ws: WebSocket, req) => {
      // Extract sessionId from query string: ws://localhost:8082?session=<id>
      const url = new URL(req.url ?? "/", "http://localhost");
      const sessionId = url.searchParams.get("session") ?? "__global__";

      if (!this.sessions.has(sessionId)) {
        this.sessions.set(sessionId, new Set());
      }
      this.sessions.get(sessionId)!.add(ws);

      console.log(
        `[EventBus] Client connected session=${sessionId} (${this.sessions.get(sessionId)!.size} listener(s))`
      );

      ws.on("message", () => {});

      ws.on("close", () => {
        const listeners = this.sessions.get(sessionId);
        if (listeners) {
          listeners.delete(ws);
          if (listeners.size === 0) {
            this.sessions.delete(sessionId);
          }
        }
        console.log(
          `[EventBus] Client disconnected session=${sessionId}`
        );
      });

      ws.on("error", (err: Error) => {
        console.log(`[EventBus] Client error: ${err.message}`);
        const listeners = this.sessions.get(sessionId);
        if (listeners) {
          listeners.delete(ws);
          if (listeners.size === 0) {
            this.sessions.delete(sessionId);
          }
        }
      });
    });

    this.wss.on("error", (err: Error) => {
      console.log(`[EventBus] Server error: ${err.message}`);
    });
  }

  /** Send a game event only to listeners of a specific session */
  sendToSession(sessionId: string, type: GameEventType, details?: Record<string, unknown>): void {
    const listeners = this.sessions.get(sessionId);
    if (!listeners || listeners.size === 0) {
      console.log(`[EventBus] No listeners for session=${sessionId}, dropping "${type}"`);
      return;
    }

    const event: GameEvent = { type, ...details };
    const payload = JSON.stringify(event);

    console.log(
      `[EventBus] Sending "${type}" to session=${sessionId} (${listeners.size} listener(s))`
    );

    for (const ws of listeners) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        } else {
          listeners.delete(ws);
        }
      } catch {
        listeners.delete(ws);
      }
    }
  }

  /** Clean shutdown */
  stop(): void {
    if (!this.wss) {
      return;
    }

    for (const [, listeners] of this.sessions) {
      for (const ws of listeners) {
        ws.close();
      }
    }
    this.sessions.clear();

    this.wss.close(() => {
      console.log("[EventBus] Server stopped");
    });
    this.wss = null;
  }
}
