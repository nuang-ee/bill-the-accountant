import { Client, GatewayIntentBits, Message, Partials, User, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, Interaction, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, TextChannel } from 'discord.js';
import dotenv from 'dotenv';
import { ethers, Contract, Wallet, JsonRpcProvider, EventLog, Log } from 'ethers';
import BillTheAccountantABI from '../artifacts/contracts/BillTheAccountant.sol/BillTheAccountant.json';
import { parseTokenIdentifier, parseTokenAmount, formatTokenAmount, findTokenByAddress, SUPPORTED_TOKENS } from './tokenUtils';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

// --- Configuration ---
const { DISCORD_TOKEN, RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS, GEMINI_API_KEY } = process.env;
const PREFIX = '>';

// Network configuration for block explorer links
function getBlockExplorerUrl(txHash: string): string | null {
    if (!RPC_URL) return null;
    
    if (RPC_URL.includes('localhost') || RPC_URL.includes('127.0.0.1')) {
        // Local network - no block explorer
        return null;
    } else if (RPC_URL.includes('mainnet')) {
        return `https://etherscan.io/tx/${txHash}`;
    } else if (RPC_URL.includes('sepolia')) {
        return `https://sepolia.etherscan.io/tx/${txHash}`;
    } else if (RPC_URL.includes('goerli')) {
        return `https://goerli.etherscan.io/tx/${txHash}`;
    }
    
    return null; // Unknown network
}

function getNetworkName(): string {
    if (!RPC_URL) return 'Unknown';
    
    if (RPC_URL.includes('localhost') || RPC_URL.includes('127.0.0.1')) {
        return 'Local Development';
    } else if (RPC_URL.includes('mainnet')) {
        return 'Ethereum Mainnet';
    } else if (RPC_URL.includes('sepolia')) {
        return 'Sepolia Testnet';
    } else if (RPC_URL.includes('goerli')) {
        return 'Goerli Testnet';
    }
    
    return 'Unknown Network';
}

// --- Basic Setup ---
if (!DISCORD_TOKEN || !RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    throw new Error("Missing environment variables. Please check your .env file.");
}

if (!GEMINI_API_KEY) {
    console.warn("⚠️ GEMINI_API_KEY not found. Automated bill detection will be disabled.");
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message, Partials.User], // Required for DMs
});

const provider = new JsonRpcProvider(RPC_URL);
const wallet = new Wallet(PRIVATE_KEY, provider);
const contract = new Contract(CONTRACT_ADDRESS, BillTheAccountantABI.abi, wallet);

// Initialize Gemini API client
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// --- Permission Guard Functions ---
async function safeSendMessage(message: Message, content: string, options?: any): Promise<void> {
    try {
        if (options) {
            await message.reply({ content, ...options });
        } else {
            await message.reply(content);
        }
    } catch (error: any) {
        console.error('Permission error sending message:', error);
        if (error.code === 50013) { // Missing Permissions
            console.log('❌ Permission for SEND_MESSAGES is not granted, please configure bot permissions');
        } else if (error.code === 50001) { // Missing Access
            console.log('❌ Permission for VIEW_CHANNEL is not granted, please configure bot permissions');
        } else {
            console.log(`❌ Permission error (${error.code}): ${error.message}`);
        }
    }
}

async function safeEditMessage(message: any, content?: string, options?: any): Promise<void> {
    try {
        if (content && options) {
            await message.edit({ content, ...options });
        } else if (content) {
            await message.edit(content);
        } else if (options) {
            await message.edit(options);
        }
    } catch (error: any) {
        console.error('Permission error editing message:', error);
        if (error.code === 50013) {
            console.log('❌ Permission for MANAGE_MESSAGES is not granted, please configure bot permissions');
        } else {
            console.log(`❌ Permission error editing message (${error.code}): ${error.message}`);
        }
    }
}

async function safeReact(message: Message, emoji: string): Promise<void> {
    try {
        await message.react(emoji);
    } catch (error: any) {
        console.error('Permission error adding reaction:', error);
        if (error.code === 50013) {
            console.log('❌ Permission for ADD_REACTIONS is not granted, please configure bot permissions');
        } else if (error.code === 50001) {
            console.log('❌ Permission for READ_MESSAGE_HISTORY is not granted, please configure bot permissions');
        } else {
            console.log(`❌ Permission error adding reaction (${error.code}): ${error.message}`);
        }
    }
}

async function safeRemoveReactions(message: Message): Promise<void> {
    try {
        await message.reactions.removeAll();
    } catch (error: any) {
        console.error('Permission error removing reactions:', error);
        if (error.code === 50013) {
            console.log('❌ Permission for MANAGE_MESSAGES is not granted, please configure bot permissions');
        } else {
            console.log(`❌ Permission error removing reactions (${error.code}): ${error.message}`);
        }
    }
}

async function safeSendDM(user: User, content?: string, options?: any): Promise<void> {
    try {
        if (content && options) {
            await user.send({ content, ...options });
        } else if (content) {
            await user.send(content);
        } else if (options) {
            await user.send(options);
        }
    } catch (error: any) {
        console.error('Permission error sending DM:', error);
        if (error.code === 50007) {
            console.log(`❌ Cannot send DM to ${user.tag} - user has DMs disabled or blocked the bot`);
        } else {
            console.log(`❌ Permission error sending DM (${error.code}): ${error.message}`);
        }
    }
}

async function safeInteractionReply(interaction: any, content?: string, options?: any): Promise<void> {
    try {
        const payload = content && options ? { content, ...options } : content ? content : options;
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload);
        } else {
            await interaction.reply(payload);
        }
    } catch (error: any) {
        console.error('Permission error with interaction:', error);
        if (error.code === 50013) {
            console.log('❌ Permission for sending interaction responses is not granted, please configure bot permissions');
        } else {
            console.log(`❌ Permission error with interaction (${error.code}): ${error.message}`);
        }
    }
}

async function safeShowModal(interaction: any, modal: any): Promise<void> {
    try {
        await interaction.showModal(modal);
    } catch (error: any) {
        console.error('Permission error showing modal:', error);
        console.log(`❌ Permission error showing modal (${error.code || 'unknown'}): ${error.message}`);
    }
}

// --- On-Chain Data Management ---
// WARNING: This stores private keys in memory which is INSECURE for production use!
// This is only for development/testing purposes.
const userPrivateKeys: { [address: string]: string } = {}; // Store private keys by address

// Helper functions for on-chain user management
async function getWalletForDiscordId(discordId: string): Promise<{ address: string; privateKey: string } | null> {
    try {
        const address = await contract.discordToWallet(discordId);
        if (address === ethers.ZeroAddress) {
            return null; // User not registered
        }
        const privateKey = userPrivateKeys[address];
        if (!privateKey) {
            console.log(`[WARNING] No private key found for address ${address} (Discord ID: ${discordId})`);
            return null;
        }
        return { address, privateKey };
    } catch (error) {
        console.error('Error getting wallet for Discord ID:', error);
        return null;
    }
}

// Helper function to prompt user for private key recovery via DM
async function promptForPrivateKeyRecovery(discordId: string, address: string): Promise<void> {
    try {
        const user = await client.users.fetch(discordId);
        const recoveryMessage = `🔑 **Private Key Recovery Required**\n\n` +
            `Your Discord account is registered with wallet address:\n` +
            `\`${address}\`\n\n` +
            `But I don't have access to your private key. To continue using the bot, please reply to this DM with:\n\n` +
            `\`>recover-key YOUR_PRIVATE_KEY_HERE\`\n\n` +
            `**Example:** \`>recover-key 0x1234567890abcdef...\`\n\n` +
            `⚠️ **Security Notes:**\n` +
            `• Only send your private key via DM, never in public channels\n` +
            `• Your private key will be stored securely in memory (development only)\n` +
            `• Never share your private key with anyone else\n\n` +
            `*This recovery is needed when the bot restarts or after system updates.*`;
        
        await safeSendDM(user, recoveryMessage);
        console.log(`[DEBUG] Sent private key recovery prompt to Discord ID ${discordId} for address ${address}`);
    } catch (error) {
        console.error(`[ERROR] Failed to send recovery prompt to Discord ID ${discordId}:`, error);
    }
}

async function isDebtResolved(pendingDebtId: number): Promise<boolean> {
    try {
        // Check if debt was confirmed or rejected by looking for events
        const confirmedFilter = contract.filters.DebtConfirmed(pendingDebtId);
        const rejectedFilter = contract.filters.DebtRejected(pendingDebtId);
        
        const [confirmedEvents, rejectedEvents] = await Promise.all([
            contract.queryFilter(confirmedFilter),
            contract.queryFilter(rejectedFilter)
        ]);
        
        return confirmedEvents.length > 0 || rejectedEvents.length > 0;
    } catch (error) {
        console.error('Error checking if debt is resolved:', error);
        return false;
    }
}

// Check if a Discord ID is registered on-chain but missing private key
async function isOrphanedRegistration(discordId: string): Promise<{ isOrphaned: boolean; address?: string }> {
    try {
        const address = await contract.discordToWallet(discordId);
        if (address === ethers.ZeroAddress) {
            return { isOrphaned: false }; // Not registered at all
        }
        
        const hasPrivateKey = !!userPrivateKeys[address];
        return { 
            isOrphaned: !hasPrivateKey, 
            address: hasPrivateKey ? undefined : address 
        };
    } catch (error) {
        console.error('Error checking orphaned registration:', error);
        return { isOrphaned: false };
    }
}

// --- Automated Bill Detection ---

interface ParsedExpense {
    description: string;
    amount: number;
    currency: string;
    payer: string;
    participants: string[];
    splitType: 'equal' | 'custom';
    customSplits?: { [participant: string]: number };
}

