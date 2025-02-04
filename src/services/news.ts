import OpenAI from 'openai';
import { Throttle } from '../utils/throttle';
import { AINewsAnalysis, AINewsAnalysisSchema, NewsItem, NewsAnalysis, NewsAnalysisSchema, NewsItemSchema } from '../types/news';
import { RSS_FEEDS } from '../constants/news';
import { XMLParser } from 'fast-xml-parser';

interface NewsConfig {
  maxArticles?: number;
  minRelevanceScore?: number;
  relevantSources?: string[];
  excludedDomains?: string[];
  cacheTTL?: number;
}

export class NewsService {
  private readonly openai: OpenAI;
  private readonly gptThrottle: Throttle;
  private readonly cache: Map<string, { data: AINewsAnalysis; timestamp: number }>;
  private readonly xmlParser: XMLParser;
  private readonly CACHE_TTL: number;
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000;

  constructor(
    openaiApiKey: string,
    private readonly config: NewsConfig = {}
  ) {
    if (!openaiApiKey) throw new Error('OPENAI_API_KEY is required');
    
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.cache = new Map();
    this.gptThrottle = new Throttle(3, 1000);
    this.CACHE_TTL = config.cacheTTL || 5 * 60 * 1000; // 5 minutes default
    
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      textNodeName: "_text",
      isArray: (name) => name === 'item',
      transformTagName: (tagName) => tagName,
      tagValueProcessor: (tagName, tagValue) => {
        if (typeof tagValue === 'string') {
          return this.decodeHTMLEntities(tagValue.trim());
        }
        return tagValue;
      }
    });
  }

  async getNewsAnalysis(symbol: string | null = null, tokenName: string | null = null): Promise<AINewsAnalysis> {
    try {
      const cacheKey = this.generateCacheKey(symbol, tokenName);
      const cachedResult = this.getFromCache(cacheKey);
      if (cachedResult) return cachedResult;

      const articles = await this.fetchNewsArticles(symbol || '', tokenName);
      if (!articles.length) {
        throw new Error('No articles found matching the search criteria');
      }

      // Filter articles based on relevance score
      const relevantArticles = articles.slice(0, this.config.maxArticles || 50);
      const gptAnalysis = await this.getDetailedGPTAnalysis(symbol || 'all', tokenName, relevantArticles);

      const newsAnalysis: NewsAnalysis = {
        articles: relevantArticles,
        aiAnalysis: gptAnalysis,
        lastUpdated: new Date()
      };

      const validated = NewsAnalysisSchema.parse(newsAnalysis);
      this.setCache(cacheKey, validated.aiAnalysis);

      return validated.aiAnalysis;
    } catch (error) {
      console.error('Error in getNewsAnalysis:', error);
      throw this.handleError(error);
    }
  }

  private async fetchNewsArticles(symbol: string, name: string | null): Promise<NewsItem[]> {
    const searchTerms = this.generateSearchTerms(symbol, name);
    const fetchPromises = RSS_FEEDS
      .filter(feed => this.isAllowedSource(feed))
      .map(feed => this.fetchFeedWithRetry(feed, searchTerms));

    const results = await Promise.allSettled(fetchPromises);
    const articles = results
      .filter((result): result is PromiseFulfilledResult<NewsItem[]> => result.status === 'fulfilled')
      .flatMap(result => result.value);

    return this.deduplicateAndSortArticles(articles);
  }

  private async fetchFeedWithRetry(feedUrl: string, searchTerms: string[]): Promise<NewsItem[]> {
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        const articles = await this.fetchAndParseRSSFeed(feedUrl, searchTerms);
        return articles;
      } catch (error) {
        if (attempt === this.MAX_RETRIES - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * Math.pow(2, attempt)));
      }
    }
    return [];
  }

  private async fetchAndParseRSSFeed(url: string, searchTerms: string[]): Promise<NewsItem[]> {
    const response = await fetch(url, {
      headers: {
        'User-Agent': this.getRandomUserAgent(),
        'Accept': 'application/rss+xml, application/xml'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} for ${url}`);
    }

    const xml = await response.text();
    const parsed = this.xmlParser.parse(xml);
    const items = this.extractItemsFromParsedXML(parsed);

    return items
      .filter(item => this.isRelevantArticle(item, searchTerms))
      .map((item, index) => this.createNewsItem(item, url, index))
      .slice(0, this.config.maxArticles || 50);
  }

  private extractItemsFromParsedXML(parsed: any): any[] {
    const channel = parsed.rss?.channel || parsed.feed;
    if (!channel) throw new Error('Invalid RSS format');
    
    const items = channel.item || channel.entry || [];
    return Array.isArray(items) ? items : [items];
  }

  private createNewsItem(item: any, feedUrl: string, index: number): NewsItem {
    const pubDate = this.parseDate(item.pubDate || item.published || item.updated);
    
    return NewsItemSchema.parse({
      id: `${feedUrl}-${index}`,
      title: this.extractTextContent(item.title),
      summary: this.extractTextContent(item.description || item.summary || ''),
      url: item.link?.href || item.link || '',
      publishedAt: pubDate,
      source: new URL(feedUrl).hostname
    });
  }

  private async getDetailedGPTAnalysis(
    symbol: string,
    tokenName: string | null,
    articles: NewsItem[]
  ): Promise<AINewsAnalysis> {
    return this.gptThrottle.add(async () => {
      const prompt = this.generateAnalysisPrompt(symbol, tokenName, articles);
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{
          role: "system",
          content: prompt
        }, {
          role: "user",
          content: JSON.stringify(articles)
        }],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      const analysis = JSON.parse(completion.choices[0]?.message?.content || '{}');
      return AINewsAnalysisSchema.parse(analysis);
    });
  }

  // Helper methods
  private generateCacheKey(symbol: string | null, tokenName: string | null): string {
    return `${symbol || 'all'}_${tokenName || 'all'}`;
  }

  private getFromCache(key: string): AINewsAnalysis | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: AINewsAnalysis): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  private generateSearchTerms(symbol: string, name: string | null): string[] {
    const terms = [symbol.toLowerCase()];
    if (name) terms.push(name.toLowerCase());
    return terms;
  }

  private isAllowedSource(feedUrl: string): boolean {
    const domain = new URL(feedUrl).hostname;
    if (this.config.excludedDomains?.includes(domain)) return false;
    if (this.config.relevantSources?.length && !this.config.relevantSources.includes(domain)) return false;
    return true;
  }

  private filterArticles(articles: NewsItem[]): NewsItem[] {
    // First apply source filtering if configured
    let filtered = articles;
    if (this.config.relevantSources?.length) {
      filtered = filtered.filter(article => 
        this.config.relevantSources?.includes(new URL(article.url).hostname)
      );
    }

    // Remove articles from excluded domains
    if (this.config.excludedDomains?.length) {
      filtered = filtered.filter(article => 
        !this.config.excludedDomains?.includes(new URL(article.url).hostname)
      );
    }

    // Apply max articles limit
    filtered = filtered.slice(0, this.config.maxArticles || 50);

    return this.deduplicateAndSortArticles(filtered);
  }

  private deduplicateAndSortArticles(articles: NewsItem[]): NewsItem[] {
    const uniqueArticles = Array.from(
      new Map(articles.map(article => [article.url, article])).values()
    );
    
    return uniqueArticles.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }

  private isRelevantArticle(item: any, searchTerms: string[]): boolean {
    const content = `${this.extractTextContent(item.title)} ${this.extractTextContent(item.description || item.summary || '')}`.toLowerCase();
    return searchTerms.some(term => content.includes(term));
  }

  private extractTextContent(content: any): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (content.__cdata) return content.__cdata;
    if (content._text) return content._text;
    return '';
  }

  private parseDate(dateStr: string): Date {
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) Chrome/91.0.4472.124'
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  private generateAnalysisPrompt(symbol: string, tokenName: string | null, articles: NewsItem[]): string {
    return `Analyze the following news articles about ${tokenName || symbol} and provide a comprehensive analysis in JSON format.

Your response must exactly match this structure:
{
  "marketSentiment": string (either "bullish", "bearish", or "neutral"),
  "keyTrends": [
    {
      "trend": string (name of the trend),
      "description": string (detailed explanation)
    }
  ],
  "impactAnalysis": [
    {
      "factor": string (name of the impact factor),
      "impact": string (either "positive", "negative", or "neutral"),
      "description": string (detailed explanation)
    }
  ],
  "riskLevel": string (either "low", "medium", or "high")
}

Requirements:
1. Each keyTrends item must be an object with trend and description
2. Each impactAnalysis item must be an object with factor, impact, and description
3. Provide at least 3 key trends and impact factors
4. Keep descriptions concise but informative
5. Use factual, data-driven analysis
6. Base sentiment and risk on quantifiable factors

Focus on recent developments, market movements, and technical indicators.`;
  }

  private handleError(error: unknown): Error {
    if (error instanceof Error) {
      return error;
    }
    return new Error('An unexpected error occurred in NewsService');
  }

  private decodeHTMLEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#039;': "'",
      '&apos;': "'",
      '&nbsp;': ' '
    };
    return text.replace(/&[^;]+;/g, match => entities[match] || match);
  }

  clearCache(): void {
    this.cache.clear();
  }
}