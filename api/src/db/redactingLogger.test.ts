import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRedactingLogger } from './redactingLogger.js';

describe('createRedactingLogger', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts a known secret out of an error message before logging', () => {
    const logger = createRedactingLogger(['s3cr3t-p@ss']);
    logger.error("query failed: CREATE ROLE parimaan_app LOGIN PASSWORD 's3cr3t-p@ss';");
    expect(errorSpy).toHaveBeenCalledWith(
      "query failed: CREATE ROLE parimaan_app LOGIN PASSWORD '[REDACTED]';",
    );
  });

  it('redacts every occurrence of the secret, not just the first', () => {
    const logger = createRedactingLogger(['dupe']);
    logger.warn('dupe appears twice: dupe');
    expect(warnSpy).toHaveBeenCalledWith('[REDACTED] appears twice: [REDACTED]');
  });

  it('redacts across all four log levels', () => {
    const logger = createRedactingLogger(['topsecret']);
    logger.debug?.('debug topsecret');
    logger.info('info topsecret');
    logger.warn('warn topsecret');
    logger.error('error topsecret');
    expect(debugSpy).toHaveBeenCalledWith('debug [REDACTED]');
    expect(infoSpy).toHaveBeenCalledWith('info [REDACTED]');
    expect(warnSpy).toHaveBeenCalledWith('warn [REDACTED]');
    expect(errorSpy).toHaveBeenCalledWith('error [REDACTED]');
  });

  it('redacts multiple distinct secrets in the same message', () => {
    const logger = createRedactingLogger(['adminpass', 'approlepass']);
    logger.error('conn as adminpass, role password approlepass');
    expect(errorSpy).toHaveBeenCalledWith('conn as [REDACTED], role password [REDACTED]');
  });

  it('leaves a message untouched when no secrets are configured', () => {
    const logger = createRedactingLogger([]);
    logger.error('nothing sensitive here');
    expect(errorSpy).toHaveBeenCalledWith('nothing sensitive here');
  });

  it('ignores empty-string secrets rather than corrupting every message', () => {
    const logger = createRedactingLogger(['', 'real-secret']);
    logger.error('a message with real-secret in it');
    expect(errorSpy).toHaveBeenCalledWith('a message with [REDACTED] in it');
  });

  it('leaves a message with no matching secret unchanged', () => {
    const logger = createRedactingLogger(['unrelated-secret']);
    logger.error('an ordinary error message');
    expect(errorSpy).toHaveBeenCalledWith('an ordinary error message');
  });
});
