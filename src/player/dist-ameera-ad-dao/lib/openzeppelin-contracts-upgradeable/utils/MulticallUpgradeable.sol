

pragma solidity ^0.8.0;

import "./AddressUpgradeable.sol";
import "./ContextUpgradeable.sol";
import {Initializable} from "../proxy/utils/Initializable.sol";

abstract contract MulticallUpgradeable is Initializable, ContextUpgradeable {
    function __Multicall_init() internal onlyInitializing {
    }

    function __Multicall_init_unchained() internal onlyInitializing {
    }

    function multicall(bytes[] calldata data) external virtual returns (bytes[] memory results) {
        bytes memory context = msg.sender == _msgSender()
            ? new bytes(0)
            : msg.data[msg.data.length - _contextSuffixLength():];

        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            results[i] = AddressUpgradeable.functionDelegateCall(address(this), bytes.concat(data[i], context));
        }
        return results;
    }

    uint256[50] private __gap;
}
