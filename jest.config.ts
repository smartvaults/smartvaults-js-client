import type { Config } from 'jest';
import 'websocket-polyfill'

const config: Config = {
  verbose: true,
  moduleFileExtensions: [
    "ts",
    "js",
  ],
  transform: {
    "^.+\\.(ts?)$": "ts-jest",
  },
  testPathIgnorePatterns: [
    "<rootDir>/node_modules",
    "<rootDir>/dist"
  ],
  testRegex: "(/src/.*(\\.|/)(test|spec))\\.(jsx?|tsx?)$",
  testEnvironment: "./jest-environment-jsdom.js"
};

export default config;