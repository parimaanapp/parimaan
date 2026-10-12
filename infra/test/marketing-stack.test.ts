import { describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { MarketingStack } from '../stacks/marketing-stack';

const FAKE_CERT_ARN =
  'arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000';

describe('MarketingStack', () => {
  const synth = (context: Record<string, string> = {}): Template => {
    const app = new cdk.App({ context });
    return Template.fromStack(new MarketingStack(app, 'Parimaan-dev-Marketing', { envName: 'dev' }));
  };

  it('synthesizes without error', () => {
    expect(() => synth()).not.toThrow();
  });

  it('serves the site from a private, encrypted, TLS-only bucket — never a public bucket', () => {
    const template = synth();
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.anyValue(),
      }),
    });
    // enforceSSL materialises as a deny-insecure-transport bucket policy statement.
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('puts exactly one CloudFront distribution in front, reachable only via an origin access control', () => {
    const template = synth();
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });

  it('answers unknown paths with the branded 404 page, not an S3 XML error', () => {
    synth().hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 404, ResponsePagePath: '/404.html' }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 404, ResponsePagePath: '/404.html' }),
        ]),
      }),
    });
  });

  it('attaches a strict security-headers policy: HSTS, nosniff, DENY framing, and a no-script CSP', () => {
    synth().hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({ Override: true }),
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: 'DENY', Override: true },
          ContentSecurityPolicy: {
            Override: true,
            ContentSecurityPolicy: Match.stringLikeRegexp("default-src 'self'.*script-src 'none'.*frame-ancestors 'none'"),
          },
        }),
      }),
    });
  });

  it('has no custom domain until both a domain and a certificate are supplied — the default CloudFront URL works on its own', () => {
    const noDomain = synth();
    noDomain.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.not(Match.objectLike({ Aliases: Match.anyValue() })),
    });

    const domainOnly = synth({ marketingDomain: 'www.parimaan.app' });
    domainOnly.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.not(Match.objectLike({ Aliases: Match.anyValue() })),
    });
  });

  it('attaches the domain and the us-east-1 certificate once both are supplied', () => {
    synth({ marketingDomain: 'www.parimaan.app', marketingCertArn: FAKE_CERT_ARN }).hasResourceProperties(
      'AWS::CloudFront::Distribution',
      {
        DistributionConfig: Match.objectLike({
          Aliases: ['www.parimaan.app'],
          ViewerCertificate: Match.objectLike({
            AcmCertificateArn: FAKE_CERT_ARN,
            SslSupportMethod: 'sni-only',
          }),
        }),
      },
    );
  });

  it('stores web fonts as font/woff2, not the deployment helper\'s octet-stream fallback', () => {
    synth().hasResourceProperties('Custom::CDKBucketDeployment', {
      SystemMetadata: Match.objectLike({ 'content-type': 'font/woff2' }),
      Exclude: ['*'],
      Include: ['fonts/*.woff2'],
    });
  });

  it('publishes the values a human needs for the one-time DNS step as stack outputs', () => {
    const outputs = synth().findOutputs('*');
    expect(Object.keys(outputs)).toEqual(
      expect.arrayContaining(['DistributionDomainName', 'DistributionId', 'SiteBucketName']),
    );
  });
});
