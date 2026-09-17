

pragma solidity ^0.8.0;

interface IERC6372Upgradeable {

    function clock() external view returns (uint48);

    function CLOCK_MODE() external view returns (string memory);
}
