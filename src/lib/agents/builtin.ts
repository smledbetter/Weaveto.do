/**
 * Built-in agent registry.
 * Pre-bundled agents that ship with the app, not user-uploaded.
 * Built-ins bypass IndexedDB and are loaded from static assets.
 */

import type { AgentManifest, StoredAgentModule } from "./types";
import autoBalanceManifestJson from "./auto-balance.manifest.json";
import unblockManifestJson from "./unblock.manifest.json";

const autoBalanceManifest = autoBalanceManifestJson as AgentManifest;
const unblockManifest = unblockManifestJson as AgentManifest;

/** Prefix used for built-in agent module IDs. */
export const BUILTIN_PREFIX = "builtin:";

/**
 * Check if a module ID refers to a built-in agent.
 */
export function isBuiltIn(moduleId: string): boolean {
  return moduleId.includes(BUILTIN_PREFIX);
}

/**
 * Build the module ID for a built-in agent in a specific room.
 */
function builtInId(roomId: string, name: string): string {
  return `${roomId}:${BUILTIN_PREFIX}${name}`;
}

/**
 * Fetch a WASM binary from static assets.
 * Returns null if fetch fails (e.g. offline, missing asset).
 */
async function fetchWasm(path: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Get all built-in agent modules for a room.
 * Fetches WASM binaries from static assets in parallel.
 * Partial failure safe: if one agent fails to load, others still register.
 */
export async function getBuiltInAgents(
  roomId: string,
): Promise<StoredAgentModule[]> {
  const [autoBalanceBytes, unblockBytes] = await Promise.all([
    fetchWasm("/agents/auto-balance.wasm"),
    fetchWasm("/agents/unblock.wasm"),
  ]);

  const result: StoredAgentModule[] = [];

  if (autoBalanceBytes) {
    result.push({
      id: builtInId(roomId, autoBalanceManifest.name),
      roomId,
      manifest: autoBalanceManifest,
      wasmBytes: autoBalanceBytes,
      uploadedAt: 0,
      active: true,
    });
  }

  if (unblockBytes) {
    result.push({
      id: builtInId(roomId, unblockManifest.name),
      roomId,
      manifest: unblockManifest,
      wasmBytes: unblockBytes,
      uploadedAt: 0,
      active: true,
    });
  }

  return result;
}

/**
 * Get the manifest for a built-in agent by name.
 */
export function getBuiltInManifest(name: string): AgentManifest | null {
  if (name === "auto-balance") return autoBalanceManifest;
  if (name === "unblock") return unblockManifest;
  return null;
}
