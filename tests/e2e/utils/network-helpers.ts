import type { BrowserContext, Page, WebSocketRoute } from "@playwright/test";

/**
 * WebSocket gate for network resilience testing.
 *
 * Uses `browserContext.routeWebSocket()` (context-level, NOT page-level)
 * so the handler survives reconnects (Playwright bug #34045: page-level
 * handlers don't re-fire on subsequent WebSocket connections).
 *
 * IMPORTANT: When routeWebSocket is active, browser-side ws.close() does
 * NOT propagate properly (Playwright intercepts it). Use the gate's
 * dropConnection() method which closes from the route side.
 */
export interface WsGate {
	/** Sever the WebSocket connection (simulates WiFi drop). */
	dropConnection(code?: number): void;
	/** Whether a live WebSocket passthrough is currently active. */
	readonly connected: boolean;
	/** Captured WebSocket frames sent from page to server. */
	readonly sentFrames: string[];
	/** Captured WebSocket frames sent from server to page. */
	readonly receivedFrames: string[];
}

export async function installWsGate(
	context: BrowserContext,
	urlPattern: string | RegExp = /localhost:3001/,
): Promise<WsGate> {
	let clientWs: WebSocketRoute | null = null;
	let serverWs: WebSocketRoute | null = null;
	let isConnected = false;
	const sentFrames: string[] = [];
	const receivedFrames: string[] = [];

	await context.routeWebSocket(urlPattern, async (ws) => {
		const server = ws.connectToServer();
		clientWs = ws;
		serverWs = server;
		isConnected = true;

		ws.onMessage((msg) => {
			if (typeof msg === "string") sentFrames.push(msg);
			server.send(msg);
		});

		server.onMessage((msg) => {
			if (typeof msg === "string") receivedFrames.push(msg);
			ws.send(msg);
		});

		ws.onClose(() => {
			isConnected = false;
		});

		server.onClose(() => {
			isConnected = false;
		});
	});

	return {
		dropConnection(code = 3001) {
			// Close client side first (triggers browser's WebSocket.onclose)
			if (clientWs) {
				clientWs.close({ code, reason: "test-network-drop" });
				clientWs = null;
			}
			// Then close server side
			if (serverWs) {
				serverWs.close({ code, reason: "test-network-drop" });
				serverWs = null;
			}
			isConnected = false;
		},
		get connected() {
			return isConnected;
		},
		sentFrames,
		receivedFrames,
	};
}

/**
 * Inject a WebSocket tracker for browser-side close operations.
 * Only needed when NOT using routeWebSocket (routeWebSocket intercepts
 * browser-side close events and prevents them from propagating).
 */
export async function injectWsTracker(target: Page | BrowserContext): Promise<void> {
	await target.addInitScript(() => {
		const sockets: WebSocket[] = [];
		(window as any).__wsSockets = sockets;

		const OrigWebSocket = window.WebSocket;
		(window as any).WebSocket = function (url: string, protocols?: string | string[]) {
			const ws = new OrigWebSocket(url, protocols);
			sockets.push(ws);
			return ws;
		} as any;
		(window as any).WebSocket.prototype = OrigWebSocket.prototype;
		(window as any).WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
		(window as any).WebSocket.OPEN = OrigWebSocket.OPEN;
		(window as any).WebSocket.CLOSING = OrigWebSocket.CLOSING;
		(window as any).WebSocket.CLOSED = OrigWebSocket.CLOSED;
	});
}
