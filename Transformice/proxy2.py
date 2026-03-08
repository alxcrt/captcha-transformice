import asyncio
import websockets
import socket
import aiohttp
from aiohttp import web
import os
import sys
import hashlib
from pathlib import Path
import json
from datetime import datetime

# Force unbuffered output so prints show up immediately
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# Global set of event listener WebSocket connections
event_listeners = set()

def parse_vlq_length(data, offset=0):
    """Parse VLQ-encoded length from raw bytes. Returns (length, bytes_consumed)."""
    length = 0
    shift = 0
    pos = offset
    while pos < len(data):
        b = data[pos]
        length |= (b & 0x7F) << shift
        pos += 1
        if (b & 0x80) == 0:
            break
        shift += 7
        if shift > 28:
            break
    return length, pos - offset

def parse_server_packet(data):
    """Parse server→client Transformice packets from raw TCP data.
    Server packets have NO fingerprint: VLQ length + C + CC + payload.
    Returns list of (C, CC, payload) tuples."""
    packets = []
    offset = 0
    while offset < len(data):
        if offset >= len(data):
            break
        pkt_len, vlq_size = parse_vlq_length(data, offset)
        offset += vlq_size
        if pkt_len < 2 or offset + pkt_len > len(data):
            break
        # C(1) + CC(1) + payload (no fingerprint for server packets)
        C = data[offset]
        CC = data[offset + 1]
        payload = data[offset + 2:offset + pkt_len]
        packets.append((C, CC, payload))
        offset += pkt_len
    return packets

async def broadcast_event(event_type, details=None):
    """Send a game event to all connected event listeners."""
    global event_listeners
    msg = json.dumps({"type": event_type, **(details or {})})
    print(f"[BROADCAST] Sending '{msg}' to {len(event_listeners)} listeners")
    dead = set()
    for ws in event_listeners:
        try:
            await ws.send(msg)
            print(f"[BROADCAST] Sent OK to listener")
        except Exception as e:
            print(f"[BROADCAST] Failed to send to listener: {e}")
            dead.add(ws)
    event_listeners -= dead

class TransformiceProxy:
    def __init__(self, listen_port, target_host, target_port):
        self.listen_port = listen_port
        self.target_host = target_host
        self.target_port = target_port

    async def handle_websocket(self, websocket):
        tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            tcp_socket.connect((self.target_host, self.target_port))
            tcp_socket.setblocking(False)
            print(f"Connected to {self.target_host}:{self.target_port}")

            await asyncio.gather(
                self.ws_to_tcp(websocket, tcp_socket),
                self.tcp_to_ws(websocket, tcp_socket),
                return_exceptions=True
            )
        except Exception as e:
            print(f"Error: {e}")
        finally:
            tcp_socket.close()

    async def ws_to_tcp(self, websocket, tcp_socket):
        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    await asyncio.get_event_loop().sock_sendall(tcp_socket, message)
                    print(f"WS->TCP: {len(message)} bytes")
        except Exception as e:
            print(f"WS->TCP error: {e}")

    async def tcp_to_ws(self, websocket, tcp_socket):
        try:
            while True:
                data = await asyncio.get_event_loop().sock_recv(tcp_socket, 4096)
                if not data:
                    break
                # Inspect server→client packets for cheese/victory
                try:
                    for C, CC, payload in parse_server_packet(data):
                        if C == 144 and CC == 6:
                            print(f"[EVENT] Player collected cheese!")
                            await broadcast_event("cheese")
                        elif C == 8 and CC == 6:
                            print(f"[EVENT] Player entered hole!")
                            await broadcast_event("victory")
                except Exception as e:
                    print(f"Packet parse error (non-fatal): {e}")
                await websocket.send(data)
                print(f"TCP->WS: {len(data)} bytes")
        except Exception as e:
            print(f"TCP->WS error: {e}")

    async def start(self):
        await websockets.serve(
            self.handle_websocket, "127.0.0.1", self.listen_port,
            reuse_address=True, reuse_port=True,
        )
        print(f"WebSocket proxy listening on ws://localhost:{self.listen_port}")

