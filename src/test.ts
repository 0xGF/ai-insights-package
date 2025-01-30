// src/test.ts
import { TokenAnalyzer } from './index';
import dotenv from 'dotenv';
dotenv.config();

// Validate environment
const requiredEnvVars = ['BIRDEYE_API_KEY', 'TWITTER_BEARER_KEY', 'OPENAI_API_KEY'] as const;
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

async function testTokenLookup() {
  const config = {
    birdseyeApiKey: process.env.BIRDEYE_API_KEY!,
    twitterApiKey: process.env.TWITTER_BEARER_KEY,
    openaiApiKey: process.env.OPENAI_API_KEY,
  };

  try {
    const analyzer = new TokenAnalyzer(config);

    const result = await analyzer.analyze('VINE', {
      includeSocial: true,
      includeSentiment: true,
      includeTechnical: true
    });
    
    const serializedResult = JSON.stringify(result, (key, value) => 
      typeof value === 'bigint' ? value.toString() : value, 
      2
    );
    
    console.log(serializedResult);
    
  } catch (error) {
    console.error('Error during token lookup:', error);
  }
}

console.log('Starting token lookup tests...');
testTokenLookup()
  .catch(console.error)
  .finally(() => console.log('Tests completed'));