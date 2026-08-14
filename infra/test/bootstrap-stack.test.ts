import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BootstrapStack } from '../stacks/bootstrap-stack';

describe('BootstrapStack', () => {
  const synth = (envName: 'dev' | 'prod'): Template => {
    const app = new cdk.App();
    const stack = new BootstrapStack(app, `Parimaan-${envName}-Bootstrap`, { envName });
    return Template.fromStack(stack);
  };

  it('synthesizes without error', () => {
    expect(() => synth('dev')).not.toThrow();
  });

  it('declares no resources yet (Sprint 0 is an empty skeleton)', () => {
    const template = synth('dev').toJSON() as { Resources?: Record<string, unknown> };
    expect(Object.keys(template.Resources ?? {})).toHaveLength(0);
  });

  it('does not embed an account id or region literal in the synthesized template', () => {
    const json = JSON.stringify(synth('prod').toJSON());
    expect(json).not.toMatch(/\d{12}/);
    expect(json).not.toMatch(/ap-south-1/);
  });
});
