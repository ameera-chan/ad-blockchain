

pragma solidity ^0.8.0;

import "./IERC165Upgradeable.sol";
import "./IERC721Upgradeable.sol";

interface IERC4906Upgradeable is IERC165Upgradeable, IERC721Upgradeable {

    event MetadataUpdate(uint256 _tokenId);

    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
}
