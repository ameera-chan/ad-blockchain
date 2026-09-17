

pragma solidity ^0.8.0;

import "../GovernorUpgradeable.sol";
import "../../token/ERC20/extensions/ERC20VotesCompUpgradeable.sol";
import {Initializable} from "../../proxy/utils/Initializable.sol";

abstract contract GovernorVotesCompUpgradeable is Initializable, GovernorUpgradeable {
    ERC20VotesCompUpgradeable public token;

    function __GovernorVotesComp_init(ERC20VotesCompUpgradeable token_) internal onlyInitializing {
        __GovernorVotesComp_init_unchained(token_);
    }

    function __GovernorVotesComp_init_unchained(ERC20VotesCompUpgradeable token_) internal onlyInitializing {
        token = token_;
    }

    function clock() public view virtual override returns (uint48) {
        try token.clock() returns (uint48 timepoint) {
            return timepoint;
        } catch {
            return SafeCastUpgradeable.toUint48(block.number);
        }
    }

    function CLOCK_MODE() public view virtual override returns (string memory) {
        try token.CLOCK_MODE() returns (string memory clockmode) {
            return clockmode;
        } catch {
            return "mode=blocknumber&from=default";
        }
    }

    function _getVotes(
        address account,
        uint256 timepoint,
        bytes memory
    ) internal view virtual override returns (uint256) {
        return token.getPriorVotes(account, timepoint);
    }

    uint256[50] private __gap;
}
