# M3 Acceptance Criteria

Status: **Complete**

## Agent Module Upload & Validation

```gherkin
Scenario: Upload a valid agent module
  Given I am in a room with the Agents panel open
  When I upload a valid manifest.json and agent.wasm
  Then the agent appears in the agent list as "Inactive"
  And the module is stored in IndexedDB

Scenario: Reject invalid WASM binary
  Given I upload a manifest with a correct hash but invalid WASM bytes
  When the loader validates the binary
  Then I see "Invalid WASM module"
  And nothing is stored

Scenario: Reject hash mismatch
  Given I upload a manifest where wasmHash doesn't match the binary
  When the loader validates the upload
  Then I see "WASM hash mismatch"
  And nothing is stored

Scenario: Reject oversized module
  Given I upload a WASM binary larger than 500KB
  When the loader validates the upload
  Then I see "WASM binary exceeds size limit"
  And nothing is stored
```

## Agent Activation & Lifecycle

```gherkin
Scenario: Activate an agent
  Given an uploaded agent module is listed as "Inactive"
  When I click "Activate"
  Then the agent status changes to "Active"
  And the agent's init() function is called

Scenario: Deactivate an agent
  Given an active agent is running
  When I click "Deactivate"
  Then the agent stops receiving events
  And the tick loop stops
  And encrypted state is flushed to IndexedDB

Scenario: Delete an agent module
  Given an inactive agent module exists
  When I click "Delete"
  Then the module is removed from IndexedDB
  And it disappears from the agent list
```

## Event Dispatch

```gherkin
Scenario: Agent receives task events
  Given an active agent with emit_events permission
  When a new task is created in the room
  Then the agent's on_task_event() is called
  And the agent can read the event via host_get_event

Scenario: Agent emits task mutations
  Given an active agent processing a task event
  When the agent calls host_emit_event with a task_assigned event
  Then the event is validated (allowed type, has taskId)
  And actorId is forced to "agent:{moduleId}"
  And the event is encrypted and sent to the room

Scenario: Agent tick fires periodically
  Given an active agent
  When 30 seconds have elapsed
  Then the agent's on_tick() function is called
  And dirty state is flushed afterward
```

## Security: Sandboxing

```gherkin
Scenario: Agent cannot access room keys
  Given a WASM agent module
  When it is instantiated
  Then no crypto primitives are available in imports
  And no room session keys are exposed

Scenario: Agent memory is isolated
  Given two active agents in the same room
  When agent A writes to its linear memory
  Then agent B cannot read agent A's memory
  And each agent has its own WebAssembly.Memory instance

Scenario: Hash verified at instantiation
  Given a stored module with a valid hash
  When the binary is tampered with after storage
  Then instantiation fails with "WASM hash mismatch"

Scenario: Host-provided memory enforced
  Given a WASM module that exports its own memory
  When instantiated
  Then the host-provided memory is used
  And the agent-exported memory is ignored

Scenario: Circuit breaker auto-deactivates failing agent
  Given an active agent whose on_tick throws 3 times consecutively
  When the third failure occurs
  Then the agent is automatically deactivated
  And a warning is logged
```

## Security: State Encryption

```gherkin
Scenario: Agent state encrypted at rest
  Given an agent that calls host_set_state with JSON data
  When the state is flushed to IndexedDB
  Then it is stored as AES-256-GCM ciphertext
  And the encryption key is derived via HKDF from the room's PRF seed

Scenario: Agent state persists across sessions
  Given an agent wrote state and was deactivated
  When the agent is reactivated later
  Then host_get_state returns the previously saved data
  And the data was decrypted using the same derived key

Scenario: Different agents have different keys
  Given two agents in the same room
  When each derives its state encryption key
  Then the keys are different (moduleId is part of HKDF info)

Scenario: Oversized state rejected
  Given an agent tries to set state larger than 1MB
  When host_set_state is called
  Then the state is not saved
  And a warning is logged
```

## Quality Gates

- 207 unit tests passing (89%+ statement coverage on `src/lib/agents/`)
- 36 E2E tests passing (6 new + 30 regression)
- Zero svelte-check errors
- Opus security audit completed with all critical/high findings addressed
- Zero new dependencies added (raw WebAssembly API only)
