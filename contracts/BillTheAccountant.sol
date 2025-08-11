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

    /**
     * @dev Emitted every time a new debt is added, creating an immutable historical record.
     * @param actionId A unique, incrementing ID for the debt action.
     * @param debtor The address of the person who owes money.
     * @param creditor The address of the person who is owed money.
     * @param token The ERC20 token of the debt.
     * @param amount The gross amount of the debt action.
     * @param memo A description of why the debt was created.
     * @param timestamp The block timestamp of the transaction.
     */
    event DebtAdded(
        uint256 indexed actionId,
        address indexed debtor,
        address indexed creditor,
        address token,
        uint256 amount,
        string memo,
        uint256 timestamp
    );

    /**
     * @dev Emitted when a debt is settled.
     * @param debtor The address of the person who paid the debt.
     * @param creditor The address of the person who received the payment.
     * @param token The ERC20 token of the debt.
     * @param amount The amount settled.
     */
    event DebtSettled(
        address indexed debtor,
        address indexed creditor,
        address token,
        uint256 amount
    );

    /**
     * @notice Records a new debt, automatically netting it against any existing debt.
     * @param token The ERC20 token of the debt.
     * @param debtor The address of the person who owes money.
     * @param creditor The address of the person who is owed money.
     * @param amount The amount of the debt.
     * @param memo A description of the debt (e.g., "For lunch").
     */
    function addDebt(address token, address debtor, address creditor, uint256 amount, string memory memo) public {
        require(debtor != creditor, "Debtor and creditor cannot be the same");
        require(amount > 0, "Debt amount must be positive");

        uint256 existingOppositeDebt = debts[token][creditor][debtor];

        if (existingOppositeDebt >= amount) {
            // New debt is smaller or equal to opposite debt.
            // The new debt is fully cancelled out by reducing the opposite debt.
            debts[token][creditor][debtor] = existingOppositeDebt - amount;
        } else {
            // New debt is larger than opposite debt.
            // Clear the opposite debt and record the remainder of the new debt.
            if (existingOppositeDebt > 0) {
                debts[token][creditor][debtor] = 0;
            }
            debts[token][debtor][creditor] += amount - existingOppositeDebt;
        }

        // Emit an event for the historical record, regardless of netting.
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

    /**
     * @notice Settles a debt. The caller must have approved the contract to spend tokens.
     * @param token The ERC20 token of the debt.
     * @param creditor The address to whom the debt is owed.
     */
    function settleDebt(address token, address creditor) public {
        uint256 amountOwed = debts[token][msg.sender][creditor];
        require(amountOwed > 0, "No debt to settle");

        // Clear the debt before the transfer to prevent re-entrancy.
        debts[token][msg.sender][creditor] = 0;

        // Transfer the tokens from the debtor (msg.sender) to the creditor.
        IERC20(token).transferFrom(msg.sender, creditor, amountOwed);

        emit DebtSettled(msg.sender, creditor, token, amountOwed);
    }
}