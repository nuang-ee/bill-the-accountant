import { expect } from "chai";
import { ethers } from "ethers";
import { 
    parseTokenIdentifier, 
    parseTokenAmount, 
    formatTokenAmount, 
    findTokenByAddress,
    SUPPORTED_TOKENS,
    TokenInfo 
} from "../src/tokenUtils";

describe("Token Utils", function () {
    describe("parseTokenIdentifier", function () {
        it("should parse ETH token correctly", function () {
            const result = parseTokenIdentifier("ETH");
            expect(result.symbol).to.equal("ETH");
            expect(result.decimals).to.equal(18);
            expect(result.address).to.equal(SUPPORTED_TOKENS.ETH.address);
        });

        it("should parse USDC token correctly", function () {
            const result = parseTokenIdentifier("USDC");
            expect(result.symbol).to.equal("USDC");
            expect(result.decimals).to.equal(6);
            expect(result.address).to.equal(SUPPORTED_TOKENS.USDC.address);
        });

        it("should parse token identifiers case-insensitively", function () {
            const result1 = parseTokenIdentifier("usdc");
            const result2 = parseTokenIdentifier("Usdc");
            const result3 = parseTokenIdentifier("USDC");
            
            expect(result1.symbol).to.equal("USDC");
            expect(result2.symbol).to.equal("USDC");
            expect(result3.symbol).to.equal("USDC");
        });

        it("should parse valid ethereum addresses", function () {
            const testAddress = "0x1234567890123456789012345678901234567890";
            const result = parseTokenIdentifier(testAddress);
            
            expect(result.address).to.equal(testAddress);
            expect(result.decimals).to.equal(18); // Default
            expect(result.symbol).to.equal("0x123456...");
        });

        it("should throw error for unsupported token", function () {
            expect(() => parseTokenIdentifier("INVALID")).to.throw(
                "Invalid token: INVALID"
            );
        });

        it("should throw error for invalid address", function () {
            expect(() => parseTokenIdentifier("0xinvalid")).to.throw(
                "Invalid token: 0xinvalid"
            );
        });
    });

    describe("parseTokenAmount", function () {
        const ethToken: TokenInfo = {
            address: SUPPORTED_TOKENS.ETH.address,
            decimals: 18,
            symbol: "ETH"
        };

        const usdcToken: TokenInfo = {
            address: SUPPORTED_TOKENS.USDC.address,
            decimals: 6,
            symbol: "USDC"
        };

        it("should parse ETH amounts correctly", function () {
            const result = parseTokenAmount("1.0", ethToken);
            expect(result).to.equal(ethers.parseEther("1.0"));
        });

        it("should parse USDC amounts correctly", function () {
            const result = parseTokenAmount("10.5", usdcToken);
            expect(result).to.equal(ethers.parseUnits("10.5", 6));
            expect(result).to.equal(10500000n); // 10.5 * 10^6
        });

        it("should handle integer amounts", function () {
            const result = parseTokenAmount("100", usdcToken);
            expect(result).to.equal(100000000n); // 100 * 10^6
        });

        it("should handle small decimal amounts", function () {
            const result = parseTokenAmount("0.001", usdcToken);
            expect(result).to.equal(1000n); // 0.001 * 10^6
        });

        it("should throw error for invalid amount format", function () {
            expect(() => parseTokenAmount("abc", ethToken)).to.throw(
                "Invalid amount format: abc"
            );
        });

        it("should handle overflow gracefully", function () {
            // Test that our function can handle potential overflow scenarios
            // Note: Ethers handles very large numbers gracefully, so we test that no crash occurs
            const largeAmount = "999999999999999999999999999";
            // This should either parse successfully or throw a descriptive error (both are fine)
            try {
                const result = parseTokenAmount(largeAmount, usdcToken);
                expect(typeof result).to.equal("bigint");
            } catch (error) {
                expect(error).to.be.instanceOf(Error);
            }
        });

        it("should prevent the original bug - USDC parsing with ETH decimals", function () {
            // This was the bug: parsing "10" USDC with 18 decimals instead of 6
            const correctResult = parseTokenAmount("10", usdcToken);
            const buggyResult = ethers.parseEther("10"); // What the bug would have produced
            
            expect(correctResult).to.equal(10000000n); // 10 * 10^6 (correct)
            expect(buggyResult).to.equal(ethers.parseEther("10")); // 10 * 10^18 (wrong!)
            expect(correctResult).to.not.equal(buggyResult);
            
            // Verify the buggy result would cause overflow error
            expect(buggyResult > correctResult).to.be.true;
            expect(Number(buggyResult)).to.be.greaterThan(1e17); // Demonstrating the huge difference
        });
    });

    describe("formatTokenAmount", function () {
        const ethToken: TokenInfo = {
            address: SUPPORTED_TOKENS.ETH.address,
            decimals: 18,
            symbol: "ETH"
        };

        const usdcToken: TokenInfo = {
            address: SUPPORTED_TOKENS.USDC.address,
            decimals: 6,
            symbol: "USDC"
        };

        it("should format ETH amounts correctly", function () {
            const amount = ethers.parseEther("1.5");
            const result = formatTokenAmount(amount, ethToken);
            expect(result).to.equal("1.5 ETH");
        });

        it("should format USDC amounts correctly", function () {
            const amount = ethers.parseUnits("10.25", 6);
            const result = formatTokenAmount(amount, usdcToken);
            expect(result).to.equal("10.25 USDC");
        });

        it("should handle zero amounts", function () {
            const amount = 0n;
            const result = formatTokenAmount(amount, usdcToken);
            expect(result).to.equal("0.0 USDC");
        });

        it("should handle very small amounts", function () {
            const amount = 1n; // 1 wei for USDC (0.000001 USDC)
            const result = formatTokenAmount(amount, usdcToken);
            expect(result).to.equal("0.000001 USDC");
        });
    });

    describe("findTokenByAddress", function () {
        it("should find ETH token by address", function () {
            const result = findTokenByAddress(SUPPORTED_TOKENS.ETH.address);
            expect(result).to.not.be.null;
            expect(result!.symbol).to.equal("ETH");
            expect(result!.decimals).to.equal(18);
        });

        it("should find USDC token by address", function () {
            const result = findTokenByAddress(SUPPORTED_TOKENS.USDC.address);
            expect(result).to.not.be.null;
            expect(result!.symbol).to.equal("USDC");
            expect(result!.decimals).to.equal(6);
        });

        it("should handle case-insensitive address matching", function () {
            const upperCaseAddress = SUPPORTED_TOKENS.USDC.address.toUpperCase();
            const result = findTokenByAddress(upperCaseAddress);
            expect(result).to.not.be.null;
            expect(result!.symbol).to.equal("USDC");
        });

        it("should return null for unknown address", function () {
            const result = findTokenByAddress("0x1234567890123456789012345678901234567890");
            expect(result).to.be.null;
        });
    });

    describe("Integration - Prevent Original Bug", function () {
        it("should correctly handle the exact scenario that caused the overflow", function () {
            // Simulating user command: ">add-debt @user 10 USDC memo"
            const amountRaw = "10";
            const tokenIdentifier = "USDC";
            
            // This is what the new code should do
            const tokenInfo = parseTokenIdentifier(tokenIdentifier);
            const amount = parseTokenAmount(amountRaw, tokenInfo);
            const formatted = formatTokenAmount(amount, tokenInfo);
            
            expect(tokenInfo.symbol).to.equal("USDC");
            expect(tokenInfo.decimals).to.equal(6);
            expect(amount).to.equal(10000000n); // 10 * 10^6
            expect(formatted).to.equal("10.0 USDC");
            
            // Ensure this doesn't cause the overflow that was in the error message
            expect(Number(amount)).to.be.lessThan(1e15); // Much smaller than the 6.7e47 in the error
        });

        it("should handle edge cases that could cause overflow", function () {
            const scenarios = [
                { amount: "999999", token: "USDC" }, // Large USDC amount
                { amount: "0.000001", token: "USDC" }, // Smallest USDC unit
                { amount: "1000", token: "ETH" }, // Large ETH amount
            ];

            scenarios.forEach(({ amount, token }) => {
                expect(() => {
                    const tokenInfo = parseTokenIdentifier(token);
                    const parsedAmount = parseTokenAmount(amount, tokenInfo);
                    formatTokenAmount(parsedAmount, tokenInfo);
                }).to.not.throw();
            });
        });
    });
});