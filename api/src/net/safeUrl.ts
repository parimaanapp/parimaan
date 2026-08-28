import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** `https` only — not even `http` (E2E_MVP_PLAN.md §13.2.10). */
export const ALLOWED_PROTOCOL = 'https:';
const DEFAULT_PORT = '443';

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

export interface SafeUrlDeps {
  /** Injectable DNS resolver — defaults to a real `dns.promises.lookup` requesting every address (`all: true`), never just the first. Tests inject a stub to simulate a hostname resolving to a private address (the DNS-rebinding shape) without a real network lookup. */
  resolveHostname?: (hostname: string) => Promise<ResolvedAddress[]>;
}

const defaultResolveHostname = (hostname: string): Promise<ResolvedAddress[]> => lookup(hostname, { all: true, verbatim: true });

/** Strips the `[...]` brackets WHATWG URL wraps an IPv6 host in (`new URL('https://[::1]/').hostname === '[::1]'`) before an `isIP` check — without this, a bracketed IPv6 literal falsely reads as "not an IP literal" and would fall through to DNS resolution instead of being rejected at this gate directly (rejected either way, since resolving a bracketed literal as a hostname fails — but rejecting it here is the correct, direct reason). */
const stripIpv6Brackets = (hostname: string): string => hostname.replace(/^\[|\]$/g, '');

/** One private/reserved IPv4 range, as an (a, b-range) test against the address's first two octets — table-driven rather than a long if-chain, to keep `isIpv4PrivateOrReserved` itself simple. */
interface Ipv4Range {
  readonly a: number;
  readonly bMin: number;
  readonly bMax: number;
}

const IPV4_PRIVATE_RANGES: readonly Ipv4Range[] = [
  { a: 0, bMin: 0, bMax: 255 }, // "this network"
  { a: 10, bMin: 0, bMax: 255 }, // RFC1918
  { a: 127, bMin: 0, bMax: 255 }, // loopback
  { a: 100, bMin: 64, bMax: 127 }, // CGNAT, RFC6598 (100.64.0.0/10)
  { a: 169, bMin: 254, bMax: 254 }, // link-local (includes the 169.254.169.254 cloud metadata endpoint)
  { a: 172, bMin: 16, bMax: 31 }, // RFC1918
  { a: 192, bMin: 168, bMax: 168 }, // RFC1918
  { a: 192, bMin: 0, bMax: 0 }, // IETF protocol assignments / documentation (192.0.0.0/24, 192.0.2.0/24)
  { a: 198, bMin: 18, bMax: 19 }, // benchmarking (198.18.0.0/15)
  { a: 198, bMin: 51, bMax: 51 }, // documentation (198.51.100.0/24)
  { a: 203, bMin: 0, bMax: 0 }, // documentation (203.0.113.0/24)
];

const isIpv4PrivateOrReserved = (parts: readonly [number, number, number, number]): boolean => {
  if (parts.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) return true; // malformed — treat as unsafe
  const [a, b] = parts;
  if (a >= 224) return true; // multicast (224-239), reserved (240-255), broadcast
  return IPV4_PRIVATE_RANGES.some((range) => range.a === a && b >= range.bMin && b <= range.bMax);
};

/**
 * Expands any valid textual IPv6 address (including a `::` zero-run and an
 * embedded dotted-decimal IPv4 tail) into its 8 numeric 16-bit groups —
 * `security-reviewer` flagged that the original string-prefix-matching
 * approach (checking e.g. `normalized.startsWith('fc')`) cannot reliably
 * distinguish address forms that share a textual prefix but differ in a
 * later group (a real public `2001:4860:4860::8888` vs. the Teredo tunnel
 * prefix `2001:0000::/32`, both starting with `"2001:"`) — range checks
 * need actual numeric group values, not string prefixes. Returns `null`
 * for anything that doesn't parse as a well-formed address.
 */
