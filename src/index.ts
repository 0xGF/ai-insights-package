import { OnChainService } from "./services/onchain";
import { SocialService } from "./services/social";
import { SentimentService } from "./services/sentiment";
import { MarketService } from "./services/market";
import { TechnicalAnalysisService } from "./services/technical";
import { TokenAnalytics, TokenAnalyticsSchema } from "./types/token";

export interface TokenAnalyzerConfig {
  birdseyeApiKey: string;
  twitterApiKey?: string;
  openaiApiKey?: string;
}

export interface AnalysisOptions {
  includeSocial?: boolean;
  includeSentiment?: boolean;
  includeTechnical?: boolean;
}

export class TokenAnalyzer {
  private readonly onchain: OnChainService;
  private readonly market: MarketService;
  private readonly social?: SocialService;
  private readonly sentiment?: SentimentService;
  private readonly technical?: TechnicalAnalysisService;
  private readonly analysisCache: Map<string, { data: TokenAnalytics; timestamp: number }>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly config: TokenAnalyzerConfig) {
    if (!config.birdseyeApiKey) {
      throw new Error('BIRDEYE_API_KEY is required');
    }

    this.onchain = new OnChainService(config.birdseyeApiKey);
    this.market = new MarketService(config.birdseyeApiKey);
    
    // Initialize SocialService if both Twitter and OpenAI keys are provided
    if (config.twitterApiKey && config.openaiApiKey) {
      this.social = new SocialService(config.twitterApiKey, config.openaiApiKey);
    }
    
    if (config.openaiApiKey) {
      this.sentiment = new SentimentService(config.openaiApiKey);
      this.technical = new TechnicalAnalysisService(config.birdseyeApiKey);
    }
    
    this.analysisCache = new Map();
  }

  async analyze(input: string, options: AnalysisOptions = {}): Promise<TokenAnalytics> {
    try {
      // Check if input is a Solana address (base58 string of correct length)
      const isAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
      
      // Try to find the token info based on input type
      let tokenInfo: { address: string; symbol?: string; name?: string } | null = null;

      if (isAddress) {
        tokenInfo = { address: input };
      } else {
        // Search by symbol or name
        const matches = await this.searchTokenList(input);
        if (matches.length > 0) {
          tokenInfo = matches[0]; // Use best match
        }
      }

      if (!tokenInfo) {
        throw new Error(`No token found matching: ${input}`);
      }

      return this.analyzeToken(
        tokenInfo.address,
        tokenInfo.symbol || null,
        tokenInfo.name || null,
        options
      );
    } catch (error) {
      console.error(`Error analyzing token:`, error);
      throw new Error(`Failed to analyze token: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async analyzeToken(
    address: string, 
    symbol: string | null = null, 
    tokenName: string | null = null,
    options: AnalysisOptions = {}
  ): Promise<TokenAnalytics> {
    try {
      const cacheKey = `${address}_${JSON.stringify(options)}`;
      const cached = this.analysisCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }

      console.log('Starting token analysis for:', address);

      const analysisPromises: Promise<any>[] = [
        Promise.all([
          this.onchain.getTokenData(address),
          this.market.getMarketData(address)
        ])
      ];

      if (options.includeTechnical && this.technical) {
        console.log('Including technical analysis...');
        analysisPromises.push(this.technical.analyzeTechnicals(address));
      }

      const [basicData, technicalAnalysis] = await Promise.all(analysisPromises);
      const [onChainData, market] = basicData;

      const finalSymbol = symbol || onChainData.symbol;
      const finalTokenName = tokenName || onChainData.name;

      let socialMetrics = undefined;
      let sentiment = undefined;

      // Optional social analysis - now requires both Twitter and OpenAI
      if (options.includeSocial && this.social) {
        console.log('Fetching social metrics using Twitter and OpenAI...');
        try {
          socialMetrics = await this.social.getSocialMetrics(
            finalSymbol,
            finalTokenName,
            {
              price: market.price,
              priceChange24h: market.priceChange24h,
              volume24h: onChainData.volume24h.toString(),
              decimals: onChainData.decimals
            }
          );

          console.log(`Received ${socialMetrics.tweets.length} tweets from Twitter`);

          // Optional sentiment analysis
          if (options.includeSentiment && this.sentiment && socialMetrics.tweets.length > 0) {
            console.log('Performing sentiment analysis on tweets...');
            sentiment = await this.sentiment.analyzeSentiment(socialMetrics.tweets);
            console.log('Sentiment analysis completed');
          } else {
            console.log('Skipping sentiment analysis:', 
              !options.includeSentiment ? 'not requested' : 
              !this.sentiment ? 'no sentiment service' : 
              'no tweets available');
          }
        } catch (error) {
          console.error('Error in social/sentiment analysis:', error);
          // Continue with analysis even if social metrics fail
        }
      }

      const analytics: TokenAnalytics = {
        address,
        onChainData,
        market,
        technicalAnalysis: options.includeTechnical ? technicalAnalysis : undefined,
        socialMetrics,
        sentiment,
        lastUpdated: new Date()
      };

      console.log('Validating analytics data...');
      const validated = TokenAnalyticsSchema.parse(analytics);

      this.analysisCache.set(cacheKey, {
        data: validated,
        timestamp: Date.now()
      });

      return validated;
    } catch (error) {
      console.error('Error in analyzeToken:', error);
      throw error;
    }
  }

  private async searchTokenList(query: string): Promise<Array<{
    address: string;
    symbol: string;
    name: string;
  }>> {
    try {
      console.log('Searching for token:', query);
  
      const response = await fetch(
        `https://public-api.birdeye.so/defi/v3/search?` +
        `chain=solana` +
        `&keyword=${encodeURIComponent(query)}` +
        `&target=token` +
        `&sort_by=liquidity` +
        `&sort_type=desc` +
        `&offset=0` +
        `&limit=20`,
        {
          method: 'GET',
          headers: {
            'accept': 'application/json',
            'X-API-KEY': this.config.birdseyeApiKey
          }
        }
      );
  
      if (!response.ok) {
        throw new Error(`Birdeye search API error: ${response.status}`);
      }
  
      const data = await response.json();
      console.log('Search response:', data);
  
      if (!data.success || !data.data?.items) {
        console.warn('No data found in search response');
        return [];
      }
  
      // Find the token results
      const tokenItem = data.data.items.find(item => item.type === 'token');
      if (!tokenItem?.result) {
        console.warn('No token results found');
        return [];
      }
  
      const matches = tokenItem.result
        .filter((token: any) => token.liquidity > 0)
        .map((token: any) => ({
          address: token.address,
          symbol: token.symbol,
          name: token.name,
          liquidity: token.liquidity || 0,
          volume24h: token.volume_24h_usd || 0,
          price: token.price || 0,
          lastTrade: token.last_trade_human_time,
          verified: token.verified || false
        }));
  
      console.log('Found matches:', matches.length);
      if (matches.length > 0) {
        console.log('Top matches:', matches.slice(0, 3).map(m => 
          `${m.symbol} (${m.name})\n` +
          `  Price: $${this.formatNumber(m.price)}\n` +
          `  Liquidity: $${this.formatNumber(m.liquidity)}\n` +
          `  24h Volume: $${this.formatNumber(m.volume24h)}\n` +
          `  Verified: ${m.verified}\n` +
          `  Last Trade: ${new Date(m.lastTrade).toLocaleString()}\n` +
          `  Address: ${m.address}`
        ));
      } else {
        console.log('No active tokens found for:', query);
      }
  
      return matches.map(({ address, symbol, name }) => ({
        address,
        symbol,
        name
      }));
    } catch (error) {
      console.error('Error searching tokens:', error);
      throw error;
    }
  }
  
  private formatNumber(num: number): string {
    if (!num) return '0';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
    return num.toFixed(2);
  }

  async getTrendingTokens(limit: number = 100, options?: AnalysisOptions): Promise<TokenAnalytics[]> {
    try {
      const trending = await this.market.getTrendingTokens(limit);
      return Promise.all(
        trending.map(token => 
          this.analyzeToken(token.address, token.symbol, token.name, options)
        )
      );
    } catch (error) {
      console.error('Error fetching trending tokens:', error);
      throw error;
    }
  }

  clearCache(): void {
    this.analysisCache.clear();
    this.market.clearCache();
  }
}