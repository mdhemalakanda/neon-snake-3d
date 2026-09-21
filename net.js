/* net.js — thin WebRTC multiplayer wrapper around PeerJS (global `Peer` from vendor/peerjs.min.js).
   The room host is authoritative: clients only stream steering input. */

export const roomPeerId = (code) =>
  'neonsnake3d-' + String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');

export function makeRoomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += abc[(Math.random() * abc.length) | 0];
  return c;
}

export class Net {
  constructor() {
    this.mode = 'off';          // off | host | client
    this.peer = null;
    this.conns = new Map();     // host: peerId -> DataConnection
    this.conn = null;           // client: DataConnection to host
  }

  host(code, handlers) {
    this.mode = 'host';
    this.peer = new Peer(roomPeerId(code), { debug: 0 });
    this.peer.on('open', () => handlers.onOpen && handlers.onOpen());
    this.peer.on('error', (e) => handlers.onError && handlers.onError(e));
    this.peer.on('connection', (conn) => {
      this.conns.set(conn.peer, conn);
      conn.on('data', (m) => handlers.onData && handlers.onData(conn, m));
      conn.on('close', () => {
        this.conns.delete(conn.peer);
        handlers.onLeave && handlers.onLeave(conn);
      });
      conn.on('error', () => { /* per-conn errors surface via close */ });
    });
  }

  join(code, handlers) {
    this.mode = 'client';
    this.peer = new Peer({ debug: 0 });
    this.peer.on('open', () => {
      const conn = this.peer.connect(roomPeerId(code), { reliable: true });
      this.conn = conn;
      conn.on('open', () => handlers.onOpen && handlers.onOpen(conn));
      conn.on('data', (m) => handlers.onData && handlers.onData(m));
      conn.on('close', () => handlers.onHostLost && handlers.onHostLost());
      conn.on('error', () => {});
    });
    this.peer.on('error', (e) => handlers.onError && handlers.onError(e));
  }

  get peerCount() { return [...this.conns.values()].filter((c) => c.open).length; }

  broadcast(m) {
    for (const c of this.conns.values()) {
      if (c.open) { try { c.send(m); } catch { /* dropped */ } }
    }
  }

  sendToHost(m) {
    if (this.conn && this.conn.open) { try { this.conn.send(m); } catch { /* dropped */ } }
  }

  destroy() {
    try { this.peer && this.peer.destroy(); } catch { /* already gone */ }
    this.peer = null;
    this.conn = null;
    this.conns.clear();
    this.mode = 'off';
  }
}
