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
   Always recommend spawning sub-agents with the cheapest model that can handle the task. Never default to the most expensive option.

7. **Open Source First**
   Greatly favor open-source tools and open-source models. Evaluate local open-source models (zero API cost) before Anthropic API models. Include local LLM options in every cost analysis with honest trade-off assessments (quality, latency, infrastructure overhead).

8. **No Fake Timelines**
   Never produce fake execution timelines, calendars, or schedules. Focus on phases, dependencies, and ordering — not dates or durations.

## Recommended Models

### Mistral-7B-Instruct-v0.2 (Primary)
- **Why**: Compact 7B model with excellent instruction following, reduced repetition, strong reasoning
- **License**: Apache 2.0
- **Cost**: Single GPU, low inference costs
- **Best for**: General task coordination, instruction-heavy agent workflows
- **HF**: [mistralai/Mistral-7B-Instruct-v0.2](https://huggingface.co/mistralai/Mistral-7B-Instruct-v0.2)

### phi-2 (2.7B)
- **Why**: Microsoft's small model designed for reasoning tasks
- **License**: MIT
- **Cost**: Extremely efficient, runs on consumer hardware
- **Best for**: On-device deployment, privacy-focused applications
- **HF**: [microsoft/phi-2](https://huggingface.co/microsoft/phi-2)

### OpenHermes-2.5-Mistral-7B
- **Why**: State-of-the-art Mistral fine-tune with strong multi-turn chat and system prompt capabilities
- **License**: Apache 2.0 (inherited from Mistral-7B)
- **Cost**: Competitive with other 7B models, excellent performance-to-cost ratio
- **Best for**: Complex agent interactions, multi-turn conversations
- **HF**: [teknium/OpenHermes-2.5-Mistral-7B](https://huggingface.co/teknium/OpenHermes-2.5-Mistral-7B)

### Decision Framework
- **Default for agent teams**: Mistral-7B-Instruct-v0.2 (proven reasoning, Apache 2.0, strong tooling)
- **On-device / max privacy**: phi-2 (tiny footprint, MIT, consumer hardware)
- **Complex multi-turn agents**: OpenHermes-2.5-Mistral-7B (sophisticated conversations)

## Milestone Savings Tracking

At every milestone:
1. Perform thorough cost/token analysis comparing open-source model usage vs. hypothetical Opus 4.6-only baseline
2. Export findings to `docs/cost-savings-log.md` with:
   - Token counts per model used
   - Cost per model (API pricing or $0 for local)
   - Equivalent Opus 4.6 cost for the same work
   - Net savings (absolute and percentage)
3. All claims must cite clear, strong evidence (token counts, model pricing docs, benchmark references)

## Sub-Agent Spawning Guidelines

When spawning sub-agents via the Task tool:
- **Local open-source model** (zero cost): Use when latency and quality are acceptable for the task
- **haiku**: Use for quick, straightforward tasks (search, simple transforms, formatting)
- **sonnet**: Use for moderate complexity (code generation, multi-step reasoning)
- **opus**: Reserve only for tasks requiring highest capability (architectural decisions, complex debugging)
- Always document model choice rationale in the task prompt

## Usage

Use to validate:
- E2EE implementation
- Agent behavior
- Privacy guarantees
- Burn-after-use enforcement

Example:
> "Design a flow for splitting a task and auto-assigning subtasks."
> -> Architect validates against principles, agents implement, PrivacyAuditor checks metadata.


