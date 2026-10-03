/**
 * The outbound-URL guard: the ONLY sanctioned way for this app to fetch a URL
 * a caller supplied.
 *
 * Why this exists as its own module rather than a regex in a route
 * (`src/app/api/recipes/ingest` used to carry one): a string check cannot
 * answer the question that matters. The question is not "does this look like a
 * private address?" — it is "does this URL, once the network has resolved and
 * followed it, land on an address inside this house?" A public-looking host
 * that 302s to `127.0.0.1` answers "yes" and no amount of prefix matching on
 * the submitted string can see it.
 *
 * So the contract is:
 *
 *   1. SCHEME — `http:`/`https:` only. `file:`, `gopher:`, `ftp:`, `data:` and
 *      friends are refused before anything is opened.
 *   2. SHAPE — a bare hostname must be a real, dotted, public-suffix-bearing
 *      DNS name. A single-label host (`pocketbase`, `hermes-agent-2`) or a
 *      special-use suffix (`.local`, `.internal`, `.localhost`, `.home.arpa`)
 *      is how the compose network is addressed from inside the container, and
 *      it is refused WITHOUT a DNS round-trip.
 *   3. RESOLVED ADDRESS — every address the name resolves to must be public.
 *      The guard judges the ADDRESS, on EVERY redirect hop, never the string.
 *   4. BOUNDS — one deadline for the whole chain, a redirect hop cap, and a
 *      byte cap enforced on the bytes actually read.
 *
 * Rule 3 is the load-bearing one and it has a known, accepted limit: DNS can
 * answer differently between our `lookup()` and the connection `fetch` opens.
 * Re-resolving and re-validating on every hop shrinks that window to a single
 * connection and does not close it; closing it entirely needs a pinned
 * dispatcher (connect to the exact IP we validated), which this module does not
 * do. Anything that treats a fetched page as untrusted input must not rely on
 * this alone.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Only these two. `file:`/`gopher:`/`data:` never reach the network here. */
export const ALLOWED_OUTBOUND_SCHEMES: readonly string[] = ["http:", "https:"];

/** Redirects that may be followed before the chain is refused. */
export const MAX_REDIRECT_HOPS = 3;

/** One deadline for the ENTIRE chain (all hops + all UA retries), not per hop. */
export const DEFAULT_OUTBOUND_TIMEOUT_MS = 15_000;

/** Hard ceiling on the bytes read from a single response body. */
export const MAX_OUTBOUND_BYTES = 5 * 1024 * 1024;

/** 3xx that carry a `Location` we must re-validate. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export type OutboundDenyCode =
  | "invalid_url"
  | "scheme_not_allowed"
  | "credentials_in_url"
  | "blocked_hostname"
  | "private_address"
  | "dns_failed"
  | "bad_redirect"
  | "too_many_redirects"
  | "timeout"
  | "too_large"
  | "http_status"
  | "network_error";

/** A refusal or a transport failure, carrying the status the caller should answer with. */
export class OutboundRequestError extends Error {
  readonly code: OutboundDenyCode;
  readonly status: number;

  constructor(code: OutboundDenyCode, status: number, message: string) {
    super(message);
    this.name = "OutboundRequestError";
    this.code = code;
    this.status = status;
  }
}

// --- Deny rules -------------------------------------------------------------
// Every range below is checked as a byte prefix, so `172.16.0.0/12` really
// covers `172.16` through `172.31` and `fe80::/10` really covers `fe80` through
// `febf` — no dotted-quad arithmetic that a clever literal can slip past.

type Prefix = readonly [string, number];

// IPv4: unspecified/this-network, RFC1918, CGNAT, loopback, link-local (which
// is where cloud metadata lives: 169.254.169.254), IETF/TEST-NET documentation,
// the benchmarking block, multicast, reserved and the broadcast address.
const IPV4_BLOCKED_PREFIXES: readonly Prefix[] = [
  ["0.0.0.0", 8], //        "this network" (RFC 1122) — includes 0.0.0.0
  ["10.0.0.0", 8], //       RFC1918 private
  ["100.64.0.0", 10], //    CGNAT shared address space (RFC 6598)
  ["127.0.0.0", 8], //      loopback
  ["169.254.0.0", 16], //   link-local + cloud metadata
  ["172.16.0.0", 12], //    RFC1918 private
  ["192.0.0.0", 24], //     IETF protocol assignments
  ["192.0.2.0", 24], //     TEST-NET-1
  ["192.88.99.0", 24], //   6to4 relay anycast (deprecated)
  ["192.168.0.0", 16], //   RFC1918 private
  ["198.18.0.0", 15], //    benchmarking
  ["198.51.100.0", 24], //  TEST-NET-2
  ["203.0.113.0", 24], //   TEST-NET-3
  ["224.0.0.0", 4], //      multicast
  ["240.0.0.0", 4], //      reserved (includes the 255.255.255.255 broadcast)
];

