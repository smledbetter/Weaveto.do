# **Product Requirements Document: Weave.us**  
*Privacy-first, agent-augmented task coordination for decentralized teams*  

---

## **1. Product Vision**  
Weave.us enables trusted groups—caregiving collectives, event organizers, volunteer networks—to coordinate tasks securely and efficiently without relying on centralized services.  

The platform ensures that all communication and task data remain private by default, with end-to-end encryption, minimal metadata, and ephemeral state. Automation is handled by lightweight, sandboxed agent teams that act on behalf of users—without ever accessing plaintext.  

Weave.us is designed for simplicity, resilience, and user sovereignty: no accounts, no tracking, no persistence beyond what’s necessary.

---

## **2. Unique Value Proposition**  
> *Weave.us is the only task coordination tool that combines end-to-end encryption, autonomous agent automation, and burn-after-use semantics—so teams can collaborate securely and efficiently without surrendering privacy or control.*

### Key Differentiators:
- ✅ **End-to-end encrypted by default**: All data encrypted client-side; servers only relay ciphertext  
- ✅ **No user accounts or identifiers**: Access via secure links and WebAuthn  
- ✅ **Agent teams**: WASM-based modules automate task splitting, reminders, and load balancing  
- ✅ **Ephemeral by design**: Rooms and tasks auto-delete on completion  
- ✅ **Federated hosting**: Users can self-host or join community-run nodes  
- ✅ **No mobile apps or telemetry**: Web-only, works in private browsers, no tracking  

---

## **3. Release Milestones**

---

### **M0: E2EE Room Core (Alpha)**  
*Secure, ephemeral rooms for encrypted task creation and messaging*

#### **User Stories & Acceptance Criteria (Gherkin)**

**As a** coordinator in a volunteer network  
**I want** to create an encrypted room for planning a community event  
**So that** only invited participants can access the details  

```gherkin
Scenario: Create an E2EE room
  Given I am on the Weave.us homepage
  When I click "New Room"
  Then a new cryptographic identity is generated using WebAuthn
  And a unique room ID is displayed (e.g., weave.us/r/abc123)
  And the room is configured for end-to-end encryption using Megolm
  And no personal information is stored locally or on any server
```

```gherkin
Scenario: Join an E2EE room
  Given I have a valid room ID (weave.us/r/abc123)
  When I navigate to the URL
  Then I am prompted to authenticate using WebAuthn
  And my device establishes a secure session with existing members
  And I can receive and decrypt previously sent messages
  And my identity remains anonymous to the server
```

```gherkin
Scenario: Send an encrypted message
  Given I am a member of an E2EE room
  When I send a message "Distribute flyers at 10 AM"
  Then the message is encrypted before leaving my device
  And only room members can decrypt it
  And the server logs only encrypted blobs and timestamps (no content or sender metadata)
```

---

### **M1: Task Management & Agent Orchestration (Beta)**  
*Create, assign, and automate tasks with privacy-preserving agents*

#### **User Stories & Acceptance Criteria**

**As a** team lead in a distributed project  
**I want** to split a task into subtasks and assign them automatically  
**So that** workload is balanced and follow-ups are handled without manual effort  

```gherkin
Scenario: Create a task with subtasks
  Given I am in an E2EE room
  When I create a task "Prepare event materials"
    And specify "Split into: design, print, distribute"
  Then the task is parsed and split into three subtasks
  And each subtask is encrypted and stored in the room
  And no plaintext is exposed to the server or agent runtime
```

```gherkin
Scenario: Assign tasks based on availability
  Given there are three subtasks and two active members
  When I trigger "Auto-assign"
  Then an agent analyzes recent activity (locally, client-side)
  And assigns subtasks to members with lowest current load
  And encrypted assignment events are sent to the room
  And no central service tracks user behavior
```

```gherkin
Scenario: Receive a reminder for an uncompleted task
  Given I have an assigned task "Print flyers" due in 1 hour
  When the deadline approaches and the task is incomplete
  Then an encrypted reminder is sent to my device
  And the agent only processes the reminder trigger—not the task content
  And no data is retained after delivery
```

