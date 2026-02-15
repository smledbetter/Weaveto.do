---
name: weave-architect
description: Architectural blueprint for weave.us — E2EE task coordination with agent teams, no accounts, burn-after-use.
---

## Core Principles

1. **Zero-Knowledge by Default**
   All data encrypted client-side. No plaintext on server or agent.

2. **Architectural Privacy**
   Privacy enforced by design — no trust in infrastructure.

3. **Ephemeral by Design**
   Tasks and rooms auto-delete on completion. Keys wiped.

4. **User Sovereignty**
   No accounts. Identity via WebAuthn PRF. Self-hosted or federated.

5. **Minimal Trust**
   Nodes store encrypted shards. No single point of control.

## System Layers

| Layer | Components | Responsibilities |
|------|------------|------------------|
| **Client** | Svelte, WebAuthn, vodozemac | Key generation, E2EE, UI |
| **Agents** | WebContainer (WASM), Noise Pipes | Auto-assign, reminders, cleanup |
| **Federation** | Matrix-like P2P sync | Shard routing, Merkle-verified consistency |
| **Hosting** | Node.js, Docker, VM | No long-term storage, no IP logs |

## Security Invariants

- **E2EE**: Olm/Megolm -> MLS. Keys ratcheted per message.
- **Authentication**: WebAuthn PRF only. No recovery.
- **Metadata Protection**: Rotating pseudonyms, traffic padding, no IP logging.
- **Burn-After-Use**: On completion or TTL expiry, wipe keys, state, and URL.

## Agent Contracts

- **TaskSplitter**: Decompose task -> subtasks (WASM sandbox)
- **LoadBalancer**: Assign based on client-side availability
- **ReminderAgent**: Send encrypted reminders (no cloud scheduling)
- **CleanupAgent**: Enforce burn — terminate agents, wipe keys

## Threat Model

| Adversary | Mitigation |
|---------|----------|
| Malicious node | E2EE, client-verified sync |
| Compromised agent | WASM sandbox, no persistent state |
| Device theft | WebAuthn PRF, no key export |
| Traffic analysis | Padding, batched sends, no IP logs |

## Cost Optimization Principles

6. **Cheapest Appropriate Model**
   For development-time sub-agents (Claude Code): use the cheapest Claude tier (haiku/sonnet/opus) that meets quality requirements. For runtime product agents (M2+): default to local open-source models for zero API cost and privacy.

7. **Open Source First — Scoped to Runtime**
   Open-source models are the default for **runtime product agents** (WASM-sandboxed, client-side). They are NOT recommended for development-time coding sub-agents due to quality/context limitations. Favor open-source tools and libraries everywhere.

8. **No Fake Timelines**
   Never produce fake execution timelines, calendars, or schedules. Focus on phases, dependencies, and ordering — not dates or durations.

## Model Selection by Context

### Development-Time (Claude Code Sub-Agents)

Claude Code supports haiku/sonnet/opus. Local open-source models are not supported and not recommended for dev-time coding (quality gap, limited context windows, hallucination risk on modern frameworks).

| Task | Model | Rationale |
|------|-------|-----------|
| Codebase exploration | haiku | Fast, cheap, good enough for search |
| Simple code generation | haiku | Formatting, simple components |
| Complex code generation | sonnet | Multi-file features, TypeScript inference |
| Test writing | sonnet | Needs reasoning for edge cases |
| Refactoring (multi-file) | sonnet | Context window critical |
| Code review | sonnet | Pattern recognition, architecture |
| Security review | opus | Non-negotiable for E2EE codebase |
| Architectural decisions | opus | Long-term cost savings |

### Runtime Product Agents (M2+ WASM Sandboxing)

Open-source models are the **default** for runtime agents. Zero API cost, full privacy, offline-first.

