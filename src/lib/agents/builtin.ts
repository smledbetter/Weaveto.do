/**
 * Built-in agent registry.
 * Pre-bundled agents that ship with the app, not user-uploaded.
 * Built-ins bypass IndexedDB and are loaded from static assets.
 */

import type { AgentManifest, StoredAgentModule } from "./types";
import manifestJson from "./auto-balance.manifest.json";

const manifest = manifestJson as AgentManifest;

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
 * Fetch the auto-balance WASM binary from static assets.
 * Returns null if fetch fails (e.g. offline, missing asset).
 */
async function fetchAutoBalanceWasm(): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch("/agents/auto-balance.wasm");
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Get all built-in agent modules for a room.
 * Fetches WASM binaries from static assets.
 * Returns empty array if fetch fails.
 */
export async function getBuiltInAgents(
  roomId: string,
): Promise<StoredAgentModule[]> {
  const wasmBytes = await fetchAutoBalanceWasm();
  if (!wasmBytes) return [];

  return [
    {
      id: builtInId(roomId, manifest.name),
      roomId,
      manifest,
      wasmBytes,
      uploadedAt: 0,
      active: true,
    },
  ];
}

/**
 * Get the manifest for a built-in agent by name.
 */
export function getBuiltInManifest(name: string): AgentManifest | null {
  if (name === "auto-balance") return manifest;
  return null;
}
