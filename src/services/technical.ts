// src/services/technical.ts
import { Throttle } from '../utils/throttle';
import { 
  PriceCandle,
  TechnicalAnalysis,
  TechnicalAnalysisSchema 
} from '../types/technical';

export class TechnicalAnalysisService {
  private readonly birdseyeThrottle: Throttle;
  private readonly cache: Map<string, { data: TechnicalAnalysis; timestamp: number }>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly birdseyeApiKey: string) {
    this.birdseyeThrottle = new Throttle(3, 1000);
    this.cache = new Map();
  }

  async analyzeTechnicals(address: string): Promise<TechnicalAnalysis> {
    try {
      console.log('Starting technical analysis for:', address);
      const cacheKey = `ta_${address}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }

      console.log('Fetching price data for technical analysis...');
      const [fifteenMin, oneHour, fourHour] = await Promise.all([
        this.getHistoricalPrices(address, '15m'),
        this.getHistoricalPrices(address, '1H'),
        this.getHistoricalPrices(address, '4H')
      ]);

      if (!oneHour.length || !fifteenMin.length || !fourHour.length) {
        console.log('Insufficient price data for analysis, returning default');
        return this.getDefaultAnalysis();
      }

      console.log('Calculating technical indicators...');
      const indicators = this.calculateIndicators(oneHour);

      console.log('Performing pattern analysis...');
      const analysis = await this.performAnalysis({
        fifteenMin,
        oneHour,
        fourHour,
        indicators
      });

      console.log('Validating technical analysis...');
      const validated = TechnicalAnalysisSchema.parse(analysis);

      this.cache.set(cacheKey, {
        data: validated,
        timestamp: Date.now()
      });

      return validated;
    } catch (error) {
      console.error('Error in technical analysis:', error);
      return this.getDefaultAnalysis();
    }
  }

  private async getHistoricalPrices(address: string, timeframe: string): Promise<PriceCandle[]> {
    console.log(`Fetching ${timeframe} candles for ${address}...`);
    try {
      // Get more historical data points
      const now = Math.floor(Date.now() / 1000);
      const oneWeekAgo = now - (7 * 24 * 60 * 60); // 7 days of data
      
      const response = await this.birdseyeThrottle.add(() =>
        fetch(
          `https://public-api.birdeye.so/defi/history_price?` + 
          `address=${address}` +
          `&address_type=token` +
          `&type=${timeframe}` +
          `&time_from=${oneWeekAgo}` +
          `&time_to=${now}`,
          {
            method: 'GET',
            headers: {
              'accept': 'application/json',
              'x-chain': 'solana',
              'X-API-KEY': this.birdseyeApiKey
            }
          }
        )
      );

      if (!response.ok) {
        throw new Error(`Birdeye API error: ${response.status}`);
      }

      const data = await response.json();
      console.log(`Received ${data.data?.items?.length || 0} price points for ${timeframe}`);

      if (!data.success || !data.data?.items || !Array.isArray(data.data.items)) {
        console.warn(`Invalid price history format for ${timeframe}:`, data);
        return [];
      }

      // Convert price points to candles
      const items = data.data.items;
      if (items.length < 2) return [];

      const candles: PriceCandle[] = [];
      for (let i = 1; i < items.length; i++) {
        const current = items[i];
        const previous = items[i - 1];
        
        // Create a candle using current and previous values
        const value = Number(current.value || 0);
        const prevValue = Number(previous.value || 0);
        
        candles.push({
          timestamp: Number(current.unixTime || 0),
          open: prevValue,
          close: value,
          high: Math.max(value, prevValue),
          low: Math.min(value, prevValue),
          volume: 0 // Volume not available in this endpoint
        });
      }

      console.log(`Processed ${candles.length} candles for ${timeframe}`);
      return candles;

    } catch (error) {
      console.error(`Error fetching ${timeframe} candles:`, error);
      return [];
    }
  }

  private calculateIndicators(candles: PriceCandle[]) {
    return {
      rsi: this.calculateRSI(candles),
      macd: this.calculateMACD(candles),
      movingAverages: {
        sma20: this.calculateSMA(candles, 20),
        sma50: this.calculateSMA(candles, 50),
        sma200: this.calculateSMA(candles, 200),
        ema20: this.calculateEMA(candles, 20)
      }
    };
  }

  private async performAnalysis(data: {
    fifteenMin: PriceCandle[];
    oneHour: PriceCandle[];
    fourHour: PriceCandle[];
    indicators: any;
  }): Promise<TechnicalAnalysis> {
    console.log('Starting pattern analysis with data points:', {
      fifteenMin: data.fifteenMin.length,
      oneHour: data.oneHour.length,
      fourHour: data.fourHour.length
    });

    const prices = data.oneHour.map(candle => candle.close);
    const supportLevels = this.findSupportLevels(prices);
    const resistanceLevels = this.findResistanceLevels(prices);

    console.log('Support and resistance levels:', {
      support: supportLevels,
      resistance: resistanceLevels
    });

    const shortTermTrend = this.determineTrend(data.fifteenMin, 20);
    const mediumTermTrend = this.determineTrend(data.oneHour, 50);

    console.log('Trend analysis:', {
      shortTerm: shortTermTrend,
      mediumTerm: mediumTermTrend
    });

    const patterns = this.identifyPatterns(data.oneHour);
    console.log('Identified patterns:', patterns);

    const volumeAnalysis = this.analyzeVolume(data.oneHour);
    const confidence = this.calculateTrendConfidence(data);

    return {
      patterns,
      indicators: data.indicators,
      supportResistance: {
        support: supportLevels,
        resistance: resistanceLevels,
        strongestSupport: supportLevels[0] || 0,
        strongestResistance: resistanceLevels[resistanceLevels.length - 1] || 0
      },
      trend: {
        shortTerm: shortTermTrend,
        mediumTerm: mediumTermTrend,
        confidence,
        reasoning: this.generateTrendReasoning(shortTermTrend, mediumTermTrend, data.indicators)
      },
      volumeAnalysis
    };
  }

  private calculateRSI(candles: PriceCandle[], periods: number = 14): number {
    if (candles.length < periods + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= periods; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change >= 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }

    let avgGain = gains / periods;
    let avgLoss = losses / periods;

    for (let i = periods + 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      
      if (change >= 0) {
        avgGain = (avgGain * 13 + change) / 14;
        avgLoss = (avgLoss * 13) / 14;
      } else {
        avgGain = (avgGain * 13) / 14;
        avgLoss = (avgLoss * 13 - change) / 14;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateMACD(candles: PriceCandle[]): { value: number; signal: number; histogram: number } {
    const prices = candles.map(c => c.close);
    const ema12 = this.calculateEMAArray(prices, 12);
    const ema26 = this.calculateEMAArray(prices, 26);
    
    const macdLine = ema12[ema12.length - 1] - ema26[ema26.length - 1];
    const macdHistory = prices.map((_, i) => ema12[i] - ema26[i]);
    const signalLine = this.calculateEMAArray(macdHistory, 9);
    
    return {
      value: macdLine,
      signal: signalLine[signalLine.length - 1],
      histogram: macdLine - signalLine[signalLine.length - 1]
    };
  }

  private calculateSMA(candles: PriceCandle[], periods: number): number {
    if (candles.length < periods) return 0;
    const prices = candles.slice(-periods).map(c => c.close);
    return prices.reduce((a, b) => a + b, 0) / periods;
  }

  private calculateEMA(candles: PriceCandle[], periods: number): number {
    const prices = candles.map(c => c.close);
    const emaArray = this.calculateEMAArray(prices, periods);
    return emaArray[emaArray.length - 1];
  }

  private calculateEMAArray(values: number[], periods: number): number[] {
    if (values.length < periods) return values;
    
    const multiplier = 2 / (periods + 1);
    const ema = [values[0]];
    
    for (let i = 1; i < values.length; i++) {
      ema.push((values[i] - ema[i - 1]) * multiplier + ema[i - 1]);
    }
    
    return ema;
  }

  private findSupportLevels(prices: number[]): number[] {
    const pivots = [];
    for (let i = 2; i < prices.length - 2; i++) {
      if (
        prices[i] < prices[i - 1] && 
        prices[i] < prices[i - 2] &&
        prices[i] < prices[i + 1] && 
        prices[i] < prices[i + 2]
      ) {
        pivots.push(prices[i]);
      }
    }
    return [...new Set(pivots)].sort((a, b) => b - a).slice(0, 3);
  }

  private findResistanceLevels(prices: number[]): number[] {
    const pivots = [];
    for (let i = 2; i < prices.length - 2; i++) {
      if (
        prices[i] > prices[i - 1] && 
        prices[i] > prices[i - 2] &&
        prices[i] > prices[i + 1] && 
        prices[i] > prices[i + 2]
      ) {
        pivots.push(prices[i]);
      }
    }
    return [...new Set(pivots)].sort((a, b) => a - b).slice(-3);
  }

  private determineTrend(candles: PriceCandle[], period: number): 'bullish' | 'bearish' | 'neutral' {
    if (candles.length < period) return 'neutral';
    
    const sma = this.calculateSMA(candles, period);
    const currentPrice = candles[candles.length - 1].close;
    const priceChange = ((currentPrice - candles[candles.length - period].close) / candles[candles.length - period].close) * 100;
    
    if (currentPrice > sma && priceChange > 1) return 'bullish';
    if (currentPrice < sma && priceChange < -1) return 'bearish';
    return 'neutral';
  }

  private identifyPatterns(candles: PriceCandle[]): Array<{
    name: string;
    confidence: number;
    implication: 'bullish' | 'bearish' | 'neutral';
    priceTarget: number | null;
  }> {
    const patterns = [];
    const lastPrice = candles[candles.length - 1].close;
    
    // Double Bottom
    if (this.isDoubleBottom(candles)) {
      patterns.push({
        name: 'Double Bottom',
        confidence: 0.8,
        implication: 'bullish' as 'bullish',
        priceTarget: lastPrice * 1.1
      });
    }
    
    // Head and Shoulders
    if (this.isHeadAndShoulders(candles)) {
      patterns.push({
        name: 'Head and Shoulders',
        confidence: 0.7,
        implication: 'bearish' as 'bearish',
        priceTarget: lastPrice * 0.9
      });
    }
    
    return patterns;
  }

  private isDoubleBottom(candles: PriceCandle[]): boolean {
    if (candles.length < 20) return false;
    
    const recentLows = candles
      .slice(-20)
      .map((c, i) => ({ price: c.low, index: i }))
      .sort((a, b) => a.price - b.price)
      .slice(0, 2);
      
    const indexDiff = Math.abs(recentLows[0].index - recentLows[1].index);
    const priceDiff = Math.abs(recentLows[0].price - recentLows[1].price) / recentLows[0].price;
    
    return indexDiff > 5 && priceDiff < 0.02;
  }

  private isHeadAndShoulders(candles: PriceCandle[]): boolean {
    if (candles.length < 20) return false;
    
    const peaks = this.findPeaks(candles.slice(-20));
    if (peaks.length < 3) return false;
    
    const [leftShoulder, head, rightShoulder] = peaks.slice(-3);
    
    return (
      head.price > leftShoulder.price &&
      head.price > rightShoulder.price &&
      Math.abs(leftShoulder.price - rightShoulder.price) / leftShoulder.price < 0.05
    );
  }

  private findPeaks(candles: PriceCandle[]): Array<{ price: number; index: number }> {
    const peaks = [];
    for (let i = 1; i < candles.length - 1; i++) {
      if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
        peaks.push({ price: candles[i].high, index: i });
      }
    }
    return peaks;
  }

  private calculateTrendConfidence(data: {
    fifteenMin: PriceCandle[];
    oneHour: PriceCandle[];
    fourHour: PriceCandle[];
    indicators: any;
  }): number {
    let confidence = 0;
    const { rsi, macd, movingAverages } = data.indicators;
    
    // RSI confirmation (20%)
    if (rsi > 70 || rsi < 30) confidence += 0.2;
    
    // MACD confirmation (20%)
    if (Math.abs(macd.histogram) > Math.abs(macd.signal)) confidence += 0.2;
    
    // Moving average confirmation (40%)
    if (movingAverages.sma20 > movingAverages.sma50) confidence += 0.2;
    if (movingAverages.sma50 > movingAverages.sma200) confidence += 0.2;
    
    // Price consistency across timeframes (20%)
    const fifteenMinTrend = this.determineTrend(data.fifteenMin, 20);
    const hourTrend = this.determineTrend(data.oneHour, 50);
    const fourHourTrend = this.determineTrend(data.fourHour, 50);
    
    if (fifteenMinTrend === hourTrend) confidence += 0.1;
    if (hourTrend === fourHourTrend) confidence += 0.1;
    
    return Math.min(confidence, 1);
  }

  private analyzeVolume(candles: PriceCandle[]): {
    trend: string;
    significance: number;
    unusualActivity: boolean;
    insight: string;
  } {
    // Since we don't have volume data from the history_price endpoint
    return {
      trend: "unknown",
      significance: 0,
      unusualActivity: false,
      insight: "Volume analysis not available for this token"
    };
  }

  private generateTrendReasoning(
    shortTerm: 'bullish' | 'bearish' | 'neutral',
    mediumTerm: 'bullish' | 'bearish' | 'neutral',
    indicators: any
  ): string {
    const reasons = [];
    
    // Trend alignment
    if (shortTerm === mediumTerm) {
      reasons.push(`Consistent ${shortTerm} trend across timeframes`);
    } else {
      reasons.push(`Mixed signals: ${shortTerm} short-term, ${mediumTerm} medium-term`);
    }
    
    // RSI conditions
    if (indicators.rsi > 70) {
      reasons.push('Overbought RSI conditions suggest potential pullback');
    } else if (indicators.rsi < 30) {
      reasons.push('Oversold RSI conditions suggest potential bounce');
    }
    
    // MACD analysis
    if (indicators.macd.histogram > 0 && indicators.macd.histogram > indicators.macd.signal) {
      reasons.push('MACD showing strong positive momentum');
    } else if (indicators.macd.histogram < 0 && indicators.macd.histogram < indicators.macd.signal) {
      reasons.push('MACD indicating negative momentum');
    }
    
    // Moving averages
    if (indicators.movingAverages.sma20 > indicators.movingAverages.sma50) {
      if (indicators.movingAverages.sma50 > indicators.movingAverages.sma200) {
        reasons.push('All moving averages aligned bullishly (20 > 50 > 200)');
      } else {
        reasons.push('Short-term moving averages bullish but long-term resistance ahead');
      }
    } else if (indicators.movingAverages.sma20 < indicators.movingAverages.sma50) {
      if (indicators.movingAverages.sma50 < indicators.movingAverages.sma200) {
        reasons.push('All moving averages aligned bearishly (20 < 50 < 200)');
      } else {
        reasons.push('Short-term moving averages bearish but long-term support present');
      }
    }
    
    return reasons.join('. ');
  }

  private getDefaultAnalysis(): TechnicalAnalysis {
    return {
      patterns: [],
      indicators: {
        rsi: 50,
        macd: {
          value: 0,
          signal: 0,
          histogram: 0
        },
        movingAverages: {
          sma20: 0,
          sma50: 0,
          sma200: 0,
          ema20: 0
        }
      },
      supportResistance: {
        support: [],
        resistance: [],
        strongestSupport: 0,
        strongestResistance: 0
      },
      trend: {
        shortTerm: 'neutral',
        mediumTerm: 'neutral',
        confidence: 0,
        reasoning: 'Insufficient data for analysis'
      },
      volumeAnalysis: {
        trend: "unknown",
        significance: 0,
        unusualActivity: false,
        insight: "Volume analysis not available for this token"
      }
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}