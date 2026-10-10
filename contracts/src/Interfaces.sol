// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
}

interface IERC721 {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// ERC-6551 registry (0x000000006551c19487814612e58FE06813775758 on Monad)
interface IERC6551Registry {
    function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external returns (address);
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external view returns (address);
}

/// Tokenbound AccountProxy: must be initialized with the AccountV3 implementation after creation
interface ITokenboundProxy {
    function initialize(address implementation) external;
}
