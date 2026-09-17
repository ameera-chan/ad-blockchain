

pragma solidity ^0.8.4;

import "./AccessControlUpgradeable.sol";
import "../crosschain/CrossChainEnabledUpgradeable.sol";
import {Initializable} from "../proxy/utils/Initializable.sol";

abstract contract AccessControlCrossChainUpgradeable is Initializable, AccessControlUpgradeable, CrossChainEnabledUpgradeable {
    bytes32 public constant CROSSCHAIN_ALIAS = keccak256("CROSSCHAIN_ALIAS");

    function __AccessControlCrossChain_init() internal onlyInitializing {
    }

    function __AccessControlCrossChain_init_unchained() internal onlyInitializing {
    }

    function _checkRole(bytes32 role) internal view virtual override {
        if (_isCrossChain()) {
            _checkRole(_crossChainRoleAlias(role), _crossChainSender());
        } else {
            super._checkRole(role);
        }
    }

    function _crossChainRoleAlias(bytes32 role) internal pure virtual returns (bytes32) {
        return role ^ CROSSCHAIN_ALIAS;
    }

    uint256[50] private __gap;
}
