import OpenAI from 'openai';
import { Throttle } from '../utils/throttle';
import { AINewsAnalysis, AINewsAnalysisSchema, NewsItem, NewsAnalysis, NewsAnalysisSchema } from '../types/news';
import { RSS_FEEDS } from '../constants/news';

interface NewsConfig {
  maxArticles?: number;
  minRelevanceScore?: number;
  relevantSources?: string[];
  excludedDomains?: string[];
}

export class NewsService {
  private readonly openai: OpenAI;
  private readonly gptThrottle: Throttle;
  private readonly cache: Map<string, { data: AINewsAnalysis; timestamp: number }>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    openaiApiKey: string,
    private readonly config: NewsConfig = {}
  ) {
    if (!openaiApiKey) throw new Error('OPENAI_API_KEY is required');
    
    this.openai = new OpenAI({ apiKey: openaiApiKey });
    this.cache = new Map();
    this.gptThrottle = new Throttle(3, 1000);
  }

  async getNewsAnalysis(symbol: string | null = null, tokenName: string | null = null): Promise<AINewsAnalysis> {
    try {
      const cacheKey = `${symbol || 'all'}_${tokenName || 'all'}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.data;
      }

      const articles = await this.fetchNewsArticles(symbol || '', tokenName);
      const gptAnalysis = await this.getDetailedGPTAnalysis(symbol || 'all', tokenName, articles);

      const newsAnalysis: NewsAnalysis = {
        articles: articles,
        aiAnalysis: gptAnalysis,
        lastUpdated: new Date()
      };

      const validated = NewsAnalysisSchema.parse(newsAnalysis);
      
      this.cache.set(cacheKey, {
        data: validated.aiAnalysis,
        timestamp: Date.now()
      });

      return validated.aiAnalysis;
    } catch (error) {
      console.error('Error in getNewsAnalysis:', error);
      throw error;
    }
  }

  private async fetchNewsArticles(symbol: string, name: string | null): Promise<NewsItem[]> {
    const allArticles: NewsItem[] = [];
    const searchTerms = [symbol.toLowerCase()];
    if (name) searchTerms.push(name.toLowerCase());

    for (const feedUrl of RSS_FEEDS) {
      try {
        const articles = await this.fetchAndParseRSSFeed(feedUrl, searchTerms);
        allArticles.push(...articles);
      } catch (error) {
        console.error(`Error fetching feed ${feedUrl}:`, error);
      }
    }

    console.log(`Fetched ${allArticles.length} articles for ${symbol} (${name || 'no name'})`);

    return allArticles;
  }

  private async filterArticlesWithGPT(
    articles: NewsItem[],
    symbol: string,
    name: string | null
  ): Promise<NewsItem[]> {
    const completion = await this.openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [{
        role: "system",
        content: `Analyze these articles about ${name || symbol} and return an array of relevant article IDs in JSON format, including fields like marketSentiment, keyTrends, impactAnalysis, and riskLevel.`
      }, {
        role: "user",
        content: JSON.stringify(articles)
      }],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    return articles.filter(a => result.relevant_articles?.includes(a.id));
  }

  private async getDetailedGPTAnalysis(
    symbol: string,
    tokenName: string | null,
    articles: NewsItem[]
  ): Promise<AINewsAnalysis> {
    return this.gptThrottle.add(async () => {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [{
          role: "system",
          content: `Analyze news articles about ${tokenName || symbol} and return analysis in JSON format, ensuring to include marketSentiment, keyTrends, impactAnalysis, and riskLevel.`
        }, {
          role: "user",
          content: JSON.stringify(articles)
        }],
        temperature: 0.3,
        response_format: { type: "json_object" }
      });

      console.log('Raw API response:', completion.choices[0]?.message?.content);

      const analysis = JSON.parse(completion.choices[0]?.message?.content || '{}');
      return AINewsAnalysisSchema.parse(analysis);
    });
  }

  private async fetchAndParseRSSFeed(url: string, searchTerms: string[]): Promise<NewsItem[]> {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) Chrome/91.0.4472.124'
    ];

    for (const userAgent of userAgents) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': userAgent,
            'Accept': 'application/rss+xml, application/xml'
          }
        });

        if (!response.ok) {
          if (response.status === 403) continue;
          throw new Error(`HTTP error: ${response.status}`);
        }

        const xml = await response.text();
        const items = this.parseXML(xml);
        
        return items
          .filter(item => {
            const content = (item.title + ' ' + item.description).toLowerCase();
            return searchTerms.some(term => content.includes(term));
          })
          .map((item, index) => ({
            id: `${url}-${index}`,
            title: this.decodeHTMLEntities(item.title),
            summary: this.decodeHTMLEntities(item.description),
            url: item.link,
            publishedAt: isNaN(Date.parse(item.pubDate)) ? new Date() : new Date(item.pubDate),
            source: new URL(url).hostname
          }));
      } catch (error) {
        if (userAgent === userAgents[userAgents.length - 1]) throw error;
      }
    }
    return [];
  }

  private parseXML(xml: string) {
    const itemRegex = /<item>[\s\S]*?<\/item>/g;
    const titleRegex = /<title>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/title>/;
    const linkRegex = /<link>(.*?)<\/link>/;
    const descriptionRegex = /<description>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/description>/;
    const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;

    return (xml.match(itemRegex) || []).map(item => ({
      title: (item.match(titleRegex)?.[1] || "").trim(),
      link: (item.match(linkRegex)?.[1] || "").trim(),
      description: (item.match(descriptionRegex)?.[1] || "").trim(),
      pubDate: (item.match(pubDateRegex)?.[1] || "").trim()
    }));
  }

  private decodeHTMLEntities(text: string): string {
    const entities: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#039;': "'",
        '&apos;': "'"
      };
    return text.replace(/&amp;|&lt;|&gt;|&quot;|&#039;|&apos;/g, match => entities[match]);
  }

  clearCache(): void {
    this.cache.clear();
  }
}