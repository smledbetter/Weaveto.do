# Security Policy

## Reporting a vulnerability

Email **weaveto.dosecurity.scribing608@passinbox.com**.

Please do not open a public issue for anything that affects the confidentiality of a room's contents, the integrity of its member list, or the availability of the relay. Everything else is fine in the tracker.

What helps, roughly in order of usefulness:

- What an attacker gains, stated plainly.
- The steps to reproduce it, or the reasoning if it is not reproducible on demand.
- The commit or deployed version you tested.

You do not need a proof of concept. A clear description of a real weakness is worth more than a partial exploit for a theoretical one.

## What to expect

This is a personal project with one maintainer, so there is no team on rotation and no service level to promise. What can be promised is that reports are read, answered, and not ignored, and that you will be told plainly if something is already known or is a deliberate trade rather than a defect.

There is no bounty programme and no money. If you would like credit, say so and it will be given in the fix.

## In scope

The client, the relay, the crypto, and the claims. Specifically:

- Anything that lets the relay, its host, or a network observer read message content, task content, or display names.
- Anything that lets one room member act as another, or read a room they were removed from.
- Anything that lets a client reach the relay's network or filesystem, or make it act on the client's behalf. The push endpoint is the interesting surface here.
- Anything that lets an agent module escape its sandbox, or read data it was not handed.
- **Any claim in `README.md`, `docs/THREAT-MODEL.md`, or the privacy policy that is not true.** A false claim about what the software protects is treated as a vulnerability, because someone will rely on it.

## Out of scope

Not because these do not matter, but because they are known and stated:

- **A compromised device or a malicious browser extension.** The client is the trust root. Anything running in the origin can read what the person can read.
- **The relay learning who is connected to which room, and when.** It routes ciphertext between sockets, so it necessarily knows which sockets. `docs/THREAT-MODEL.md` sets out exactly what it sees.
- **The connecting address.** The relay cannot avoid seeing it and neither can the host in front of it. It is minimized rather than hidden, and gap 9 of the threat model explains what that is worth and what it is not.
- **The offline cache being readable from the same origin.** Its key sits in `localStorage` beside the data. Gap 10 covers this.
- **A room member exfiltrating content they can already read.** Screenshots and copy-paste are a social problem.
- **Denial of service by volume alone**, against a single relay documented as a single process.

If you believe one of these is worse than the documentation says, that is worth reporting. The judgement about severity is the part most likely to be wrong.

## Supported versions

`main`, and whatever is deployed. There are no release branches and no backports.

## Reading first

`docs/THREAT-MODEL.md` is the honest account of what this does and does not defend, including the gaps that are accepted and why. It will save you time, and it is also the document most likely to contain a mistake worth telling me about.
