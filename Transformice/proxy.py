import asyncio
import websockets
import socket
import aiohttp
from aiohttp import web


async def handle_http_proxy(request):
    # Get the path after /
    path = request.match_info.get('path', '')

    # Reconstruct the Transformice URL
    target_url = f'http://www.transformice.com/{path}'
    if request.query_string:
        target_url += f'?{request.query_string}'

    # Fetch from Transformice
    async with aiohttp.ClientSession() as session:
        async with session.get(target_url) as resp:
            body = await resp.read()

            # Return with CORS headers
            return web.Response(
                body=body,
                status=resp.status,
                headers={
                    'Content-Type': resp.headers.get('Content-Type', 'application/octet-stream'),
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                }
            )

async def start_http_proxy():
    app = web.Application()
    app.router.add_get('/{path:.*}', handle_http_proxy)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, 'localhost', 8081)
    await site.start()
    print("HTTP proxy listening on http://localhost:8081")



class TransformiceProxy:
    def __init__(self, listen_port, target_host, target_port):
        self.listen_port = listen_port
        self.target_host = target_host
        self.target_port = target_port

    async def handle_websocket(self, websocket):  # Remove 'path' parameter
        # Connect to TCP server
        tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            tcp_socket.connect((self.target_host, self.target_port))
            tcp_socket.setblocking(False)
            print(f"Connected to {self.target_host}:{self.target_port}")

            # Handle bidirectional communication
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
                    # Send raw bytes to TCP
                    await asyncio.get_event_loop().sock_sendall(tcp_socket, message)
                    print(f"WS->TCP: {len(message)} bytes")
        except Exception as e:
            print(f"WS->TCP error: {e}")

    async def tcp_to_ws(self, websocket, tcp_socket):
        try:
            while True:
                # Read from TCP socket
                data = await asyncio.get_event_loop().sock_recv(tcp_socket, 4096)
                if not data:
                    break
                # Send to WebSocket as binary
                await websocket.send(data)
                print(f"TCP->WS: {len(data)} bytes")
        except Exception as e:
            print(f"TCP->WS error: {e}")

    async def start(self):
        await websockets.serve(self.handle_websocket, "localhost", self.listen_port)
        print(f"WebSocket proxy listening on ws://localhost:{self.listen_port}")

async def main():
    # Create proxies for each port
    proxies = [
        TransformiceProxy(11801, "localhost", 11802),
        TransformiceProxy(12801, "localhost", 12802),
        TransformiceProxy(13801, "localhost", 13802),
        TransformiceProxy(14801, "localhost", 14802),
    ]

   # Start all services
    await asyncio.gather(
        *[proxy.start() for proxy in proxies],
        start_http_proxy(),  # Add HTTP proxy
    )


    # Keep running
    await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())