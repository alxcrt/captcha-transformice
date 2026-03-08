#!/bin/bash
# Start all 3 services: Java server, WebSocket proxy, Next.js frontend

ROOT="$(cd "$(dirname "$0")" && pwd)"
JAVA_HOME="/Users/alex/Library/Java/JavaVirtualMachines/corretto-22.0.2/Contents/Home"
MVN="/Applications/IntelliJ IDEA.app/Contents/plugins/maven/lib/maven3/bin/mvn"

cleanup() {
    echo ""
    echo "Stopping all services..."
    kill $PID_SERVER $PID_PROXY $PID_FRONTEND 2>/dev/null
    wait $PID_SERVER $PID_PROXY $PID_FRONTEND 2>/dev/null
    echo "All services stopped."
    exit 0
}
trap cleanup SIGINT SIGTERM

# 1. Java server
echo "Starting Java server..."
cd "$ROOT/Transformice"
JAVA_HOME="$JAVA_HOME" PATH="$JAVA_HOME/bin:$PATH" "$MVN" -q compile exec:java \
    -Dexec.mainClass="org.transformice.Application" \
    -f "$ROOT/Transformice/pom.xml" &
PID_SERVER=$!

# Wait for server to be ready
echo "Waiting for Java server..."
for i in $(seq 1 30); do
    if lsof -i :11802 -sTCP:LISTEN > /dev/null 2>&1; then
        echo "Java server ready."
        break
    fi
    sleep 1
done

# 2. WebSocket proxy (TypeScript)
echo "Starting proxy..."
cd "$ROOT/Transformice/proxy"
npx tsx src/index.ts &
PID_PROXY=$!
sleep 2
echo "Proxy ready."

# 3. Vite frontend (captcha-designs)
echo "Starting frontend..."
cd "$ROOT/captcha-designs"
npx vite --host &
PID_FRONTEND=$!
sleep 3

echo ""
echo "=== All services running ==="
echo "  Frontend:    http://localhost:4000"
echo "  Proxy:       ports 11801-14801, 8082"
echo "  Java server: ports 11802-14802"
echo ""
echo "Press Ctrl+C to stop all."
echo ""

wait
