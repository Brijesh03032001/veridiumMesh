import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

// next/jest automatically sets up the transform, moduleNameMapper, and
// testEnvironment. We only need to add our own overrides here.
const config: Config = {
  coverageProvider: "v8",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    // Resolve @/* TypeScript path alias
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

export default createJestConfig(config);
