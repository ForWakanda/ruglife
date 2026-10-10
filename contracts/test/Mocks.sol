// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Minimal ERC-20 with EIP-2612 permit, domain name "Chog" version "1" like the real token.
contract MockChog {
    string public name = "Chog"; string public symbol = "CHOG"; uint8 public decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public nonces;
    bytes32 public constant PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("Chog"), keccak256("1"), block.chainid, address(this)));
    }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; totalSupply += amount; }
    function transfer(address to, uint256 amount) external returns (bool) { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        require(a >= amount, "ERC20: insufficient allowance");
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount; balanceOf[to] += amount; return true;
    }
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        require(block.timestamp <= deadline, "ERC20Permit: expired deadline");
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonces[owner]++, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == owner, "ERC20Permit: invalid signature");
        allowance[owner][spender] = value;
    }
}

contract MockNFT {
    mapping(uint256 => address) public owners;
    function setOwner(uint256 id, address o) external { owners[id] = o; }
    function ownerOf(uint256 id) external view returns (address) { require(owners[id] != address(0), "none"); return owners[id]; }
}

/// A chest: created by the registry, initialized once, then only the NFT's owner may execute.
contract MockChest {
    address public impl; address public nft; uint256 public tokenId; bool public inited;
    constructor(address nft_, uint256 tokenId_) { nft = nft_; tokenId = tokenId_; }
    function initialize(address impl_) external { require(!inited, "inited"); inited = true; impl = impl_; }
    function owner() public view returns (address) { require(inited, "not initialized"); return MockNFT(nft).ownerOf(tokenId); }
    function execute(address to, uint256 value, bytes calldata data, uint8) external returns (bytes memory) {
        require(msg.sender == owner(), "NotAuthorized");
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        require(ok, "call");
        return ret;
    }
}

/// Deterministic like ERC-6551: account() predicts the CREATE2 address createAccount() deploys to.
contract MockRegistry {
    function _salt(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) internal pure returns (bytes32) {
        return keccak256(abi.encode(implementation, salt, chainId, tokenContract, tokenId));
    }
    function _initCode(address tokenContract, uint256 tokenId) internal pure returns (bytes memory) {
        return abi.encodePacked(type(MockChest).creationCode, abi.encode(tokenContract, tokenId));
    }
    function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(implementation, salt, chainId, tokenContract, tokenId), keccak256(_initCode(tokenContract, tokenId))));
        return address(uint160(uint256(h)));
    }
    function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external returns (address a) {
        bytes memory code = _initCode(tokenContract, tokenId);
        bytes32 s = _salt(implementation, salt, chainId, tokenContract, tokenId);
        assembly { a := create2(0, add(code, 0x20), mload(code), s) }
        require(a != address(0), "create2");
    }
}
