import { describe, expect, it } from 'vitest';
import { isPrivateOrReservedAddress, validateSafeUrl } from './safeUrl.js';

/** A stub resolver returning a fixed set of addresses, so tests never depend on real DNS. */
const resolvesTo = (...addresses: string[]) => async (_hostname: string) =>
  addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

const PUBLIC_ADDRESS = '93.184.216.34'; // example.com's real, stable public address

describe('validateSafeUrl — scheme, credentials, port, IP-literal-host gates', () => {
  it.each(['http://example.com/', 'file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/'])(
    'rejects a non-https scheme: %s',
    async (url) => {
      expect(await validateSafeUrl(url, { resolveHostname: resolvesTo(PUBLIC_ADDRESS) })).toBeNull();
    },
  );

  it('rejects credentials embedded in the URL', async () => {
    expect(await validateSafeUrl('https://user:pass@example.com/', { resolveHostname: resolvesTo(PUBLIC_ADDRESS) })).toBeNull();
  });

  it('rejects a non-default port', async () => {
    expect(await validateSafeUrl('https://example.com:8443/', { resolveHostname: resolvesTo(PUBLIC_ADDRESS) })).toBeNull();
  });

  it('accepts the default port written out explicitly', async () => {
    expect(await validateSafeUrl('https://example.com:443/', { resolveHostname: resolvesTo(PUBLIC_ADDRESS) })).not.toBeNull();
  });

  it('rejects a malformed URL rather than throwing', async () => {
    expect(await validateSafeUrl('not a url at all', {})).toBeNull();
  });

  it.each(['https://169.254.169.254/latest/meta-data/', 'https://127.0.0.1/', 'https://10.0.0.1/', 'https://192.168.1.1/', 'https://100.64.0.1/'])(
    'rejects an IP-literal host, even a public-looking one is never reached: %s',
    async (url) => {
      // The host is an IP literal — rejected at that gate, before any DNS
      // resolution would even run (§13.2.10: "any host that is an IP
      // literal rather than a name").
      expect(await validateSafeUrl(url, {})).toBeNull();
    },
  );

  it('rejects the IPv6 loopback literal https://[::1]/', async () => {
    expect(await validateSafeUrl('https://[::1]/', {})).toBeNull();
  });
});

describe('validateSafeUrl — DNS resolution against private/reserved ranges', () => {
  it('accepts a hostname resolving to a public address', async () => {
    const result = await validateSafeUrl('https://example.com/recipe', { resolveHostname: resolvesTo(PUBLIC_ADDRESS) });
    expect(result).not.toBeNull();
    expect(result!.address).toBe(PUBLIC_ADDRESS);
    expect(result!.url.href).toBe('https://example.com/recipe');
  });

  it('rejects a hostname resolving to a private address — the DNS-rebinding shape (injected resolver)', async () => {
    expect(await validateSafeUrl('https://evil.example.com/', { resolveHostname: resolvesTo('10.0.0.5') })).toBeNull();
  });

  it('rejects when ANY resolved address is private, not just the first', async () => {
    expect(await validateSafeUrl('https://multi.example.com/', { resolveHostname: resolvesTo(PUBLIC_ADDRESS, '169.254.169.254') })).toBeNull();
  });

  it('rejects when DNS resolution fails', async () => {
    const rejects = async () => {
      throw new Error('NXDOMAIN');
    };
    expect(await validateSafeUrl('https://nonexistent.example.com/', { resolveHostname: rejects })).toBeNull();
  });

  it('rejects when DNS resolution returns no addresses at all', async () => {
    expect(await validateSafeUrl('https://empty.example.com/', { resolveHostname: resolvesTo() })).toBeNull();
  });
});

describe('isPrivateOrReservedAddress', () => {
  it.each(['169.254.169.254', '127.0.0.1', '10.0.0.1', '192.168.1.1', '100.64.0.1', '100.127.255.255', '0.0.0.0', '172.16.0.1', '172.31.255.255', '224.0.0.1'])(
    'flags %s as private/reserved',
    (address) => {
      expect(isPrivateOrReservedAddress(address)).toBe(true);
    },
  );

  it.each(['8.8.8.8', '93.184.216.34', '1.1.1.1', '172.32.0.1', '100.63.255.255', '100.128.0.1'])('accepts %s as public', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(false);
  });

  it.each([
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::169.254.169.254', // deprecated IPv4-compatible form, no "ffff:" prefix
    '2001:0000::1', // Teredo tunnelling (2001:0000::/32) — distinct from a real public 2001:xxxx:: address
    '2002::1', // 6to4 tunnelling (2002::/16)
    '64:ff9b::a9fe:a9fe', // NAT64 well-known prefix, embedding 169.254.169.254
    'ff02::1', // multicast (ff00::/8)
  ])('flags IPv6 %s as private/reserved', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(true);
  });

  it.each(['2001:4860:4860::8888', '::ffff:93.184.216.34', '2001:4860::1'])('accepts IPv6 %s as public — including addresses that merely share a textual prefix with a reserved range', (address) => {
    expect(isPrivateOrReservedAddress(address)).toBe(false);
  });

  it('treats a non-IP string as unsafe rather than passing it through', () => {
    expect(isPrivateOrReservedAddress('not-an-ip')).toBe(true);
  });
});