interface BillAnalysisResult {
    expenses: ParsedExpense[];
    totalAmount: number;
    currency: string;
    summary: string;
    participants: string[];
}

// Function to scrape recent chat messages
async function scrapeRecentMessages(channel: TextChannel, hours: number = 72): Promise<string[]> {
    try {
        const messages: string[] = [];
        const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
        
        let lastMessageId: string | undefined;
        let fetchedCount = 0;
        const maxMessages = 200; // Reasonable limit
        
        while (fetchedCount < maxMessages) {
            const options: any = { limit: 100 };
            if (lastMessageId) {
                options.before = lastMessageId;
            }
            
            const batch = await channel.messages.fetch(options) as any;
            if (batch.size === 0) break;
            
            const batchArray = Array.from(batch.values());
            const batchMessages = batchArray
                .filter((msg: any) => msg.createdTimestamp > cutoffTime && !msg.author.bot)
                .map((msg: any) => `${msg.author.tag}: ${msg.content}`)
                .reverse(); // Oldest first
            
            messages.unshift(...batchMessages);
            fetchedCount += batch.size;
            lastMessageId = batch.last()?.id;
            
            // If we've processed all messages in timeframe, stop
            const oldestInBatch = batch.last();
            if (oldestInBatch && oldestInBatch.createdTimestamp <= cutoffTime) {
                break;
            }
        }
        
        console.log(`[DEBUG] Scraped ${messages.length} messages from last ${hours} hours`);
        return messages;
    } catch (error) {
        console.error('Error scraping messages:', error);
        return [];
    }
}

// Function to analyze messages with Gemini API
async function analyzeBillsWithGemini(messages: string[], mentionedUsers: string[], userMappingText: string): Promise<BillAnalysisResult | null> {
    if (!genAI) {
        throw new Error('Gemini API key not configured. Please set GEMINI_API_KEY in your .env file.');
    }
    
    const systemPrompt = `You are a bill-splitting assistant. Analyze the chat messages to identify expenses and who paid for what.

IMPORTANT RULES:
1. Only extract expenses that are explicitly mentioned with amounts
2. Identify who paid and who should participate in each expense
3. Default to equal splitting among participants unless specified otherwise
4. Use common sense to determine participants (e.g., if someone says "we all had dinner", include everyone mentioned)
5. Convert all amounts to USD if possible, otherwise use the original currency
6. Be conservative - don't infer expenses that aren't clearly stated
7. When you see usernames in chat messages, map them to Discord mentions using the USER MAPPING provided
8. ALWAYS use Discord mention format <@123456> in your output (never use usernames or display names)
9. You can infer participants based on context (e.g., "we all", "everyone", "us") but only include users from the USER MAPPING

Return a JSON object with this structure:
{
  "expenses": [
    {
      "description": "Brief description of expense",
      "amount": number,
      "currency": "USD|KRW|JPY|etc",
      "payer": "<@123456>",
      "participants": ["<@123456>", "<@789012>", ...],
      "splitType": "equal"
    }
  ],
  "totalAmount": number,
  "currency": "most common currency",
  "summary": "Brief summary of what was found",
  "participants": ["<@123456>", "<@789012>", ...]
}

If no clear expenses are found, return {"expenses": [], "summary": "No clear expenses found in the chat history."}`;

    const userPrompt = `Analyze these chat messages for bill-splitting:

USER MAPPING (username -> Discord mention):
${userMappingText}

PARTICIPANTS MENTIONED: ${mentionedUsers.join(', ')}

CHAT MESSAGES:
${messages.join('\n')}

Extract any expenses, who paid, and who should split the costs. Focus on clear, explicit mentions of payments. When you see usernames like "nuang_ee" or "neuangi8716" in the chat messages, use the USER MAPPING above to convert them to the correct Discord mentions in your response.`;

    try {
        console.log(`[DEBUG] Sending ${messages.length} messages to Gemini for analysis`);
        
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const prompt = `${systemPrompt}\n\n${userPrompt}`;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        let text = response.text();
        if (text.startsWith("```json\n") && text.endsWith("\n```")) {
            // Remove code block formatting
            text = text.slice(8, -4).trim();
        }
        
        try {
            const analysisResult = JSON.parse(text) as BillAnalysisResult;
            console.log('[DEBUG] Raw response:', text);
            console.log(`[DEBUG] Gemini found ${analysisResult.expenses.length} expenses`);
            return analysisResult;
        } catch (parseError) {
            console.error('Failed to parse Gemini response as JSON:', parseError);
            console.log('Raw response:', text);
            return null;
        }
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        return null;
    }
}

// Function to handle automated bill detection
async function handleAutomatedBillDetection(message: Message) {
    if (!message.guild || !message.channel.isTextBased()) return;
    
    try {
        await safeReact(message, '🤔'); // Thinking reaction
        
        // Get mentioned users (excluding bot) and create username-to-mention mapping
        const mentionedUserObjects = message.mentions.users
            .filter(user => !user.bot && user.id !== client.user?.id)
            .map(user => ({ mention: `<@${user.id}>`, username: user.username, displayName: user.displayName || user.username }));
        
        // Add the message author
        const authorObj = { 
            mention: `<@${message.author.id}>`, 
            username: message.author.username, 
            displayName: message.author.displayName || message.author.username 
        };
        if (!mentionedUserObjects.some(u => u.mention === authorObj.mention)) {
            mentionedUserObjects.push(authorObj);
        }
        
        // (User mapping and mentioned users will be created after finding additional users)
        // Send initial response
        const initialResponse = await message.reply(`🔍 **Analyzing chat history for bill-splitting...**\n\nI'm looking through the last 3 hours of messages to identify expenses and who paid for what.\n\n*This may take a moment...*`);
        
        // Scrape recent messages  
        const messages = await scrapeRecentMessages(message.channel as TextChannel, 3); // last 3 hours
        
        if (messages.length === 0) {
            await safeEditMessage(initialResponse, `❌ **No recent messages found**\n\nI couldn't find any messages in the last 3 hours to analyze. Try using manual \`>add-debt\` commands instead.`);
            await safeRemoveReactions(message);
            return;
        }
        
        // Find additional users mentioned by username in the chat messages
        console.log(`[DEBUG] Starting user discovery from ${messages.length} messages...`);
        try {
            const additionalUsers = await findAdditionalUsersFromMessages(messages, message.guild);
            console.log(`[DEBUG] Found additional users from messages: ${additionalUsers.map(u => u.username).join(', ')}`);
            
            // Combine mentioned users with discovered users (avoid duplicates)
            for (const additionalUser of additionalUsers) {
                if (!mentionedUserObjects.some(existing => existing.mention === additionalUser.mention)) {
                    mentionedUserObjects.push(additionalUser);
                }
            }
        } catch (error) {
            console.log(`[DEBUG] User discovery failed (continuing with mentioned users only): ${error}`);
            // Continue with just the explicitly mentioned users
        }
        
        // Update the user mapping and mentioned users list
        const userMappingText = mentionedUserObjects.map(user => 
            `${user.username} (${user.displayName}) = ${user.mention}`
        ).join('\n');
        
        const mentionedUsers = mentionedUserObjects.map(user => user.mention);
        
        console.log(`[DEBUG] Bill detection triggered by ${message.author.tag}`);
        console.log(`[DEBUG] All discovered users: ${mentionedUserObjects.map(u => u.username).join(', ')}`);
        console.log(`[DEBUG] User mapping:\n${userMappingText}`);
        
        // Analyze with Gemini
        await safeReact(message, '🧠'); // AI thinking
        const analysis = await analyzeBillsWithGemini(messages, mentionedUsers, userMappingText);
        
        if (!analysis || analysis.expenses.length === 0) {
            await safeEditMessage(initialResponse, `📊 **Bill Analysis Complete**\n\n${analysis?.summary || 'No clear expenses found in the chat history.'}\n\n💡 **Tip:** For better detection, mention specific amounts and who paid (e.g., "John paid $50 for dinner for all of us")`);
            await safeRemoveReactions(message);
            return;
        }
        
        // Present findings for confirmation
        await presentBillAnalysisForConfirmation(message, analysis, initialResponse);
        await safeRemoveReactions(message);
        await safeReact(message, '✅'); // Success
        
    } catch (error) {
        console.error('Error in automated bill detection:', error);
        await safeSendMessage(message, `❌ **Error during bill analysis**\n\n${error instanceof Error ? error.message : 'Unknown error occurred'}\n\nPlease try again or use manual \`>add-debt\` commands.`);
        await safeRemoveReactions(message);
    }
}