// IPv6: the same categories plus the forms that CARRY an IPv4 address inside
// an IPv6 one. `::ffff:127.0.0.1` is loopback wearing an IPv6 costume, and
// `64:ff9b::/96` (NAT64) and `2002::/16` (6to4) embed a v4 address in their
// low 32 bits — all three would otherwise sail past a v6-prefix check.
const IPV6_BLOCKED_PREFIXES: readonly Prefix[] = [
  ["::", 128], //            unspecified
  ["::1", 128], //           loopback
  ["::", 96], //             IPv4-compatible (::a.b.c.d) — deprecated, tunnels to v4
  ["::ffff:0:0", 96], //     IPv4-mapped
  ["64:ff9b::", 96], //      NAT64 well-known prefix
  ["64:ff9b:1::", 48], //    NAT64 local-use prefix
  ["100::", 64], //          discard-only
  ["2001::", 32], //         Teredo (tunneling)
  ["2001:db8::", 32], //     documentation
  ["2002::", 16], //         6to4 (encodes an IPv4 address)
  ["fc00::", 7], //          unique-local
  ["fe80::", 10], //         link-local
  ["fec0::", 10], //         site-local (deprecated)
  ["ff00::", 8], //          multicast
];

/**
 * Special-use suffixes (RFC 6761 + the RFC 8375 home.arpa + the internal
 * names a NAS/Docker estate actually uses). These resolve inside the house or
 * not at all, so they are refused before a DNS round-trip.
 */
const BLOCKED_HOSTNAME_SUFFIXES: readonly string[] = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "private",
  "corp",
  "lan",
  "home",
  "home.arpa",
  "test",
  "invalid",
  "example",
  "onion",
];

const BLOCKED_ADDRESS_MESSAGE =
  "That link points inside the home network, so it can't be imported.";

const DNS_FAILURE_MESSAGE =
  "Could not look up that site's address. Check the link and try again.";

const TIMEOUT_MESSAGE =
  "The site took too long to respond. Try again, or paste the recipe text instead.";

const TOO_LARGE_MESSAGE =
  "That page is bigger than the 5 MB import limit. Try a lighter page, or paste the recipe text.";

// --- Address parsing --------------------------------------------------------

function parseIpv4(text: string): Uint8Array | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const value = Number(parts[i]);
    if (value > 255) return null;
    out[i] = value;
  }
  return out;
}

function parseIpv6(text: string): Uint8Array | null {
  let s = text.trim();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone); // drop a %eth0 zone id
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1);
  if (!s.includes(":")) return null;

  // An embedded IPv4 tail (::ffff:127.0.0.1) becomes two hex groups so the
  // rest of the parser only ever deals with 8×16-bit groups.
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${s.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleColon = s.indexOf("::");
  let head: string[];
  let rest: string[];
  if (doubleColon === -1) {
    head = s.split(":");
    rest = [];
    if (head.length !== 8) return null;
  } else {
    if (s.indexOf("::", doubleColon + 1) !== -1) return null; // two `::` is invalid
    const before = s.slice(0, doubleColon);
    const after = s.slice(doubleColon + 2);
    head = before ? before.split(":") : [];
    rest = after ? after.split(":") : [];
    // `::` stands for at least one zero group, so the literals must not
    // already fill all eight.
    if (head.length + rest.length > 7) return null;
  }

  const groups = [
    ...head,
    ...new Array<string>(8 - head.length - rest.length).fill("0"),
    ...rest,
  ];
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(groups[i])) return null;
    const value = parseInt(groups[i], 16);
    bytes[i * 2] = (value >> 8) & 0xff;
    bytes[i * 2 + 1] = value & 0xff;
  }
  return bytes;
}

type CompiledPrefix = { bytes: Uint8Array; bits: number };

const compile = (prefixes: readonly Prefix[]): CompiledPrefix[] =>
  prefixes.map(([address, bits]) => ({
    bytes: (parseIpv4(address) ?? parseIpv6(address)) as Uint8Array,
    bits,
  }));

const COMPILED_IPV4 = compile(IPV4_BLOCKED_PREFIXES);
const COMPILED_IPV6 = compile(IPV6_BLOCKED_PREFIXES);

