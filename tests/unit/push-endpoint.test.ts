// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  isBlockedAddress,
  checkPushEndpoint,
} from "../../server/push-endpoint";

/**
 * The relay POSTs to whatever URL a client hands it.
 *
 * Unchecked, that is a request the relay makes on the client's behalf from
 * inside the network it is deployed in, to an address the client could not
 * reach itself. The response never returns to the client, so it is blind, but
 * reachability is inferable from timing and anything acting on an
 * unauthenticated POST can still be triggered. The cloud metadata service at
 * 169.254.169.254 is the classic target, because it answers unauthenticated
 * requests with credentials.
 */

describe("addresses the relay must never dial", () => {
  const blocked = [
    ["loopback", "127.0.0.1"],
    ["loopback, anywhere in the /8", "127.99.4.7"],
    ["cloud metadata", "169.254.169.254"],
    ["link-local", "169.254.1.1"],
    ["private 10/8", "10.0.0.1"],
    ["private 172.16/12, low edge", "172.16.0.1"],
    ["private 172.16/12, high edge", "172.31.255.254"],
    ["private 192.168/16", "192.168.1.1"],
    ["this network", "0.0.0.0"],
    ["carrier NAT", "100.64.0.1"],
    ["IETF protocol assignments", "192.0.0.1"],
    ["benchmarking", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unspecified", "::"],
    ["IPv6 unique local", "fd00::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 multicast", "ff02::1"],
  ] as const;

  for (const [what, address] of blocked) {
    it(`blocks ${what} (${address})`, () => {
      expect(isBlockedAddress(address)).toBe(true);
    });
  }

  it("blocks a private address wearing an IPv6 coat", () => {
    // ::ffff:127.0.0.1 reaches the same host as 127.0.0.1. A filter that only
    // reads the outer notation waves it through.
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:10.0.0.1")).toBe(true);
  });

  it("blocks the hex form of a mapped address", () => {
    // ::ffff:7f00:1 is 127.0.0.1 written as two hex groups. Same host, and it
    // does not contain a single dot to pattern-match on.
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true);
    expect(isBlockedAddress("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
  });

  it("blocks anything it cannot classify", () => {
    // The endpoint comes from an unauthenticated client. An address this does
    // not understand is a reason to refuse, not a reason to try.
    expect(isBlockedAddress("not-an-address")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
    expect(isBlockedAddress("999.999.999.999")).toBe(true);
  });

  it("allows ordinary public addresses", () => {
    // The guard is worthless if it also blocks the real push services.
    for (const ok of ["1.1.1.1", "8.8.8.8", "13.107.42.14", "2606:4700::1111"]) {
      expect(isBlockedAddress(ok), `${ok} should be allowed`).toBe(false);
    }
  });

  it("does not block a public address that merely starts with a blocked octet", () => {
    // 172.15 and 172.32 sit outside the private range, and 100.128 outside
    // carrier NAT. An off-by-one here silently breaks real endpoints.
    expect(isBlockedAddress("172.15.0.1")).toBe(false);
    expect(isBlockedAddress("172.32.0.1")).toBe(false);
    expect(isBlockedAddress("100.128.0.1")).toBe(false);
    expect(isBlockedAddress("11.0.0.1")).toBe(false);
  });
});

describe("checking an endpoint before it is stored", () => {
  it("accepts a real push service URL", () => {
    const r = checkPushEndpoint(
      "https://fcm.googleapis.com/fcm/send/abc123:def456",
    );
    expect(r.ok).toBe(true);
  });

  it("refuses anything that is not https", () => {
    // Every real Web Push service is public HTTPS. Allowing other schemes buys
    // nothing and opens every protocol Node can speak.
    for (const bad of [
      "http://push.example/x",
      "file:///etc/passwd",
      "ftp://push.example/x",
    ]) {
      const r = checkPushEndpoint(bad);
      expect(r.ok, `${bad} should be refused`).toBe(false);
    }
  });

  it("refuses a literal address that is not publicly routable", () => {
    for (const bad of [
      "https://127.0.0.1/x",
      "https://169.254.169.254/latest/meta-data/",
      "https://10.0.0.1/x",
      "https://[::1]/x",
      "https://[::ffff:127.0.0.1]/x",
    ]) {
      const r = checkPushEndpoint(bad);
      expect(r.ok, `${bad} should be refused`).toBe(false);
    }
  });

  it("refuses credentials in the URL", () => {
    expect(checkPushEndpoint("https://user:pass@push.example/x").ok).toBe(false);
  });

  it("refuses something that is not a URL at all", () => {
    expect(checkPushEndpoint("not a url").ok).toBe(false);
    expect(checkPushEndpoint("").ok).toBe(false);
  });

  it("allows a hostname without resolving it", () => {
    // Resolution belongs at request time. An answer taken now is stale by the
    // time anything is sent, and resolving a name an unauthenticated client
    // chose is itself work the client gets to command.
    const r = checkPushEndpoint("https://push.example.test/x");
    expect(r.ok).toBe(true);
  });

  it("says why it refused", () => {
    const r = checkPushEndpoint("http://push.example/x");
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.reason).toContain("https");
  });
});
