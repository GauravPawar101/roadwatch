import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from './errorHandler.js';

describe('errorHandler', () => {
  it('responds with a 500 and the error message', () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn().mockReturnThis();
    const res = { status, json } as any;

    errorHandler(new Error('boom'), {} as any, res, vi.fn());

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error', details: 'boom' });
  });
});