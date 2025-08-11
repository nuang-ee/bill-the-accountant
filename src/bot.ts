import { Client, GatewayIntentBits, Message, Partials, User, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, Interaction } from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import { ethers, Contract, Wallet, JsonRpcProvider, EventLog } from 'ethers';
import SplitwiseABI from '../artifacts/contracts/Splitwise.sol/Splitwise.json';

dotenv.config();

// --- Configuration ---
const { DISCORD_TOKEN, RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS } = process.env;
const PREFIX = '>';
const USER_WALLETS_FILE = './user-wallets.json';

// --- Basic Setup ---
if (!DISCORD_TOKEN || !RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
    throw new Error("Missing environment variables. Please check your .env file.");
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel], // Required for DMs
});

const provider = new JsonRpcProvider(RPC_URL);
const wallet = new Wallet(PRIVATE_KEY, provider);
const contract = new Contract(CONTRACT_ADDRESS, SplitwiseABI.abi, wallet);

// --- User Wallets Persistence ---
let userWallets: { [discordId: string]: string } = {};

function loadUserWallets() {
    try {
        if (fs.existsSync(USER_WALLETS_FILE)) {
            const data = fs.readFileSync(USER_WALLETS_FILE, 'utf-8');
            userWallets = JSON.parse(data);
            console.log('User wallets loaded from file.');
        }
    } catch (error) {
        console.error('Error loading user wallets:', error);
    }
}

function saveUserWallets() {
    try {
        fs.writeFileSync(USER_WALLETS_FILE, JSON.stringify(userWallets, null, 4));
    } catch (error) {
        console.error('Error saving user wallets:', error);
    }
}

loadUserWallets();

const SUPPORTED_TOKENS: { [symbol: string]: string } = {
    'ETH': '0x0000000000000000000000000000000000000000',
    'USDC': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' // Sepolia
};

// --- Bot Logic ---
client.once('ready', () => {
    console.log(`Bot is online! Logged in as ${client.user?.tag}`);
    console.log(`Connected to contract at: ${CONTRACT_ADDRESS}`);
});

