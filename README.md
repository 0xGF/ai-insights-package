# ai-insights-package

This package is a collection of tools for analyzing Solana tokens and news. You can use it to gain insights using onchain, birdeye, recent twitter posts and news articles scraped from the web.

## Configuration

The project uses environment variables for configuration. You can set these in a `.env` file. An example configuration is provided in `.env.example`.

## Quick Start (change token in test-token.ts)

- `pnpm install`
- `pnpm build`
- `pnpm news`
- `pnpm token`

## Scripts

- `pnpm build`: Compiles the TypeScript code.
- `pnpm test`: Runs the test suite using Jest.
- `pnpm prepare`: Prepares the package for publishing by running the build script.
- `pnpm prepublishOnly`: Ensures tests pass before publishing.
- `pnpm news`: Runs the news analysis script.
- `pnpm token`: Runs the token analysis script.

## Dependencies

- `@solana/web3.js`: Solana JavaScript API.
- `dotenv`: Loads environment variables from a `.env` file.
- `openai`: OpenAI API client.
- `zod`: TypeScript-first schema validation.

## Development Dependencies

- `@types/jest`: Type definitions for Jest.
- `@types/node`: Type definitions for Node.js.
- `jest`: JavaScript testing framework.
- `ts-jest`: TypeScript preprocessor for Jest.
- `typescript`: TypeScript language.

## License

This project is licensed under the MIT License.

## Author

0xGF

# ai-insights-package
