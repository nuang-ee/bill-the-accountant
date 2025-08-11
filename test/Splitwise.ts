import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Splitwise, MockERC20 } from "../typechain-types";

describe("Splitwise Ledger", function () {
    let splitwise: Splitwise;
    let mockERC20: MockERC20;
    let owner: HardhatEthersSigner, addr1: HardhatEthersSigner, addr2: HardhatEthersSigner;

    beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners();

        const MockERC20Factory = await ethers.getContractFactory("MockERC20");
        mockERC20 = await MockERC20Factory.deploy("Mock Token", "MT");
        await mockERC20.waitForDeployment();

        const SplitwiseFactory = await ethers.getContractFactory("Splitwise");
        splitwise = await SplitwiseFactory.deploy();
        await splitwise.waitForDeployment();
    });

    it("Should add a new debt and emit an event", async function () {
        const amount = ethers.parseUnits("100", 18);
        const memo = "Test debt";

        await expect(splitwise.addDebt(await mockERC20.getAddress(), addr1.address, addr2.address, amount, memo))
            .to.emit(splitwise, "DebtAdded")
            .withArgs(1, addr1.address, addr2.address, await mockERC20.getAddress(), amount, memo, (await ethers.provider.getBlock('latest'))!.timestamp + 1);

        const debt = await splitwise.debts(await mockERC20.getAddress(), addr1.address, addr2.address);
        expect(debt).to.equal(amount);
    });

    it("Should net debts correctly", async function () {
        const addr1OwesAddr2 = ethers.parseUnits("100", 18);
        await splitwise.addDebt(await mockERC20.getAddress(), addr1.address, addr2.address, addr1OwesAddr2, "First debt");

        const addr2OwesAddr1 = ethers.parseUnits("30", 18);
        await splitwise.addDebt(await mockERC20.getAddress(), addr2.address, addr1.address, addr2OwesAddr1, "Second debt (netting)");

        const finalDebtAddr1ToAddr2 = await splitwise.debts(await mockERC20.getAddress(), addr1.address, addr2.address);
        const finalDebtAddr2ToAddr1 = await splitwise.debts(await mockERC20.getAddress(), addr2.address, addr1.address);

        expect(finalDebtAddr1ToAddr2).to.equal(ethers.parseUnits("70", 18));
        expect(finalDebtAddr2ToAddr1).to.equal(0);
    });

    it("Should allow a user to settle their debt", async function () {
        const amount = ethers.parseUnits("50", 18);
        await splitwise.addDebt(await mockERC20.getAddress(), addr1.address, owner.address, amount, "Debt to be settled");

        // Fund addr1 and approve the contract to spend
        await mockERC20.connect(owner).transfer(addr1.address, amount);
        await mockERC20.connect(addr1).approve(await splitwise.getAddress(), amount);

        await expect(splitwise.connect(addr1).settleDebt(await mockERC20.getAddress(), owner.address))
            .to.emit(splitwise, "DebtSettled");

        const finalDebt = await splitwise.debts(await mockERC20.getAddress(), addr1.address, owner.address);
        expect(finalDebt).to.equal(0);

        const ownerBalance = await mockERC20.balanceOf(owner.address);
        // Initial mint was 1,000,000. Transferred 50 to addr1. Received 50 back.
        expect(ownerBalance).to.equal(ethers.parseUnits("1000000", 18));
    });
});