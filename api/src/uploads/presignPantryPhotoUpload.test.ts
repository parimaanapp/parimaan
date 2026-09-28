import { randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from 'vitest';
import { PANTRY_PHOTO_PRESIGN_EXPIRY_SECONDS, presignPantryPhotoUpload } from './presignPantryPhotoUpload.js';

const s3 = new S3Client({ region: 'ap-south-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } });
const sub = '11111111-2222-3333-4444-555555555555';
const now = new Date('2026-09-28T10:00:00.000Z');

describe('presignPantryPhotoUpload', () => {
  it('presigns a PUT to the uploads bucket for a caller-scoped key, and returns that key', async () => {
    const id = randomUUID();
    const result = await presignPantryPhotoUpload(s3, 'parimaan-uploads-test', sub, id, now);
    const url = new URL(result.url);

    expect(result.s3Key).toBe(`pantry-photos/${sub}/${id}.jpg`);
    expect(url.hostname).toContain('parimaan-uploads-test');
    expect(decodeURIComponent(url.pathname)).toBe(`/${result.s3Key}`);
  });

  it('expires in 5 minutes (D4), and reports the same instant as expiresAt', async () => {
    const result = await presignPantryPhotoUpload(s3, 'parimaan-uploads-test', sub, randomUUID(), now);

    expect(PANTRY_PHOTO_PRESIGN_EXPIRY_SECONDS).toBe(300);
    expect(new URL(result.url).searchParams.get('X-Amz-Expires')).toBe('300');
    expect(result.expiresAt).toBe('2026-09-28T10:05:00.000Z');
  });

  it('signs the Content-Type header, so the PUT cannot be repurposed for another file type', async () => {
    const result = await presignPantryPhotoUpload(s3, 'parimaan-uploads-test', sub, randomUUID(), now);
    const signedHeaders = new URL(result.url).searchParams.get('X-Amz-SignedHeaders') ?? '';

    expect(signedHeaders.split(';')).toContain('content-type');
  });
});