function matchesPrefix(address: Uint8Array, prefixes: CompiledPrefix[]): boolean {
  for (const { bytes, bits } of prefixes) {
    if (bytes.length !== address.length) continue;
    let matched = true;
    for (let i = 0; i < bytes.length; i += 1) {
      const remaining = bits - i * 8;
      if (remaining <= 0) break;
      const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff;
      if ((address[i] & mask) !== (bytes[i] & mask)) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

export type IpVerdict = "public" | "blocked" | "not_a_literal";

/**
 * Classify a literal address. A name is NOT an address, so it comes back
 * `not_a_literal` rather than being waved through — the DNS path owns that
 * case, and a false "public" here would be a false all-clear.
 */
export function classifyIpAddress(ip: string): IpVerdict {
  const trimmed = String(ip ?? "").trim();
  if (!trimmed) return "blocked";
  const v4 = parseIpv4(trimmed);
  if (v4) return matchesPrefix(v4, COMPILED_IPV4) ? "blocked" : "public";
  const v6 = parseIpv6(trimmed);
  if (v6) return matchesPrefix(v6, COMPILED_IPV6) ? "blocked" : "public";
  return "not_a_literal";
}

export function isBlockedIpAddress(ip: string): boolean {
  return classifyIpAddress(ip) === "blocked";
}

// --- Hostname shape ---------------------------------------------------------

/**
 * A hostname that is not a literal must at least LOOK like a public DNS name:
 * a dot, legal LDH characters, and no special-use suffix. This is what stops
 * `pocketbase:8090` — the exact address of the family's own database inside the
 * compose network — from ever reaching a socket.
 */
function isPlausibleDnsName(hostname: string): boolean {
  const name = hostname.replace(/\.$/, "").toLowerCase();
  if (!name || name.length > 253) return false;
  if (name.includes("..")) return false;
  if (!/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9_-]*[a-z0-9])?)+$/.test(name)) {
    return false;
  }
  return !BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => name === suffix || name.endsWith(`.${suffix}`));
}

// --- Guard ------------------------------------------------------------------

async function resolveAllAddresses(hostname: string): Promise<string[]> {
  const answers = await dnsLookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
}

/**
 * Parse and validate a caller-supplied URL against every rule above and hand
 * back the parsed URL. Throws `OutboundRequestError` on any refusal.
 */
export async function assertOutboundUrlAllowed(rawUrl: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(String(rawUrl));
  } catch {
    throw new OutboundRequestError(
      "invalid_url",
      400,
      "That doesn't look like a valid link. It should start with http:// or https://",
    );
  }

  if (!ALLOWED_OUTBOUND_SCHEMES.includes(url.protocol)) {
    throw new OutboundRequestError("scheme_not_allowed", 400, "Only HTTP and HTTPS URLs are allowed");
  }
  // `http://public.host@127.0.0.1/` style tricks: the credentials field is a
  // second, unchecked place to hide a target.
  if (url.username || url.password) {
    throw new OutboundRequestError(
      "credentials_in_url",
      400,
      "That link can't be imported. Remove the username and password from it.",
    );
  }

  const verdict = classifyIpAddress(url.hostname);
  if (verdict === "blocked") {
    throw new OutboundRequestError("private_address", 400, BLOCKED_ADDRESS_MESSAGE);
  }
  if (verdict === "not_a_literal") {
    // Fail closed on anything the OS resolver would read as an address but we
    // did not parse as one — an unparsed address is not a licence to connect.
    if (isIP(url.hostname) !== 0) {
      throw new OutboundRequestError("private_address", 400, BLOCKED_ADDRESS_MESSAGE);
    }
    if (!isPlausibleDnsName(url.hostname)) {
      throw new OutboundRequestError("blocked_hostname", 400, BLOCKED_ADDRESS_MESSAGE);
    }

    let addresses: string[];
    try {
      addresses = await resolveAllAddresses(url.hostname);
    } catch {
      throw new OutboundRequestError("dns_failed", 502, DNS_FAILURE_MESSAGE);
    }
    if (addresses.length === 0) {
      throw new OutboundRequestError("dns_failed", 502, DNS_FAILURE_MESSAGE);
    }
    // ANY blocked answer refuses the request: a name that returns one public
    // and one private address is a rebinding attempt, not a coincidence.
    for (const address of addresses) {
      if (isBlockedIpAddress(address)) {
        throw new OutboundRequestError("private_address", 400, BLOCKED_ADDRESS_MESSAGE);
      }
    }
  }

  return url;
}

// --- Body reading -----------------------------------------------------------

