import { INestApplication } from '@nestjs/common';
import { setupSwagger } from './swagger';

describe('setupSwagger', () => {
  it('mounts nothing, and never touches the app, when disabled', () => {
    // If it touched the app, the empty object would throw.
    expect(setupSwagger({} as INestApplication, false)).toBe(false);
  });
});
