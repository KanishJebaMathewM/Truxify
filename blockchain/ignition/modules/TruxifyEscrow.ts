import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const TruxifyModule = buildModule("TruxifyModule", (m) => {
  const deployer = m.getAccount(0);

  const escrow = m.contract("TruxifyEscrow");

  const reputation = m.contract("Reputation", [deployer]);

  return { escrow, reputation };
});

export default TruxifyModule;
