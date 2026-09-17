

pragma solidity ^0.8.0;

import "../GovernorUpgradeable.sol";
import "../../interfaces/IERC5805Upgradeable.sol";
import {Initializable} from "../../proxy/utils/Initializable.sol";

abstract contract GovernorVotesUpgradeable is Initializable, GovernorUpgradeable {
    IERC5805Upgradeable public token;

    function __GovernorVotes_init(IVotesUpgradeable tokenAddress) internal onlyInitializing {
        __GovernorVotes_init_unchained(tokenAddress);
    }

    function __GovernorVotes_init_unchained(IVotesUpgradeable tokenAddress) internal onlyInitializing {
        token = IERC5805Upgradeable(address(tokenAddress));
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
        return token.getPastVotes(account, timepoint);
    }

    uint256[50] private __gap;
}
