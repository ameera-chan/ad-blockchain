

pragma solidity ^0.8.0;

import "../ERC721Upgradeable.sol";
import "../../../governance/utils/VotesUpgradeable.sol";
import {Initializable} from "../../../proxy/utils/Initializable.sol";

abstract contract ERC721VotesUpgradeable is Initializable, ERC721Upgradeable, VotesUpgradeable {
    function __ERC721Votes_init() internal onlyInitializing {
    }

    function __ERC721Votes_init_unchained() internal onlyInitializing {
    }

    function _afterTokenTransfer(
        address from,
        address to,
        uint256 firstTokenId,
        uint256 batchSize
    ) internal virtual override {
        _transferVotingUnits(from, to, batchSize);
        super._afterTokenTransfer(from, to, firstTokenId, batchSize);
    }

    function _getVotingUnits(address account) internal view virtual override returns (uint256) {
        return balanceOf(account);
    }

    uint256[50] private __gap;
}
