import { z } from 'zod';

export const NewsItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  url: z.string().url(),
  publishedAt: z.date(),
  source: z.string()
});

export type NewsItem = z.infer<typeof NewsItemSchema>;

export const AINewsAnalysisSchema = z.object({
  marketSentiment: z.string(),
  keyTrends: z.array(z.object({
    trend: z.string(),
    description: z.string()
  })),
  impactAnalysis: z.array(z.object({
    factor: z.string(),
    impact: z.string(),
    description: z.string()
  })),
  riskLevel: z.string()
});

export type AINewsAnalysis = z.infer<typeof AINewsAnalysisSchema>;

export const NewsAnalysisSchema = z.object({
  articles: z.array(NewsItemSchema),
  aiAnalysis: AINewsAnalysisSchema,
  lastUpdated: z.date()
});

export type NewsAnalysis = z.infer<typeof NewsAnalysisSchema>;