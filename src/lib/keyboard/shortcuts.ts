export type ShortcutHandler = (e: KeyboardEvent) => void;

export interface Shortcut {
	key: string;
	modifiers?: ('cmd' | 'ctrl' | 'shift' | 'alt')[];
	handler: ShortcutHandler;
	description: string;
}

export class ShortcutManager {
	private shortcuts: Shortcut[] = [];
	private boundHandler: ((e: KeyboardEvent) => void) | null = null;

	register(shortcut: Shortcut): void {
		this.shortcuts.push(shortcut);
	}

	unregister(key: string): void {
		this.shortcuts = this.shortcuts.filter((s) => s.key !== key);
	}

	attach(): void {
		if (this.boundHandler) return; // Already attached
		this.boundHandler = (e: KeyboardEvent) => this.handleKeydown(e);
		window.addEventListener('keydown', this.boundHandler);
	}

	detach(): void {
		if (this.boundHandler) {
			window.removeEventListener('keydown', this.boundHandler);
			this.boundHandler = null;
		}
	}

	getShortcuts(): Shortcut[] {
		return [...this.shortcuts];
	}

	private handleKeydown(e: KeyboardEvent): void {
		for (const shortcut of this.shortcuts) {
			if (this.matches(e, shortcut)) {
				shortcut.handler(e);
				break;
			}
		}
	}

	private matches(e: KeyboardEvent, shortcut: Shortcut): boolean {
		// Case-insensitive key match
		if (e.key.toLowerCase() !== shortcut.key.toLowerCase()) {
			return false;
		}

		// Check modifiers
		const modifiers = shortcut.modifiers || [];

		// Check cmd/ctrl (platform-aware)
		const hasCmd = modifiers.includes('cmd') || modifiers.includes('ctrl');
		const isCmdPressed = e.metaKey || e.ctrlKey;

		if (hasCmd && !isCmdPressed) {
			return false;
		}

		if (!hasCmd && (e.metaKey || e.ctrlKey)) {
			return false;
		}

		// Check shift
		const hasShift = modifiers.includes('shift');
		if (hasShift !== e.shiftKey) {
			return false;
		}

		// Check alt
		const hasAlt = modifiers.includes('alt');
		if (hasAlt !== e.altKey) {
			return false;
		}

		return true;
	}
}
