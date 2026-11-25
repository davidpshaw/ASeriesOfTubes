# AGENTS.md — A Series of Tubes

Instructions for AI coding agents (and humans) working in this repo. These are
deliberate decisions agreed with the project owner — do not change them without
asking.

## What this is
A self-contained web app that teaches how the internet actually works (DNS, TCP,
TLS, HTTP, proxies, tunnels, MITM, buffer overflows) with step-by-step
animations. The audience is curious non-programmers first; technical detail sits
behind a "Dive deeper" panel. Runs in Docker, published to Docker Hub. The name
is a nod to the 2006 "series of tubes" description of the internet.

## Hard constraints
- **Self-contained. No CDN / no external requests from the UI.** Everything is
  served from this app. CSP is `default-src 'self'`, so no inline `<script>`,
  no inline `style="…"` attributes, no web fonts (system font stack only), no
  analytics, no icon libraries.
- **Backend: plain `node:http`, zero runtime dependencies.** It only serves
  `public/` (loaded into memory at startup) and `/healthz`. Any dependency needs
  owner approval. Tests use `node:test`.
- **Frontend: vanilla HTML/CSS/JS ES modules, no build step.** Files in
  `public/` are served as-is.
- **Node 22 LTS, ES modules** (`"type": "module"`).

## Content rules
- Topics live in `public/topics.js` (`TOPICS` + `GROUPS`). The engine in
  `public/app.js` should not need changes to add a topic.
- Write narration for a non-programmer: plain words first, then the exact term
  in **bold**. Link related topics with `<a href="#topic-id">`.
- Be technically accurate. Use documentation-only addresses and names in
  examples: `192.0.2.x`, `198.51.100.x`, `203.0.113.x`, `example.com`,
  `*.example`. Mark terminal output as sample output.
- Security topics explain how an attack works and how it is defended against,
  conceptually and visually. **Never include working exploit code, shellcode or
  step-by-step attack instructions.**
- Message kinds: `p` postcard (readable on the wire), `e` sealed envelope
  (encrypted), `x` forged/attacker, `l` lost. Keep labels short; put the full
  contents in the optional 5th field.
- `npm test` validates every topic (actors, messages, links, groups). Keep it
  passing; extend `test/topics.test.js` when the topic format grows.

## UI rules
- **Scroll is the main control.** Each topic is an intro, one caption card per
  step, and a "Where next?" card. The scene is pinned (right on desktop, top on
  phones) and plays whichever card crosses the trigger line. The step replays
  10 s after it finishes (`REPLAY_MS`) while its card stays active, except while
  a packet popover is open or the tab is hidden. ← / → jump between cards. No
  play/pause or step buttons.
- **Mail is the metaphor, not a legend.** Message kinds draw as a postcard
  (`p`, readable), sealed envelope (`e`, encrypted), red postcard (`x`, forged)
  or dashed postcard (`l`, lost). Tapping a packet opens a popover with what's
  inside (the optional 5th message field), and for envelopes what an
  eavesdropper sees.
- **Actors use plain names first** (`l`, e.g. "Phone book") with the real term
  underneath (`term`, e.g. "DNS resolver"), and an `icon`.
- **Drilling down is zooming.** A step's `zoom`, a "+" badge in the scene, a
  "Go deeper" button, or a topic link in narration zooms into that topic inside
  the same scene. "Back out" (button, breadcrumb, or Esc) zooms back to the
  exact step you left. The All topics menu jumps directly and clears the trail.
- Topics without `steps` render as "coming soon" with their `plan` outline.
- "Try it yourself" (real command + sample output) sits collapsed in the last card.
- Respect `prefers-reduced-motion` (no packet flight, no zoom animation).
- Light/dark follows `prefers-color-scheme`. Mobile-first; touch targets ≥ 44px.
- `localStorage` only for "seen" marks, wrapped in try/catch.

## Layout
```
src/server.js     Static file server: in-memory files, ETags, security headers, /healthz
public/index.html Page shell
public/app.css    Styles
public/app.js     Scroll-driven story engine, zoom, packet popovers
public/topics.js  All topic content (TOPICS, GROUPS)
test/             node:test: server.test.js spawns the server with PORT=0;
                  topics.test.js validates the content
Dockerfile        node:22-alpine, non-root, no npm install, HEALTHCHECK
```

## Environment variables
| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |

## Commands
- `npm start` — run the server (http://localhost:8080)
- `npm test` — run tests (`node --test`)
- `docker build -t aseriesoftubes .` / `docker run -p 8080:8080 aseriesoftubes`
- `docker-compose.yml` pulls `davidshawcodes/aseriesoftubes:latest` and **must
  stay standalone** (no `build:`, no references to other repo files) so it can be
  pasted into Dockhand or Portainer. It uses a read-only filesystem and drops all
  capabilities, so the app must never write to disk.
- Build from source: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`

## Dev environment
The owner develops on Windows with Docker and Node in the **`Ubuntu` WSL
distro** (use `wsl -d Ubuntu -e …`). Do not use `Ubuntu-22.04`: its Docker CLI
(20.10) is too old for the daemon. Never kill all `node.exe` processes on
Windows; stop test servers by PID or port.

## License
GPL-3.0-or-later (`LICENSE`). New source files start with
`// SPDX-License-Identifier: GPL-3.0-or-later` (or `/* … */` in CSS,
`<!-- … -->` in HTML).

## CI
`.github/workflows/ci.yml` runs on every push to `main` and on every pull
request: tests, a Docker build, and a container smoke test (read-only, all caps
dropped). It publishes nothing.

## Release
`.github/workflows/docker-publish.yml` builds `linux/amd64` + `linux/arm64` with
buildx and pushes to Docker Hub on `v*` tags (and manual dispatch). Requires repo
secrets `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, and repo variable
`DOCKERHUB_REPO` (`davidshawcodes/aseriesoftubes`).