// Function to present analysis results and get user confirmation
async function presentBillAnalysisForConfirmation(originalMessage: Message, analysis: BillAnalysisResult, responseMessage: Message) {
    let confirmationMessage = `📊 **Bill Analysis Complete**\n\n`;
    confirmationMessage += `${analysis.summary}\n\n`;
    confirmationMessage += `**Found ${analysis.expenses.length} expense(s):**\n\n`;
    
    for (let i = 0; i < analysis.expenses.length; i++) {
        const expense = analysis.expenses[i];
        const splitAmount = expense.amount / expense.participants.length;
        
        // Format payer display (convert mention to readable name but keep as mention for notifications)
        const payerDisplay = await formatUserDisplay(expense.payer, originalMessage.guild);
        
        // Format participants list (keep as mentions for proper notifications)
        const participantsDisplay = expense.participants.map(p => p).join(', '); // Keep mentions for notifications
        
        confirmationMessage += `**${i + 1}.** ${expense.description}\n`;
        confirmationMessage += `• **Amount:** ${expense.amount} ${expense.currency}\n`;
        confirmationMessage += `• **Paid by:** ${expense.payer}\n`;  // Keep mention for notification
        confirmationMessage += `• **Participants:** ${participantsDisplay}\n`;
        confirmationMessage += `• **Split:** ${splitAmount.toFixed(2)} ${expense.currency} each\n\n`;
    }
    
    confirmationMessage += `**Total:** ${analysis.totalAmount} ${analysis.currency}\n\n`;
    confirmationMessage += `🤝 **This will create ${calculateTotalDebts(analysis.expenses)} debt proposal(s)**\n\n`;
    confirmationMessage += `**Do you want to proceed with creating these debt proposals?**`;
    
    const confirmButton = new ButtonBuilder()
        .setCustomId('confirm-bills')
        .setLabel('✅ Create Debt Proposals')
        .setStyle(ButtonStyle.Success);
    
    const cancelButton = new ButtonBuilder()
        .setCustomId('cancel-bills')
        .setLabel('❌ Cancel')
        .setStyle(ButtonStyle.Secondary);
    
    const row = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(confirmButton, cancelButton);
    
    await safeEditMessage(responseMessage, undefined, {
        content: confirmationMessage,
        components: [row]
    });
    
    // Store analysis data temporarily (in production, use a proper cache/database)
    pendingBillAnalyses.set(responseMessage.id, {
        analysis,
        requesterId: originalMessage.author.id,
        channelId: originalMessage.channel.id,
        timestamp: Date.now()
    });
    
    // Set timeout to clean up after 5 minutes
    setTimeout(() => {
        pendingBillAnalyses.delete(responseMessage.id);
    }, 5 * 60 * 1000);
}

// Temporary storage for pending bill analyses
const pendingBillAnalyses = new Map<string, {
    analysis: BillAnalysisResult;
    requesterId: string;
    channelId: string;
    timestamp: number;
}>();

// Helper function to calculate total number of debts that will be created
function calculateTotalDebts(expenses: ParsedExpense[]): number {
    let totalDebts = 0;
    for (const expense of expenses) {
        // For each expense, create debts from payer to each other participant
        totalDebts += expense.participants.filter(p => p !== expense.payer).length;
    }
    return totalDebts;
}

// Handle confirmation/cancellation of automated bill analysis
async function handleBillConfirmation(interaction: any) {
    const pendingAnalysis = pendingBillAnalyses.get(interaction.message.id);
    
    if (!pendingAnalysis) {
        await interaction.reply({
            content: '❌ **Analysis expired or not found**\n\nPlease trigger bill analysis again.',
            ephemeral: true
        });
        return;
    }
    
    // Check if the user who clicked is the same as who requested the analysis
    if (interaction.user.id !== pendingAnalysis.requesterId) {
        await interaction.reply({
            content: '❌ **Permission denied**\n\nOnly the person who requested the analysis can confirm it.',
            ephemeral: true
        });
        return;
    }
    
    if (interaction.customId === 'cancel-bills') {
        await interaction.update({
            content: '❌ **Bill analysis cancelled**\n\nNo debt proposals were created.',
            components: []
        });
        pendingBillAnalyses.delete(interaction.message.id);
        return;
    }
    
    if (interaction.customId === 'confirm-bills') {
        await interaction.update({
            content: '⏳ **Creating debt proposals...**\n\nPlease wait while I create all the debt proposals.',
            components: []
        });
        
        try {
            await createAutomatedDebtProposals(pendingAnalysis.analysis, interaction);
            pendingBillAnalyses.delete(interaction.message.id);
        } catch (error) {
            console.error('Error creating automated debt proposals:', error);
            await interaction.followUp({
                content: `❌ **Error creating debt proposals**\n\n${error instanceof Error ? error.message : 'Unknown error occurred'}`
            });
        }
    }
}

