import { ApiProperty } from '@nestjs/swagger';

/**
 * WHAT: The documented shape of EVERY error the API returns.
 *
 * This is documentation only - the real body is produced by
 * `AllExceptionsFilter`, which is why the two must agree. The fields below
 * mirror what that filter writes: `statusCode`, `message`, `error`, `path`
 * and `timestamp`.
 *
 * `message` is a single string for most errors but an ARRAY of strings for
 * validation errors (400), one entry per failed rule - hence `oneOf`.
 */
export class ErrorResponseDto {
  @ApiProperty({ example: 404, description: 'The HTTP status code.' })
  statusCode!: number;

  @ApiProperty({
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ],
    example: 'Project not found',
    description:
      'What went wrong. A list of messages (one per failed rule) for validation errors.',
  })
  message!: string | string[];

  @ApiProperty({
    example: 'Not Found',
    description: 'The standard HTTP reason phrase for the status code.',
  })
  error!: string;

  @ApiProperty({
    example: '/organizations/3f1c.../projects/9b2e...',
    description: 'The request URL that produced the error.',
  })
  path!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-21T09:30:00.000Z',
  })
  timestamp!: string;
}
