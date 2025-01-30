import { z } from "zod";

export const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().optional(),
  GROK_API_KEY: z.string().optional(),
  BIRDEYE_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;