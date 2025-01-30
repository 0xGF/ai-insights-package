## Configuration

The project uses environment variables for configuration. You can set these in a `.env` file. An example configuration is provided in `.env.example`.

## Quickstart (ONLY TO TEST WITHOUT BUILDING)
- Copy env.example to .env
- Add twiter bearer key, birdeye key, openai api key
- `nvm use 20`: Use updated node (optional).
- `pnpm i`: PNPM install.
- `npx ts-node src/test.ts`: RUN test.js

## Scripts

- `pnpm build`: Compiles the TypeScript code.
- `pnpm test`: Runs the test suite using Jest.
- `pnpm prepare`: Prepares the package for publishing by running the build script.
- `pnpm prepublishOnly`: Ensures tests pass before publishing.

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

Your Name
# ai-insights-package
