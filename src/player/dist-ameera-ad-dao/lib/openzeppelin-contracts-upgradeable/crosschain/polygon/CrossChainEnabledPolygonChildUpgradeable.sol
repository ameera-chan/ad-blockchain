

pragma solidity ^0.8.4;

import "../CrossChainEnabledUpgradeable.sol";
import "../../security/ReentrancyGuardUpgradeable.sol";
import "../../utils/AddressUpgradeable.sol";
import "../../vendor/polygon/IFxMessageProcessorUpgradeable.sol";
import {Initializable} from "../../proxy/utils/Initializable.sol";

address constant DEFAULT_SENDER = 0x000000000000000000000000000000000000dEaD;

abstract contract CrossChainEnabledPolygonChildUpgradeable is Initializable, IFxMessageProcessorUpgradeable, CrossChainEnabledUpgradeable, ReentrancyGuardUpgradeable {

    address private immutable _fxChild;
    address private _sender = DEFAULT_SENDER;

    constructor(address fxChild) {
        _fxChild = fxChild;
    }

    function _isCrossChain() internal view virtual override returns (bool) {
        return msg.sender == _fxChild;
    }

    function _crossChainSender() internal view virtual override onlyCrossChain returns (address) {
        return _sender;
    }

    function processMessageFromRoot(
        uint256  ,
        address rootMessageSender,
        bytes calldata data
    ) external override nonReentrant {
        if (!_isCrossChain()) revert NotCrossChainCall();

        _sender = rootMessageSender;
        AddressUpgradeable.functionDelegateCall(address(this), data, "cross-chain execution failed");
        _sender = DEFAULT_SENDER;
    }

    uint256[49] private __gap;
}
