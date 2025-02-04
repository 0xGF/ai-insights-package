// src/test-news.ts
import { NewsService } from './services/news';
import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config();

if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing required environment variable: OPENAI_API_KEY');
}

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

async function testNewsAnalysis() {
  try {
    const news = new NewsService(process.env.OPENAI_API_KEY!!);
    
    // Test individual token news
    console.log('Testing news source analysis...');
    const vineNews = await news.getNewsAnalysis();
    console.log(JSON.stringify(vineNews, null, 2));

  } catch (error) {
    console.error('Error during news analysis:', error);
  }
}

testNewsAnalysis()
  .catch(console.error)
  .finally(() => console.log('Tests completed'));