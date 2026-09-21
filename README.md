# Neon Snake Online

A neon slither-style snake game built with Three.js (WebGL) and peer-to-peer
WebRTC multiplayer. Fully static: no build step, no backend server of your own,
no CDN calls at runtime.

**Play online: https://mdhemalakanda.github.io/neon-snake-3d/**

## How it works

- **PLAY SOLO** — huge circular arena (radius 250) with 5 AI snakes.
- **CREATE ROOM** — starts a game and gives you a 4-letter room code. Share the
  invite link (button in-game) or just the code.
- **JOIN** — enter a friend's code to play in their arena.

Multiplayer is peer-to-peer over WebRTC data channels (PeerJS free signaling
cloud). The room creator's browser runs the authoritative simulation and
streams state to everyone else, so:

- best for 2-8 players,
- the arena lives as long as the host keeps the tab open,
- if the host leaves, the room ends.

## Controls

| Action | Input |
|---|---|
| Steer | Mouse (snake chases the cursor), arrows / WASD, or drag on touch |
| Boost | Hold SPACE, hold mouse button, or second finger (costs length) |
| Sound | M or the speaker button |

Eat glowing orbs to grow longer and score points (+1 to +3). Dead snakes turn
into food. Avoid other snakes' bodies and the arena wall — only your head is
vulnerable. The leaderboard tracks the top 8 snakes in real time, and your
best solo score is saved locally. Every snake wears its player's name.

## Run locally

ES modules need any static HTTP server:

```sh
python3 -m http.server 8137
# then open http://127.0.0.1:8137/
```

## Self-test hooks (inert without query params)

- `?autopilot=eat` — synchronously drives the simulation (eat, grow, wall death)
  and writes the result to the document's `data-autopilot` attribute.
- `?autopilot=live` — starts a solo game immediately (screenshots).
- `?nettest=host&room=CODE` / `?nettest=join&room=CODE` — headless multiplayer
  smoke test; reports into `data-net`.

Built with [Three.js](https://threejs.org/) r170 and
[PeerJS](https://peerjs.com/) 1.5 (both vendored in `vendor/`).
