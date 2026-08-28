import { describe, expect, it } from 'vitest';
import { loadAiConfig } from './config.js';

const validEnv = {
  GEMINI_API_KEY_SECRET_ARN: 'arn:aws:secretsmanager:ap-south-1:123456789012:secret:parimaan/gemini-api-key-abc123',
};

describe('loadAiConfig', () => {
  it('parses a fully-populated env into an AiConfig', () => {
    const config = loadAiConfig(validEnv);
    expect(config).toEqual({ geminiApiKeySecretArn: validEnv.GEMINI_API_KEY_SECRET_ARN });
  });

  it('throws naming GEMINI_API_KEY_SECRET_ARN when it is missing', () => {
    expect(() => loadAiConfig({})).toThrow(/GEMINI_API_KEY_SECRET_ARN/);
  });

  it('throws when GEMINI_API_KEY_SECRET_ARN is an empty string', () => {
    expect(() => loadAiConfig({ GEMINI_API_KEY_SECRET_ARN: '' })).toThrow(/GEMINI_API_KEY_SECRET_ARN/);
  });
});
