# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **draft** blockchain-based bill splitting application called "BillTheAccountant" that enables automated, transparent P2P debt management. The ultimate goal is to let users register and manage debts on-chain through natural Discord conversations.

**Current State (Draft):**
1. **Smart Contract** (`contracts/BillTheAccountant.sol`) - On-chain debt ledger with propose-confirm workflow
2. **Discord Bot** (`src/bot.ts`) - Manual command interface for debt management
3. **Web Server** (`src/server.ts`) - Express server component

**Target Vision:**
- Users discuss expenses naturally in Discord (e.g., "I paid $50 for pizza for me, Alice, and Bob")
- Bot automatically understands context and proposes appropriate debt splits
- All debts tracked on-chain with full message context and history

## Architecture

### Core Design Philosophy
- **On-chain debt netting**: Instead of tracking individual bills, the system maintains net balances between user pairs
- **Propose-confirm workflow**: All debts require confirmation from the debtor before being added to the ledger
- **Event-based history**: Complete transaction history is maintained via contract events, not storage
- **Gas efficiency**: Storage grows with user pairs, not number of transactions

### Smart Contract Architecture
- Uses nested mapping: `tokenAddress => debtor => creditor => amount`
- Automatic debt netting when new debts are added
- Pending debts system with approval/rejection workflow
- Events for complete audit trail (`DebtAdded`, `DebtProposed`, `DebtConfirmed`, `DebtRejected`, `DebtSettled`)
- **Limitation:** Current memo field is short string - needs expansion for full message context

### Bot Architecture
- Maps Discord users to Ethereum wallet addresses using on-chain registry
- Manages pending debt proposals and confirmations
- Provides balance checking and transaction history
- Uses on-chain storage for all user data and debt state management
- **Needs Enhancement:** Currently manual command-driven, should evolve to message parsing

## Development Commands

### Smart Contract Development
- `npx hardhat compile` - Compile Solidity contracts
- `npx hardhat test` - Run contract tests
- `npx hardhat node` - Start local blockchain node
- `npx hardhat run scripts/deploy.ts --network localhost` - Deploy to local network
- `npx hardhat coverage` - Generate test coverage report

### Bot Development  
- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run bot in development mode (ts-node)
- `npm start` - Run compiled bot from dist/
- `npm run start-local` - Start local Hardhat node

### Testing
- Smart contract tests are in `test/BillTheAccountant.ts` using Chai/Mocha
- Token utility tests are in `test/tokenUtils.test.ts` - **critical for preventing decimal parsing bugs**
- Tests cover debt proposal/confirmation, netting logic, settlement, rejection workflows, and token parsing
- **Important**: Run `npm test` before any token-related changes to prevent decimal overflow regressions

## Key Files and Structure

### Contracts (`contracts/`)
- `BillTheAccountant.sol` - Main debt ledger contract with propose-confirm workflow
- `MockERC20.sol` - Test token for development

### Source Code (`src/`)
- `bot.ts` - Discord bot with commands: register, add-debt, balance, history, help
- `tokenUtils.ts` - **Critical utilities for token parsing with correct decimal handling**
- `server.ts` - Express server component

### Configuration
- `hardhat.config.ts` - Hardhat configuration for Solidity 0.8.20
- `tsconfig.json` - TypeScript configuration targeting ES2020
- `.env` - Environment variables (DISCORD_TOKEN, RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS)

### Data Files
- `typechain-types/` - Generated TypeScript contract interfaces
- **Note:** User registration and debt state are now stored on-chain via the smart contract

## Environment Setup

Required environment variables in `.env`:
- `DISCORD_TOKEN` - Discord bot token
- `RPC_URL` - Blockchain RPC endpoint
- `PRIVATE_KEY` - Bot wallet private key
- `CONTRACT_ADDRESS` - Deployed contract address

## Roadmap & Development Priorities

### 1. Automated Bill Detection (Priority 1)
**Goal:** Bot should automatically understand natural Discord messages about expenses and propose debt splits.

**Current Limitation:** Manual `>add-debt` commands with short memo text
**Target:** Parse messages like "I paid $50 for dinner for me, Alice, and Bob" and auto-propose debts

**Implementation Considerations:**
- Need multiline memo support in smart contract for full message context
- Include Discord message links in debt descriptions for traceability
- Message parsing logic to identify expenses, amounts, and participants
- Natural language understanding for bill splitting scenarios

### 2. Unified Balance/History View (Priority 2) 
**Goal:** Show all debts across all currencies in single view
**Current:** Requires specifying token for balance/history commands
**Target:** `>balance @user` and `>history @user` show complete multi-currency overview

### 3. Enhanced Debt Context
**Need:** Longer, more descriptive debt memos that can include:
- Original Discord message content
- Message links for reference
- Multi-line descriptions
- Expense breakdowns

## Current Discord Bot Commands

- `>register` - Create new wallet for user
- `>add-debt @user <amount> [token] <memo>` - Propose debt to another user *(needs enhancement for longer memos)*
- `>balance @user <token>` - Check net balance with another user *(needs multi-currency support)*
- `>history @user` - View transaction history with another user *(needs multi-currency support)*
- `>help` - Show available commands

## Testing Patterns

The test suite demonstrates key patterns:
- Event extraction from transaction receipts
- Pending debt ID management 
- Multi-step propose-confirm workflows
- ERC20 token approval and settlement
- Debt netting verification