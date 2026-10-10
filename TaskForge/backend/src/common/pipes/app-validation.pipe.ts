import { ValidationPipe } from '@nestjs/common';

/**
 * WHAT: The ONE definition of how TaskForge validates incoming requests.
 *
 * Both the real server (`main.ts`) and the end-to-end test app build their
 * global pipe from this function.
 *
 * WHY it exists: the two used to be written out separately, and drifted - the
 * test app was missing `enableImplicitConversion`. Query-string values are
 * always strings, so with the option missing `?pageSize=2` stayed the text
 * "2" and failed `@IsInt()`: the test said 400 while the real server would
 * have answered 200. A test environment that differs from production proves
 * very little, so there is now a single source of truth.
 *
 * What each option does:
 *  - `whitelist`: properties without a validation decorator are stripped.
 *  - `forbidNonWhitelisted`: ...and sending an unknown property is a 400
 *    instead of being silently ignored.
 *  - `transform`: the body/query becomes a real instance of the DTO class
 *    (so defaults like `page = 1` apply).
 *  - `enableImplicitConversion`: values are converted to the property's
 *    declared type (`"2"` -> `2`). Beware booleans: `Boolean("false")` is
 *    `true` - see `toOptionalBoolean`.
 */
export function createAppValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}
