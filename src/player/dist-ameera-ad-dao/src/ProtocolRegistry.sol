// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ProtocolRegistry {
    address public immutable referenceBorrower;
    address public immutable lendingVault;
    address public immutable rewardGaugeV1;
    address public immutable riskGovernor;
    address public immutable voteMirror;
    address public immutable daoTreasury;

    constructor(
        address referenceBorrower_,
        address lendingVault_,
        address rewardGaugeV1_,
        address riskGovernor_,
        address voteMirror_,
        address daoTreasury_
    ) {
        referenceBorrower = referenceBorrower_;
        lendingVault = lendingVault_;
        rewardGaugeV1 = rewardGaugeV1_;
        riskGovernor = riskGovernor_;
        voteMirror = voteMirror_;
        daoTreasury = daoTreasury_;
    }
}
