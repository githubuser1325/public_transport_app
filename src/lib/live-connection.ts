export interface LiveSocket {
  onopen: ((event: Event) => unknown) | null;
  onmessage: ((event: MessageEvent) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  onclose: ((event: CloseEvent) => unknown) | null;
  close(): void;
}

export interface LiveConnectionOptions {
  url: string;
  createSocket: (url: string) => LiveSocket;
  onStatus: (status: "connecting" | "connected" | "reconnecting") => void;
  onMessage: (payload: unknown) => void;
  retryDelayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

export function startLiveConnection(options: LiveConnectionOptions): () => void {
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  const retryDelayMs = options.retryDelayMs ?? 5_000;
  let active = true;
  let socket: LiveSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = () => {
    if (!active) return;
    options.onStatus("connecting");
    socket = options.createSocket(options.url);
    socket.onopen = () => active && options.onStatus("connected");
    socket.onmessage = (event) => active && options.onMessage(event.data);
    socket.onerror = () => active && options.onStatus("reconnecting");
    socket.onclose = () => {
      if (!active) return;
      options.onStatus("reconnecting");
      if (retryTimer !== null) return;
      retryTimer = schedule(() => {
        retryTimer = null;
        connect();
      }, retryDelayMs);
    };
  };

  connect();
  return () => {
    active = false;
    if (retryTimer !== null) cancel(retryTimer);
    socket?.close();
  };
}
