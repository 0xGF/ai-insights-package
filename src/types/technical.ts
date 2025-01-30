// types/technical.ts
import { z } from 'zod';

export const PriceCandleSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number()
});

export const TechnicalIndicatorsSchema = z.object({
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
});

export const SupportResistanceSchema = z.object({
  support: z.array(z.number()),
  resistance: z.array(z.number()),
  strongestSupport: z.number(),
  strongestResistance: z.number()
});

export const ChartPatternSchema = z.object({
  name: z.string(),
  confidence: z.number().min(0).max(1),
  implication: z.enum(['bullish', 'bearish', 'neutral']),
  priceTarget: z.number().nullable()
});

export const VolumeAnalysisSchema = z.object({
  trend: z.string(),
  significance: z.number().min(0).max(1),
  unusualActivity: z.boolean(),
  insight: z.string()
});

export const TechnicalAnalysisSchema = z.object({
  patterns: z.array(ChartPatternSchema),
  indicators: TechnicalIndicatorsSchema,
  supportResistance: SupportResistanceSchema,
  trend: z.object({
    shortTerm: z.enum(['bullish', 'bearish', 'neutral']),
    mediumTerm: z.enum(['bullish', 'bearish', 'neutral']),
    confidence: z.number().min(0).max(1),
    reasoning: z.string()
  }),
  volumeAnalysis: VolumeAnalysisSchema
});

export type PriceCandle = z.infer<typeof PriceCandleSchema>;
export type TechnicalIndicators = z.infer<typeof TechnicalIndicatorsSchema>;
export type SupportResistance = z.infer<typeof SupportResistanceSchema>;
export type ChartPattern = z.infer<typeof ChartPatternSchema>;
export type VolumeAnalysis = z.infer<typeof VolumeAnalysisSchema>;
export type TechnicalAnalysis = z.infer<typeof TechnicalAnalysisSchema>;