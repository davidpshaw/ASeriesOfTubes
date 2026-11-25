# A Series of Tubes

[![CI](https://github.com/davidpshaw/ASeriesOfTubes/actions/workflows/ci.yml/badge.svg)](https://github.com/davidpshaw/ASeriesOfTubes/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

How the internet actually works, animated one packet at a time. (Spoiler: it isn't tubes.)

In 2006 a US senator famously described the internet as "a series of tubes." This project is the longer
answer: a small, self-contained web app that shows what really happens between typing a URL and seeing a
page, and lets you drill into each piece.

- **Scroll the story:** each step's caption plays its part of the animation as you reach it
- **Postcards and sealed envelopes:** readable traffic is a postcard, encrypted traffic is a sealed
  envelope. Tap any of them to look inside, and to see what an eavesdropper would see
- **Zoom in:** any step can zoom into its own topic (the DNS step opens up into the DNS lookup
  chain) and back out to exactly where you were
- **Try it yourself:** the real command that shows the same thing on your own computer, with sample output
- Start with *What happens when you type a URL*, then go deeper into DNS, TCP, TLS, HTTP and
  man-in-the-middle attacks. IP routing, certificates, key exchange, proxies, SSH, VPNs and buffer
  overflows are on the way.
- No accounts, no tracking, no external requests: everything is served from the container
- Works on phones and desktops, follows your light/dark setting, and respects reduced-motion settings

## Run with Docker

```sh
docker run -d --name tubes -p 8080:8080 davidshawcodes/aseriesoftubes
```

Then open http://localhost:8080.

### docker compose

[docker-compose.yml](docker-compose.yml) runs the published image with a read-only filesystem and all Linux
capabilities dropped. It needs no other files, so you can paste it straight into Dockhand, Portainer or a
similar tool:

```sh
docker compose up -d
HOST_PORT=8090 docker compose up -d                 # optional: a different host port
docker compose pull && docker compose up -d         # update to the latest release
```

To build from source inside a clone of the repo, add the build override:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

### Without Docker

The app is static files, so any web server can host `public/` as-is. The included server adds strict
security headers and a health check:

```sh
npm start      # http://localhost:8080
```

## Adding a topic

All content lives in [`public/topics.js`](public/topics.js). A topic is one entry in `TOPICS`, listed under a
heading in `GROUPS`:

```js
'my-topic': {
  title: 'My topic', short: 'Sidebar name', blurb: 'One sentence under the title.',
  actors: [ { id: 'a', l: 'Your computer', term: 'client', icon: 'laptop', x: 0, y: 50 },
            { id: 'b', l: 'The website', term: 'server', icon: 'server', x: 100, y: 50 } ],  // x, y: 0–100
  links: [ ['a', 'b'] ],                                         // faint lines between actors
  steps: [
    { t: 'Step title', d: 'Narration. Link with <a href="#dns">DNS</a>.',
      m: [ ['a', 'b', 'hello', 'p', 'Full text shown when tapped'], ['b', 'a', 'hi', 'e'] ],  // from, to, label, kind, inside
      on: ['a'], b: { b: 'badge under b' }, zoom: 'tls' },     // zoom: topic this step opens into
    { t: 'Last step', d: '…', page: 'a' },                     // page: draw a browser page building itself next to actor a
    // chain: { at: 'a', check: 0, cards: [{ name: 'www.example.com', checks: [['In date'], ['Signed by …', true, 'b']] }, …] }
    //   draws a chain-of-trust panel that ticks off each check (see the Certificates topic)
  ],
  deeper: [ ['tls', 'Why this links to TLS'] ],
  cmd: 'the command', out: 'sample output', note: 'What to look for in the output.',
},
```

Message kinds: `p` postcard (readable by anyone on the path), `e` sealed envelope (encrypted), `x` forged or
attacker, `l` lost. Icons: `laptop`, `server`, `book`, `globe`, `drawers`, `doc`, `seal`, `hood`, `bank`.
A topic without `steps` shows as "coming soon"; give it a `plan` list instead.

Writing rules (checked by `npm test` where possible):
- Spell out each abbreviation at its first use in every topic, name first: "Domain Name System (DNS)".
- Label actors with the same words the captions use.
- Explain every packet label in that step's caption, and give the packet plain-words contents to show when tapped.

Run `npm test` afterwards. It checks every topic: actors, messages, badges, links, groups and abbreviations.

## Development

```sh
npm start      # http://localhost:8080
npm test
```

There are no dependencies to install and no build step. Edit files in `public/` and reload.

## Publishing (GitHub Actions)

`.github/workflows/docker-publish.yml` runs the tests and then builds `linux/amd64` + `linux/arm64`
images. It pushes them to Docker Hub whenever a `v*` tag is pushed (it can also be run manually).

Set up the repository:
- Secrets: `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` (a Docker Hub access token)
- Variable: `DOCKERHUB_REPO` = `davidshawcodes/aseriesoftubes`

Release:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and on every pull request. It runs the tests, builds the
Docker image, and smoke-tests the running container. It publishes nothing.

## License

Copyright (C) 2026 David Shaw

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
[LICENSE](LICENSE) file for details.
