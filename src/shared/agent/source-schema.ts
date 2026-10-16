import { z } from 'zod';
import { sourceUrl } from './sources';

export const webSourceSchema = z.object({
  url: z.string().max(2048).refine((value) => sourceUrl(value) !== null),
  title: z.string().max(300), snippet: z.string().max(800),
  publishedAt: z.iso.date().optional(), read: z.boolean()
});
export const webSourcesSchema = z.array(webSourceSchema).max(60);