const expandIpv6Groups = (address: string): number[] | null => {
  const withoutZoneId = address.split('%')[0]!;
  const halves = withoutZoneId.split('::');
  if (halves.length > 2) return null;

  const parseHexGroups = (segment: string): number[] | null => {
    if (segment === '') return [];
    const tokens = segment.split(':');
    const lastToken = tokens[tokens.length - 1]!;
    if (lastToken.includes('.')) {
      // A trailing embedded IPv4 in dotted-decimal form (e.g. "::a.b.c.d" or "::ffff:a.b.c.d").
      const octets = lastToken.split('.').map(Number);
      if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
      const hexTokens = tokens.slice(0, -1);
      const hexGroups = hexTokens.map((t) => parseInt(t, 16));
      if (hexGroups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
      return [...hexGroups, (octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!];
    }
    const groups = tokens.map((t) => parseInt(t, 16));
    return groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff) ? null : groups;
  };

  if (halves.length === 1) {
    const groups = parseHexGroups(halves[0]!);
    return groups !== null && groups.length === 8 ? groups : null;
  }

  const head = parseHexGroups(halves[0]!);
  const tail = parseHexGroups(halves[1]!);
  if (head === null || tail === null) return null;
  const zerosToInsert = 8 - head.length - tail.length;
  return zerosToInsert < 0 ? null : [...head, ...new Array<number>(zerosToInsert).fill(0), ...tail];
};

/** One private/reserved/tunnelling IPv6 prefix, checked against the address's leading groups by numeric value rather than string prefix. */
interface Ipv6Range {
  readonly groups: readonly number[]; // the leading groups that must match exactly
}

const IPV6_TUNNEL_AND_RESERVED_RANGES: readonly Ipv6Range[] = [
  { groups: [0x2001, 0x0000] }, // Teredo tunnelling (2001:0000::/32) — distinct from real public 2001:xxxx:: space
  { groups: [0x2002] }, // 6to4 tunnelling (2002::/16) — the embedded IPv4 is attacker-influenced via the address itself
  { groups: [0x0064, 0xff9b] }, // NAT64 well-known prefix (64:ff9b::/96)
];

/** The three private/reserved ranges checkable from just the leading group's value, as (min, max) bounds — link-local (fe80::/10), unique local (fc00::/7), multicast (ff00::/8). */
const IPV6_LEADING_GROUP_RANGES: readonly { readonly min: number; readonly max: number }[] = [
  { min: 0xfe80, max: 0xfebf },
  { min: 0xfc00, max: 0xfdff },
  { min: 0xff00, max: 0xffff },
];

/** An IPv4-mapped (`::ffff:a.b.c.d`) or deprecated IPv4-compatible (`::a.b.c.d`) address's groups — `null` if `groups` isn't one of those two shapes. */
const embeddedIpv4Octets = (groups: readonly number[]): [number, number, number, number] | null => {
  const isIpv4Embedded = groups.slice(0, 5).every((value) => value === 0) && (groups[5] === 0 || groups[5] === 0xffff);
  if (!isIpv4Embedded) return null;
  const highGroup = groups[6]!;
  const lowGroup = groups[7]!;
  return [(highGroup >> 8) & 0xff, highGroup & 0xff, (lowGroup >> 8) & 0xff, lowGroup & 0xff];
};

const isIpv6PrivateOrReserved = (address: string): boolean => {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true; // loopback / unspecified

  const groups = expandIpv6Groups(normalized);
  if (groups === null) return true; // unparseable — treat as unsafe, never pass through

  const [first] = groups;
  if (first === undefined) return true;
  if (IPV6_LEADING_GROUP_RANGES.some((range) => first >= range.min && first <= range.max)) return true;
  if (IPV6_TUNNEL_AND_RESERVED_RANGES.some((range) => range.groups.every((value, index) => groups[index] === value))) return true;

  const embeddedOctets = embeddedIpv4Octets(groups);
  return embeddedOctets !== null && isIpv4PrivateOrReserved(embeddedOctets);
};

/** Checked for every DNS-resolved address, never just the first (E2E_MVP_PLAN.md §13.2.10). Treats anything not recognisably a plain IPv4/IPv6 address as unsafe rather than passing it through. */
export const isPrivateOrReservedAddress = (address: string): boolean => {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    return parts.length !== 4 || isIpv4PrivateOrReserved(parts as [number, number, number, number]);
  }
  if (version === 6) {
    return isIpv6PrivateOrReserved(address);
  }
  return true;
};

export interface ValidatedUrl {
  readonly url: URL;
  /** The first DNS-resolved, already-validated address — used to pin the outbound connection (closing the DNS-rebinding window between this validation and the actual connect, E2E_MVP_PLAN.md §13.2.10). */
  readonly address: string;
}

/**
 * The full SSRF gate: scheme allowlist (`https` only), no credentials in
 * the URL, no non-default port, the host must be a name rather than an IP
 * literal, and — the control most attacks actually turn on — an explicit
 * DNS resolution with EVERY returned address checked against private/
 * loopback/link-local/CGNAT/reserved ranges, not just the first one a
 * naive implementation might check.
 *
 * Returns `null` on any rejection, **never throws, and never distinguishes
 * *why*** a URL was rejected (malformed vs. wrong scheme vs. private
 * address vs. a real DNS failure) — every caller must treat every
 * rejection identically. Surfacing *which* check failed would itself be
 * an internal-network oracle (E2E_MVP_PLAN.md §13.2.10's own point: "an
 * error never contains... a resolved IP").
 */
/** The structural half of the gate — everything checkable without a DNS round trip: scheme, credentials, port, IP-literal host. */
const passesStructuralChecks = (url: URL): boolean =>
  url.protocol === ALLOWED_PROTOCOL &&
  url.username === '' &&
  url.password === '' &&
  (url.port === '' || url.port === DEFAULT_PORT) &&
  isIP(stripIpv6Brackets(url.hostname)) === 0;

export const validateSafeUrl = async (rawUrl: string, deps: SafeUrlDeps = {}): Promise<ValidatedUrl | null> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!passesStructuralChecks(url)) return null;

  const resolveHostname = deps.resolveHostname ?? defaultResolveHostname;
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveHostname(url.hostname);
  } catch {
    return null;
  }
  if (addresses.length === 0) return null;
  if (addresses.some((candidate) => isPrivateOrReservedAddress(candidate.address))) return null;

  return { url, address: addresses[0]!.address };
};
