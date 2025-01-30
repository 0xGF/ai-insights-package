import { SocialMetrics, Tweet, SocialMetricsSchema, TwitterConfig, MarketDataInput, AIAnalysis, AIAnalysisSchema } from '../types/token';
import { Throttle } from '../utils/throttle';
import OpenAI from 'openai';
import { TwitterAPIResponse, TokenInfo } from '../types/token';
import { defaultTwitterConfig } from '../constants/twitter';

export class SocialService {
  private readonly TWITTER_API_URL = 'https://api.twitter.com/2/tweets/search/recent';
  private readonly twitterToken: string;
  private readonly openai: OpenAI;
  private readonly gptThrottle: Throttle;
  private readonly cache: Map<string, { data: SocialMetrics; timestamp: number }>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly defaultConfig: TwitterConfig = defaultTwitterConfig;

  constructor(
    twitterApiKey: string, 
    openaiApiKey: string,
    private readonly twitterConfig: TwitterConfig = {}
  ) {
    if (!twitterApiKey) throw new Error('TWITTER_BEARER_KEY is required');
    if (!openaiApiKey) throw new Error('OPENAI_API_KEY is required');
    
    this.twitterToken = twitterApiKey;
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.cache = new Map();
    this.gptThrottle = new Throttle(3, 1000);
  }

  async getSocialMetrics(
    symbol: string,
    tokenName: string | null = null,
    marketData?: MarketDataInput
  ): Promise<SocialMetrics> {
    try {
      const cacheKey = `${symbol}_${tokenName || ''}_${JSON.stringify({
        ...marketData,
        volume24h: marketData?.volume24h ? marketData.volume24h.toString() : undefined
      })}`;
      
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }

      console.log(`Fetching real social data for ${symbol} (${tokenName || 'no name'})`);
      const tokenInfo = await this.getTokenInfo(symbol, tokenName);
      console.log(`Found ${tokenInfo.tweets.length} tweets`);

      // Filter to only include tweets from the last 48 hours
      const recentTweets = tokenInfo.tweets
        .filter(tweet => {
          const tweetAge = Date.now() - tweet.createdAt.getTime();
          const isRecent = tweetAge < (48 * 60 * 60 * 1000);
          if (!isRecent) {
            console.log(`Filtered out tweet from ${tweet.createdAt.toISOString()} (too old)`);
          }
          return isRecent;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      console.log(`Processing ${recentTweets.length} recent tweets`);

      const gptAnalysis = await this.getDetailedGPTAnalysis(
        symbol,
        tokenName,
        tokenInfo.about,
        recentTweets,
        marketData
      );

      const metrics: SocialMetrics = {
        mentionsCount: recentTweets.length,
        trendingScore: this.calculateTrendingScore(recentTweets),
        tweets: recentTweets,
        lastUpdated: new Date(),
        aiAnalysis: gptAnalysis,
      };

      console.log('Validating social metrics schema');
      const validated = SocialMetricsSchema.parse(metrics);

      this.cache.set(cacheKey, {
        data: validated,
        timestamp: Date.now(),
      });

      return validated;
    } catch (error) {
      console.error('Error in getSocialMetrics:', error);
      throw new Error(`Failed to fetch social metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async getTokenInfo(symbol: string, name: string | null): Promise<TokenInfo> {
    try {
      // Get real tweets from Twitter
      const tweets = await this.fetchTwitterData(symbol, name);
      
      // Get project description from GPT
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{
          role: "system",
          content: "You are a cryptocurrency expert. Provide concise, factual descriptions of crypto projects."
        }, {
          role: "user",
          content: `Provide a concise 2-3 sentence description of the ${name || symbol} cryptocurrency project. 
          Focus only on factual information about what the project is and its purpose. 
          If it's a 'Wrapped' token, describe the underlying asset.`
        }],
        temperature: 0.3
      });

      const about = completion.choices[0]?.message?.content || 
        `${name || symbol} is a cryptocurrency token.`;

