/**
 * Validation for push subscription endpoints.
 *
 * The relay POSTs to whatever URL a client hands it. Without a check that is a
 * request the relay makes on the client's behalf, from inside the network the
 * relay is deployed in, to an address the client could not reach itself. The
 * response never goes back to the client, so it is blind, but reachability is
 * still inferable from timing and anything that acts on an unauthenticated
 * POST can still be triggered.
 *
 * Two checks, at two different times, because one time is not enough.
 *
 * At subscribe time the check is syntactic: the scheme must be https, and a
 * literal address must not be one of the ranges below. That rejects the
 * obvious cases cheaply and without a DNS round trip on a path an unauthorised
 * client can drive.
 *
 * At request time the hostname is resolved and every answer is checked, and
 * the socket is then pinned to the address that was checked. Validating a
 * hostname when the subscription arrives and resolving it again later is not a
 * check, because the second answer can differ from the first. That is the
 * whole trick behind DNS rebinding.
 */

import { isIP } from "node:net";

/** Parse a dotted-quad into its four octets, or null if it is not one. */
function ipv4Octets(address: string): [number, number, number, number] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets as [number, number, number, number];
}

/**
 * True for an IPv4 address the relay must never be pointed at.
 *
 * Everything here is either unroutable on the public internet or names
 * something inside the deployment. 169.254.0.0/16 is called out because it
 * holds the cloud metadata service, which is the highest-value target for this
 * class of bug: it answers unauthenticated requests with credentials.
 */
function isBlockedIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (octets === null) return true; // not parseable, so not provably safe
  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8, "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 carrier NAT
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && octets[1] === 0 && octets[2] === 0) return true; // 192.0.0/24
  if (a === 192 && octets[1] === 0 && octets[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast and reserved, includes broadcast

  return false;
}

/** True for an IPv6 address the relay must never be pointed at. */
function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase().split("%")[0]; // drop any zone index

  // An IPv4 address wearing an IPv6 coat still reaches the IPv4 host, so the
  // embedded address is what has to be judged. Both of these forms have been
  // used to walk past filters that only looked at the outer notation.
  const mapped = lower.match(/^(?:::ffff:|64:ff9b::)(.+)$/);
  if (mapped) {
    const inner = mapped[1];
    if (isIP(inner) === 4) return isBlockedIpv4(inner);
    // ::ffff:7f00:1 is 127.0.0.1 written as hex groups.
    const hex = inner.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
      return isBlockedIpv4(dotted);
    }
    return true;
  }

  if (lower === "::" || lower === "::1") return true; // unspecified, loopback
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 link-local
  if (/^ff[0-9a-f]{2}:/.test(lower)) return true; // ff00::/8 multicast
  if (lower.startsWith("2001:db8:")) return true; // documentation

  return false;
}

/**
 * True for any literal address the relay must never connect to.
 *
 * Defaults to blocked for anything it cannot classify. A push endpoint is
 * supplied by an unauthenticated client, so an address this function does not
 * understand is a reason to refuse, not a reason to try.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

export type EndpointCheck =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/**
 * Check a push endpoint before it is stored.
 *
 * Syntactic only. A hostname is not resolved here, because the answer would be
 * stale by the time anything is sent to it, and because resolving a name an
 * unauthenticated client chose is itself work the client gets to command.
 */
export function checkPushEndpoint(endpoint: string): EndpointCheck {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: "not a URL" };
  }

  // Every real Web Push service is public HTTPS. Allowing anything else buys
  // nothing and opens every other protocol Node can speak.
  if (url.protocol !== "https:") {
    return { ok: false, reason: `scheme ${url.protocol} is not https:` };
  }

  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "credentials in the URL" };
  }

  // URL keeps IPv6 literals in brackets.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "") return { ok: false, reason: "no host" };

  // Only judge literals here. A hostname is judged at request time.
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    return { ok: false, reason: `address ${host} is not publicly routable` };
  }

  return { ok: true, url };
}
