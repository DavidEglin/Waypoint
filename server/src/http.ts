import type { FastifyReply } from 'fastify';
import type { z } from 'zod';
import { sendError } from './auth.js';

/** Validate a request body; on failure sends a 400 and returns null. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown, reply: FastifyReply): z.infer<T> | null {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  sendError(reply, 400, 'invalid_request', result.error.issues[0]?.message ?? 'That request was not valid.');
  return null;
}