| Model | License | Best For | Memory |
|-------|---------|----------|--------|
| **Mistral-7B-Instruct-v0.2** | Apache 2.0 | Task coordination, auto-assign, splitting | ~8GB |
| **phi-2 (2.7B)** | MIT | Low-memory devices, on-device deployment | ~2GB |
| **OpenHermes-2.5-Mistral-7B** | Apache 2.0 | Complex multi-turn agent interactions | ~8GB |

Decision framework:
- **Default**: Mistral-7B-Instruct-v0.2 (best quality/size, Apache 2.0)
- **Low-memory devices**: phi-2 (tiny footprint, MIT)
- **Complex reasoning**: OpenHermes-2.5-Mistral-7B

### Local Development Tooling (Optional)

- **Commit messages**: Local Mistral-7B via Ollama (zero cost, non-critical)
- **Documentation drafts**: Local models adequate, human review required
- **NOT for security-critical tasks**

### CI/CD Pipeline

- Use Claude Haiku (fast, cheap, no GPU runner overhead)
- Local models too slow on CPU-only CI runners

## Milestone Savings Tracking

At every milestone:
1. Track Claude API token usage by tier (haiku/sonnet/opus)
2. Compare against hypothetical all-opus baseline
3. For M2+: track user-side savings from local runtime agents vs hypothetical API costs
4. Export findings to `docs/cost-savings-log.md`

## Testing Requirements

- All code must have unit tests with 80%+ line coverage
- Integration tests for all API endpoints
- E2E tests for critical user flows
- Security tests for all input validation and authentication
- Performance tests for all database queries and API endpoints
- Accessibility tests using axe-core
- Cross-browser testing for all UI components

### Test Plan Template

**Unit Tests**
- [ ] Test all public functions
- [ ] Test edge cases and error conditions
- [ ] Mock external dependencies
- [ ] Verify inputs and outputs

**Integration Tests**
- [ ] Test API endpoints with realistic payloads
- [ ] Test database interactions
- [ ] Test third-party service integrations
- [ ] Test error handling

**E2E Tests**
- [ ] Test complete user workflows
- [ ] Test authentication flows
- [ ] Test data persistence
- [ ] Test error recovery

### Testing Stack

- Unit/Integration: Jest, Vitest, or PyTest
- E2E: Playwright or Cypress
- Security: OWASP ZAP, Snyk, or SonarQube
- Accessibility: axe-core or pa11y
- Performance: Lighthouse, k6, or Artillery
- Coverage: Istanbul or Coverage.py

### Quality Gates

- Block merge if test coverage < 80%
- Block merge if security scan finds critical vulnerabilities
- Block merge if accessibility score < 90
- Block merge if performance score < 90
- Block merge if any test fails

### TDD Process

1. Write failing test for new feature
2. Implement minimal code to pass test
3. Refactor with tests as safety net
4. Repeat for all requirements

### Test Data

- Use factories to generate test data
- Never use production data
- Reset database between tests
- Use realistic but anonymized data

### CI/CD Pipeline

1. Run linters and type checkers
2. Run unit and integration tests
3. Generate test coverage report
4. Run security scans
5. Run accessibility tests
6. Run performance tests
7. Deploy to staging
8. Run E2E tests
9. Manual QA (if required)
10. Deploy to production

### Production Monitoring

- Log all errors with context
- Monitor API response times
- Track error rates
- Set up alerts for critical failures
- Capture user feedback on issues

### Test Documentation

- Document test strategy
- Document test environment setup
- Document test data generation
- Document test execution process
- Document test results and metrics

### Continuous Testing

- Run fast tests on every commit
- Run full test suite on every PR
- Run performance tests on staging
- Run security scans on dependencies
- Run accessibility tests on UI changes

## Usage

Use to validate:
- E2EE implementation
- Agent behavior
- Privacy guarantees
- Burn-after-use enforcement

Example:
> "Design a flow for splitting a task and auto-assigning subtasks."
> -> Architect validates against principles, agents implement, PrivacyAuditor checks metadata.


