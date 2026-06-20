# Technology Stack

**Analysis Date:** 2026-03-22

## Languages

**Primary:**
- TypeScript 5.9.3 - Core application logic and type definitions

**Secondary:**
- JavaScript - Implicit (output targets ES2022)

## Runtime

**Environment:**
- Node.js (no specific version enforced)

**Package Manager:**
- npm (implied by package-lock.json presence)
- Lockfile: Present

## Frameworks

**Core:**
- @actual-app/api 26.3.0 - Budget management and transaction import/export
- Built-in Node.js modules (fs, crypto) - File system operations and UUID generation

**Build/Dev:**
- tsx 4.21.0 - TypeScript execution runner for development and CLI
- typescript 5.9.3 - Type checking and compilation

## Key Dependencies

**Critical:**
- @actual-app/api 26.3.0 - Provides SDK for connecting to Actual Budget server, importing transactions, and managing accounts
- dotenv 17.3.1 - Environment variable loading from .env files

**Development:**
- @types/node 25.5.0 - Node.js type definitions

## Configuration

**Environment:**
- Configuration via .env file (see .env.example)
- Required environment variables:
  - `COSTCO_AUTH_TOKEN` - Bearer token for Costco API authentication
  - `COSTCO_CLIENT_ID` - Costco API client identifier
  - `ACTUAL_SERVER_URL` - URL to Actual Budget server (e.g., https://actual.tower.local)
  - `ACTUAL_PASSWORD` - Password for Actual Budget account
  - `ACTUAL_BUDGET_ID` - Budget ID in Actual instance

**Build:**
- tsconfig.json: ES2022 target, strict mode enabled
- Output: ES2022 modules with bundler resolution

## Platform Requirements

**Development:**
- Node.js (no minimum version specified)
- npm for package management
- Unix-like environment (Bash/Zsh scripting in src)

**Production:**
- Node.js runtime
- Actual Budget server instance accessible at ACTUAL_SERVER_URL
- Network access to Costco GraphQL API (ecom-api.costco.com)
- Temporary cache directory at `/tmp/actual-costco-cache` (or configurable)

---

*Stack analysis: 2026-03-22*
