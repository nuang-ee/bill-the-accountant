import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { BillTheAccountant, MockERC20 } from "../typechain-types";

describe("BillTheAccountant Ledger", function () {
    let billTheAccountant: BillTheAccountant;
    let mockERC20: MockERC20;
    let owner: HardhatEthersSigner, addr1: HardhatEthersSigner, addr2: HardhatEthersSigner;

    beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners();

        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockERC20 = (await MockERC20Factory.deploy("Mock Token", "MT")) as unknown as MockERC20;
        await mockERC20.waitForDeployment();

        const BillTheAccountantFactory = await ethers.getContractFactory("BillTheAccountant");
        billTheAccountant = (await BillTheAccountantFactory.deploy()) as unknown as BillTheAccountant;
        await billTheAccountant.waitForDeployment();
    });

    it("Should add a new debt and emit an event", async function () {
        const amount = ethers.parseUnits("100", 18);
        const memo = "Test debt";

        // Propose debt
        const proposeTx = await billTheAccountant.connect(addr1).proposeDebt(await mockERC20.getAddress(), addr2.address, amount, memo);
        const proposeReceipt = await proposeTx.wait();
        expect(proposeReceipt).to.not.be.null;

        const debtProposedEvent = proposeReceipt!.logs.map((log: any) => {
            try {
                return billTheAccountant.interface.parseLog(log);
            } catch (error) {
                return null;
            }
        }).find((log: any) => log?.name === 'DebtProposed');

        expect(debtProposedEvent).to.not.be.null;
        const pendingDebtId = debtProposedEvent!.args[0]; // Extract pendingDebtId

        // Confirm debt
        await expect(billTheAccountant.connect(addr2).confirmDebt(pendingDebtId)) // Use extracted pendingDebtId
            .to.emit(billTheAccountant, "DebtConfirmed")
            .to.emit(billTheAccountant, "DebtAdded");

        const debt = await billTheAccountant.debts(await mockERC20.getAddress(), addr1.address, addr2.address);
        expect(debt).to.equal(amount);
    });

    it("Should net debts correctly", async function () {
        const addr1OwesAddr2 = ethers.parseUnits("100", 18);
        // Propose and confirm first debt
        const proposeTx1 = await billTheAccountant.connect(addr1).proposeDebt(await mockERC20.getAddress(), addr2.address, addr1OwesAddr2, "First debt");
        const proposeReceipt1 = await proposeTx1.wait();
        expect(proposeReceipt1).to.not.be.null;
        const debtProposedEvent1 = proposeReceipt1!.logs.map((log: any) => {
            try {
                return billTheAccountant.interface.parseLog(log);
            } catch (error) {
                return null;
            }
        }).find((log: any) => log?.name === 'DebtProposed');
        expect(debtProposedEvent1).to.not.be.null;
        const pendingDebtId1 = debtProposedEvent1!.args[0];
        await billTheAccountant.connect(addr2).confirmDebt(pendingDebtId1);

        const addr2OwesAddr1 = ethers.parseUnits("30", 18);
        // Propose and confirm second debt
        const proposeTx2 = await billTheAccountant.connect(addr2).proposeDebt(await mockERC20.getAddress(), addr1.address, addr2OwesAddr1, "Second debt (netting)");
        const proposeReceipt2 = await proposeTx2.wait();
        expect(proposeReceipt2).to.not.be.null;
        const debtProposedEvent2 = proposeReceipt2!.logs.map((log: any) => {
            try {
                return billTheAccountant.interface.parseLog(log);
            } catch (error) {
                return null;
            }
        }).find((log: any) => log?.name === 'DebtProposed');
        expect(debtProposedEvent2).to.not.be.null;
        const pendingDebtId2 = debtProposedEvent2!.args[0];
        await billTheAccountant.connect(addr1).confirmDebt(pendingDebtId2);

        const finalDebtAddr1ToAddr2 = await billTheAccountant.debts(await mockERC20.getAddress(), addr1.address, addr2.address);
        const finalDebtAddr2ToAddr1 = await billTheAccountant.debts(await mockERC20.getAddress(), addr2.address, addr1.address);

        expect(finalDebtAddr1ToAddr2).to.equal(ethers.parseUnits("70", 18));
        expect(finalDebtAddr2ToAddr1).to.equal(0);
    });

    it("Should allow a user to settle their debt", async function () {
        const amount = ethers.parseUnits("50", 18);
        // Propose and confirm debt
        const proposeTx = await billTheAccountant.connect(addr1).proposeDebt(await mockERC20.getAddress(), owner.address, amount, "Debt to be settled");
        const proposeReceipt = await proposeTx.wait();
        expect(proposeReceipt).to.not.be.null;
        const debtProposedEvent = proposeReceipt!.logs.map((log: any) => {
            try {
                return billTheAccountant.interface.parseLog(log);
            } catch (error) {
                return null;
            }
        }).find((log: any) => log?.name === 'DebtProposed');
        expect(debtProposedEvent).to.not.be.null;
        const pendingDebtId = debtProposedEvent!.args[0];
        await billTheAccountant.connect(owner).confirmDebt(pendingDebtId);

        // Fund addr1 and approve the contract to spend
        await mockERC20.connect(owner).transfer(addr1.address, amount);
        await mockERC20.connect(addr1).approve(await billTheAccountant.getAddress(), amount);

        await expect(billTheAccountant.connect(addr1).settleDebt(await mockERC20.getAddress(), owner.address))
            .to.emit(billTheAccountant, "DebtSettled");

        const finalDebt = await billTheAccountant.debts(await mockERC20.getAddress(), addr1.address, owner.address);
        expect(finalDebt).to.equal(0);

        const ownerBalance = await mockERC20.balanceOf(owner.address);
        // Initial mint was 1,000,000. Transferred 50 to addr1. Received 50 back.
        expect(ownerBalance).to.equal(ethers.parseUnits("1000000", 18));
    });

    it("Should allow a debtor to reject a debt proposal", async function () {
        const amount = ethers.parseUnits("10", 18);
        const memo = "Debt to be rejected";

        // Propose debt
        const proposeTx = await billTheAccountant.connect(addr1).proposeDebt(await mockERC20.getAddress(), addr2.address, amount, memo);
        const proposeReceipt = await proposeTx.wait();
        expect(proposeReceipt).to.not.be.null;
        const debtProposedEvent = proposeReceipt!.logs.map((log: any) => {
            try {
                return billTheAccountant.interface.parseLog(log);
            } catch (error) {
                return null;
            }
        }).find((log: any) => log?.name === 'DebtProposed');
        expect(debtProposedEvent).to.not.be.null;
        const pendingDebtId = debtProposedEvent!.args[0];

        // Reject debt
        await expect(billTheAccountant.connect(addr2).rejectDebt(pendingDebtId))
            .to.emit(billTheAccountant, "DebtRejected")
            .withArgs(pendingDebtId);

        // Verify that the pending debt no longer exists
        const pendingDebt = await billTheAccountant.pendingDebts(pendingDebtId);
        expect(pendingDebt.exists).to.be.false;
    });

    it("Should allow a creditor to reject a debt proposal", async function () {
        const amount = ethers.parseUnits("10", 18);
        const memo = "Debt to be rejected by creditor";

        // Propose debt
        const proposeTx = await billTheAccountant.connect(addr1).proposeDebt(await mockERC20.getAddress(), addr2.address, amount, memo);
        const proposeReceipt = await proposeTx.wait();
        expect(proposeReceipt).to.not.be.null;
        const debtProposedEvent = proposeReceipt!.logs.map((log: any) => {
            try {
                return billTheAccountant.interface.parseLog(log);
            } catch (error) {
                return null;
            }
        }).find((log: any) => log?.name === 'DebtProposed');
        expect(debtProposedEvent).to.not.be.null;
        const pendingDebtId = debtProposedEvent!.args[0];

        // Reject debt
        await expect(billTheAccountant.connect(addr1).rejectDebt(pendingDebtId))
            .to.emit(billTheAccountant, "DebtRejected")
            .withArgs(pendingDebtId);

        // Verify that the pending debt no longer exists
        const pendingDebt = await billTheAccountant.pendingDebts(pendingDebtId);
        expect(pendingDebt.exists).to.be.false;
    });
});