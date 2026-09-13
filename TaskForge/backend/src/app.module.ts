import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { ExampleModule } from './example/example.module';

@Module({
  imports: [AppConfigModule, HealthModule, ExampleModule],
})
export class AppModule {}
