import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { TeamsModule } from './teams/teams.module';
import { ProjectsModule } from './projects/projects.module';
import { BoardsModule } from './boards/boards.module';
import { TasksModule } from './tasks/tasks.module';
import { LabelsModule } from './labels/labels.module';
import { CommentsModule } from './comments/comments.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { SearchModule } from './search/search.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { QueuesModule } from './queues/queues.module';
import { MaintenanceModule } from './maintenance/maintenance.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    QueuesModule,
    HealthModule,
    UsersModule,
    AuthModule,
    OrganizationsModule,
    TeamsModule,
    ProjectsModule,
    BoardsModule,
    TasksModule,
    LabelsModule,
    CommentsModule,
    AttachmentsModule,
    SearchModule,
    NotificationsModule,
    RealtimeModule,
    MaintenanceModule,
  ],
})
export class AppModule {}
