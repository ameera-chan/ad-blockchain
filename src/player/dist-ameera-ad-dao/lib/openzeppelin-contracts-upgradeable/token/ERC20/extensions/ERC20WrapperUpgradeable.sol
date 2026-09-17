

pragma solidity ^0.8.0;

import "../ERC20Upgradeable.sol";
import "../utils/SafeERC20Upgradeable.sol";
import {Initializable} from "../../../proxy/utils/Initializable.sol";

abstract contract ERC20WrapperUpgradeable is Initializable, ERC20Upgradeable {
    IERC20Upgradeable private _underlying;

    function __ERC20Wrapper_init(IERC20Upgradeable underlyingToken) internal onlyInitializing {
        __ERC20Wrapper_init_unchained(underlyingToken);
    }

    function __ERC20Wrapper_init_unchained(IERC20Upgradeable underlyingToken) internal onlyInitializing {
        require(underlyingToken != this, "ERC20Wrapper: cannot self wrap");
        _underlying = underlyingToken;
    }

    function decimals() public view virtual override returns (uint8) {
        try IERC20MetadataUpgradeable(address(_underlying)).decimals() returns (uint8 value) {
            return value;
        } catch {
            return super.decimals();
        }
    }

    function underlying() public view returns (IERC20Upgradeable) {
        return _underlying;
    }

    function depositFor(address account, uint256 amount) public virtual returns (bool) {
        address sender = _msgSender();
        require(sender != address(this), "ERC20Wrapper: wrapper can't deposit");
        SafeERC20Upgradeable.safeTransferFrom(_underlying, sender, address(this), amount);
        _mint(account, amount);
        return true;
    }

    function withdrawTo(address account, uint256 amount) public virtual returns (bool) {
        _burn(_msgSender(), amount);
        SafeERC20Upgradeable.safeTransfer(_underlying, account, amount);
        return true;
    }

    function _recover(address account) internal virtual returns (uint256) {
        uint256 value = _underlying.balanceOf(address(this)) - totalSupply();
        _mint(account, value);
        return value;
    }

    uint256[50] private __gap;
}
