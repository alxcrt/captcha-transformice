import { WsTcpBridge } from "./ws-tcp-bridge.js";
import { EventBus } from "./event-bus.js";
import { HttpProxy } from "./http-proxy.js";

const TCP_HOST = process.env.TCP_HOST || "localhost";

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
  const bridge = new WsTcpBridge({ wsPort, tcpHost, tcpPort });
  bridge.eventBus = eventBus;
  bridges.push(bridge);
}

const httpProxy = new HttpProxy({ port: 8081, cacheDir, offlineMode: offline });

// --- Start all services ---
async function start(): Promise<void> {
  eventBus.start(8082);

  for (const bridge of bridges) {
    bridge.start();
  }

  httpProxy.start();

  console.log("=".repeat(50));
  console.log("  Transformice Proxy — All services started");
  console.log("=".repeat(50));
  console.log(`  EventBus:   ws://localhost:8082`);
  for (const { wsPort, tcpHost, tcpPort } of BRIDGE_PORTS) {
    console.log(`  Bridge:     ws://localhost:${wsPort} -> ${tcpHost}:${tcpPort}`);
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
