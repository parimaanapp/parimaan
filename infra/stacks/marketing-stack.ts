import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

export interface MarketingStackProps extends cdk.StackProps {
  /** Deployment environment name, supplied via CDK context. */
  readonly envName: 'dev' | 'prod';
}

/**
 * The public marketing site (`marketing/` at the repo root) — a static,
 * zero-JavaScript site on S3 behind CloudFront.
 *
 * Why this exists as its own small stack rather than part of
 * `FrontendStack`: that stack is the *signed-in* Next.js dashboard on
 * Amplify Hosting (SSR, NextAuth, Cognito), and its prod variant is
 * reserved for the bare apex `parimaan.app` (`auth-stack.ts`'s own
 * `webDomain`). This site has no backend, no auth and no build step, and it
 * had to exist before prod does — AWS Activate rejected the application
 * because `www.parimaan.app` was still the registrar's "Launching Soon"
 * placeholder (2026-10-07).
 *
 * **Domain wiring is opt-in, two-phase, by design** — the same shape
 * `FrontendStack`'s `enableCustomDomain` learned the hard way. DNS for
 * `parimaan.app` lives at the registrar (GoDaddy), which has no CNAME/ALIAS
 * at the apex and cannot be written from CDK, so:
 *
 * 1. Deploy with no context: the site is live at the CloudFront default
 *    domain (`DistributionDomainName` output) and nothing else is needed.
 * 2. Request an ACM certificate **in us-east-1** (CloudFront requires that
 *    region regardless of where this stack lives), add its validation CNAME
 *    at the registrar, wait for ISSUED, then redeploy with
 *    `-c marketingDomain=www.parimaan.app -c marketingCertArn=<arn>`.
 *    Supplying only one of the two deliberately does nothing — a
 *    half-configured alias would make CloudFront reject the update.
 *
 * Only `www` is mapped. The apex cannot be a CNAME at this registrar; it is
 * forwarded to `www` by the registrar's own domain-forwarding feature.
 * Nothing here conflicts with `FrontendStack`'s future prod apex mapping —
 * the apex is simply not this stack's concern.
 *
 * Deployed from the `dev` AWS account because that is the only account
 * wired up for the beta (founder decision, 2026-10-06). A static site is
 * trivially redeployable: moving it to prod later is a context change and a
 * DNS edit, not a migration.
 */
export class MarketingStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: MarketingStackProps) {
    super(scope, id, props);

    // Site content is reproducible from git, so the bucket is disposable.
    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    this.distribution = this.createDistribution(props.envName);
    this.deploySiteContent();

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distribution.distributionDomainName,
      description:
        'CloudFront domain. Live immediately; also the CNAME target for www at the DNS registrar.',
    });
    new cdk.CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new cdk.CfnOutput(this, 'SiteBucketName', { value: this.bucket.bucketName });
  }

  /**
   * `exactOptionalPropertyTypes` rejects `Bucket` where CDK's own `IBucket`
   * is expected (`isWebsite: boolean | undefined` vs `boolean`) — the same
   * friction `ApiStackProps`' doc comments describe for `userPool`/`vpc`.
   * The cast is to the interface the CDK constructs below actually declare;
   * it narrows nothing and hides nothing.
   */
  private get siteBucket(): s3.IBucket {
    return this.bucket as s3.IBucket;
  }

  private createDistribution(envName: 'dev' | 'prod'): cloudfront.Distribution {
    const domainName = this.node.tryGetContext('marketingDomain') as string | undefined;
    const certificateArn = this.node.tryGetContext('marketingCertArn') as string | undefined;

    const customDomain =
      domainName && certificateArn
        ? {
            domainNames: [domainName],
            certificate: acm.Certificate.fromCertificateArn(this, 'SiteCertificate', certificateArn),
          }
        : {};

    return new cloudfront.Distribution(this, 'Distribution', {
      comment: `Parimaan ${envName} — marketing site`,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: this.createSecurityHeaders(),
        compress: true,
      },
      // With an origin access control, a missing key comes back as 403, not
      // 404 — map both to the branded page.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: cdk.Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: cdk.Duration.minutes(5) },
      ],
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // PriceClass_200 is the cheapest class that includes India's edges.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      ...customDomain,
    });
  }

  private createSecurityHeaders(): cloudfront.ResponseHeadersPolicy {
    return new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'Parimaan marketing site — security headers',
      securityHeadersBehavior: {
        // The site ships no script, no inline style and no third-party
        // origin, so the CSP can be this tight. If a page ever needs more,
        // loosen it here deliberately rather than at the page.
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            "img-src 'self' data:",
            "style-src 'self'",
            "font-src 'self'",
            "script-src 'none'",
            "connect-src 'none'",
            "form-action 'none'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
          ].join('; '),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        // No includeSubdomains: `dev.parimaan.app` and any future
        // subdomain are separate deployments and must not inherit this.
        strictTransportSecurity: {
          accessControlMaxAge: cdk.Duration.days(365),
          includeSubdomains: false,
          preload: false,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
            override: true,
          },
        ],
      },
    });
  }

  private deploySiteContent(): void {
    const sources = [s3deploy.Source.asset(path.join(__dirname, '..', '..', 'marketing'))];
    const cacheControl = [
      s3deploy.CacheControl.setPublic(),
      s3deploy.CacheControl.maxAge(cdk.Duration.minutes(5)),
    ];

    // Everything except the web fonts. `prune` is safe here because the
    // excluded paths are also excluded from the sync's delete pass.
    const site = new s3deploy.BucketDeployment(this, 'SiteContent', {
      sources,
      destinationBucket: this.siteBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      exclude: ['.DS_Store', '*.map', 'fonts/*.woff2'],
      cacheControl,
      prune: true,
    });

    // The deployment helper's MIME table has no `woff2`, so fonts would be
    // stored as `binary/octet-stream`. Browsers tolerate that, but it is
    // wrong, so the fonts get their own pass with an explicit type. Runs
    // after the main pass so its invalidation sees everything.
    const fonts = new s3deploy.BucketDeployment(this, 'SiteFonts', {
      sources,
      destinationBucket: this.siteBucket,
      exclude: ['*'],
      include: ['fonts/*.woff2'],
      contentType: 'font/woff2',
      cacheControl,
      prune: false,
    });
    fonts.node.addDependency(site);
  }
}
