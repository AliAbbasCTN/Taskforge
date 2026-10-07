import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { trimString } from '../../common/utils/trim-string';

/**
 * WHAT: The validated shape for creating or editing a comment.
 *
 * Trimmed before validation so a comment of only spaces is rejected rather
 * than stored as an invisible message.
 *
 * Comment text is stored exactly as written and is NEVER treated as HTML: the
 * frontend renders it as plain text (React escapes it), which is what keeps a
 * comment like `<script>...</script>` harmless.
 */
export class CommentBodyDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string;
}