client.on('messageCreate', async (message: Message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift()?.toLowerCase();

    // --- Command Handler --
    switch (command) {
        case 'register': {
            const newWallet = ethers.Wallet.createRandom();
            userWallets[message.author.id] = newWallet.address;
            saveUserWallets();
            await message.author.send(`Your new wallet address is: ${newWallet.address}\nYour private key is: ${newWallet.privateKey}\n**IMPORTANT: Save this private key securely. It cannot be recovered.**`);
            await message.reply(`I've sent you a DM with your new wallet details.`);
            break;
        }

        case 'add-debt': {
            // >add-debt @user <amount> [token] <memo...>
            const mentionedUser = message.mentions.users.first();
            if (!mentionedUser || args.length < 2) {
                await message.reply("Usage: `>add-debt @user <amount> [token] <memo...>`");
                return;
            }

            const amountRaw = args[1];
            let tokenIdentifier: string | undefined;
            let memo: string;

            if (args.length > 2) {
                const potentialToken = args[2].toUpperCase();
                if (ethers.isAddress(potentialToken) || SUPPORTED_TOKENS[potentialToken]) {
                    tokenIdentifier = potentialToken;
                    memo = args.slice(3).join(' ');
                } else {
                    tokenIdentifier = undefined;
                    memo = args.slice(2).join(' ');
                }
            } else {
                tokenIdentifier = undefined;
                memo = '';
            }

            const debtor = userWallets[mentionedUser.id];
            const creditor = userWallets[message.author.id];

            if (!debtor || !creditor) {
                await message.reply("Both you and the mentioned user must be registered. Use `>register`.");
                return;
            }

            if (tokenIdentifier) {
                const tokenAddress = ethers.isAddress(tokenIdentifier) ? tokenIdentifier : SUPPORTED_TOKENS[tokenIdentifier];
                try {
                    const tx = await contract.addDebt(tokenAddress, debtor, creditor, ethers.parseEther(amountRaw), memo);
                    await tx.wait();
                    await message.reply(`Debt of ${amountRaw} ${tokenIdentifier} added for ${mentionedUser.tag}.\nTransaction: ${tx.hash}`);
                } catch (e) {
                    console.error(e);
                    await message.reply("Failed to add debt. See console for errors.");
                }
            } else {
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`select_debt_token:${message.id}`)
                    .setPlaceholder('Select a token')
                    .addOptions(
                        new StringSelectMenuOptionBuilder()
                            .setLabel('ETH')
                            .setValue('ETH'),
                        new StringSelectMenuOptionBuilder()
                            .setLabel('USDC')
                            .setValue('USDC')
                    );

                const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

                await message.reply({
                    content: 'Please select a token for the debt:',
                    components: [row]
                });
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

            const upperTokenIdentifier = tokenIdentifier.toUpperCase();
            let tokenAddress: string;

            if (ethers.isAddress(upperTokenIdentifier)) {
                tokenAddress = upperTokenIdentifier;
            } else if (SUPPORTED_TOKENS[upperTokenIdentifier]) {
                tokenAddress = SUPPORTED_TOKENS[upperTokenIdentifier];
            } else {
                await message.reply(`Invalid token: ${tokenIdentifier}. Supported tokens are ETH, USDC, or a valid address.`);
                return;
            }

            const user1 = userWallets[message.author.id];
            const user2 = userWallets[targetUser.id];
            
            if (!user1 || !user2) {
                 await message.reply("Both you and the mentioned user must be registered. Use `>register`.");
                 return;
            }

            const debtOwed = await contract.debts(tokenAddress, user1, user2);
            const debtOwing = await contract.debts(tokenAddress, user2, user1);

            await message.reply(`Your balance with ${targetUser.tag} for ${upperTokenIdentifier}:\n- You owe them: ${ethers.formatEther(debtOwing)} tokens\n- They owe you: ${ethers.formatEther(debtOwed)} tokens`);
            break;
        }

        case 'help': {
            const helpMessage = `
**Splitwise Bot Commands**

**>register** - Register yourself and get a new wallet.
**>add-debt @user <amount> [token] <memo...>** - Add a new debt. If no token is specified, a dropdown will appear.
**>balance @user <token_symbol_or_address>** - Check your balance with another user for a specific token.
**>history @user** - View your transaction history with another user.
**>help** - Shows this help message.
`;
            await message.reply(helpMessage);
            break;
        }

        case 'history': {

            const historyUser = message.mentions.users.first();
            if (!historyUser) {
                await message.reply("Usage: `>history @user`");
                return;
            }
            const authorWallet = userWallets[message.author.id];
            const targetWallet = userWallets[historyUser.id];

            if (!authorWallet || !targetWallet) {
                await message.reply("Both you and the mentioned user must be registered. Use `>register`.");
                return;
            }

            const filter1 = contract.filters.DebtAdded(undefined, authorWallet, targetWallet);
            const filter2 = contract.filters.DebtAdded(undefined, targetWallet, authorWallet);

            const events1 = await contract.queryFilter(filter1);
            const events2 = await contract.queryFilter(filter2);

            const allEvents = [...events1, ...events2]
                .filter((e): e is EventLog => 'args' in e)
                .sort((a, b) => Number(a.args.timestamp) - Number(b.args.timestamp));

            if (allEvents.length === 0) {
                await message.reply("No history found with this user.");
                return;
            }

            let history = 'Transaction History:\n';
            for (const event of allEvents) {
                const [_id, _debtor, _creditor, _token, amount, memo, ts] = event.args;
                const date = new Date(Number(ts) * 1000).toLocaleDateString();
                history += `[${date}] ${memo} - Amount: ${ethers.formatEther(amount)}\n`;
            }
            await message.reply(history);
            break;
        }
    }
});

client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isStringSelectMenu()) return;

    const [customId, messageId] = interaction.customId.split(':');

    if (customId === 'select_debt_token') {
        const originalMessage = await interaction.channel?.messages.fetch(messageId);
        if (!originalMessage) {
            await interaction.reply({ content: 'Original message not found.', ephemeral: true });
            return;
        }

        const mentionedUser = originalMessage.mentions.users.first();
        const args = originalMessage.content.slice(PREFIX.length).trim().split(/ +/);
        args.shift(); // remove command

        if (!mentionedUser || args.length < 2) {
            await interaction.reply({ content: 'Invalid original command.', ephemeral: true });
            return;
        }
        
        const debtor = userWallets[mentionedUser.id];
        const creditor = userWallets[originalMessage.author.id];
        const amountRaw = args[1];
        const tokenIdentifier = interaction.values[0];
        
        let memo: string;
        if (args.length > 2) {
            const potentialToken = args[2].toUpperCase();
            if (ethers.isAddress(potentialToken) || SUPPORTED_TOKENS[potentialToken]) {
                memo = args.slice(3).join(' ');
            } else {
                memo = args.slice(2).join(' ');
            }
        } else {
            memo = '';
        }

        const tokenAddress = SUPPORTED_TOKENS[tokenIdentifier];

        if (!debtor || !creditor) {
            await interaction.reply({ content: "Both users must be registered.", ephemeral: true });
            return;
        }

        try {
            const tx = await contract.addDebt(tokenAddress, debtor, creditor, ethers.parseEther(amountRaw), memo);
            await tx.wait();
            await interaction.update({ content: `Debt of ${amountRaw} ${tokenIdentifier} added for ${mentionedUser.tag}.\nTransaction: ${tx.hash}`, components: [] });
        } catch (e) {
            console.error(e);
            await interaction.update({ content: 'Failed to add debt. See console for errors.', components: [] });
        }
    }
});

client.login(DISCORD_TOKEN);