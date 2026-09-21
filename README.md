# Neon Snake 3D

A neon arcade snake game built with Three.js (WebGL). Fully self-contained:
no build step, no CDN calls, no assets to download at runtime.

**Play online: https://mdhemalakanda.github.io/neon-snake-3d/**

## Controls

| Action | Input |
|---|---|
| Steer | Arrow keys or WASD (swipe on touch) |
| Start | Space / Enter / tap (any arrow also starts) |
| Pause | P or Esc |
| Sound on/off | M or the speaker button |

## Features

- 17x17 neon arena with a pulsing shader grid, energy walls, ambient dust, and bloom post-processing
- Rounded 3D snake with a cyan-to-violet gradient, smooth interpolated movement, googly eyes
- Pulsing food crystal with its own point light; eating triggers particle bursts, a grid ripple, a score popup, and a speed increase
- Synthesized WebAudio sound effects (no audio files)
- Persistent best score, pause/auto-pause, start/pause/game-over screens, mobile swipe support

## Run locally

The game uses ES modules, so it needs any static HTTP server:

```sh
python3 -m http.server 8137
# then open http://127.0.0.1:8137/
```

## Self-test

`?autopilot=live` starts a game immediately (used for screenshots).
`?autopilot=eat` synchronously drives the game logic (eat, grow, wall death)
and writes the outcome into the document's `data-autopilot` attribute, so the
core loop can be smoke-tested in headless browsers where requestAnimationFrame
does not tick.

Built with [Three.js](https://threejs.org/) r170 (vendored in `vendor/`).