// Create debt proposals from automated bill analysis
async function createAutomatedDebtProposals(analysis: BillAnalysisResult, interaction: any) {
    const results: { success: number; failed: number; errors: string[] } = {
        success: 0,
        failed: 0,
        errors: []
    };
    
    for (const expense of analysis.expenses) {
        const splitAmount = expense.amount / expense.participants.length;
        
        // Find Discord users by their usernames/tags
        const payerUser = await findUserByTag(expense.payer, interaction.guild);
        if (!payerUser) {
            results.failed++;
            const payerDisplay = await formatUserDisplay(expense.payer, interaction.guild);
            results.errors.push(`❌ Could not find user: ${payerDisplay}`);
            continue;
        }
        
        // Get payer's wallet
        const payerWallet = await getWalletForDiscordId(payerUser.id);
        if (!payerWallet) {
            results.failed++;
            const payerDisplay = await formatUserDisplay(expense.payer, interaction.guild);
            results.errors.push(`❌ ${payerDisplay} is not registered`);
            continue;
        }
        
        // Create debt proposal to each participant (except payer)
        for (const participantTag of expense.participants) {
            if (participantTag === expense.payer) continue; // Skip the payer
            
            const participantUser = await findUserByTag(participantTag, interaction.guild);
            if (!participantUser) {
                results.failed++;
                const participantDisplay = await formatUserDisplay(participantTag, interaction.guild);
                results.errors.push(`❌ Could not find user: ${participantDisplay}`);
                continue;
            }
            
            const participantWallet = await getWalletForDiscordId(participantUser.id);
            if (!participantWallet) {
                results.failed++;
                const participantDisplay = await formatUserDisplay(participantTag, interaction.guild);
                results.errors.push(`❌ ${participantDisplay} is not registered`);
                continue;
            }
            
            try {
                // Convert currency to supported token
                const tokenInfo = getCurrencyTokenInfo(expense.currency);
                if (!tokenInfo || !tokenInfo.address) {
                    results.failed++;
                    results.errors.push(`❌ Unsupported currency: ${expense.currency}`);
                    continue;
                }
                const amount = parseTokenAmount(splitAmount.toFixed(2), tokenInfo);
                const memo = `${expense.description} (Auto-detected from chat)`;
                
                // Create debt proposal using payer's wallet
                const payerEthersWallet = new Wallet(payerWallet.privateKey, provider);
                const payerContract = new Contract(CONTRACT_ADDRESS!, BillTheAccountantABI.abi, payerEthersWallet);
                
                const tx = await payerContract.proposeDebt(tokenInfo.address, participantWallet.address, amount, memo);
                await tx.wait();
                
                // Send notification to participant (format payer display name)
                const payerDisplayName = await formatUserDisplay(expense.payer, interaction.guild);
                const proposalMessage = `📄 **Auto-Detected Debt Proposal**\n\n` +
                    `**From:** ${payerDisplayName}\n` +
                    `**Amount:** ${splitAmount.toFixed(2)} ${expense.currency}\n` +
                    `**For:** ${expense.description}\n` +
                    `**Auto-detected from chat history**\n\n` +
                    `Click below to accept or reject:`;
                
                const pendingDebtCounter = await contract.pendingDebtCounter();
                const row = new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`agree-debt:${pendingDebtCounter}`)
                            .setLabel('Agree')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`disagree-debt:${pendingDebtCounter}`)
                            .setLabel('Disagree')
                            .setStyle(ButtonStyle.Danger),
                    );
                
                await safeSendDM(participantUser, proposalMessage, {
                    components: [row]
                });
                
                results.success++;
                console.log(`[DEBUG] Created automated debt proposal: ${expense.payer} → ${participantTag} (${splitAmount.toFixed(2)} ${expense.currency})`);
                
            } catch (error) {
                results.failed++;
                const payerDisplay = await formatUserDisplay(expense.payer, interaction.guild);
                const participantDisplay = await formatUserDisplay(participantTag, interaction.guild);
                results.errors.push(`❌ Failed to create debt ${payerDisplay} → ${participantDisplay}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                console.error(`Error creating debt proposal for ${payerDisplay} → ${participantDisplay}:`, error);
            }
        }
    }
    
    // Send summary
    let summaryMessage = `✅ **Automated Debt Proposals Created**\n\n`;
    summaryMessage += `**Successfully created:** ${results.success} proposals\n`;
    summaryMessage += `**Failed:** ${results.failed} proposals\n\n`;
    
    if (results.errors.length > 0) {
        summaryMessage += `**Errors:**\n${results.errors.join('\n')}\n\n`;
    }
    
    summaryMessage += `**Next Steps:**\n`;
    summaryMessage += `• Participants will receive DMs with debt proposals\n`;
    summaryMessage += `• They can accept or reject each proposal\n`;
    summaryMessage += `• Use \`>balance @user <token>\` to check confirmed debts\n`;
    summaryMessage += `• Use \`>history @user\` to see all transactions`;
    
    await safeInteractionReply(interaction, summaryMessage);
}

// Helper function to find Discord user by tag/username
// Helper function to extract user ID from Discord mention format <@123456>
function extractUserIdFromMention(mention: string): string | null {
    const match = mention.match(/^<@!?(\d+)>$/);
    return match ? match[1] : null;
}

// Helper function to format user display for messages (converts mentions to readable format)
async function formatUserDisplay(userIdentifier: string, guild: any): Promise<string> {
    const userId = extractUserIdFromMention(userIdentifier);
    if (userId) {
        try {
            const member = guild.members.cache.get(userId) || await guild.members.fetch(userId);
            return member.displayName || member.user.username;
        } catch {
            return `<@${userId}>`;  // Fallback to mention if user not found
        }
    }
    return userIdentifier; // Return as-is if not a mention
}

// Helper function to find users mentioned by username in chat messages
async function findAdditionalUsersFromMessages(messages: string[], guild: any): Promise<Array<{mention: string, username: string, displayName: string}>> {
    const foundUsers: Array<{mention: string, username: string, displayName: string}> = [];
    const usernamePattern = /\b[a-zA-Z0-9_]{2,32}\b/g; // Basic username pattern
    
    // Extract potential usernames from messages
    const potentialUsernames = new Set<string>();
    for (const message of messages) {
        const matches = message.match(usernamePattern);
        if (matches) {
            matches.forEach(match => {
                // Filter out common words and short strings
                if (match.length >= 3 && !['the', 'and', 'for', 'you', 'are', 'can', 'will', 'have', 'this', 'that', 'with', 'from', 'bot', 'add', 'debt', 'register', 'user', 'paid', 'USD', 'KRW', 'JPY', 'EUR'].includes(match.toLowerCase())) {
                    potentialUsernames.add(match.toLowerCase());
                }
            });
        }
    }
    
    console.log(`[DEBUG] Potential usernames found: ${Array.from(potentialUsernames).join(', ')}`);
    
    try {
        // First, try to find users in the current cache
        for (const username of potentialUsernames) {
            const member = guild.members.cache.find((m: any) => 
                m.user.username.toLowerCase() === username || 
                (m.displayName && m.displayName.toLowerCase() === username)
            );
            
            if (member) {
                foundUsers.push({
                    mention: `<@${member.user.id}>`,
                    username: member.user.username,
                    displayName: member.displayName || member.user.username
                });
            }
        }
        
        // Only try member fetch if we have a very small cache and only for a few seconds
        if (foundUsers.length === 0 && guild.members.cache.size < 20 && potentialUsernames.size <= 5) {
            console.log(`[DEBUG] Cache has ${guild.members.cache.size} members, attempting limited fetch for ${potentialUsernames.size} usernames...`);
            try {
                // Very conservative fetch - only get online members with short timeout
                await guild.members.fetch({ limit: 20, time: 2000 });
                
                // Try again with the expanded cache
                for (const username of potentialUsernames) {
                    const member = guild.members.cache.find((m: any) => 
                        m.user.username.toLowerCase() === username || 
                        (m.displayName && m.displayName.toLowerCase() === username)
                    );
                    
                    if (member) {
                        foundUsers.push({
                            mention: `<@${member.user.id}>`,
                            username: member.user.username,
                            displayName: member.displayName || member.user.username
                        });
                    }
                }
            } catch (fetchError) {
                console.log(`[DEBUG] Member fetch failed (this is OK, continuing with cache-only): ${fetchError}`);
                // Continue with cached members only - this is fine
            }
        } else {
            console.log(`[DEBUG] Skipping member fetch (cache: ${guild.members.cache.size}, found: ${foundUsers.length}, usernames: ${potentialUsernames.size})`);
        }
        
    } catch (error) {
        console.log(`[DEBUG] Error in user discovery (continuing with limited results): ${error}`);
    }
    
    console.log(`[DEBUG] Successfully mapped ${foundUsers.length} usernames to Discord users`);
    return foundUsers;
}

async function findUserByTag(userIdentifier: string, guild: any): Promise<any> {
    try {
        // First, try to extract user ID from mention format <@123456>
        const userId = extractUserIdFromMention(userIdentifier);
        if (userId) {
            const member = guild.members.cache.get(userId);
            if (member) return member.user;
            
            // If not cached, try to fetch from Discord
            try {
                const fetchedMember = await guild.members.fetch(userId);
                return fetchedMember.user;
            } catch (fetchError) {
                console.log(`Could not fetch user with ID ${userId}`);
            }
        }
        
        // Fallback: Try to find by tag first (username#discriminator)
        const member = guild.members.cache.find((m: any) => m.user.tag === userIdentifier);
        if (member) return member.user;
        
        // Try to find by display name or username
        const memberByName = guild.members.cache.find((m: any) => 
            m.displayName === userIdentifier || m.user.username === userIdentifier
        );
        if (memberByName) return memberByName.user;
        
        return null;
    } catch (error) {
        console.error(`Error finding user by identifier ${userIdentifier}:`, error);
        return null;
    }
}

// Helper function to map currency to supported tokens
function getCurrencyTokenInfo(currency: string): any {
    const currencyUpper = currency.toUpperCase();
    
    switch (currencyUpper) {
        case 'USD':
        case 'USDC':
            return parseTokenIdentifier('USDC');
        case 'ETH':
        case 'ETHER':
            return parseTokenIdentifier('ETH');
        case 'KRW':
        case 'WON':
            // For now, default to USDC for non-supported currencies
            return parseTokenIdentifier('USDC');
        case 'JPY':
        case 'YEN':
            return parseTokenIdentifier('USDC');
        default:
            // Default to USDC
            return parseTokenIdentifier('USDC');
    }
}

// SUPPORTED_TOKENS is now imported from tokenUtils

// --- Bot Logic ---
client.once('ready', () => {
    console.log(`Bot is online! Logged in as ${client.user?.tag}`);
    console.log(`Connected to contract at: ${CONTRACT_ADDRESS}`);
});

client.on('messageCreate', async (message: Message) => {
    if (message.author.bot) return;
    
    // Check if bot is mentioned with bill-splitting keywords
    const botMentioned = message.mentions.has(client.user?.id || '');
    const billKeywords = ['bill', 'split', 'settle', 'clear', 'expense', 'debt', 'money', 'pay', 'owe'];
    const hasBillKeywords = billKeywords.some(keyword => 
        message.content.toLowerCase().includes(keyword)
    );
    
    if (botMentioned && hasBillKeywords && message.guild) {
        // Automated bill detection triggered
        await handleAutomatedBillDetection(message);
        return;
    }
    
    // Regular command processing
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    // --- Command Handler ---
    switch (command) {
        case 'register': {
            // Check if user already has a working registration
            const existingWallet = await getWalletForDiscordId(message.author.id);
            if (existingWallet) {
                await safeSendMessage(message, "✅ You are already registered and your wallet is working correctly.");
                return;
            }
            
            // Check if this is an orphaned registration (registered on-chain but no private key)
            const orphanCheck = await isOrphanedRegistration(message.author.id);
            
            if (orphanCheck.isOrphaned) {
                // User is registered on-chain but we don't have their private key
                await safeSendMessage(message, `⚠️ **Registration Recovery Needed**\n\nYour Discord account is registered on-chain (address: \`${orphanCheck.address}\`) but the bot doesn't have access to your wallet.\n\nThis can happen after system updates or if you were registered using the old system.\n\n**Options:**\n1. Use \`>reset-wallet\` to create a new wallet (recommended)\n2. Contact an admin for manual recovery\n\n*Note: If you reset, you'll get a new wallet address but keep your Discord ID registration.*`);
                return;
            }
            
            const newWallet = ethers.Wallet.createRandom();
            
            // Store private key in memory (for development only)
            userPrivateKeys[newWallet.address] = newWallet.privateKey;
            
            // Register user on-chain
            try {
                const registerTx = await contract.registerUser(message.author.id, newWallet.address);
                await registerTx.wait();
                console.log(`[DEBUG] User ${message.author.id} registered on-chain with address ${newWallet.address}`);
            } catch (error) {
                console.error(`[DEBUG] Failed to register user on-chain:`, error);
                
                // Check if this is a "Discord ID already registered" error
                const errorMessage = (error as Error).message || (error as any).toString();
                if (errorMessage.includes('Discord ID already registered')) {
                    await message.reply(`❌ **Registration Conflict**\n\nYour Discord ID is already registered on-chain, but there seems to be an issue with the wallet mapping.\n\nPlease try:\n1. \`>reset-wallet\` to resolve the conflict\n2. Contact an admin if the problem persists\n\n*This can happen after system updates or blockchain resets.*`);
                } else {
                    await message.reply(`❌ Failed to register on blockchain: ${errorMessage}\n\nPlease try again or contact an admin.`);
                }
                return;
            }
            
            // Auto-fund the new wallet with ETH for gas fees (development only)
            try {
                console.log(`[DEBUG] Auto-funding wallet ${newWallet.address} with 10 ETH for gas fees...`);
                const fundingTx = await wallet.sendTransaction({
                    to: newWallet.address,
                    value: ethers.parseEther("10") // 10 ETH should be plenty for gas
                });
                await fundingTx.wait();
                console.log(`[DEBUG] Successfully funded wallet ${newWallet.address}`);
            } catch (error) {
                console.error(`[DEBUG] Failed to fund wallet:`, error);
                await message.reply("⚠️ Wallet registered but auto-funding failed. You may need ETH for gas fees.");
            }
            
            await message.author.send(`Your new wallet address is: ${newWallet.address}\nYour private key is: ${newWallet.privateKey}\n**IMPORTANT: Save this private key securely. It cannot be recovered.**\n\n✅ Your wallet has been automatically funded with 10 ETH for gas fees.`);
            await message.reply(`I\'ve sent you a DM with your new wallet details.`);
            break;
        }

        case 'recover-key': {
            // Handle private key recovery via DM
            if (!message.guild) { // Only works in DMs
                if (args.length < 1) {
                    await safeSendMessage(message, "❌ **Usage:** `>recover-key YOUR_PRIVATE_KEY`\n\n**Example:** `>recover-key 0x1234567890abcdef...`\n\n⚠️ **Security:** Only use this command in DMs, never in public channels!");
                    return;
                }

                const providedKey = args[0];
                
                // Basic validation of private key format
                if (!providedKey.startsWith('0x') || providedKey.length !== 66) {
                    await message.reply("❌ **Invalid Private Key Format**\n\nPrivate keys should:\n• Start with `0x`\n• Be exactly 66 characters long\n• Contain only hexadecimal characters (0-9, a-f)\n\n**Example:** `0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef`");
                    return;
                }

                try {
                    // Validate the private key by creating a wallet
                    const testWallet = new ethers.Wallet(providedKey);
                    const derivedAddress = testWallet.address;
                    
                    // Check if this address matches the user's registered address
                    const registeredAddress = await contract.discordToWallet(message.author.id);
                    if (registeredAddress === ethers.ZeroAddress) {
                        await message.reply("❌ **Not Registered**\n\nYour Discord account isn't registered on-chain yet. Use `>register` to create a new account.");
                        return;
                    }
                    
                    if (derivedAddress.toLowerCase() !== registeredAddress.toLowerCase()) {
                        await message.reply(`❌ **Address Mismatch**\n\n**Your registered address:** \`${registeredAddress}\`\n**Private key corresponds to:** \`${derivedAddress}\`\n\nThe private key you provided doesn't match your registered wallet address. Please check your private key or use \`>reset-wallet\` if you need a new wallet.`);
                        return;
                    }
                    
                    // Store the private key
                    userPrivateKeys[registeredAddress] = providedKey;
                    
                    // Verify it works by testing wallet creation
                    const verifyWallet = await getWalletForDiscordId(message.author.id);
                    if (verifyWallet) {
                        await message.reply(`✅ **Private Key Recovered Successfully!**\n\n**Wallet Address:** \`${registeredAddress}\`\n\nYour wallet is now active and you can use all bot commands.\n\n🛡️ **Security:** Your private key is securely stored in memory. Remember to keep it safe!`);
                        console.log(`[DEBUG] Successfully recovered private key for Discord ID ${message.author.id}, address ${registeredAddress}`);
                    } else {
                        await message.reply("❌ **Recovery Failed**\n\nThere was an issue storing your private key. Please try again or contact an admin.");
                    }
                    
                } catch (error) {
                    console.error(`[ERROR] Private key recovery failed for ${message.author.id}:`, error);
                    await message.reply("❌ **Invalid Private Key**\n\nThe private key you provided is not valid. Please check the format and try again.\n\n**Format:** `0x` followed by 64 hexadecimal characters");
                }
            } else {
                // Command used in public channel - security warning
                await message.reply("🚨 **SECURITY WARNING**\n\n**NEVER share your private key in public channels!**\n\nThe `>recover-key` command only works in DMs for your security.\n\nPlease:\n1. Delete this message immediately\n2. Send me a DM with the command instead\n\n🔒 **Your private key = full control of your wallet**");
                
                // Try to delete the message if bot has permissions
                try {
                    await message.delete();
                } catch (deleteError) {
                    console.log("[WARNING] Could not delete public private key message - insufficient permissions");
                }
            }
            break;
        }

        case 'reset-wallet': {
            // This command helps fix orphaned registrations
            const orphanCheck = await isOrphanedRegistration(message.author.id);
            
            if (!orphanCheck.isOrphaned) {
                const existingWallet = await getWalletForDiscordId(message.author.id);
                if (existingWallet) {
                    await message.reply("❌ Your wallet is working correctly. No reset needed.\n\nIf you're experiencing issues, please contact an admin.");
                } else {
                    await message.reply("❌ You're not registered yet. Use `>register` to create a new account.");
                }
                return;
            }

            // Create a new wallet for the orphaned registration
            const newWallet = ethers.Wallet.createRandom();
            
            // Store the new private key in memory
            userPrivateKeys[newWallet.address] = newWallet.privateKey;
            
            try {
                // Update the on-chain mapping to point to the new wallet
                // Note: This requires a new smart contract function or manual admin intervention
                // For now, we'll delete the old registration and create a new one
                
                console.log(`[DEBUG] Attempting to reset wallet for Discord ID ${message.author.id} from ${orphanCheck.address} to ${newWallet.address}`);
                
                // Since we can't easily update the mapping, we'll provide manual recovery instructions
                await message.reply(`⚠️ **Wallet Reset Required - Manual Intervention Needed**\n\nYour Discord ID (${message.author.id}) is registered on-chain with address \`${orphanCheck.address}\`, but the bot doesn't have the private key.\n\n**Temporary Solution:**\n1. I've generated a new wallet: \`${newWallet.address}\`\n2. I'll send you the private key via DM\n3. An admin needs to update the on-chain mapping\n\n**For Development:** You can restart the blockchain node to clear all registrations, then use \`>register\` normally.\n\n*This is a known issue when migrating from the old JSON-based system.*`);
                
                await message.author.send(`🔧 **Temporary Wallet for Recovery**\n\nAddress: ${newWallet.address}\nPrivate Key: ${newWallet.privateKey}\n\n**IMPORTANT:** This is a temporary wallet. An admin needs to update the on-chain mapping to link your Discord ID to this new address.\n\n**For Development:** Restart the blockchain node and use \`>register\` to fix this permanently.`);
                
            } catch (error) {
                console.error(`[DEBUG] Failed to reset wallet:`, error);
                const errorMessage = (error as Error).message || (error as any).toString();
                await message.reply(`❌ Failed to reset wallet. Please contact an admin.\n\nError: ${errorMessage}`);
            }
            break;
        }

        case 'add-debt': {
            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser || args.length < 2) {
                await message.reply("Usage: `>add-debt @user <amount> [token] <memo...>`");
                return;
            }

            const amountRaw = args[1];
            let tokenIdentifier: string | undefined;
            let memo: string;

            if (args.length > 2) {
                const potentialToken = args[2];
                try {
                    parseTokenIdentifier(potentialToken);
                    tokenIdentifier = potentialToken;
                    memo = args.slice(3).join(' ');
                } catch {
                    memo = args.slice(2).join(' ');
                }
            } else {
                memo = '';
            }

            const debtorId = mentionedUser.id;
            const creditorId = message.author.id;
            
            // Use on-chain user lookup
            const debtorWallet = await getWalletForDiscordId(debtorId);
            const creditorWallet = await getWalletForDiscordId(creditorId);

            if (!debtorWallet || !creditorWallet) {
                let errorMessage = "❌ **Registration Required**\n\n";
                
                if (!creditorWallet) {
                    const creditorOrphanCheck = await isOrphanedRegistration(creditorId);
                    if (creditorOrphanCheck.isOrphaned) {
                        errorMessage += "**You:** Your wallet needs private key recovery. Check your DMs for instructions.\n";
                        // Send DM with recovery instructions
                        await promptForPrivateKeyRecovery(creditorId, creditorOrphanCheck.address!);
                    } else {
                        errorMessage += "**You:** Not registered. Use `>register` to create an account.\n";
                    }
                }
                
                if (!debtorWallet) {
                    const debtorOrphanCheck = await isOrphanedRegistration(debtorId);
                    if (debtorOrphanCheck.isOrphaned) {
                        errorMessage += `**@${mentionedUser.tag}:** Their wallet needs private key recovery. They should check their DMs.\n`;
                        // Send DM with recovery instructions
                        await promptForPrivateKeyRecovery(debtorId, debtorOrphanCheck.address!);
                    } else {
                        errorMessage += `**@${mentionedUser.tag}:** Not registered. They should use \`>register\`.\n`;
                    }
                }
                
                errorMessage += "\n*Both users must have working wallet registrations to create debt proposals.*";
                await message.reply(errorMessage);
                return;
            }

            const executeProposal = async (tokenSymbol: string) => {
                try {
                    console.log(`[DEBUG] executeProposal called with tokenSymbol: ${tokenSymbol}, amountRaw: ${amountRaw}`);
                    const tokenInfo = parseTokenIdentifier(tokenSymbol);
                    console.log(`[DEBUG] tokenInfo:`, tokenInfo);
                    const amount = parseTokenAmount(amountRaw, tokenInfo);
                    console.log(`[DEBUG] parsed amount:`, amount.toString());
                    const tokenAddress = tokenInfo.address;
                    
                    // Check the current pendingDebtCounter before proposing
                    const currentCounter = await contract.pendingDebtCounter();
                    console.log(`[DEBUG] Current pendingDebtCounter before proposal:`, currentCounter.toString());
                    
                    // Create a contract instance using the creditor's wallet (not the bot's wallet)
                    const creditorEthersWallet = new Wallet(creditorWallet.privateKey, provider);
                    const creditorContract = new Contract(CONTRACT_ADDRESS, BillTheAccountantABI.abi, creditorEthersWallet);
                    
                    console.log(`[DEBUG] Using creditor's wallet ${creditorWallet.address} to propose debt`);
                    const tx = await creditorContract.proposeDebt(tokenAddress, debtorWallet.address, amount, memo);
                    const receipt = await tx.wait();
                    
                    // Check the pendingDebtCounter after proposing
                    const newCounter = await contract.pendingDebtCounter();
                    console.log(`[DEBUG] New pendingDebtCounter after proposal:`, newCounter.toString());
                    
                    // Instead of parsing event logs (which seems corrupted), use the counter directly
                    // Since we know the counter went from currentCounter to newCounter, 
                    // the new debt ID is the newCounter value
                    const pendingDebtId = newCounter;
                    const pendingDebtIdStr = pendingDebtId.toString();
                    console.log(`[DEBUG] Using counter as pendingDebtId:`, pendingDebtIdStr);

                    const debtorUser = await client.users.fetch(debtorId);
                    const creditorUser = await client.users.fetch(creditorId);

                    const row = new ActionRowBuilder<ButtonBuilder>()
                            .addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`agree-debt:${pendingDebtIdStr}`)
                                    .setLabel('Agree')
                                    .setStyle(ButtonStyle.Success),
                                new ButtonBuilder()
                                    .setCustomId(`disagree-debt:${pendingDebtIdStr}`)
                                    .setLabel('Disagree')
                                    .setStyle(ButtonStyle.Danger),
                            );

                    // Create detailed debt proposal message
                    let proposalMessage = `📄 **New Debt Proposal from ${creditorUser.tag}**\n\n`;
                    proposalMessage += `**Debt Details:**\n`;
                    proposalMessage += `• Amount: ${amountRaw} ${tokenInfo.symbol}\n`;
                    proposalMessage += `• Memo: ${memo}\n`;
                    proposalMessage += `• Proposal ID: ${pendingDebtIdStr}\n\n`;
                    
                    proposalMessage += `**Transaction Details:**\n`;
                    proposalMessage += `• Transaction Hash: \`${tx.hash}\`\n`;
                    proposalMessage += `• Block Number: ${receipt.blockNumber}\n`;
                    proposalMessage += `• Network: ${getNetworkName()}\n`;
                    
                    const explorerUrl = getBlockExplorerUrl(tx.hash);
                    if (explorerUrl) {
                        proposalMessage += `• View on Explorer: ${explorerUrl}\n`;
                    }
                    
                    proposalMessage += `\n**Please review and respond:**`;

                    await debtorUser.send({
                        content: proposalMessage,
                        components: [row]
                    });

                    // Also provide transaction details to the proposer
                    let confirmationMessage = `✅ **Debt proposal created!**\n\n`;
                    confirmationMessage += `**Proposal sent to:** ${mentionedUser.tag}\n`;
                    confirmationMessage += `**Amount:** ${amountRaw} ${tokenInfo.symbol}\n`;
                    confirmationMessage += `**Memo:** ${memo}\n`;
                    confirmationMessage += `**Proposal ID:** ${pendingDebtIdStr}\n\n`;
                    confirmationMessage += `**Transaction Hash:** \`${tx.hash}\`\n`;
                    
                    if (explorerUrl) {
                        confirmationMessage += `**View on Explorer:** ${explorerUrl}\n`;
                    }
                    
                    confirmationMessage += `\n*The proposal has been recorded on-chain. ${mentionedUser.tag} will receive a DM to confirm or reject.*`;

                    await message.reply(confirmationMessage);
                } catch (e) {
                    console.error(e);
                    
                    // Check if it's an insufficient funds error
                    const errorMessage = (e as Error).message || (e as any).toString();
                    if (errorMessage.includes('insufficient funds') || errorMessage.includes("doesn't have enough funds")) {
                        // Get current balance to show in error message
                        let balanceInfo = '';
                        try {
                            const balance = await provider.getBalance(creditorWallet.address);
                            const balanceEth = ethers.formatEther(balance);
                            balanceInfo = `\n**Current Balance:** ${balanceEth} ETH`;
                        } catch (balanceError) {
                            console.error('Failed to get balance:', balanceError);
                        }
                        
                        await message.reply(`❌ **Insufficient funds to create debt proposal**\n\nYour wallet (${creditorWallet.address}) needs ETH to pay for gas fees.${balanceInfo}\n\n**Solutions:**\n• Run \`>fund-wallet\` to get 10 ETH for gas fees\n• Ask someone to send you ETH\n• Try again once you have funds`);
                    } else {
                        await message.reply(`❌ Failed to propose debt: ${errorMessage}\n\nPlease try again or contact an admin.`);
                    }
                }
            };

            if (tokenIdentifier) {
                await executeProposal(tokenIdentifier);
            }
            else {
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`select_debt_token:${message.id}`)
                    .setPlaceholder('Select a token')
                    .addOptions(
                        Object.keys(SUPPORTED_TOKENS).map(symbol =>
                            new StringSelectMenuOptionBuilder()
                                .setLabel(symbol)
                                .setValue(symbol)
                        )
                    );
                const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
                await message.reply({ content: 'Please select a token for the debt:', components: [row] });
            }
            break;
        }

        case 'balance': {
            const targetUser = message.mentions.users.first();
            const tokenIdentifier = args[1];

            if (!targetUser || !tokenIdentifier) {
                await message.reply("Usage: `>balance @user <token_symbol_or_address>`");
                return;
            }

            let tokenInfo;
            try {
                tokenInfo = parseTokenIdentifier(tokenIdentifier);
            } catch (error) {
                await message.reply(`Invalid token: ${tokenIdentifier}. Supported tokens are ETH, USDC, or a valid address.`);
                return;
            }

            // Use on-chain user lookup
            const user1 = await getWalletForDiscordId(message.author.id);
            const user2 = await getWalletForDiscordId(targetUser.id);
            
            if (!user1 || !user2) {
                let errorMessage = "❌ **Registration Required for Balance Check**\n\n";
                
                if (!user1) {
                    const user1OrphanCheck = await isOrphanedRegistration(message.author.id);
                    if (user1OrphanCheck.isOrphaned) {
                        errorMessage += "**You:** Your wallet needs private key recovery. Check your DMs for instructions.\n";
                        // Send DM with recovery instructions
                        await promptForPrivateKeyRecovery(message.author.id, user1OrphanCheck.address!);
                    } else {
                        errorMessage += "**You:** Not registered. Use `>register` to create an account.\n";
                    }
                }
                
                if (!user2) {
                    const user2OrphanCheck = await isOrphanedRegistration(targetUser.id);
                    if (user2OrphanCheck.isOrphaned) {
                        errorMessage += `**@${targetUser.tag}:** Their wallet needs private key recovery. They should check their DMs.\n`;
                        // Send DM with recovery instructions  
                        await promptForPrivateKeyRecovery(targetUser.id, user2OrphanCheck.address!);
                    } else {
                        errorMessage += `**@${targetUser.tag}:** Not registered. They should use \`>register\`.\n`;
                    }
                }
                
                errorMessage += "\n*Both users must have working registrations to check balances.*";
                await message.reply(errorMessage);
                return;
            }

            const debtOwed = await contract.debts(tokenInfo.address, user1.address, user2.address);
            const debtOwing = await contract.debts(tokenInfo.address, user2.address, user1.address);

            // Pending debts - get all events first, then filter by users and token
            const allDebtProposedEvents = await contract.queryFilter(contract.filters.DebtProposed());
            console.log(`[DEBUG] Total DebtProposed events for balance check: ${allDebtProposedEvents.length}`);
            
            // Filter by users and token manually (more reliable than complex filter parameters)
            const relevantEvents = allDebtProposedEvents.filter(event => {
                const [_id, creditor, debtor, token, _amount, _memo] = (event as EventLog).args;
                const userMatch = (creditor.toLowerCase() === user1.address.toLowerCase() && debtor.toLowerCase() === user2.address.toLowerCase()) ||
                                 (creditor.toLowerCase() === user2.address.toLowerCase() && debtor.toLowerCase() === user1.address.toLowerCase());
                const tokenMatch = token.toLowerCase() === tokenInfo.address.toLowerCase();
                const match = userMatch && tokenMatch;
                console.log(`[DEBUG] Balance event check: users=${userMatch}, token=${tokenMatch}, overall=${match}`);
                return match;
            });
            
            // Filter out resolved debts using the on-chain helper function
            const pendingDebtEvents: EventLog[] = [];
            for (const event of relevantEvents) {
                const pendingDebtId = Number((event as EventLog).args[0]);
                const isResolved = await isDebtResolved(pendingDebtId);
                console.log(`[DEBUG] Debt ${pendingDebtId} resolved status: ${isResolved}`);
                if (!isResolved) {
                    pendingDebtEvents.push(event as EventLog);
                }
            }

            let pendingOwed = ethers.parseUnits("0", tokenInfo.decimals);
            let pendingOwing = ethers.parseUnits("0", tokenInfo.decimals);

            for (const event of pendingDebtEvents) {
                const [_id, creditor, debtor, _token, amount, _memo] = (event as EventLog).args;
                if (debtor === user1.address && creditor === user2.address) {
                    pendingOwed = pendingOwed + amount;
                } else if (debtor === user2.address && creditor === user1.address) {
                    pendingOwing = pendingOwing + amount;
                }
            }

            let balanceMessage = `**Balance with ${targetUser.tag} for ${tokenInfo.symbol}:**\n\n`;
            balanceMessage += '**Confirmed Balance:**\n';
            balanceMessage += `- You owe them: ${formatTokenAmount(debtOwing, tokenInfo)}\n`;
            balanceMessage += `- They owe you: ${formatTokenAmount(debtOwed, tokenInfo)}\n\n`;
            balanceMessage += '**Pending Balance:**\n';
            balanceMessage += `- You owe them (pending): ${formatTokenAmount(pendingOwing, tokenInfo)}\n`;
            balanceMessage += `- They owe you (pending): ${formatTokenAmount(pendingOwed, tokenInfo)}\n`;

            await message.reply(balanceMessage);
            break;
        }

        case 'history': {
            const historyUser = message.mentions.users.first();
            if (!historyUser) {
                await message.reply("Usage: `>history @user`");
                return;
            }
            // Use on-chain user lookup
            const authorWallet = await getWalletForDiscordId(message.author.id);
            const targetWallet = await getWalletForDiscordId(historyUser.id);

            if (!authorWallet || !targetWallet) {
                let errorMessage = "❌ **Registration Required for History**\n\n";
                
                if (!authorWallet) {
                    const authorOrphanCheck = await isOrphanedRegistration(message.author.id);
                    if (authorOrphanCheck.isOrphaned) {
                        errorMessage += "**You:** Your wallet needs private key recovery. Check your DMs for instructions.\n";
                        // Send DM with recovery instructions
                        await promptForPrivateKeyRecovery(message.author.id, authorOrphanCheck.address!);
                    } else {
                        errorMessage += "**You:** Not registered. Use `>register` to create an account.\n";
                    }
                }
                
                if (!targetWallet) {
                    const targetOrphanCheck = await isOrphanedRegistration(historyUser.id);
                    if (targetOrphanCheck.isOrphaned) {
                        errorMessage += `**@${historyUser.tag}:** Their wallet needs private key recovery. They should check their DMs.\n`;
                        // Send DM with recovery instructions
                        await promptForPrivateKeyRecovery(historyUser.id, targetOrphanCheck.address!);
                    } else {
                        errorMessage += `**@${historyUser.tag}:** Not registered. They should use \`>register\`.\n`;
                    }
                }
                
                errorMessage += "\n*Both users must have working registrations to view transaction history.*";
                await message.reply(errorMessage);
                return;
            }

            // Confirmed debts
            const debtAddedFilter1 = contract.filters.DebtAdded(undefined, authorWallet.address, targetWallet.address);
            const debtAddedFilter2 = contract.filters.DebtAdded(undefined, targetWallet.address, authorWallet.address);
            const debtAddedEvents1 = await contract.queryFilter(debtAddedFilter1);
            const debtAddedEvents2 = await contract.queryFilter(debtAddedFilter2);
            const confirmedDebtEvents = [...debtAddedEvents1, ...debtAddedEvents2];

            // Pending debts - get all events first, then filter manually
            const allDebtProposedEvents = await contract.queryFilter(contract.filters.DebtProposed());
            console.log(`[DEBUG] Total DebtProposed events for history: ${allDebtProposedEvents.length}`);
            
            // Filter by users manually (more reliable than complex filter parameters)
            const relevantProposedEvents = allDebtProposedEvents.filter(event => {
                const [_id, creditor, debtor, _token, _amount, _memo] = (event as EventLog).args;
                const match = (creditor.toLowerCase() === authorWallet.address.toLowerCase() && debtor.toLowerCase() === targetWallet.address.toLowerCase()) ||
                             (creditor.toLowerCase() === targetWallet.address.toLowerCase() && debtor.toLowerCase() === authorWallet.address.toLowerCase());
                return match;
            });
            
            // Filter out resolved debts using the on-chain helper function
            const pendingDebtEvents: EventLog[] = [];
            for (const event of relevantProposedEvents) {
                const pendingDebtId = Number((event as EventLog).args[0]);
                const isResolved = await isDebtResolved(pendingDebtId);
                if (!isResolved) {
                    pendingDebtEvents.push(event as EventLog);
                }
            }

            if (confirmedDebtEvents.length === 0 && pendingDebtEvents.length === 0) {
                await message.reply("No history found with this user.");
                return;
            }

            let history = '**Transaction History:**\n';

            history += '\n**Confirmed Debts:**\n';
            if (confirmedDebtEvents.length > 0) {
                for (const event of confirmedDebtEvents) {
                    const [_id, _debtor, _creditor, token, amount, memo, ts] = (event as EventLog).args;
                    const date = new Date(Number(ts) * 1000).toLocaleDateString();
                    
                    // Find token info or use defaults
                    const tokenInfo = findTokenByAddress(token) || {
                        address: token,
                        decimals: 18,
                        symbol: token.slice(0, 8) + '...'
                    };
                    
                    history += `[${date}] ${memo} - Amount: ${formatTokenAmount(amount, tokenInfo)}\n`;
                }
            } else {
                history += 'No confirmed debts.\n';
            }

            history += '\n**Pending Debts:**\n';
            if (pendingDebtEvents.length > 0) {
                for (const event of pendingDebtEvents) {
                    const [_id, _creditor, _debtor, token, amount, memo] = (event as EventLog).args;
                    
                    // Find token info or use defaults
                    const tokenInfo = findTokenByAddress(token) || {
                        address: token,
                        decimals: 18,
                        symbol: token.slice(0, 8) + '...'
                    };
                    
                    history += `(Pending) ${memo} - Amount: ${formatTokenAmount(amount, tokenInfo)}\n`;
                }
            } else {
                history += 'No pending debts.\n';
            }

            await message.reply(history);
            break;
        }

        case 'fund-wallet': {
            // Development command to fund user wallets with ETH for gas fees
            const userWallet = await getWalletForDiscordId(message.author.id);
            if (!userWallet) {
                await message.reply("You need to register first. Use `>register`.");
                return;
            }
            
            try {
                console.log(`[DEBUG] Manually funding wallet ${userWallet.address} with 10 ETH...`);
                const fundingTx = await wallet.sendTransaction({
                    to: userWallet.address,
                    value: ethers.parseEther("10")
                });
                await fundingTx.wait();
                await message.reply(`✅ Successfully funded your wallet (${userWallet.address}) with 10 ETH for gas fees.`);
            } catch (error) {
                console.error(`[DEBUG] Failed to fund wallet:`, error);
                await message.reply(`❌ Failed to fund wallet: ${error}`);
            }
            break;
        }

        case 'test-parse': {
            // Debug command to test token parsing without hitting the blockchain
            if (args.length < 2) {
                await message.reply("Usage: `>test-parse <amount> [token]`");
                return;
            }
            const testAmount = args[0];
            const testToken = args[1] || 'USDC';
            
            try {
                console.log(`[DEBUG] Testing parse with amount: ${testAmount}, token: ${testToken}`);
                const tokenInfo = parseTokenIdentifier(testToken);
                console.log(`[DEBUG] Token info:`, tokenInfo);
                const amount = parseTokenAmount(testAmount, tokenInfo);
                console.log(`[DEBUG] Parsed amount:`, amount.toString());
                const formatted = formatTokenAmount(amount, tokenInfo);
                
                await message.reply(`✅ Parse test successful!\n**Input:** ${testAmount} ${testToken}\n**Token Info:** ${JSON.stringify(tokenInfo)}\n**Parsed Amount:** ${amount.toString()}\n**Formatted:** ${formatted}`);
            } catch (error) {
                console.error(`[DEBUG] Parse test failed:`, error);
                await message.reply(`❌ Parse test failed: ${error}`);
            }
            break;
        }

        case 'debug-events': {
            // Debug command to check recent blockchain events
            const targetUser = message.mentions.users.first();
            if (!targetUser) {
                await message.reply("Usage: `>debug-events @user`");
                return;
            }

            const user1 = await getWalletForDiscordId(message.author.id);
            const user2 = await getWalletForDiscordId(targetUser.id);
            
            if (!user1 || !user2) {
                await message.reply("Both users must be registered to debug events.");
                return;
            }

            try {
                // Get ALL DebtProposed events first to see what's in the blockchain
                const allProposedEvents = await contract.queryFilter(contract.filters.DebtProposed());
                console.log(`[DEBUG] Total DebtProposed events on chain: ${allProposedEvents.length}`);
                
                // Log all events for debugging
                for (const event of allProposedEvents) {
                    const [pendingDebtId, creditor, debtor, token, amount, memo] = (event as EventLog).args;
                    console.log(`[DEBUG] Event ${pendingDebtId}: creditor=${creditor}, debtor=${debtor}`);
                }
                
                // Filter events involving these specific users
                const relevantEvents = allProposedEvents.filter(event => {
                    const [_id, creditor, debtor, _token, _amount, _memo] = (event as EventLog).args;
                    const match = (creditor.toLowerCase() === user1.address.toLowerCase() && debtor.toLowerCase() === user2.address.toLowerCase()) ||
                                  (creditor.toLowerCase() === user2.address.toLowerCase() && debtor.toLowerCase() === user1.address.toLowerCase());
                    console.log(`[DEBUG] Event check: creditor=${creditor}, debtor=${debtor}, user1=${user1.address}, user2=${user2.address}, match=${match}`);
                    return match;
                });

                let debugMessage = `🔍 **Debug: Recent Events**\n\n`;
                debugMessage += `**Your wallet:** \`${user1.address}\`\n`;
                debugMessage += `**Their wallet:** \`${user2.address}\`\n\n`;
                debugMessage += `**Total DebtProposed events on chain:** ${allProposedEvents.length}\n`;
                debugMessage += `**Events involving you two:** ${relevantEvents.length}\n\n`;

                for (const event of relevantEvents.slice(-3)) { // Show last 3 events
                    const [pendingDebtId, creditor, debtor, token, amount, memo] = (event as EventLog).args;
                    const isResolved = await isDebtResolved(Number(pendingDebtId));
                    const tokenInfo = findTokenByAddress(token) || { symbol: 'Unknown', decimals: 18, address: token };
                    
                    debugMessage += `**Event ${pendingDebtId}:**\n`;
                    debugMessage += `• Creditor: \`${creditor}\`\n`;
                    debugMessage += `• Debtor: \`${debtor}\`\n`;  
                    debugMessage += `• Amount: ${formatTokenAmount(amount, tokenInfo)}\n`;
                    debugMessage += `• Memo: ${memo}\n`;
                    debugMessage += `• Status: ${isResolved ? 'Resolved' : 'Pending'}\n`;
                    debugMessage += `• Block: ${event.blockNumber}\n\n`;
                }

                if (relevantEvents.length === 0) {
                    debugMessage += `*No DebtProposed events found between you and ${targetUser.tag}*\n\n`;
                    
                    // Show all events for debugging if none match
                    if (allProposedEvents.length > 0) {
                        debugMessage += `**All events on chain (for debugging):**\n`;
                        for (const event of allProposedEvents.slice(-5)) {
                            const [pendingDebtId, creditor, debtor, token, amount, memo] = (event as EventLog).args;
                            const tokenInfo = findTokenByAddress(token) || { symbol: 'Unknown', decimals: 18, address: token };
                            debugMessage += `• Event ${pendingDebtId}: \`${creditor}\` → \`${debtor}\` (${formatTokenAmount(amount, tokenInfo)})\n`;
                        }
                    }
                }

                await message.reply(debugMessage);
            } catch (error) {
                console.error('[DEBUG] Event debugging failed:', error);
                const errorMessage = (error as Error).message || (error as any).toString();
                await message.reply(`❌ Debug failed: ${errorMessage}`);
            }
            break;
        }

        case 'help': {
            const helpMessage = `\n**BillTheAccountant Bot Commands**\n\n**Manual Commands:**\n**>register** - Register yourself and get a new wallet (auto-funded with 10 ETH).\n**>recover-key <private_key>** - Recover access to your registered wallet (DM only).\n**>reset-wallet** - Fix wallet issues from system updates or registration conflicts.\n**>add-debt @user <amount> [token] <memo...>** - Propose a new debt to another user.\n**>balance @user <token_symbol_or_address>** - Check your confirmed and pending balances with another user.\n**>history @user** - View your confirmed and pending transaction history with another user.\n**>fund-wallet** - Manually fund your wallet with 10 ETH for gas fees.\n\n**Automated Bill Detection:**\n**@Bill [mention users] + bill keywords** - Mention me with bill-related words to automatically analyze chat history and detect expenses!\n**Example:** "@Bill can you clear out our bill splitting from yesterday? @john @alice"\n\n**Debug Commands:**\n**>test-parse <amount> [token]** - Debug command to test token parsing.\n**>debug-events @user** - Debug command to check blockchain events with a user.\n**>help** - Shows this help message.\n\n*🤖 **Smart Features:** I can automatically detect expenses from your chat history using AI!*\n*If you get "needs private key recovery" messages, check your DMs for recovery instructions.*\n`;
            await message.reply(helpMessage);
            break;
        }
    }
});

