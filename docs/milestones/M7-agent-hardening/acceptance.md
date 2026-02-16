# M7 Acceptance Criteria: Agent Hardening

## Release Goal

Three security hardening features for the WASM agent infrastructure: true preemption via Web Workers, Ed25519 module signatures for custom agents, and event validation to prevent agents from manipulating unknown tasks. Zero new dependencies.

## Threat Model

**Scenario 1: Runaway Agent**  
A custom agent contains an infinite loop or computationally expensive operation. Currently `callWithTimeout()` can't preempt synchronous WASM — the main thread freezes until the call returns. A Web Worker allows the host to terminate the worker entirely, protecting the UI from blocking.

**Scenario 2: Malicious Custom Module**  
An attacker uploads a WASM module that appears benign but contains malicious logic (e.g., always assigns tasks to a specific user, creates spam tasks). Currently only the WASM hash is verified. Ed25519 signatures allow trusted developers to sign modules, and rooms can reject unsigned modules.

**Scenario 3: Event Injection**  
A compromised or buggy agent emits task events referencing taskIds that don't exist in the current room (e.g., trying to assign a task from a different room, or a task that was already deleted). Currently `validateEmittedEvent()` only checks event type and actorId.

## User Stories

### Web Worker Preemption

**As a** room member with an active custom agent  
**I want** the agent to run in a Web Worker  
**So that** if it hangs or runs too long, the UI remains responsive and the agent can be forcibly terminated

#### Acceptance Criteria

```gherkin
Feature: Web Worker Preemption

  Scenario: Agent instantiated in Web Worker
    Given a custom agent module is activated
    When the executor instantiates the WASM
    Then the instantiation happens in a dedicated Web Worker
    And the main thread is not blocked during init()

  Scenario: Agent execution doesn't block main thread
    Given an active agent in a Web Worker
    When on_tick() runs for 2 seconds (heavy computation)
    Then the room UI remains responsive
    And users can scroll, type, and interact normally

  Scenario: Timeout terminates worker
    Given an agent with an infinite loop in on_tick()
    When the 5-second timeout expires
    Then the Web Worker is terminated
    And the agent is marked as failed in the circuit breaker
    And a warning is logged: "Agent call timed out, worker terminated"

  Scenario: Host imports work via postMessage
    Given an agent calls host_get_tasks()
    When the call crosses the worker boundary via postMessage
    Then the host responds with current task JSON
    And the agent receives it in its linear memory

  Scenario: Built-in auto-balance agent continues to work
    Given the built-in auto-balance agent is activated
    When tasks are created and members join
    Then assignments occur as before
    And all tests continue to pass
```

### Ed25519 Module Signatures

**As a** room creator who allows custom agents  
**I want** to only activate modules signed by trusted developers  
**So that** malicious or untrusted code cannot run in my room

#### Acceptance Criteria

```gherkin
Feature: Ed25519 Module Signatures

  Scenario: Upload signed module
    Given a manifest.json with a valid Ed25519 signature field
    And the signature was created by signing the WASM hash with a known private key
    When I upload the module
    Then the loader verifies the signature against a trusted public key
    And the module is stored if verification passes

  Scenario: Reject unsigned module when signatures required
    Given room policy requires signed agents
    When I upload a manifest without a signature field
    Then I see "Module signature required but not provided"
    And nothing is stored

  Scenario: Reject invalid signature
    Given a manifest with a signature field
    But the signature doesn't match the WASM hash
    When I upload the module
    Then I see "Invalid module signature"
    And nothing is stored

  Scenario: Built-in agents bypass signature check
    Given the built-in auto-balance agent
    When it is activated
    Then no signature verification is performed
    And it activates successfully (hash-only verification)

  Scenario: Optional signatures for testing
    Given a room without signature policy
    When I upload an unsigned custom module
    Then it is accepted (hash verification only)
    And I see a warning icon indicating "unsigned module"
```

### Agent Event Validation

**As a** room member running custom agents  
**I want** agents to only emit events for tasks that exist in this room  
**So that** buggy or malicious agents can't inject references to unknown tasks

#### Acceptance Criteria

```gherkin
Feature: Agent Event Validation

  Scenario: Agent emits event for existing task
    Given an active agent processing a task_created event
    When the agent emits a task_assigned event for that taskId
    Then the event passes validation
    And it is encrypted and sent to the room

  Scenario: Reject event for unknown taskId
    Given an active agent
    When it emits a task_assigned event for a taskId not in the current room
    Then the event is rejected
    And a warning is logged: "Agent emitted event for unknown taskId"
    And the event is not sent

  Scenario: Allow task_created events
    Given an active agent
    When it emits a task_created event (new taskId)
    Then validation passes even though the task doesn't exist yet
    And the event is processed normally

  Scenario: Validate against current task store
    Given a task is deleted
    When an agent tries to emit an event for that taskId
    Then validation fails (task no longer in store)
    And the event is rejected

  Scenario: Validation doesn't break existing flows
    Given the built-in auto-balance agent
    When it assigns tasks
    Then all events validate correctly
    And all existing tests pass
```

## Security Invariants

- Web Worker runs in a separate thread — true preemption via worker termination
- Worker has its own vodozemac WASM instance (can't share main thread's)
- Ed25519 signatures verified before module activation (custom modules only)
- Signature field is optional — rooms can allow unsigned modules for development
- Built-in agents verified by hash only (no signature required)
- Event validation checks taskId existence except for `task_created` events
- Zero new dependencies (Web Worker API, vodozemac Ed25519 or WebCrypto Ed25519)

## What's Cut

| Feature | Reason |
|---------|--------|
| Multiple trusted signers | V1: single trusted public key per room. Multi-signer is future scope. |
| Signature revocation | No CRL/OCSP. V1 relies on module deletion for revoked keys. |
| Sandboxed worker pool | V1: one worker per agent. Pooling is future optimization. |
| Worker SharedArrayBuffer | Not needed for current design. Adds complexity. |
| Custom signature algorithms | V1: Ed25519 only. No RSA, no ECDSA. |

## Definition of Done

- All Gherkin scenarios passing (unit + E2E)
- 75%+ coverage on new worker/signature/validation code
- 0 new dependencies
- 0 type errors (`npm run check`)
- All existing tests pass (342 unit, 108 E2E)
- Ship-readiness gate: prod-eng + security audit pass