      return {
        about,
        tweets: this.parseTweets(tweets)
      };
    } catch (error) {
      console.error('Error in getTokenInfo:', error);
      throw error;
    }
  }

  private async fetchTwitterData(symbol: string, name: string | null = null): Promise<TwitterAPIResponse> {
    try {
      const config = { ...this.defaultConfig, ...this.twitterConfig };
      const baseQuery = name ? `(${symbol} OR "${name}")` : symbol;
      
      // Build account filter if provided
      const accountFilter = config.relevantAccounts && config.relevantAccounts.length > 0
        ? ` (${config.relevantAccounts.map(account => `from:${account}`).join(' OR ')})`
        : '';

      const query = `${baseQuery} crypto 
        ${accountFilter}
        -"airdrop" -"presale" -"giveaway" -"whitelist"
        min_faves:${config.minLikes}
        min_retweets:${config.minRetweets}
        -has:links
        lang:en
        -is:retweet`.replace(/\s+/g, ' ').trim();

      const params = new URLSearchParams({
        query,
        'tweet.fields': 'created_at,public_metrics,author_id',
        'max_results': '100',
        'sort_order': 'relevancy'
      });

      console.log('Twitter search query:', query);

      const response = await fetch(`${this.TWITTER_API_URL}?${params}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.twitterToken}`,
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Twitter API Error Details:', {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Twitter API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      
      if (!data.data || !Array.isArray(data.data)) {
        console.warn('No tweets found or invalid response format:', data);
        return { data: [] };
      }

      // Use GPT to filter and rank tweets
      const relevantTweets = await this.filterTweetsWithGPT(
        data.data,
        symbol,
        name,
        config.maxTweets || 10
      );

      return {
        data: relevantTweets
      };
    } catch (error) {
      console.error('Error in fetchTwitterData:', error);
      throw error;
    }
  }

  private async filterTweetsWithGPT(
    tweets: any[], 
    symbol: string,
    name: string | null,
    maxTweets: number
  ): Promise<any[]> {
    try {
      const tweetsForAnalysis = tweets.map(t => ({
        id: t.id,
        text: t.text,
        metrics: t.public_metrics
      }));

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{
          role: "system",
          content: `You are an expert crypto analyst. Analyze these tweets about ${name || symbol} and:
          1. Filter out spam, promotional content, and low-quality posts
          2. Keep only informative, analytical, or noteworthy tweets from credible sources
          3. Rank them by relevance and information value
          4. Return only the top ${maxTweets} most relevant tweets
          5. Return ONLY tweet IDs in a JSON array, no explanation needed`
        }, {
          role: "user",
          content: JSON.stringify(tweetsForAnalysis)
        }],
        temperature: 0.1,
        response_format: { type: "json_object" }
      });

      const result = JSON.parse(completion.choices[0]?.message?.content || "{}");
      const relevantIds = new Set(result.relevant_tweets || []);

      return tweets.filter(t => relevantIds.has(t.id));
    } catch (error) {
      console.error('Error filtering tweets with GPT:', error);
      // Return original tweets if GPT filtering fails
      return tweets.slice(0, maxTweets);
    }
  }

  private parseTweets(twitterResponse: TwitterAPIResponse): Tweet[] {
    return twitterResponse.data.map(tweet => ({
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id,
      createdAt: new Date(tweet.created_at),
      likeCount: tweet.public_metrics.like_count,
      retweetCount: tweet.public_metrics.retweet_count,
      replyCount: tweet.public_metrics.reply_count,
      quoteCount: tweet.public_metrics.quote_count
    }));
  }

  private handlePriceTarget(analysis: any, marketData?: { price?: number | null }): void {
    if (marketData?.price === null || marketData?.price === undefined) {
      analysis.priceTarget = {
        short: null,
        medium: null,
        confidence: 0
      };
      return;
    }
  
    const currentPrice = marketData.price;
  
    if (typeof analysis.priceTarget?.short === 'number') {
      if (analysis.priceTarget.short > currentPrice * 2) {
        analysis.priceTarget.short = null;
        analysis.priceTarget.confidence = 0;
      }
      return;
    }
  
    if (typeof analysis.priceTarget?.short === 'string') {
      const shortTarget = Number(analysis.priceTarget.short.replace(/[$,]/g, ''));
      if (!isNaN(shortTarget) && shortTarget > currentPrice * 2) {
        analysis.priceTarget.short = null;
        analysis.priceTarget.confidence = 0;
      } else if (!isNaN(shortTarget)) {
        analysis.priceTarget.short = shortTarget;
      }
    }
  
    if (typeof analysis.priceTarget?.medium === 'string') {
      const mediumTarget = Number(analysis.priceTarget.medium.replace(/[$,]/g, ''));
      if (!isNaN(mediumTarget)) {
        analysis.priceTarget.medium = mediumTarget;
      }
    }
  }
  
  private calculateTrendingScore(tweets: Tweet[]): number {
    const now = new Date();
    const hourInMs = 3600000;
    const maxAge = 48 * hourInMs;
  
    return tweets.reduce((score, tweet) => {
      const age = now.getTime() - tweet.createdAt.getTime();
      if (age > maxAge) return score;
  
      const engagement = 
        tweet.likeCount + 
        tweet.retweetCount * 2 + 
        tweet.replyCount * 1.5 + 
        tweet.quoteCount * 1.8;
  
      const timeDecay = Math.exp(-age / (12 * hourInMs));
      return score + (engagement * timeDecay);
    }, 0);
  }

  private async getDetailedGPTAnalysis(
    symbol: string,
    tokenName: string | null,
    about: string,
    tweets: Tweet[],
    marketData?: MarketDataInput
  ): Promise<AIAnalysis> {
    return this.gptThrottle.add(async () => {
      const price = typeof marketData?.price === 'number' ? marketData.price : null;
      const currentPrice = price ? `$${price.toFixed(6)}` : 'Unknown';
      const priceChange = marketData?.priceChange24h ? 
        `${marketData.priceChange24h > 0 ? '+' : ''}${marketData.priceChange24h.toFixed(2)}%` : 
        'Unknown';
      
      let volume = 'Unknown';
      if (marketData?.volume24h && marketData.decimals) {
        const volumeValue = typeof marketData.volume24h === 'bigint' ? 
          marketData.volume24h : 
          BigInt(marketData.volume24h);
        volume = `$${(Number(volumeValue) / Math.pow(10, marketData.decimals)).toFixed(2)}`;
      }

      try {
        const completion = await this.openai.chat.completions.create({
          model: "gpt-4-turbo-preview",
          messages: [{
            role: "system",
            content: `You are a cryptocurrency market analyst. Analyze real social media data and market metrics.
            Always return your analysis in valid JSON format matching the specified structure.`
          }, {
            role: "user",
            content: `Analyze these real tweets and market data for ${symbol}${tokenName ? ` (${tokenName})` : ''}:

            PROJECT INFORMATION:
            ${about}

            CURRENT MARKET DATA:
            - Price: ${currentPrice}
            - 24h Change: ${priceChange}
            - 24h Volume: ${volume}

            RECENT TWEETS (Last 48 hours):
            ${tweets.map(t => `Tweet: ${t.text}
            Engagement: ${t.likeCount + t.retweetCount * 2}
            Posted: ${t.createdAt.toISOString()}
            `).join('\n')}

            Return your analysis in this exact JSON format:
            {
              "marketSentiment": {
                "direction": "bullish" | "bearish" | "neutral",
                "confidence": 0.0 to 1.0,
                "reasoning": "based on actual data provided"
              },
              "keyTrends": [
                {
                  "topic": "specific trend from tweets",
                  "sentiment": "positive/negative/neutral",
                  "importance": 0.0 to 1.0
                }
              ],
              "volumeAnalysis": {
                "trend": "based on actual volume data",
                "significance": 0.0 to 1.0
              },
              "riskLevel": 0 to 10,
              "priceTarget": {
                "short": price or null,
                "medium": price or null,
                "confidence": 0.0 to 1.0
              }
            }`
          }],
          temperature: 0.3,
          response_format: { type: "json_object" }
        });

        const analysisResponse = completion.choices[0]?.message?.content || '{}';
        let analysis = JSON.parse(analysisResponse);
        
        // Handle price targets
        this.handlePriceTarget(analysis, { price });

        // Adjust confidence based on data availability
        if (!tweets.length) {
          analysis.marketSentiment.confidence = Math.min(analysis.marketSentiment.confidence, 0.3);
        }
        if (!price) {
          analysis.marketSentiment.confidence = Math.min(analysis.marketSentiment.confidence, 0.4);
        }

        return AIAnalysisSchema.parse(analysis);
      } catch (error) {
        console.error('Error getting GPT analysis:', error);
        return {
          marketSentiment: {
            direction: 'neutral',
            confidence: 0.1,
            reasoning: 'Error processing market analysis'
          },
          keyTrends: [],
          volumeAnalysis: {
            trend: 'unknown',
            significance: 0
          },
          riskLevel: 5,
          priceTarget: {
            short: null,
            medium: null,
            confidence: 0
          }
        };
      }
    });

    
  }
}