import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { OnModuleDestroy } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  StorageObjectNotFoundError,
  StorageService,
  StoredObjectInfo,
} from './storage.service';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** Only for S3-compatible services (MinIO, LocalStack). Leave unset for AWS. */
  endpoint?: string;
  /** MinIO and friends need `bucket` in the URL path, not the host name. */
  forcePathStyle?: boolean;
}

/**
 * WHAT: Stores files in an AWS S3 bucket. The PRODUCTION backend
 * (STORAGE_DRIVER=s3).
 *
 * WHY S3: object storage is durable (designed for 99.999999999% durability),
 * shared by every server instance, and independent of any one container's
 * lifetime - which is what makes it possible to run TaskForge on more than one
 * server or redeploy without losing uploads.
 *
 * CREDENTIALS are deliberately NOT read here. The AWS SDK finds them itself
 * through its "default credential provider chain": the environment variables
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, a shared credentials file, or - the
 * best option in production - an IAM ROLE attached to the server/container, which
 * needs no keys at all. TaskForge's code and .env therefore never hold a secret
 * for S3. Grant that role only s3:PutObject, s3:GetObject, s3:DeleteObject
 * and s3:ListBucket on this one bucket (least privilege).
 *
 * The bucket should be PRIVATE (Block Public Access on). Files are never
 * fetched by the browser from S3 directly: they stream through the API, which
 * checks the user's permission on every download. See docs/phase-13-concepts.md
 * for the trade-off versus pre-signed URLs.
 */
export class S3StorageService
  extends StorageService
  implements OnModuleDestroy
{
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3StorageOptions, client?: S3Client) {
    super();
    this.bucket = options.bucket;
    this.client =
      client ??
      new S3Client({
        region: options.region,
        endpoint: options.endpoint,
        forcePathStyle: options.forcePathStyle,
      });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ContentLength: data.length,
      }),
    );
  }

  async get(key: string): Promise<Readable> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) {
        throw new StorageObjectNotFoundError(key);
      }
      // In Node.js the SDK returns the body as a readable stream.
      return response.Body as unknown as Readable;
    } catch (error) {
      if ((error as { name?: string }).name === 'NoSuchKey') {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    // S3 reports success even when the key does not exist, which is exactly
    // the "deleting nothing is fine" behaviour the contract asks for.
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async *listKeys(prefix: string): AsyncIterable<StoredObjectInfo> {
    let continuationToken: string | undefined;
    do {
      // S3 returns at most 1000 keys per call; the token asks for the next page.
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key && object.LastModified) {
          yield { key: object.Key, lastModified: object.LastModified };
        }
      }
      continuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }
}
