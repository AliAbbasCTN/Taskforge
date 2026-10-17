// class-transformer reads decorator metadata through this polyfill. The app
// loads it via NestJS; a standalone spec must import it itself.
import 'reflect-metadata';
import { validateEnv } from './env.validation';

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/taskforge',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv - file storage', () => {
  it('needs no storage variables at all (local disk is the default)', () => {
    expect(() => validateEnv(baseEnv)).not.toThrow();
  });

  it('accepts a complete S3 configuration', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'taskforge-files',
        S3_REGION: 'eu-west-1',
      }),
    ).not.toThrow();
  });

  it('rejects the s3 driver without a bucket and region', () => {
    expect(() => validateEnv({ ...baseEnv, STORAGE_DRIVER: 's3' })).toThrow(
      'S3_BUCKET and S3_REGION are required',
    );
    expect(() =>
      validateEnv({ ...baseEnv, STORAGE_DRIVER: 's3', S3_BUCKET: 'b' }),
    ).toThrow('S3_BUCKET and S3_REGION are required');
  });

  it('rejects an unknown storage driver', () => {
    expect(() => validateEnv({ ...baseEnv, STORAGE_DRIVER: 'ftp' })).toThrow(
      'STORAGE_DRIVER must be "local" or "s3"',
    );
  });

  it('rejects an upload limit that is zero, negative or above 100 MB', () => {
    for (const value of ['0', '-5', '101']) {
      expect(() =>
        validateEnv({ ...baseEnv, UPLOAD_MAX_FILE_SIZE_MB: value }),
      ).toThrow();
    }
    expect(() =>
      validateEnv({ ...baseEnv, UPLOAD_MAX_FILE_SIZE_MB: '25' }),
    ).not.toThrow();
  });
});
