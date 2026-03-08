import { WsTcpBridge } from "./ws-tcp-bridge.js";
import { EventBus } from "./event-bus.js";
import { HttpProxy } from "./http-proxy.js";

const TCP_HOST = process.env.TCP_HOST || "localhost";
const USE_PATH_WS = process.env.PATH_WS === "true";

const BRIDGE_PORTS = [
  { wsPort: 11801, tcpHost: TCP_HOST, tcpPort: 11802 },
  { wsPort: 12801, tcpHost: TCP_HOST, tcpPort: 12802 },
  { wsPort: 13801, tcpHost: TCP_HOST, tcpPort: 13802 },
  { wsPort: 14801, tcpHost: TCP_HOST, tcpPort: 14802 },
];

// --- CLI argument parsing ---
let offline = false;
let cacheDir = "transformice_cache";

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--offline") {
    offline = true;
  } else if (args[i] === "--cache-dir" && i + 1 < args.length) {
    cacheDir = args[++i];
  }
}

// --- Services ---
const eventBus = new EventBus();
const bridges: WsTcpBridge[] = [];

for (const { wsPort, tcpHost, tcpPort } of BRIDGE_PORTS) {
  const bridge = new WsTcpBridge({ wsPort, tcpHost, tcpPort, noServer: USE_PATH_WS });
  bridge.eventBus = eventBus;
  bridges.push(bridge);
}

const httpProxy = new HttpProxy({ port: 8081, cacheDir, offlineMode: offline });

// --- Start all services ---
async function start(): Promise<void> {
  eventBus.start(8082, USE_PATH_WS);

  for (const bridge of bridges) {
    bridge.start();
  }

  httpProxy.start();

  // If PATH_WS mode, attach WebSocket upgrade handler to the HTTP server
  if (USE_PATH_WS) {
    // Wait a tick for the server to be created
    setTimeout(() => {
      const server = httpProxy.server;
      if (!server) {
        console.error("[PathWS] HTTP server not available!");
        return;
      }

      // Map paths to WebSocket servers
      const wsMap = new Map<string, import("ws").WebSocketServer>();

      // EventBus on /ws/8082
      const eventWss = eventBus.getWss();
      if (eventWss) wsMap.set("/ws/8082", eventWss);

      // Bridges on /ws/11801, /ws/12801, etc.
      for (let i = 0; i < BRIDGE_PORTS.length; i++) {
        const wss = bridges[i].getWss();
        if (wss) wsMap.set(`/ws/${BRIDGE_PORTS[i].wsPort}`, wss);
      }

      server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        const pathname = url.pathname;

        const wss = wsMap.get(pathname);
        if (wss) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
          });
        } else {
          console.log(`[PathWS] No handler for ${pathname}, destroying socket`);
          socket.destroy();
        }
      });

      console.log("[PathWS] WebSocket upgrade handler attached to HTTP server");
      console.log(`[PathWS] Routes: ${[...wsMap.keys()].join(", ")}`);
    }, 100);
  }

  console.log("=".repeat(50));
  console.log("  Transformice Proxy — All services started");
  console.log("=".repeat(50));
  if (USE_PATH_WS) {
    console.log("  Mode:       Path-based WebSocket (single port)");
    console.log(`  HTTP+WS:    http://0.0.0.0:8081`);
    console.log(`  EventBus:   /ws/8082`);
    for (const { wsPort, tcpHost, tcpPort } of BRIDGE_PORTS) {
      console.log(`  Bridge:     /ws/${wsPort} -> ${tcpHost}:${tcpPort}`);
    }
  } else {
    console.log(`  EventBus:   ws://localhost:8082`);
    for (const { wsPort, tcpHost, tcpPort } of BRIDGE_PORTS) {
      console.log(`  Bridge:     ws://localhost:${wsPort} -> ${tcpHost}:${tcpPort}`);
    }
  }
  console.log(`  HTTP Proxy: http://localhost:8081`);
  console.log(`  Offline:    ${offline}`);
  console.log(`  Cache Dir:  ${cacheDir}`);
  console.log("=".repeat(50));
}

// --- Graceful shutdown ---
async function shutdown(): Promise<void> {
  console.log("\nShutting down...");

  for (const bridge of bridges) {
    bridge.stop();
  }

  eventBus.stop();
  httpProxy.stop();

  console.log("All services stopped.");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
