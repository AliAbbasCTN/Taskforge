import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ErrorResponseDto } from './error-response.dto';

/** A response model, or `[Model]` for a JSON array of them. */
export type ResponseModel = Type<unknown> | [Type<unknown>];

export interface ApiEndpointOptions {
  /** One line, shown next to the route. Imperative: "Create a task". */
  summary: string;
  /** Longer markdown: rules, side effects, who may call it. */
  description?: string;
  /** 200 with this body. */
  ok?: ResponseModel;
  /** 201 with this body. */
  created?: ResponseModel;
  /** 204 with no body. A string becomes the response description. */
  noContent?: boolean | string;
  /** Explain WHEN this route answers 404 (beyond the generic cases). */
  notFound?: string;
  /** Explain WHEN this route answers 409. */
  conflict?: string;
  /** Explain WHEN this route answers 422. */
  unprocessable?: string;
}

const toSchemaOptions = (model: ResponseModel) =>
  Array.isArray(model)
    ? { type: model[0], isArray: true }
    : { type: model };

/**
 * WHAT: ONE decorator that documents a route's summary, description, success
 * response and its route-specific error cases.
 *
 * WHY: without it every handler would carry four or five `@Api...` lines, and
 * the controllers - which are about routing - would drown in documentation.
 * Anything that is the same for every route (401, generic 400/404, 403 from
 * `@RequirePermission`) is NOT repeated here: see `docs/openapi-enrichment.ts`
 * and `require-permission.decorator.ts`.
 */
export function ApiEndpoint(options: ApiEndpointOptions) {
  const decorators: Array<MethodDecorator | ClassDecorator> = [
    ApiOperation({
      summary: options.summary,
      description: options.description,
    }),
  ];

  if (options.ok) {
    decorators.push(
      ApiOkResponse({ description: 'Success.', ...toSchemaOptions(options.ok) }),
    );
  }
  if (options.created) {
    decorators.push(
      ApiCreatedResponse({
        description: 'Created.',
        ...toSchemaOptions(options.created),
      }),
    );
  }
  if (options.noContent) {
    decorators.push(
      ApiNoContentResponse({
        description:
          typeof options.noContent === 'string'
            ? options.noContent
            : 'Success. There is no response body.',
      }),
    );
  }
  if (options.notFound) {
    decorators.push(
      ApiNotFoundResponse({
        description: options.notFound,
        type: ErrorResponseDto,
      }),
    );
  }
  if (options.conflict) {
    decorators.push(
      ApiConflictResponse({
        description: options.conflict,
        type: ErrorResponseDto,
      }),
    );
  }
  if (options.unprocessable) {
    decorators.push(
      ApiUnprocessableEntityResponse({
        description: options.unprocessable,
        type: ErrorResponseDto,
      }),
    );
  }

  return applyDecorators(...decorators);
}
