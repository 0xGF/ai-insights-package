// src/services/market.ts
import { MarketData } from '../types/token';
import { Throttle } from '../utils/throttle';

interface TrendingTokenResponse {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export class MarketService {
  private readonly birdseyeThrottle: Throttle;
  private readonly cache: Map<string, { data: any; timestamp: number }>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly birdseyeApiKey: string) {
    this.birdseyeThrottle = new Throttle(3, 1000);
    this.cache = new Map();
  }

  async getMarketData(address: string): Promise<MarketData> {
    const cacheKey = `market_${address}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const marketData = await this.fetchBirdseyeMarketData(address);
      if (!marketData) {
        throw new Error('No market data available');
      }

      const result: MarketData = {
        price: marketData.price || null,
        priceChange24h: marketData.price_change_24h || null,
        volume24h: marketData.volume_24h?.toString() || '0',
        mcap: marketData.marketcap || null,
        fdv: marketData.supply ? marketData.supply * (marketData.price || 0) : null,
        liquidity: marketData.liquidity || 0,
        holders: marketData.holders || 0,
        verified: marketData.verified || false,
        createdAt: new Date().toISOString()
      };

      this.cache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      console.error('Error fetching market data:', error);
      return {
        price: null,
        priceChange24h: null,
        volume24h: '0',
        mcap: null,
        fdv: null,
        liquidity: 0,
        holders: 0,
        verified: false,
        createdAt: new Date().toISOString()
      };
    }
  }

  async getTrendingTokens(limit: number = 100): Promise<TrendingTokenResponse[]> {
    try {
      console.log('Fetching trending tokens, limit:', limit);
      const response = await this.birdseyeThrottle.add(() => 
        fetch(
          `https://public-api.birdeye.so/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=${limit}`,
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
        console.warn('Birdeye trending API error:', response.status);
        return [];
      }

      const data = await response.json();
      return (data.data || []).map((token: any) => ({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals
      }));
    } catch (error) {
      console.error('Error fetching trending tokens:', error);
      return [];
    }
  }

  private async fetchBirdseyeMarketData(address: string): Promise<any> {
    try {
      console.log('Fetching Birdeye market data for address:', address);
      const response = await this.birdseyeThrottle.add(() =>
        fetch(
          `https://public-api.birdeye.so/defi/v3/token/market-data?address=${address}`,
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
      return data.data;
    } catch (error) {
      console.error('Error fetching Birdeye data:', error);
      return null;
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}