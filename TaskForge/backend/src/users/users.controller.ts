import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

/**
 * WHAT: HTTP routes for user records.
 *
 * WHERE:
 *   GET    /users
 *   GET    /users/:id
 *   POST   /users
 *   PATCH  /users/:id
 *   DELETE /users/:id
 *
 * WHY `ParseUUIDPipe`: our IDs are UUIDs. Without this pipe, a request to
 * `/users/banana` would reach the service and hit the database with an
 * invalid UUID, producing a confusing 500. The pipe rejects malformed IDs
 * with a clean 400 before any database work happens.
 *
 * SECURITY NOTE: these endpoints are deliberately unauthenticated for now,
 * because authentication does not exist until Phase 03. Once auth guards
 * are in place, these routes will be protected and user creation will move
 * behind `POST /auth/register`. This is a known, intentional gap for this
 * phase - not an oversight.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }
}
