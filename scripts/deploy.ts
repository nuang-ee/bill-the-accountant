import { ethers } from "hardhat";

async function main() {
    const Splitwise = await ethers.getContractFactory("Splitwise");
    const splitwise = await Splitwise.deploy();

    await splitwise.waitForDeployment();

    console.log("Splitwise deployed to:", splitwise.target);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});