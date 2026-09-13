import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateExampleDto } from './dto/create-example.dto';

export interface ExampleItem {
  id: number;
  title: string;
  createdAt: Date;
}

/**
 * WHAT: A tiny in-memory service demonstrating NestJS's service layer.
 *
 * WHY: This module exists purely to teach the controller -> service ->
 * dependency-injection pattern with a real, runnable example before real
 * domain modules (users, projects, tasks...) exist. Business logic lives
 * here, not in the controller, so it stays testable without HTTP.
 *
 * WHERE: Injected into `ExampleController`.
 *
 * NOTE: This module is intentionally temporary. It will be deleted once
 * Phase 02 introduces the database and the first real domain module
 * (`users`), which will demonstrate the same pattern against Postgres via
 * Prisma instead of an in-memory array.
 */
@Injectable()
export class ExampleService {
  private items: ExampleItem[] = [];
  private nextId = 1;

  findAll(): ExampleItem[] {
    return this.items;
  }

  findOne(id: number): ExampleItem {
    const item = this.items.find((i) => i.id === id);
    if (!item) {
      throw new NotFoundException(`Example item with id ${id} not found`);
    }
    return item;
  }

  create(dto: CreateExampleDto): ExampleItem {
    const item: ExampleItem = {
      id: this.nextId++,
      title: dto.title,
      createdAt: new Date(),
    };
    this.items.push(item);
    return item;
  }
}
