// src/services/onchain.ts
import { PublicKey } from "@solana/web3.js";
import { TokenData } from "../types/token";
import { Throttle } from "../utils/throttle";

export class OnChainService {
  private readonly birdseyeThrottle: Throttle;

  constructor(private readonly birdseyeApiKey: string) {
    this.birdseyeThrottle = new Throttle(5, 1000);
  }

  async getTokenData(address: string): Promise<TokenData> {
    try {
      console.log('Fetching token data for:', address);
      
      // Get both metadata and market data in parallel
      const [metadata, marketData] = await Promise.all([
        this.fetchMetadata(address),
        this.fetchMarketData(address)
      ]);

      console.log('Received metadata:', metadata);
      console.log('Received market data:', marketData);

      if (!metadata.success || !metadata.data) {
        throw new Error("Failed to fetch token metadata");
      }

      const meta = metadata.data;
      const market = marketData?.data;

      // Convert floating point numbers to integers using decimals
      const decimals = meta.decimals || 0;
      const multiplier = Math.pow(10, decimals);
      
      // Convert supply to integer before BigInt conversion
      const totalSupply = market?.supply 
        ? BigInt(Math.floor(market.supply * multiplier))
        : BigInt(0);

      // Convert volume to integer before BigInt conversion
      const volume24h = market?.volume_24h
        ? BigInt(Math.floor(market.volume_24h * multiplier))
        : BigInt(0);

      return {
        mint: new PublicKey(address),
        symbol: meta.symbol || "",
        name: meta.name || "",
        decimals: decimals,
        totalSupply: totalSupply,
        holderCount: market?.holders || 0,
        volume24h: volume24h,
        chainId: 1, // Solana mainnet
        mintAuthority: meta.mint_authority || null,
        freezeAuthority: meta.freeze_authority || null,
        verified: meta.verified || false,
        extensions: meta.extensions || {}
      };
    } catch (error) {
      console.error('Error in getTokenData:', error);
      throw error;
    }
  }

  private async fetchMetadata(address: string): Promise<any> {
    return this.birdseyeThrottle.add(async () => {
      const response = await fetch(
        `https://public-api.birdeye.so/defi/v3/token/meta-data/single?address=${address}`,
        {
          method: 'GET',
          headers: {
            'accept': 'application/json',
            'x-chain': 'solana',
            'X-API-KEY': this.birdseyeApiKey
          }
        }
      );
      
      if (!response.ok) {
        throw new Error('Birdeye metadata API error');
      }
      return response.json();
    });
  }

  private async fetchMarketData(address: string): Promise<any> {
    return this.birdseyeThrottle.add(async () => {
      const response = await fetch(
        `https://public-api.birdeye.so/defi/v3/token/market-data?address=${address}`,
        {
          method: 'GET',
          headers: {
            'accept': 'application/json',
            'x-chain': 'solana',
            'X-API-KEY': this.birdseyeApiKey
          }
        }
      );
      
      if (!response.ok) {
        throw new Error('Birdeye market data API error');
      }
      return response.json();
    });
  }
}