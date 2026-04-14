import { z } from 'zod';

export const createRoomSchema = z.object({
  body: z.object({
    type: z.enum(['direct', 'group', 'channel']),
    name: z.string().max(100).optional(),
    members: z.array(z.string()),
  }),
});

export const searchMessagesSchema = z.object({
  query: z.object({
    q: z.string().min(2),
  }),
});
