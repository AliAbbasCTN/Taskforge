import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';
import { S3StorageService } from './s3-storage.service';
import { StorageService } from './storage.service';

/**
 * WHAT: Chooses the storage backend from configuration. The ONLY place that
 * knows there is more than one.
 *
 * Used as a provider factory in `FilesModule`:
 *   { provide: StorageService, inject: [ConfigService], useFactory: createStorage }
 */
export function createStorage(config: ConfigService): StorageService {
  const logger = new Logger('Storage');
  const driver = config.get<string>('storage.driver') ?? 'local';

  if (driver === 's3') {
    const bucket = config.getOrThrow<string>('storage.s3.bucket');
    logger.log(`Using S3 storage (bucket "${bucket}")`);
    return new S3StorageService({
      bucket,
      region: config.getOrThrow<string>('storage.s3.region'),
      endpoint: config.get<string>('storage.s3.endpoint') || undefined,
      forcePathStyle: config.get<boolean>('storage.s3.forcePathStyle') ?? false,
    });
  }

  const directory = config.getOrThrow<string>('storage.localDir');
  if (config.get<string>('app.nodeEnv') === 'production') {
    // Not an error - a single server with a persistent disk is legitimate - but
    // it is the classic way to lose uploads, so say so loudly.
    logger.warn(
      'Local disk storage is active in production. Uploaded files will be lost ' +
        'if the container or disk is replaced. Set STORAGE_DRIVER=s3 for production.',
    );
  }
  logger.log(`Using local disk storage (directory "${directory}")`);
  return new LocalStorageService(directory);
}
