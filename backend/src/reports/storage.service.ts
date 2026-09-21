import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

interface RequiredConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// S3-compatible storage (AWS S3 / Cloudflare R2 / Supabase Storage — spec
// §58). Used only for reports that were actually emailed, so email_logs
// can prove exactly what was sent (decision log). On-demand downloads that
// were never emailed are generated fresh and never touch this bucket.
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client: S3Client | null = null;

  // Read lazily, not in the constructor: missing/invalid config must only
  // ever fail the "Email Details" call, never crash the whole app at boot
  // (same principle as EmailService.requireConfig()). Without this, a
  // missing STORAGE_* env var built an S3Client with empty-string
  // bucket/credentials that only failed deep inside the AWS SDK at
  // send-time with an opaque error — found in the 2026-09-21 audit.
  private requireConfig(): RequiredConfig {
    const bucket = process.env.STORAGE_BUCKET;
    const accessKeyId = process.env.STORAGE_ACCESS_KEY;
    const secretAccessKey = process.env.STORAGE_SECRET_KEY;
    if (!bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'Report storage is not configured (STORAGE_BUCKET/STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY) — cannot store or retrieve emailed reports.',
      );
    }
    return { bucket, accessKeyId, secretAccessKey, region: process.env.STORAGE_REGION ?? 'auto', endpoint: process.env.STORAGE_ENDPOINT };
  }

  private getClient(config: RequiredConfig): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      });
    }
    return this.client;
  }

  async uploadReport(key: string, body: Buffer, contentType: string): Promise<string> {
    const config = this.requireConfig();
    try {
      await this.getClient(config).send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Never publicly readable — reports contain private employee data
          // (spec §59). Access only via signed URL or authenticated endpoint.
        }),
      );
      return key;
    } catch (err) {
      this.logger.error(`Failed to upload report to storage (key=${key})`, err as Error);
      throw err;
    }
  }

  // Short-lived signed URL for an authenticated user to (re-)download a
  // report that was previously emailed.
  async getSignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    const config = this.requireConfig();
    return getSignedUrl(
      this.getClient(config),
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
