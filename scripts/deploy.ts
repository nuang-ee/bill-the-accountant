import { ethers } from "hardhat";

async function main() {
    const BillTheAccountant = await ethers.getContractFactory("BillTheAccountant");
    const billTheAccountant = await BillTheAccountant.deploy();

    await billTheAccountant.waitForDeployment();

    console.log("BillTheAccountant deployed to:", billTheAccountant.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});