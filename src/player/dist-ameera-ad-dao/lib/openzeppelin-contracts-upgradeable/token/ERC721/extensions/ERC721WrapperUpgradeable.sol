

pragma solidity ^0.8.0;

import "../ERC721Upgradeable.sol";
import {Initializable} from "../../../proxy/utils/Initializable.sol";

abstract contract ERC721WrapperUpgradeable is Initializable, ERC721Upgradeable, IERC721ReceiverUpgradeable {
    IERC721Upgradeable private _underlying;

    function __ERC721Wrapper_init(IERC721Upgradeable underlyingToken) internal onlyInitializing {
        __ERC721Wrapper_init_unchained(underlyingToken);
    }

    function __ERC721Wrapper_init_unchained(IERC721Upgradeable underlyingToken) internal onlyInitializing {
        _underlying = underlyingToken;
    }

    function depositFor(address account, uint256[] memory tokenIds) public virtual returns (bool) {
        uint256 length = tokenIds.length;
        for (uint256 i = 0; i < length; ++i) {
            uint256 tokenId = tokenIds[i];

            underlying().transferFrom(_msgSender(), address(this), tokenId);
            _safeMint(account, tokenId);
        }

        return true;
    }

    function withdrawTo(address account, uint256[] memory tokenIds) public virtual returns (bool) {
        uint256 length = tokenIds.length;
        for (uint256 i = 0; i < length; ++i) {
            uint256 tokenId = tokenIds[i];
            require(_isApprovedOrOwner(_msgSender(), tokenId), "ERC721Wrapper: caller is not token owner or approved");
            _burn(tokenId);

            underlying().safeTransferFrom(address(this), account, tokenId);
        }

        return true;
    }

    function onERC721Received(
        address,
        address from,
        uint256 tokenId,
        bytes memory
    ) public virtual override returns (bytes4) {
        require(address(underlying()) == _msgSender(), "ERC721Wrapper: caller is not underlying");
        _safeMint(from, tokenId);
        return IERC721ReceiverUpgradeable.onERC721Received.selector;
    }

    function _recover(address account, uint256 tokenId) internal virtual returns (uint256) {
        require(underlying().ownerOf(tokenId) == address(this), "ERC721Wrapper: wrapper is not token owner");
        _safeMint(account, tokenId);
        return tokenId;
    }

    function underlying() public view virtual returns (IERC721Upgradeable) {
        return _underlying;
    }

    uint256[49] private __gap;
}
