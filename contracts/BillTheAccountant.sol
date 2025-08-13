// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title BillTheAccountant
 * @dev A decentralized debt ledger that nets balances between peers and
 *      maintains a historical record of all transactions using events.
 */
contract BillTheAccountant {

    // Core data structure: tokenAddress => debtor => creditor => amount
    mapping(address => mapping(address => mapping(address => uint256))) public debts;

    uint256 public debtActionCounter;
    
    // Store Discord ID to wallet address mapping on-chain
    mapping(string => address) public discordToWallet;
    mapping(address => string) public walletToDiscord;

    struct PendingDebt {
        address creditor;
        address debtor;
        address token;
        uint256 amount;
        string memo;
        bool exists;
    }

    mapping(uint256 => PendingDebt) public pendingDebts;
    uint256 public pendingDebtCounter;

    event DebtAdded(
        uint256 indexed actionId,
        address indexed debtor,
        address indexed creditor,
        address token,
        uint256 amount,
        string memo,
        uint256 timestamp
    );

    event DebtSettled(
        address indexed debtor,
        address indexed creditor,
        address token,
        uint256 amount
    );

    event DebtProposed(
        uint256 pendingDebtId,
        address indexed creditor,
        address indexed debtor,
        address indexed token,
        uint256 amount,
        string memo
    );

    event DebtConfirmed(
        uint256 indexed pendingDebtId
    );

    event DebtRejected(
        uint256 indexed pendingDebtId
    );

    event UserRegistered(
        string indexed discordId,
        address indexed walletAddress
    );

    function proposeDebt(address token, address debtor, uint256 amount, string memory memo) public {
        require(debtor != msg.sender, "Debtor and creditor cannot be the same");
        pendingDebtCounter++;
        pendingDebts[pendingDebtCounter] = PendingDebt(msg.sender, debtor, token, amount, memo, true);
        emit DebtProposed(pendingDebtCounter, msg.sender, debtor, token, amount, memo);
    }

    function confirmDebt(uint256 pendingDebtId) public {
        PendingDebt storage pending = pendingDebts[pendingDebtId];
        require(pending.exists, "Pending debt does not exist");
        require(msg.sender == pending.debtor, "Only the debtor can confirm the debt");

        addDebt(pending.token, pending.debtor, pending.creditor, pending.amount, pending.memo);

        delete pendingDebts[pendingDebtId];
        emit DebtConfirmed(pendingDebtId);
    }

    function rejectDebt(uint256 pendingDebtId) public {
        PendingDebt storage pending = pendingDebts[pendingDebtId];
        require(pending.exists, "Pending debt does not exist");
        require(msg.sender == pending.debtor || msg.sender == pending.creditor, "Only debtor or creditor can reject");

        delete pendingDebts[pendingDebtId];
        emit DebtRejected(pendingDebtId);
    }

    function addDebt(address token, address debtor, address creditor, uint256 amount, string memory memo) internal {
        require(debtor != creditor, "Debtor and creditor cannot be the same");
        require(amount > 0, "Debt amount must be positive");

        uint256 existingOppositeDebt = debts[token][creditor][debtor];

        if (existingOppositeDebt >= amount) {
            debts[token][creditor][debtor] = existingOppositeDebt - amount;
        } else {
            if (existingOppositeDebt > 0) {
                debts[token][creditor][debtor] = 0;
            }
            debts[token][debtor][creditor] += amount - existingOppositeDebt;
        }

        debtActionCounter++;
        emit DebtAdded(
            debtActionCounter,
            debtor,
            creditor,
            token,
            amount,
            memo,
            block.timestamp
        );
    }

    function settleDebt(address token, address creditor) public {
        uint256 amountOwed = debts[token][msg.sender][creditor];
        require(amountOwed > 0, "No debt to settle");

        debts[token][msg.sender][creditor] = 0;

        IERC20(token).transferFrom(msg.sender, creditor, amountOwed);

        emit DebtSettled(msg.sender, creditor, token, amountOwed);
    }

    function registerUser(string memory discordId, address walletAddress) public {
        require(bytes(discordId).length > 0, "Discord ID cannot be empty");
        require(walletAddress != address(0), "Wallet address cannot be zero");
        require(discordToWallet[discordId] == address(0), "Discord ID already registered");
        require(bytes(walletToDiscord[walletAddress]).length == 0, "Wallet already registered");
        
        discordToWallet[discordId] = walletAddress;
        walletToDiscord[walletAddress] = discordId;
        
        emit UserRegistered(discordId, walletAddress);
    }
}
