// src/types/token.ts
import { z } from "zod";
import type { PublicKey } from "@solana/web3.js";

export const TokenDataSchema = z.object({
 mint: z.any() as unknown as z.ZodType<PublicKey>,
  symbol: z.string(),
  name: z.string(),
  decimals: z.number(),
  totalSupply: z.bigint(),
  holderCount: z.number(),
  volume24h: z.union([z.bigint(), z.string()]),
  chainId: z.number().optional(),
  mintAuthority: z.string().nullable(),
  freezeAuthority: z.string().nullable(),
  verified: z.boolean(),
  extensions: z.any(),
  technicalAnalysis: z.object({
    indicators: z.object({
      rsi: z.number(),
      macd: z.object({
        value: z.number(),
        signal: z.number(),
        histogram: z.number()
      }),
      movingAverages: z.object({
        sma20: z.number(),
        sma50: z.number(),
        sma200: z.number(),
        ema20: z.number()
      })
    }),
    patterns: z.array(z.object({
      name: z.string(),
      confidence: z.number(),
      implication: z.enum(['bullish', 'bearish', 'neutral']),
      priceTarget: z.number().optional()
    })),
    supportResistance: z.object({
      support: z.array(z.number()),
      resistance: z.array(z.number())
    }),
    trend: z.object({
      shortTerm: z.enum(['bullish', 'bearish', 'neutral']),
      mediumTerm: z.enum(['bullish', 'bearish', 'neutral']),
      confidence: z.number(),
      reasoning: z.string()
    }),
    volumeAnalysis: z.object({
      trend: z.string(),
      significance: z.number(),
      unusualActivity: z.boolean(),
      insight: z.string()
    })
  }).optional()
});

export const TweetSchema = z.object({
  id: z.string(),
  text: z.string(),
  authorId: z.string(),
  createdAt: z.date(),
  likeCount: z.number(),
  retweetCount: z.number(),
  replyCount: z.number(),
  quoteCount: z.number(),
});

export const AISentimentSchema = z.object({
  direction: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number(),
  reasoning: z.string(),
});

export const AITrendSchema = z.object({
  topic: z.string(),
  sentiment: z.string(),
  importance: z.number(),
});

export const AIVolumeAnalysisSchema = z.object({
  trend: z.string(),
  significance: z.number(),
});

export const AIPriceTargetSchema = z.object({
  short: z.union([z.string(), z.number(), z.null()]),
  medium: z.union([z.string(), z.number(), z.null()]),
  confidence: z.number()
});

export const AIAnalysisSchema = z.object({
  marketSentiment: AISentimentSchema,
  keyTrends: z.array(AITrendSchema),
  volumeAnalysis: AIVolumeAnalysisSchema,
  riskLevel: z.number(),
  priceTarget: AIPriceTargetSchema,
});

export const SocialMetricsSchema = z.object({
  mentionsCount: z.number(),
  trendingScore: z.number(),
  tweets: z.array(TweetSchema),
  lastUpdated: z.date(),
  aiAnalysis: AIAnalysisSchema,
});

export const SentimentAspectSchema = z.object({
  topic: z.string(),
  sentiment: z.number(),
});

export const SentimentAnalysisSchema = z.object({
  score: z.number(),
  magnitude: z.number(),
  aspects: z.array(SentimentAspectSchema),
});

export const MarketDataSchema = z.object({
  price: z.number().nullable(),
  priceChange24h: z.number().nullable(),
  volume24h: z.string(),
  mcap: z.number().nullable(),
  fdv: z.number().nullable(),
  liquidity: z.number(),
  holders: z.number(),
  verified: z.boolean(),
  createdAt: z.string()
});

export const TokenAnalyticsSchema = z.object({
  address: z.string(),
  onChainData: TokenDataSchema,
  market: MarketDataSchema,
  socialMetrics: SocialMetricsSchema.optional(),
  sentiment: SentimentAnalysisSchema.optional(),
  lastUpdated: z.date(),
  technicalAnalysis: z.object({
    indicators: z.object({
      rsi: z.number(),
      macd: z.object({
        value: z.number(),
        signal: z.number(),
        histogram: z.number()
      }),
      movingAverages: z.object({
        sma20: z.number(),
        sma50: z.number(),
        sma200: z.number(),
        ema20: z.number()
      })
    }),
    patterns: z.array(z.object({
      name: z.string(),
      confidence: z.number(),
      implication: z.enum(['bullish', 'bearish', 'neutral']),
      priceTarget: z.number().optional()
    })),
    supportResistance: z.object({
      support: z.array(z.number()),
      resistance: z.array(z.number())
    })
  }).optional()
});

export interface MarketDataInput {
  price?: number | null;
  priceChange24h?: number | null;
  volume24h?: string | bigint;
  decimals?: number;
}

export interface TokenInfo {
  about: string;
  tweets: Tweet[];
}

export interface TwitterAPIResponse {
  data: {
    id: string;
    text: string;
    author_id: string;
    created_at: string;
    public_metrics: {
      like_count: number;
      retweet_count: number;
      reply_count: number;
      quote_count: number;
    };
  }[];
}

export interface TwitterConfig {
  relevantAccounts?: string[];
  maxTweets?: number;
  minLikes?: number;
  minRetweets?: number;
  excludeSpam?: boolean;
}

export type TokenData = z.infer<typeof TokenDataSchema>;
export type Tweet = z.infer<typeof TweetSchema>;
export type AIAnalysis = z.infer<typeof AIAnalysisSchema>;
export type SocialMetrics = z.infer<typeof SocialMetricsSchema>;
export type SentimentAnalysis = z.infer<typeof SentimentAnalysisSchema>;
export type MarketData = z.infer<typeof MarketDataSchema>;
export type TokenAnalytics = z.infer<typeof TokenAnalyticsSchema>;

export interface TrendingToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  trendingScore: number;
  marketData: MarketData;
}