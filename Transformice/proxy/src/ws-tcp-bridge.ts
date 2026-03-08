import { WebSocketServer, WebSocket } from "ws";
import net from "net";
import { parseServerPackets } from "./packet-parser.js";
import type { EventBus } from "./event-bus.js";

// Known server->client packet IDs
const PACKET_CHEESE = { c: 144, cc: 6 };
const PACKET_VICTORY = { c: 8, cc: 6 };

export interface BridgeConfig {
  wsPort: number; // WebSocket listen port (e.g., 11801)
  tcpHost: string; // TCP target host (e.g., "localhost")
  tcpPort: number; // TCP target port (e.g., 11802)
}

export class WsTcpBridge {
  private wss: WebSocketServer | null = null;
  eventBus: EventBus | null = null;

  constructor(private config: BridgeConfig) {}

  private log(msg: string): void {
    console.log(`[Bridge:${this.config.wsPort}] ${msg}`);
  }

  // Start the WebSocket server, bind to 127.0.0.1
  start(): void {
    const { wsPort, tcpHost, tcpPort } = this.config;

    const bindHost = process.env.BIND_HOST || "127.0.0.1";
    this.wss = new WebSocketServer({ host: bindHost, port: wsPort });
    this.log(`Listening on ws://127.0.0.1:${wsPort} -> ${tcpHost}:${tcpPort}`);

    this.wss.on("error", (err) => {
      this.log(`Server error: ${err.message}`);
    });

    this.wss.on("connection", (ws: WebSocket, req) => {
      // Extract session ID from query string (set by the frontend's Ruffle socketProxy config)
      const url = new URL(req.url ?? "/", "http://localhost");
      const sessionId = url.searchParams.get("session") ?? "unknown";
      this.log(`New WebSocket connection (session=${sessionId})`);

      // Buffer WS messages until TCP is connected
      const pendingMessages: Buffer[] = [];
      let tcpConnected = false;

      const connectTcp = (attempt: number): void => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const tcp = net.createConnection({ host: tcpHost, port: tcpPort }, () => {
          this.log(`TCP connected to ${tcpHost}:${tcpPort}`);
          tcpConnected = true;

          // Flush any buffered messages
          for (const msg of pendingMessages) {
            tcp.write(msg);
          }
          pendingMessages.length = 0;

          // Wire up the live WS -> TCP forwarding
          ws.on("message", (data: Buffer, isBinary: boolean) => {
            if (!isBinary) return;
            tcp.write(data);
          });

          // TCP -> WS: inspect packets for game events, then forward
          tcp.on("data", (data: Buffer) => {
            try {
              const packets = parseServerPackets(data);
              for (const pkt of packets) {
                if (pkt.c === PACKET_CHEESE.c && pkt.cc === PACKET_CHEESE.cc) {
                  this.log(`*** CHEESE collected (session=${sessionId}) ***`);
                  this.eventBus?.sendToSession(sessionId, "cheese");
                } else if (
                  pkt.c === PACKET_VICTORY.c &&
                  pkt.cc === PACKET_VICTORY.cc
                ) {
                  this.log(`*** VICTORY detected (session=${sessionId}) ***`);
                  this.eventBus?.sendToSession(sessionId, "victory");
                }
              }
            } catch {
              // Packet parse errors are non-fatal; still forward the data
            }

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data);
            }
          });

          // On either side closing, close the other
          ws.on("close", () => {
            this.log("WebSocket closed, destroying TCP");
            tcp.destroy();
          });

          tcp.on("close", () => {
            this.log("TCP closed, closing WebSocket");
            ws.close();
          });
        });

        tcp.on("error", (err) => {
          tcp.destroy();
          const maxRetries = 10;
          if (attempt < maxRetries && ws.readyState === WebSocket.OPEN) {
            const delay = Math.min(500 * Math.pow(2, attempt), 5000);
            this.log(`TCP connect failed (attempt ${attempt + 1}/${maxRetries}): ${err.message}, retrying in ${delay}ms`);
            setTimeout(() => connectTcp(attempt + 1), delay);
          } else {
            this.log(`TCP error after ${attempt + 1} attempts: ${err.message}`);
            ws.close();
          }
        });
      };

      // Buffer messages while TCP connects
      ws.on("message", (data: Buffer, isBinary: boolean) => {
        if (!isBinary) return;
        if (!tcpConnected) {
          pendingMessages.push(Buffer.from(data));
        }
        // Once connected, the handler added in connectTcp callback takes over
      });

      ws.on("error", (err) => {
        this.log(`WebSocket error: ${err.message}`);
      });

      connectTcp(0);
    });
  }

  // Stop the server
  stop(): void {
    if (this.wss) {
      this.log("Shutting down");
      // Close all active connections
      this.wss.clients.forEach((client) => client.close());
      this.wss.close();
      this.wss = null;
    }
  }
}
