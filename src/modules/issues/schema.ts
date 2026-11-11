import { z } from 'zod';

export const CATEGORIES = ['water', 'electricity', 'internet', 'sanitation', 'furniture', 'safety', 'other'] as const;
export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

export const ClassificationSchema = z.object({
  title: z.string().trim().min(3).max(80),
  category: z.enum(CATEGORIES),
  severity: z.enum(SEVERITIES),
  department: z.string().trim().min(1),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const ReportInputSchema = z.object({
  location_id: z.string().uuid(),
  body: z.string().min(10).max(2000),
  photo_paths: z.array(z.string()).max(3),
});
export type ReportInput = z.infer<typeof ReportInputSchema>;
