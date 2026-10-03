/**
 * A `class-transformer` `@Transform()` callback that trims surrounding
 * whitespace from string input and passes any other value through
 * untouched (so `@IsString()` can still reject a number or an object).
 *
 * WHY trim BEFORE validating: without it, a name of "   " (three spaces)
 * would satisfy `@MinLength(2)` and create something that looks blank in
 * any UI. `@Transform` runs before validation (the global ValidationPipe
 * has `transform: true`), so every rule on the property sees the trimmed
 * value.
 *
 *   @Transform(trimString)
 *   @IsString()
 *   name!: string;
 */
export const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
