import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

// S3-compatible storage (AWS S3 / Cloudflare R2 / Supabase Storage — spec
// §58). Used only for reports that were actually emailed, so email_logs
// can prove exactly what was sent (decision log). On-demand downloads that
// were never emailed are generated fresh and never touch this bucket.
@Injectable()
export class StorageService {
  private client: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = process.env.STORAGE_BUCKET ?? '';
    this.client = new S3Client({
      region: process.env.STORAGE_REGION ?? 'auto',
      endpoint: process.env.STORAGE_ENDPOINT,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
      },
    });
  }

  async uploadReport(key: string, body: Buffer, contentType: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Never publicly readable — reports contain private employee data
        // (spec §59). Access only via signed URL or authenticated endpoint.
      }),
    );
    return key;
  }

  // Short-lived signed URL for an authenticated user to (re-)download a
  // report that was previously emailed.
  async getSignedDownloadUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
