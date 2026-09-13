import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ExampleService } from './example.service';
import { CreateExampleDto } from './dto/create-example.dto';

/**
 * WHAT: A minimal REST controller demonstrating routing, DTO validation,
 * and delegating to a service.
 *
 * WHERE: `GET /examples`, `GET /examples/:id`, `POST /examples`.
 *
 * HOW: Controllers should stay thin - they only translate HTTP in and out,
 * and never contain business logic. All real logic lives in
 * `ExampleService`.
 */
@Controller('examples')
export class ExampleController {
  constructor(private readonly exampleService: ExampleService) {}

  @Get()
  findAll() {
    return this.exampleService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.exampleService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateExampleDto) {
    return this.exampleService.create(dto);
  }
}
