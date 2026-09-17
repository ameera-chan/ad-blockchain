

pragma solidity >=0.6.9 <0.9.0;

interface IDelayedMessageProviderUpgradeable {

    event InboxMessageDelivered(uint256 indexed messageNum, bytes data);

    event InboxMessageDeliveredFromOrigin(uint256 indexed messageNum);
}
