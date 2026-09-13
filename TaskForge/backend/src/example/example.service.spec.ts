import { NotFoundException } from '@nestjs/common';
import { ExampleService } from './example.service';

describe('ExampleService', () => {
  let service: ExampleService;

  beforeEach(() => {
    service = new ExampleService();
  });

  it('starts with no items', () => {
    expect(service.findAll()).toEqual([]);
  });

  it('creates an item and assigns an incrementing id', () => {
    const first = service.create({ title: 'First task' });
    const second = service.create({ title: 'Second task' });

    expect(first.id).toBe(1);
    expect(second.id).toBe(2);
    expect(service.findAll()).toHaveLength(2);
  });

  it('finds an item by id', () => {
    const created = service.create({ title: 'Findable' });
    expect(service.findOne(created.id)).toEqual(created);
  });

  it('throws NotFoundException for a missing id', () => {
    expect(() => service.findOne(999)).toThrow(NotFoundException);
  });
});
