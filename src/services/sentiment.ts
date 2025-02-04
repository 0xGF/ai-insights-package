// src/services/sentiment.ts
import { OpenAI } from "openai";
import { SentimentAnalysis, Tweet } from "../types/token";
import { Throttle } from "../utils/throttle";

export class SentimentService {
  private readonly openai: OpenAI;
  private readonly openaiThrottle: Throttle;
  private readonly cache: Map<string, { analysis: SentimentAnalysis; timestamp: number }>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey });
    this.cache = new Map();
    this.openaiThrottle = new Throttle(3, 1000); // 3 requests per second
  }

  async analyzeSentiment(tweets: Tweet[]): Promise<SentimentAnalysis> {
    try {
      // If no tweets, return neutral sentiment
      if (!tweets.length) {
        return {
          score: 0,
          magnitude: 0,
          aspects: []
        };
      }

      // Generate cache key from tweets
      const cacheKey = this.generateCacheKey(tweets);
      
      // Check cache
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        return cached.analysis;
      }

      const analysis = await this.performAnalysis(tweets);

      // Update cache
      this.cache.set(cacheKey, {
        analysis,
        timestamp: Date.now()
      });

      return analysis;
    } catch (error) {
      console.error('Error in analyzeSentiment:', error);
      // Return neutral sentiment on error
      return {
        score: 0,
        magnitude: 0,
        aspects: []
      };
    }
  }

  private generateCacheKey(tweets: Tweet[]): string {
    return tweets
      .map(t => `${t.id}-${t.createdAt.getTime()}`)
      .sort()
      .join('|');
  }

  private async performAnalysis(tweets: Tweet[]): Promise<SentimentAnalysis> {
    return this.openaiThrottle.add(async () => {
      try {
        const response = await this.openai.chat.completions.create({
          model: "gpt-4",
          messages: [
            {
              role: "system",
              content: "Analyze cryptocurrency tweets for sentiment. Return your analysis in valid JSON format with these exact fields: overall_sentiment_score (number -1 to 1), magnitude (number 0 to 10), and key_aspects (array of objects with aspect and sentiment_score)."
            },
            {
              role: "user",
              content: this.createAnalysisPrompt(tweets)
            }
          ],
          temperature: 0.3,
          max_tokens: 500
        });

        const content = response.choices[0].message.content;
        if (!content) {
          throw new Error('Empty response from OpenAI');
        }

        const cleanedContent = content.replace(/```json\s*|\s*```/g, '').trim();
        const result = JSON.parse(cleanedContent) as {
          overall_sentiment_score?: number;
          magnitude?: number;
          key_aspects?: Array<{
            aspect?: string;
            sentiment_score?: number;
          }>;
        };

        return {
          score: typeof result.overall_sentiment_score === 'number' ? result.overall_sentiment_score : 0,
          magnitude: typeof result.magnitude === 'number' ? result.magnitude : 0,
          aspects: result.key_aspects?.map(aspect => ({
            topic: String(aspect.aspect || ''),
            sentiment: typeof aspect.sentiment_score === 'number' ? aspect.sentiment_score : 0
          })) || []
        };
      } catch (error) {
        console.error('Error in performAnalysis:', error);
        return {
          score: 0,
          magnitude: 0,
          aspects: []
        };
      }
    });
  }

  private createAnalysisPrompt(tweets: Tweet[]): string {
    if (tweets.length === 0) {
      return `No tweets available for analysis. Please provide a neutral sentiment analysis in JSON format.`;
    }

    const tweetsSummary = tweets
      .map(tweet => {
        const engagement = tweet.likeCount + tweet.retweetCount * 2;
        return `Tweet (${engagement} engagement):
        Text: ${tweet.text}
        Author: ${tweet.authorId}
        Engagement: ${engagement} points
        Time: ${tweet.createdAt.toISOString()}`;
      })
      .join('\n\n');

    return `Analyze these cryptocurrency tweets and return a JSON object containing sentiment analysis:

${tweetsSummary}

Response must be a valid JSON object with this exact structure:
{
  "overall_sentiment_score": 0.5,
  "magnitude": 1.0,
  "key_aspects": [
    {
      "aspect": "price movement",
      "sentiment_score": 0.7
    }
  ]
}`;
  }
}