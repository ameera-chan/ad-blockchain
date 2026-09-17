// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Setup {
    address public immutable victim;
    address public immutable lendingVault;
    address public immutable legacyGauge;
    address public immutable riskGovernor;
    address public immutable voteMirror;
    address public immutable daoTreasury;

    constructor(
        address victim_,
        address lendingVault_,
        address legacyGauge_,
        address riskGovernor_,
        address voteMirror_,
        address daoTreasury_
    ) {
        victim = victim_;
        lendingVault = lendingVault_;
        legacyGauge = legacyGauge_;
        riskGovernor = riskGovernor_;
        voteMirror = voteMirror_;
        daoTreasury = daoTreasury_;
    }
}