client.on('interactionCreate', async (interaction: Interaction) => {
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('select_debt_token:')) {
            const selectedToken = interaction.values[0];
            await safeInteractionReply(interaction, `You selected ${selectedToken}. Please run the add-debt command again with the token specified: \`>add-debt @user <amount> ${selectedToken} <memo>\``, { ephemeral: true });
        }
    } else if (interaction.isButton()) {
        // Handle automated bill confirmation buttons
        if (interaction.customId === 'confirm-bills' || interaction.customId === 'cancel-bills') {
            await handleBillConfirmation(interaction);
            return;
        }
        
        // Handle regular debt proposal buttons
        const [action, pendingDebtIdStr] = interaction.customId.split(':');
        const pendingDebtId = BigInt(pendingDebtIdStr);

        if (action === 'agree-debt') {
            // Find the user's wallet info first (outside try block so it's accessible in catch)
            const userId = interaction.user.id;
            const userWallet = await getWalletForDiscordId(userId);
            if (!userWallet) {
                await interaction.update({ content: 'Error: User not registered. Please use >register first.', components: [] });
                return;
            }
            
            try {
                console.log(`[DEBUG] agree-debt clicked - pendingDebtIdStr: "${pendingDebtIdStr}", parsed pendingDebtId: ${pendingDebtId}, type: ${typeof pendingDebtId}`);
                
                // Create a contract instance using the user's wallet
                const userEthersWallet = new Wallet(userWallet.privateKey, provider);
                const userContract = new Contract(CONTRACT_ADDRESS, BillTheAccountantABI.abi, userEthersWallet);
                
                console.log(`[DEBUG] About to call contract.confirmDebt(${pendingDebtId}) using user's wallet: ${userWallet.address}`);
                const tx = await userContract.confirmDebt(pendingDebtId);
                const receipt = await tx.wait();
                
                // Get the debt details for the confirmation message
                const confirmedFilter = contract.filters.DebtAdded();
                const confirmedEvents = await contract.queryFilter(confirmedFilter, receipt.blockNumber, receipt.blockNumber);
                
                let confirmationMessage = '✅ **Debt confirmed and added to ledger!**\n\n';
                
                // Add transaction details
                confirmationMessage += `**Transaction Details:**\n`;
                confirmationMessage += `• Transaction Hash: \`${tx.hash}\`\n`;
                confirmationMessage += `• Block Number: ${receipt.blockNumber}\n`;
                confirmationMessage += `• Network: ${getNetworkName()}\n`;
                
                // Add block explorer link if available
                const explorerUrl = getBlockExplorerUrl(tx.hash);
                if (explorerUrl) {
                    confirmationMessage += `• View on Explorer: ${explorerUrl}\n`;
                } else {
                    confirmationMessage += `• Local Network: No block explorer available\n`;
                }
                
                // Add debt information from the most recent DebtAdded event
                if (confirmedEvents.length > 0) {
                    const debtEvent = confirmedEvents[confirmedEvents.length - 1] as EventLog;
                    const [actionId, debtor, creditor, token, amount, memo, timestamp] = debtEvent.args;
                    
                    // Find token info for formatting
                    const tokenInfo = findTokenByAddress(token) || {
                        address: token,
                        decimals: 18,
                        symbol: token.slice(0, 8) + '...'
                    };
                    
                    confirmationMessage += `\n**Debt Details:**\n`;
                    confirmationMessage += `• Amount: ${formatTokenAmount(amount, tokenInfo)}\n`;
                    confirmationMessage += `• Memo: ${memo}\n`;
                    confirmationMessage += `• Action ID: ${actionId}\n`;
                }
                
                confirmationMessage += `\n*This debt has been permanently recorded on the ${getNetworkName().toLowerCase()} blockchain.*`;
                
                await interaction.update({ content: confirmationMessage, components: [] });
            } catch (e) {
                console.error(e);
                
                // Check if it's an insufficient funds error
                const errorMessage = (e as any).message || (e as Error).toString();
                if (errorMessage.includes('insufficient funds') || errorMessage.includes("doesn't have enough funds")) {
                    // Get current balance to show in error message
                    let balanceInfo = '';
                    try {
                        const balance = await provider.getBalance(userWallet.address);
                        const balanceEth = ethers.formatEther(balance);
                        balanceInfo = `\n**Current Balance:** ${balanceEth} ETH`;
                    } catch (balanceError) {
                        console.error('Failed to get balance:', balanceError);
                    }
                    
                    // Keep the buttons available for insufficient funds error
                    await interaction.update({ 
                        content: `❌ **Insufficient funds to confirm debt**\n\nYour wallet (${userWallet.address}) needs ETH to pay for gas fees.${balanceInfo}\n\n**Solutions:**\n• Run \`>fund-wallet\` to get 10 ETH for gas fees\n• Ask someone to send you ETH\n• Try again once you have funds\n\n*The debt proposal is still active - you can try accepting again once funded.*`,
                        components: interaction.message.components // Keep the original buttons
                    });
                } else {
                    // For other errors, remove buttons
                    await interaction.update({ content: `Failed to confirm debt: ${errorMessage}`, components: [] });
                }
            }
        } else if (action === 'disagree-debt') {
            const modal = new ModalBuilder()
                .setCustomId(`disagree-modal:${pendingDebtId}`)
                .setTitle('Disagree with Debt Proposal');

            const reasonInput = new TextInputBuilder()
                .setCustomId('disagree-reason')
                .setLabel("What is the reason for your disagreement?")
                .setStyle(TextInputStyle.Paragraph);

            const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput);
            modal.addComponents(firstActionRow);
            await safeShowModal(interaction, modal);
        }
    } else if (interaction.isModalSubmit()) {
        const [customId, pendingDebtIdStr] = interaction.customId.split(':');
        const pendingDebtId = BigInt(pendingDebtIdStr);

        if (customId === 'disagree-modal') {
            const reason = interaction.fields.getTextInputValue('disagree-reason');
            try {
                const pendingDebt = await contract.pendingDebts(pendingDebtId);
                // Get creditor Discord ID from on-chain mapping
                const creditorId = await contract.walletToDiscord(pendingDebt.creditor);

                // Use the user's wallet to reject the debt
                const userId = interaction.user.id;
                const userWallet = await getWalletForDiscordId(userId);
                if (!userWallet) {
                    await interaction.reply({ content: 'Error: User not registered. Please use >register first.', ephemeral: true });
                    return;
                }
                const userEthersWallet = new Wallet(userWallet.privateKey, provider);
                const userContract = new Contract(CONTRACT_ADDRESS, BillTheAccountantABI.abi, userEthersWallet);
                
                const tx = await userContract.rejectDebt(pendingDebtId);
                const receipt = await tx.wait();

                if (creditorId && creditorId !== "") {
                    const creditorUser = await client.users.fetch(creditorId);
                    await creditorUser.send(`Your debt proposal was rejected by ${interaction.user.tag}. Reason: ${reason}`);
                }

                // Create detailed rejection message
                let rejectionMessage = '❌ **Debt proposal rejected**\n\n';
                rejectionMessage += `**Transaction Details:**\n`;
                rejectionMessage += `• Transaction Hash: \`${tx.hash}\`\n`;
                rejectionMessage += `• Block Number: ${receipt.blockNumber}\n`;
                rejectionMessage += `• Network: ${getNetworkName()}\n`;
                
                const explorerUrl = getBlockExplorerUrl(tx.hash);
                if (explorerUrl) {
                    rejectionMessage += `• View on Explorer: ${explorerUrl}\n`;
                }
                
                rejectionMessage += `\n*The rejection has been recorded on-chain.*`;

                await interaction.reply({ content: rejectionMessage, ephemeral: true });
            } catch (e) {
                console.error(e);
                
                // Check if it's an insufficient funds error
                const errorMessage = (e as any).message || (e as Error).toString();
                if (errorMessage.includes('insufficient funds') || errorMessage.includes("doesn't have enough funds")) {
                    await interaction.reply({ 
                        content: `❌ **Insufficient funds to reject debt**\n\nYou need ETH for gas fees. Run \`>fund-wallet\` to get 10 ETH, then try again.`, 
                        ephemeral: true 
                    });
                } else {
                    await interaction.reply({ content: `Failed to reject debt: ${errorMessage}`, ephemeral: true });
                }
            }
        }
    }
});

client.login(DISCORD_TOKEN);