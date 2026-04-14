import { z } from 'zod';

export const updatePrefsSchema = z.object({
  body: z.object({
    digestIntervalMs: z.number().min(5000).optional(),
    quietHoursStart: z.number().min(0).max(23).optional(),
    quietHoursEnd: z.number().min(0).max(23).optional(),
    mutedRooms: z.array(z.string()).optional(),
  }),
});