async function readBodyCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new OutboundRequestError("too_large", 413, TOO_LARGE_MESSAGE);
  }
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        // Cancel rather than drain: an oversized body is refused, never buffered.
        await reader.cancel().catch(() => {});
        throw new OutboundRequestError("too_large", 413, TOO_LARGE_MESSAGE);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof OutboundRequestError) throw error;
    throw new OutboundRequestError("network_error", 502, "Could not read that page. Try again in a moment.");
  }
  return new TextDecoder("utf-8").decode(chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
}

// --- Fetch ------------------------------------------------------------------

export interface SafeFetchOptions {
  /** Tried in order; a 403 on the final response moves to the next one. */
  userAgents: readonly string[];
  /** Extra request headers (merged after the User-Agent). */
  headers?: Record<string, string>;
  /** One deadline for the whole chain. */
  timeoutMs?: number;
  /** Ceiling on the bytes read from the final body. */
  maxBytes?: number;
  /** Ceiling on redirects followed. */
  maxHops?: number;
  /** An outer signal (client disconnect) that can cut the chain short. */
  signal?: AbortSignal;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  /** The validated URL the body actually came from — NOT the submitted string. */
  url: string;
  /** Redirects followed to get there. */
  hops: number;
  /** Body text; empty when `ok` is false (a non-ok body is never read). */
  text: string;
}

function isAbortLike(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

interface ChainLimits {
  maxBytes: number;
  maxHops: number;
  headers: Record<string, string>;
}

async function followChain(
  startUrl: URL,
  userAgent: string,
  limits: ChainLimits,
  signal: AbortSignal,
): Promise<SafeFetchResult> {
  let current = startUrl;
  let hops = 0;

  for (;;) {
    // Re-validate on EVERY hop. This is the whole point: the check has to see
    // each `Location`, not just the URL the caller typed.
    await assertOutboundUrlAllowed(current);

    let response: Response;
    try {
      response = await fetch(current.href, {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": userAgent,
          Accept: "text/html,application/xhtml+xml,*/*",
          ...limits.headers,
        },
        signal,
      });
    } catch (error) {
      if (isAbortLike(error)) {
        throw new OutboundRequestError("timeout", 504, TIMEOUT_MESSAGE);
      }
      throw new OutboundRequestError(
        "network_error",
        502,
        "Could not reach that site. Check the link and try again.",
      );
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      // Release the socket: a redirect body is never read.
      await response.body?.cancel().catch(() => {});
      if (hops >= limits.maxHops) {
        throw new OutboundRequestError(
          "too_many_redirects",
          502,
          "That link redirected too many times to import. Try the page's final address instead.",
        );
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new OutboundRequestError("bad_redirect", 502, "That site sent a broken redirect.");
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new OutboundRequestError("invalid_url", 400, "That link redirected somewhere invalid.");
      }
      current = next;
      hops += 1;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { ok: false, status: response.status, url: current.href, hops, text: "" };
    }

    const text = await readBodyCapped(response, limits.maxBytes);
    return { ok: true, status: response.status, url: current.href, hops, text };
  }
}

/**
 * Fetch a caller-supplied URL under every rule above and return its body as
 * text, or throw `OutboundRequestError`.
 *
 * The returned `url` is the validated FINAL url — callers should store that
 * rather than the submitted string, so a recipe's provenance can never point at
 * `http://127.0.0.1/`.
 */
export async function safeFetchOutboundText(
  rawUrl: string | URL,
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_OUTBOUND_TIMEOUT_MS;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;

  const limits: ChainLimits = {
    maxBytes: options.maxBytes ?? MAX_OUTBOUND_BYTES,
    maxHops: options.maxHops ?? MAX_REDIRECT_HOPS,
    headers: options.headers ?? {},
  };
  const userAgents =
    options.userAgents.length > 0 ? options.userAgents : ["Consuela-Dashboard/1.0"];

  let start: URL;
  try {
    start = rawUrl instanceof URL ? new URL(rawUrl.href) : new URL(String(rawUrl));
  } catch {
    throw new OutboundRequestError(
      "invalid_url",
      400,
      "That doesn't look like a valid link. It should start with http:// or https://",
    );
  }

  // CDNs routinely 403 a non-browser UA. The original importer retried once
  // with a browser UA; that retry re-runs the WHOLE validated chain, so the
  // second attempt cannot be aimed somewhere the first one was refused.
  for (let i = 0; i < userAgents.length; i += 1) {
    const result = await followChain(start, userAgents[i], limits, signal);
    if (i < userAgents.length - 1 && result.status === 403) continue;
    return result;
  }

  throw new OutboundRequestError("network_error", 502, "Could not reach that site.");
}