class FileCache:
    def __init__(self, cache_dir="transformice_cache", offline_mode=False):
        self.cache_dir = Path(cache_dir)
        self.offline_mode = offline_mode
        self.cache_dir.mkdir(exist_ok=True)

        # Create subdirectories
        (self.cache_dir / "images").mkdir(exist_ok=True)
        (self.cache_dir / "langues").mkdir(exist_ok=True)
        (self.cache_dir / "swf").mkdir(exist_ok=True)

        self.cache_index = self.load_cache_index()

    def load_cache_index(self):
        index_file = self.cache_dir / "cache_index.json"
        if index_file.exists():
            with open(index_file, 'r') as f:
                return json.load(f)
        return {}

    def save_cache_index(self):
        with open(self.cache_dir / "cache_index.json", 'w') as f:
            json.dump(self.cache_index, f, indent=2)

    def get_cache_path(self, url_path):
        # Create a safe filename from the URL path
        safe_name = url_path.replace('/', '_').replace('?', '_')

        # Determine subdirectory based on file type
        if 'images' in url_path:
            subdir = "images"
        elif 'langues' in url_path:
            subdir = "langues"
        elif '.swf' in url_path:
            subdir = "swf"
        else:
            subdir = ""

        return self.cache_dir / subdir / safe_name

    async def get_file(self, url_path, target_url):
        cache_path = self.get_cache_path(url_path)

        # Check if file exists in cache
        if cache_path.exists():
            print(f"Cache hit: {url_path}")
            with open(cache_path, 'rb') as f:
                return f.read()

        # If offline mode, return None if not cached
        if self.offline_mode:
            print(f"Offline mode - file not cached: {url_path}")
            return None

        # Fetch from server and cache
        print(f"Cache miss: {url_path} - fetching from server")
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(target_url) as resp:
                    if resp.status == 200:
                        body = await resp.read()

                        # Save to cache
                        with open(cache_path, 'wb') as f:
                            f.write(body)

                        # Update index
                        self.cache_index[url_path] = {
                            'cached_at': datetime.now().isoformat(),
                            'size': len(body),
                            'content_type': resp.headers.get('Content-Type', 'application/octet-stream')
                        }
                        self.save_cache_index()

                        print(f"Cached: {url_path} ({len(body)} bytes)")
                        return body
                    else:
                        print(f"Failed to fetch: {target_url} - Status: {resp.status}")
                        return None
        except Exception as e:
            print(f"Error fetching {target_url}: {e}")
            return None

# Global cache instance
file_cache = None

async def handle_http_proxy(request):
    global file_cache

    path = request.match_info.get('path', '')
    target_url = f'http://www.transformice.com/{path}'
    if request.query_string:
        target_url += f'?{request.query_string}'

    # Try to get file from cache
    body = await file_cache.get_file(path, target_url)

    if body is None:
        return web.Response(
            text="File not found in cache (offline mode) or failed to fetch",
            status=404,
            headers={'Access-Control-Allow-Origin': '*'}
        )

    # Determine content type
    content_type = 'application/octet-stream'
    if path.endswith('.swf'):
        content_type = 'application/x-shockwave-flash'
    elif path.endswith('.gz'):
        content_type = 'application/gzip'
    elif path.endswith('.png'):
        content_type = 'image/png'
    elif path.endswith('.jpg') or path.endswith('.jpeg'):
        content_type = 'image/jpeg'

    return web.Response(
        body=body,
        status=200,
        headers={
            'Content-Type': content_type,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Cache-Control': 'public, max-age=3600'
        }
    )

async def handle_cache_status(request):
    global file_cache

    stats = {
        'mode': 'offline' if file_cache.offline_mode else 'online',
        'cached_files': len(file_cache.cache_index),
        'cache_dir': str(file_cache.cache_dir),
        'files': file_cache.cache_index
    }

    return web.json_response(stats, headers={'Access-Control-Allow-Origin': '*'})

async def handle_events_ws(websocket):
    """WebSocket endpoint for game event notifications (cheese, victory)."""
    event_listeners.add(websocket)
    print(f"Event listener connected (total: {len(event_listeners)})")
    try:
        async for _ in websocket:
            pass  # Keep connection alive, ignore incoming messages
    except Exception:
        pass
    finally:
        event_listeners.discard(websocket)
        print(f"Event listener disconnected (total: {len(event_listeners)})")

async def start_events_ws():
    """Start WebSocket server for game events on port 8082."""
    await websockets.serve(handle_events_ws, "127.0.0.1", 8082, reuse_address=True, reuse_port=True)
    print("Game events WebSocket listening on ws://localhost:8082")

async def start_http_proxy(offline_mode=False):
    global file_cache
    file_cache = FileCache(offline_mode=offline_mode)

    app = web.Application()
    app.router.add_get('/cache-status', handle_cache_status)
    app.router.add_get('/{path:.*}', handle_http_proxy)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 8081, reuse_address=True, reuse_port=True)
    await site.start()

    mode = "OFFLINE" if offline_mode else "ONLINE"
    print(f"HTTP proxy listening on http://localhost:8081 (Mode: {mode})")
    print(f"Cache directory: {file_cache.cache_dir}")
    print("View cache status at: http://localhost:8081/cache-status")

async def main():
    import argparse
    parser = argparse.ArgumentParser(description='Transformice Proxy Server')
    parser.add_argument('--offline', action='store_true', help='Run in offline mode (use cached files only)')
    parser.add_argument('--cache-dir', default='transformice_cache', help='Directory for cached files')
    args = parser.parse_args()

    # Create WebSocket proxies
    proxies = [
        TransformiceProxy(11801, "localhost", 11802),
        TransformiceProxy(12801, "localhost", 12802),
        TransformiceProxy(13801, "localhost", 13802),
        TransformiceProxy(14801, "localhost", 14802),
    ]

    # Start all services
    await asyncio.gather(
        *[proxy.start() for proxy in proxies],
        start_http_proxy(offline_mode=args.offline),
        start_events_ws(),
    )

    await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())