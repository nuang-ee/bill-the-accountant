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
        mockERC20 = await MockERC20Factory.deploy("Mock Token", "MT");
        await mockERC20.waitForDeployment();

        const BillTheAccountantFactory = await ethers.getContractFactory("BillTheAccountant");
        billTheAccountant = await BillTheAccountantFactory.deploy();
        await billTheAccountant.waitForDeployment();
    });

    it("Should add a new debt and emit an event", async function () {
        const amount = ethers.parseUnits("100", 18);
        const memo = "Test debt";

        await expect(billTheAccountant.addDebt(await mockERC20.getAddress(), addr1.address, addr2.address, amount, memo))
            .to.emit(billTheAccountant, "DebtAdded")
            .withArgs(1, addr1.address, addr2.address, await mockERC20.getAddress(), amount, memo, (await ethers.provider.getBlock('latest'))!.timestamp + 1);

        const debt = await billTheAccountant.debts(await mockERC20.getAddress(), addr1.address, addr2.address);
        expect(debt).to.equal(amount);
    });

    it("Should net debts correctly", async function () {
        const addr1OwesAddr2 = ethers.parseUnits("100", 18);
        await billTheAccountant.addDebt(await mockERC20.getAddress(), addr1.address, addr2.address, addr1OwesAddr2, "First debt");

        const addr2OwesAddr1 = ethers.parseUnits("30", 18);
        await billTheAccountant.addDebt(await mockERC20.getAddress(), addr2.address, addr1.address, addr2OwesAddr1, "Second debt (netting)");

        const finalDebtAddr1ToAddr2 = await billTheAccountant.debts(await mockERC20.getAddress(), addr1.address, addr2.address);
        const finalDebtAddr2ToAddr1 = await billTheAccountant.debts(await mockERC20.getAddress(), addr2.address, addr1.address);

        expect(finalDebtAddr1ToAddr2).to.equal(ethers.parseUnits("70", 18));
        expect(finalDebtAddr2ToAddr1).to.equal(0);
    });

    it("Should allow a user to settle their debt", async function () {
        const amount = ethers.parseUnits("50", 18);
        await billTheAccountant.addDebt(await mockERC20.getAddress(), addr1.address, owner.address, amount, "Debt to be settled");

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
});