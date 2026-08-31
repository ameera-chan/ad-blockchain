// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Token} from "../src/supporting/Token.sol";
import {VoteMirror} from "../src/patchable/VoteMirror.sol";
import {GovStakingVault} from "../src/supporting/GovStakingVault.sol";

// Minimal functionality test: verify the LEGITIMATE staking flow still works
// after your patch. The service's checker does the same thing every round — if
// this passes but the checker still flags you down, your patch broke a different
// legitimate path.
contract DaoDefenseTest is Test {
    Token internal gov;
    VoteMirror internal mirror;
    GovStakingVault internal vault;

    function setUp() public {
        gov = new Token("DAO Governance", "GOV");
        mirror = new VoteMirror();
        mirror.initialize();
        vault = new GovStakingVault(address(gov), address(mirror));
        mirror.setVault(address(vault));
        gov.mint(address(this), 100 ether);
    }

    // Observer hook the vault calls on stake/withdraw. Accept both signs so the
    // legitimate flow works (a "down" delegatee reverts on negative deltas —
    // that is the ghost vulnerability the challenge is built around).
    function onVoteSync(int256) external pure {}

    function testStakeAndWithdraw() public {
        gov.approve(address(vault), 100 ether);
        vault.stake(100 ether, address(this));
        assertEq(mirror.votes(address(this)), 100 ether);
        vault.withdraw(25 ether);
        assertEq(vault.staked(address(this)), 75 ether);
        assertEq(mirror.votes(address(this)), 75 ether);
    }
}
