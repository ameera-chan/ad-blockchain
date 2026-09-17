// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20} from "../interfaces/IERC20.sol";

contract ArenaTimelock is TimelockController {
    address public immutable treasury;
    IERC20 public immutable asset;
    mapping(address => uint256) public captures;

    constructor(address admin, address treasury_, address asset_)
        TimelockController(0, new address[](0), new address[](0), admin)
    {
        treasury = treasury_;
        asset = IERC20(asset_);
    }

    function executeBatch(
        address[] calldata targets, uint256[] calldata values, bytes[] calldata payloads,
        bytes32 predecessor, bytes32 salt
    ) public payable override {
        address[] memory recipients = new address[](targets.length);
        uint256[] memory before_ = new uint256[](targets.length);
        for (uint256 i; i < targets.length; ++i) {
            if (targets[i] != treasury || payloads[i].length != 100) continue;
            if (bytes4(payloads[i][:4]) != bytes4(keccak256("distribute(address,address,uint256)"))) continue;
            (address token, address recipient,) = abi.decode(payloads[i][4:], (address, address, uint256));
            if (token != address(asset)) continue;
            bool duplicate;
            for (uint256 j; j < i; ++j) if (recipients[j] == recipient) duplicate = true;
            if (!duplicate) {
                recipients[i] = recipient;
                before_[i] = asset.balanceOf(recipient);
            }
        }
        super.executeBatch(targets, values, payloads, predecessor, salt);
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0)) continue;
            uint256 after_ = asset.balanceOf(recipients[i]);
            if (after_ > before_[i] + 1000 ether) captures[recipients[i]] += 1;
        }
    }
}
