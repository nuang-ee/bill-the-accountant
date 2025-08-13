import { ethers } from 'ethers';

export const SUPPORTED_TOKENS: { [symbol: string]: { address: string; decimals: number } } = {
    'ETH': { address: '0x0000000000000000000000000000000000000000', decimals: 18 },
    'USDC': { address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', decimals: 6 } // Sepolia
};

export interface TokenInfo {
    address: string;
    decimals: number;
    symbol: string;
}

/**
 * Parses a token identifier (symbol or address) and returns token information
 * @param tokenIdentifier - Token symbol (e.g., "USDC") or address
 * @returns TokenInfo object with address, decimals, and symbol
 * @throws Error if token is not supported
 */
export function parseTokenIdentifier(tokenIdentifier: string): TokenInfo {
    const upperTokenIdentifier = tokenIdentifier.toUpperCase();
    
    // Check if it's a valid Ethereum address (case insensitive)
    if (ethers.isAddress(tokenIdentifier)) {
        return {
            address: ethers.getAddress(tokenIdentifier), // Normalize to checksum address
            decimals: 18, // Default to 18 decimals for unknown tokens
            symbol: tokenIdentifier.slice(0, 8) + '...' // Shortened address as symbol
        };
    } else if (SUPPORTED_TOKENS[upperTokenIdentifier]) {
        const tokenInfo = SUPPORTED_TOKENS[upperTokenIdentifier];
        return {
            address: tokenInfo.address,
            decimals: tokenInfo.decimals,
            symbol: upperTokenIdentifier
        };
    } else {
        throw new Error(`Invalid token: ${tokenIdentifier}. Supported tokens are ${Object.keys(SUPPORTED_TOKENS).join(', ')}, or a valid address.`);
    }
}

/**
 * Parses an amount string with the correct decimals for a given token
 * @param amountRaw - String representation of the amount (e.g., "10.5")
 * @param tokenInfo - Token information including decimals
 * @returns BigInt representation of the amount in the token's smallest unit
 * @throws Error if amount cannot be parsed or results in overflow
 */
export function parseTokenAmount(amountRaw: string, tokenInfo: TokenInfo): bigint {
    try {
        return ethers.parseUnits(amountRaw, tokenInfo.decimals);
    } catch (error) {
        if (error instanceof Error && error.message.includes('overflow')) {
            throw new Error(`Amount ${amountRaw} is too large for token ${tokenInfo.symbol} (${tokenInfo.decimals} decimals)`);
        }
        throw new Error(`Invalid amount format: ${amountRaw}`);
    }
}

/**
 * Formats a token amount for display
 * @param amount - BigInt amount in token's smallest unit
 * @param tokenInfo - Token information including decimals and symbol
 * @returns Formatted string with token symbol (e.g., "10.5 USDC")
 */
export function formatTokenAmount(amount: bigint, tokenInfo: TokenInfo): string {
    const formatted = ethers.formatUnits(amount, tokenInfo.decimals);
    return `${formatted} ${tokenInfo.symbol}`;
}

/**
 * Finds token info by address from supported tokens list
 * @param tokenAddress - The token contract address
 * @returns TokenInfo if found, null otherwise
 */
export function findTokenByAddress(tokenAddress: string): TokenInfo | null {
    for (const [symbol, info] of Object.entries(SUPPORTED_TOKENS)) {
        if (info.address.toLowerCase() === tokenAddress.toLowerCase()) {
            return {
                address: info.address,
                decimals: info.decimals,
                symbol: symbol
            };
        }
    }
    return null;
}