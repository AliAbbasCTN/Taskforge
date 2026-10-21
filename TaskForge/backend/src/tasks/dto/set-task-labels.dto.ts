import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/**
 * WHAT: The validated shape for `PUT .../tasks/:taskId/labels`.
 *
 * WHY PUT with the WHOLE list instead of "add label" / "remove label"
 * endpoints: the client says what the task's labels should BE, and the server
 * makes it so. That is idempotent (sending it twice changes nothing) and
 * immune to two people clicking at once producing a muddle of adds and
 * removes. An empty array removes every label.
 */
export class SetTaskLabelsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'uuid' },
    maxItems: 20,
    description: 'The COMPLETE list of label ids the task should have. An empty array removes every label.',
  })
  labelIds!: string[];
}
