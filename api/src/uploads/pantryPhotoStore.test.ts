import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createS3PantryPhotoStore, looksLikeJpeg, MAX_PANTRY_PHOTO_BYTES } from './pantryPhotoStore.js';

const clientWith = (send: (command: unknown) => Promise<unknown>) => ({ send: vi.fn(send) }) as unknown as S3Client & { send: ReturnType<typeof vi.fn> };
const awsError = (name: string, status: number) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

describe('createS3PantryPhotoStore', () => {
  it('head returns the size and content type, addressed to the configured bucket and key', async () => {
    const client = clientWith(() => Promise.resolve({ ContentLength: 1234, ContentType: 'image/jpeg' }));
    const info = await createS3PantryPhotoStore(client, 'bucket-x').head('pantry-photos/a/b.jpg');

    expect(info).toEqual({ contentLength: 1234, contentType: 'image/jpeg' });
    const command = client.send.mock.calls[0]![0] as HeadObjectCommand;
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'bucket-x', Key: 'pantry-photos/a/b.jpg' });
  });

  it.each([
    ['NotFound', 404],
    ['NoSuchKey', 404],
    ['AccessDenied', 403], // S3 answers 403, not 404, for a missing key when the caller lacks s3:ListBucket — which this Lambda deliberately does not have
  ])('head treats %s (%i) as "no such photo" rather than an error', async (name, status) => {
    const client = clientWith(() => Promise.reject(awsError(name, status)));
    await expect(createS3PantryPhotoStore(client, 'b').head('k')).resolves.toBeNull();
  });

  it('head still surfaces a genuine failure (a 500, a network error) instead of pretending the photo is missing', async () => {
    const client = clientWith(() => Promise.reject(awsError('InternalError', 500)));
    await expect(createS3PantryPhotoStore(client, 'b').head('k')).rejects.toThrow('InternalError');
  });

  it('getBytes issues a Range request capped at maxBytes+1, so an object swapped in after the size check can never be read whole', async () => {
    const client = clientWith(() => Promise.resolve({ Body: { transformToByteArray: () => Promise.resolve(new Uint8Array([1, 2, 3])) } }));
    const bytes = await createS3PantryPhotoStore(client, 'b').getBytes('k', 100);

    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    const command = client.send.mock.calls[0]![0] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input.Range).toBe('bytes=0-100');
  });

  it('getBytes fails loudly on an empty body rather than returning nothing', async () => {
    const client = clientWith(() => Promise.resolve({}));
    await expect(createS3PantryPhotoStore(client, 'b').getBytes('k', 10)).rejects.toThrow(/no body/i);
  });

  it('delete issues a DeleteObject for the key', async () => {
    const client = clientWith(() => Promise.resolve({}));
    await createS3PantryPhotoStore(client, 'bucket-x').delete('pantry-photos/a/b.jpg');

    const command = client.send.mock.calls[0]![0] as DeleteObjectCommand;
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect(command.input).toMatchObject({ Bucket: 'bucket-x', Key: 'pantry-photos/a/b.jpg' });
  });
});

describe('looksLikeJpeg', () => {
  it('accepts the JPEG start-of-image marker and rejects everything else, including empty and PNG', () => {
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLikeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
    expect(looksLikeJpeg(new Uint8Array([]))).toBe(false);
  });

  it('the size ceiling is the SD §8.5 500KB', () => {
    expect(MAX_PANTRY_PHOTO_BYTES).toBe(500 * 1024);
  });
});