---

### **M2: Agent Teams & WASM Sandboxing (Beta+)**  
*Run autonomous, secure agents in isolated environments*

#### **User Stories & Acceptance Criteria**

**As a** developer integrating automation  
**I want** to deploy a custom agent module that handles recurring tasks  
**So that** routine coordination happens without constant oversight  

```gherkin
Scenario: Load a trusted agent module
  Given I am in a room with admin privileges
  When I upload a WASM module (e.g., "reminder-bot.wasm")
  Then the module is loaded in a WebContainer sandbox
  And it has no access to persistent storage or host APIs
  And it can only respond to encrypted room events
```

```gherkin
Scenario: Agent processes a task event
  Given an agent is active in the room
  When an encrypted task assignment is sent
  Then the agent receives the ciphertext
  And attempts decryption using its ephemeral session key
  And if successful, schedules a reminder
  And deletes all state after execution
```

```gherkin
Scenario: Unload and destroy an agent
  Given an agent is running
  When the room completes all tasks
  Then all agent instances are terminated
  And WASM memory is zeroed
  And no code or data persists on any node
```

---

### **M3: Federation & Self-Hosting (RC)**  
*Enable decentralized hosting and cross-node sync*

#### **User Stories & Acceptance Criteria**

**As a** community organizer  
**I want** to host my own Weave.us node for our group  
**So that** we control our infrastructure and sync securely with partners  

```gherkin
Scenario: Join a self-hosted node
  Given I operate a Weave.us node at node.myorg.org
  When I configure a room to use my node
  Then all room events are routed through node.myorg.org
  And federation with other nodes uses encrypted Matrix-like sync
  And no node can read plaintext or correlate user activity
```

```gherkin
Scenario: Sync tasks across federated nodes
  Given two groups on different nodes are collaborating
  When a task is updated in the shared room
  Then the change is propagated via encrypted P2P sync
  And each node only stores encrypted shards of state
  And consistency is maintained via client-verified Merkle proofs
```

---

### **M4: Burn-After-Use & Ephemeral Mode (Stable)**  
*Automatically delete all data after task completion*

#### **User Stories & Acceptance Criteria**

**As a** user concerned about data retention  
**I want** rooms and tasks to self-destruct after completion  
**So that** no residual data remains anywhere  

```gherkin
Scenario: Room auto-deletes after completion
  Given all tasks in a room are marked complete
  When the TTL expires (e.g., 7 days)
  Then all session keys are wiped from clients
  And the room state is deleted from all nodes
  And the room URL becomes invalid
```

```gherkin
Scenario: Manual burn command
  Given I am in a room
  When I send "!burn"
  Then a signed destruction event is broadcast
  And all members wipe local state
  And nodes mark shards for deletion
  And no recovery is possible
```

---

## **4. Non-Functional Requirements**

| Category | Requirement |
|--------|-------------|
| **Security** | E2EE via Olm/Megolm (→ MLS), WebAuthn for key derivation, no plaintext on server |
| **Privacy** | No user IDs, no IP logging, no analytics, no tracking |
| **Availability** | Works offline; sync resumes when online |
| **Performance** | <500ms crypto ops in browser; agent startup <1s |
| **Compliance** | Designed to meet GDPR, CCPA data minimization principles |

---

## **5. Success Metrics**

| Metric | Target |
|-------|--------|
| Time to first encrypted message | <15 seconds |
| Agent task assignment accuracy | >90% |
| Room creation to deletion (avg) | 7 days |
| Client-side crypto failure rate | <0.1% |
| Federated sync latency (P95) | <2s |

---

## **6. Out of Scope**
- Mobile applications
- Email/SMS notifications
- File attachments (future)
- Voice/video calling
- Public directories or search

---

Weave.us is built for **privacy, simplicity, and autonomy**—not scale, surveillance, or lock-in.  
Every feature is evaluated by: *Does this reduce trust in infrastructure? Does it minimize data? Does it empower the user?*  

If not, it doesn’t ship.
