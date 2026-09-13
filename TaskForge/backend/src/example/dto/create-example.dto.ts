import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * WHAT: The shape of the request body for creating an example item.
 *
 * WHY: DTOs (Data Transfer Objects) define exactly what a request is allowed
 * to contain. The global `ValidationPipe` (configured in main.ts) uses these
 * decorators to reject bad requests with a 400 before they ever reach the
 * controller's method body - we never trust `req.body` directly.
 *
 * WHERE: `ExampleController.create()`.
 */
export class CreateExampleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;
}
