# M3 Plan: Agent Infrastructure

Status: **Not Started**

## Scope

Production-ready agent execution: WASM sandboxing for user-uploaded agent modules, persistent agent state, and capability-constrained execution. Deferred from original M2 — the task system needs real-world usage before adding agent infrastructure.

## Features

### 1. WASM Agent Sandboxing
- WebContainer sandbox for agent module execution
- Ephemeral session keys (no persistent access to room keys)
- Capability constraints: agents can only respond to encrypted room events
- Memory zeroing on agent unload
- No access to persistent storage or host APIs

### 2. Agent Module Upload
- Room admins can upload trusted WASM modules
- Module validation and signature verification
- Module lifecycle: load, activate, deactivate, destroy

### 3. Persistent Agent State
- Agents can persist state across room sessions (encrypted)
- State is scoped to the agent + room (no cross-room leakage)
- State is destroyed when agent is unloaded

## Prerequisites

- M2 complete (task intelligence features proven in real usage)
- Security audit of WASM execution model
- Usage data showing demand for custom agent automation

## Acceptance Criteria

See original PRD M2 scenarios (WASM sandboxing).
