import { type ClientEvents, NET, type ServerEvents } from '@shared/net/protocol';

type Handler<K extends keyof ServerEvents> = (data: ServerEvents[K]) => void;

/** WebSocket do modo online (`/server` no mesmo host — o Vite repassa ao Nest). */
export class NetClient {
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();
  onClose: () => void = () => {};

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    window.addEventListener('pagehide', () => this.close(), { once: true });
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${NET.path}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        // batimento: o servidor derruba conexões mudas
        const beat = setInterval(() => (ws.readyState === WebSocket.OPEN ? ws.send(JSON.stringify({ event: 'ping', data: { t: performance.now() } })) : clearInterval(beat)), 3000);
        resolve();
      };
      ws.onerror = () => reject(new Error('Não foi possível conectar ao servidor online.'));
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        this.onClose();
      };
      ws.onmessage = (e) => {
        let msg: { event?: string; data?: unknown };
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (typeof msg.event !== 'string') return;
        for (const h of this.handlers.get(msg.event) ?? []) h(msg.data);
      };
    });
  }

  on<K extends keyof ServerEvents>(event: K, handler: Handler<K>): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as (data: unknown) => void);
    this.handlers.set(event, set);
    return () => set.delete(handler as (data: unknown) => void);
  }

  send<K extends keyof ClientEvents>(event: K, data: ClientEvents[K]): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ event, data }));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
