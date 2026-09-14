import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        module:           'CommonJS',
        moduleResolution: 'node',
        jsx:              'react-jsx',
      },
    }],
    // Transform ESM-only packages (d3 and its sub-packages)
    '^.+\\.js$': ['ts-jest', {
      tsconfig: {
        module:           'CommonJS',
        moduleResolution: 'node',
        allowJs:          true,
      },
    }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(d3|d3-[a-z-]+|internmap|delaunator|robust-predicates)/)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  collectCoverageFrom: [
    'lib/**/*.ts',
    'components/**/*.tsx',
    '!**/*.d.ts',
  ],
};

export default config;
