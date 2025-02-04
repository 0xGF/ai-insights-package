export interface BirdeyeSearchItem {
    type: string;
    result: Array<{
      address: string;
      symbol: string;
      name: string;
      liquidity: number;
      volume_24h_usd: number;
      price: number;
      last_trade_human_time: string;
      verified: boolean;
    }>;
  }
  
  export interface BirdeyeSearchResponse {
    success: boolean;
    data?: {
      items: BirdeyeSearchItem[];
    };
  }