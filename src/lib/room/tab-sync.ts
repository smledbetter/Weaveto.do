export type TabSyncMessage =
	| { type: 'tab-register'; tabId: string; roomId: string }
	| { type: 'tab-deregister'; tabId: string }
	| { type: 'pin-locked'; tabId: string }
	| { type: 'tab-ping'; requestId: string }
	| { type: 'tab-pong'; requestId: string; tabId: string };

export class TabSync {
	private readonly tabId: string;
	private readonly roomId: string;
	private channel: BroadcastChannel | null = null;
	private lockCallback: (() => void) | null = null;
	private pongListeners: Map<string, (tabId: string) => void> = new Map();

	constructor(roomId: string) {
		this.tabId = crypto.randomUUID();
		this.roomId = roomId;

		if (typeof BroadcastChannel === 'undefined') {
			return;
		}

		this.channel = new BroadcastChannel('weave-tab-sync');
		this.channel.addEventListener('message', this.handleMessage.bind(this));
		this.send({ type: 'tab-register', tabId: this.tabId, roomId: this.roomId });
	}

	private send(message: TabSyncMessage): void {
		this.channel?.postMessage(message);
	}

	private handleMessage(event: MessageEvent<TabSyncMessage>): void {
		const msg = event.data;

		if (!msg || typeof msg !== 'object' || !('type' in msg)) {
			return;
		}

		// Ignore messages from self
		if ('tabId' in msg && msg.tabId === this.tabId) {
			return;
		}

		switch (msg.type) {
			case 'pin-locked':
				this.lockCallback?.();
				break;

			case 'tab-ping':
				this.send({ type: 'tab-pong', requestId: msg.requestId, tabId: this.tabId });
				break;

			case 'tab-pong': {
				const listener = this.pongListeners.get(msg.requestId);
				listener?.(msg.tabId);
				break;
			}

			default:
				break;
		}
	}

	broadcastLock(): void {
		this.send({ type: 'pin-locked', tabId: this.tabId });
	}

	onLock(callback: () => void): void {
		this.lockCallback = callback;
	}

	getActiveTabCount(): Promise<number> {
		if (!this.channel) {
			return Promise.resolve(1);
		}

		return new Promise((resolve) => {
			const requestId = crypto.randomUUID();
			const respondingTabs = new Set<string>();

			this.pongListeners.set(requestId, (tabId: string) => {
				respondingTabs.add(tabId);
			});

			this.send({ type: 'tab-ping', requestId });

			setTimeout(() => {
				this.pongListeners.delete(requestId);
				resolve(respondingTabs.size + 1);
			}, 200);
		});
	}

	destroy(): void {
		if (!this.channel) {
			return;
		}

		this.send({ type: 'tab-deregister', tabId: this.tabId });
		this.channel.close();
		this.channel = null;
		this.pongListeners.clear();
		this.lockCallback = null;
	}
}
