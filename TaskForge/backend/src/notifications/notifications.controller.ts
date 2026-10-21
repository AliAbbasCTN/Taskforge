import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEndpoint, BEARER_AUTH_NAME } from '../common/swagger';
import {
  MarkAllReadResponse,
  NotificationResponse,
  PaginatedNotificationResponse,
  UnreadCountResponse,
} from '../docs/models';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../common/decorators/current-user.decorator';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationsService } from './notifications.service';

/**
 * WHAT: The notification inbox. Unlike nearly everything else, these routes
 * are NOT nested under an organization: a notification belongs to a PERSON,
 * and one person's inbox spans every organization they are in. The only
 * authorization needed is "you may touch your own" - which the service
 * enforces by always filtering on the requester's id.
 *
 *   GET  /notifications?unread=&page=&pageSize=  - the inbox, newest first
 *   GET  /notifications/unread-count             - the number for the badge
 *   POST /notifications/read-all                 - mark everything read
 *   POST /notifications/:id/read                 - mark one read
 */
@ApiTags('Notifications')
@ApiBearerAuth(BEARER_AUTH_NAME)
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiEndpoint({
    summary: 'List your notifications',
    description: 'Your personal inbox across ALL organizations, newest first. Use `unread=true` for unread only.',
    ok: PaginatedNotificationResponse,
  })
  list(
    @Query() query: ListNotificationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.list(user.id, query);
  }

  @Get('unread-count')
  @ApiEndpoint({
    summary: 'Count unread notifications',
    description: 'The number for the badge.',
    ok: UnreadCountResponse,
  })
  unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Mark all notifications read',
    ok: MarkAllReadResponse,
  })
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.markAllRead(user.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiEndpoint({
    summary: 'Mark one notification read',
    description: 'Idempotent: marking an already-read notification returns it unchanged.',
    ok: NotificationResponse,
    notFound: 'No such notification - or it is not yours (the same answer for both).',
  })
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.markRead(user.id, id);
  }
}
