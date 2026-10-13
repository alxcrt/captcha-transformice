# Transformice CAPTCHA

A CAPTCHA you solve by playing Transformice: tick the checkbox, a real Transformice client loads in the browser (via the [Ruffle](https://ruffle.rs) Flash emulator), and you prove you're human by collecting the cheese three times.

Live demo: https://tfm-captcha.alexcretu.com

## How it works

```
Frontend (Vite + React + Ruffle)            captcha-designs/        :4000
    ↕ HTTPS (SWF + game assets)
Proxy (Node.js / TypeScript)                Transformice/proxy/
    ├── HTTP asset proxy + cache                                    :8081
    ├── EventBus (WebSocket, victory events)                        :8082
    └── WebSocket ↔ TCP bridges                                     :11801-14801
    ↕ TCP (Transformice binary protocol)
Java game server (Netty)                    Transformice/           :11802-14802
    ↕
MongoDB
```

With `PATH_WS=true` (as in Docker), the EventBus and bridges are served from the HTTP port instead, at `/ws/8082`, `/ws/11801`, etc., so only port 8081 needs to be exposed.

1. The user clicks the checkbox and the frontend boots the Transformice SWF in Ruffle.
2. The browser can't open raw TCP sockets, so Ruffle's socket proxy connects to the WebSocket bridges, which forward traffic to the game server.
3. When the player brings the cheese back to the hole, the server emits a victory event over the EventBus.
4. After 3 victories the frontend marks the CAPTCHA as verified.

## Repository layout

| Directory | What it is |
| --- | --- |
| `captcha-designs/` | The CAPTCHA frontend (Vite, React, Tailwind, Ruffle) |
| `Transformice/` | Java 22 Transformice private server (Maven, Netty, MongoDB/Morphia, LuaJ) |
| `Transformice/proxy/` | Asset proxy, EventBus and WebSocket↔TCP bridges |
| `swfparser/` | Python tools that download the official SWF, decompress it and extract the protocol keys |
| `legacy-swf/` | SWF builds from the original prototype (unpatched, stripped and no-chat clients, World's Hardest Game) |

## Running it

### Docker (everything)

```bash
docker compose up -d --build
```

Then open http://localhost:4000. In Docker the proxy runs with `--offline` and serves assets from `Transformice/proxy/transformice_cache/`.

### Locally

Requirements: Java 22, Maven, Node.js 22, and a MongoDB instance matching `Transformice/config/properties.json`.

```bash
./start.sh
```

This starts the game server, the proxy (in online mode, fetching assets from transformice.com) and the frontend on http://localhost:4000. Set `JAVA_HOME` and `MVN` if the defaults on your `PATH` aren't the ones you want.

Or run the pieces individually:

```bash
# Game server
cd Transformice && mvn compile exec:java -Dexec.mainClass=org.transformice.Application

# Proxy
cd Transformice/proxy && npm install && npm run dev

# Frontend
cd captcha-designs && npm install && npm run dev
```

## Patching the SWF for a new domain

The client SWF (`captcha-designs/public/assets/transformice-v4.swf`) has hardcoded asset URLs. To point it at a different proxy host, round-trip it through [JPEXS Free Flash Decompiler](https://github.com/jindrapetrik/jpexs-decompiler):

```bash
java -jar ffdec.jar -swf2xml input.swf tfm.xml
sed -i '' 's|localhost:8081|proxy.example.com|g' tfm.xml   # patch http://, https:// and www. variants
java -jar ffdec.jar -xml2swf tfm.xml output.swf
```

The SWF is CWS (zlib) compressed, and ABC bytecode strings are length-prefixed, so a plain binary search-and-replace with a different-length string will corrupt it. Always use the XML round trip.

## Gotchas

- HTTPS pages can't open `ws://` sockets; the frontend switches to `wss://` automatically when served over HTTPS.
- Inside Docker the proxy must bind to `0.0.0.0` (`BIND_HOST`), not the default `127.0.0.1`.
- `captcha-designs/.gitignore` inherits Vite's `*.sw?` pattern, which also matches `*.swf`; it's overridden with `!*.swf`.
- `Transformice/config/properties.docker.json` is baked into the server image at build time.

## Credits

- The game server is based on [NoFileFound/Transformice](https://github.com/NoFileFound/Transformice).
- Flash emulation by [Ruffle](https://ruffle.rs).

Transformice is a trademark of Atelier 801. This project is a fan-made experiment and is not affiliated with or endorsed by Atelier 801.
