// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title AttributeSignature
 * @dev Verifies attribute-based signatures (ABS) for permissioned features.
 *      The previous implementation accepted ANY non-zero 64-byte blob as a
 *      valid signature, so anyone could forge attribute proofs. The verifier
 *      now requires the signature to be a real ECDSA signature over the exact
 *      manifest hash and policy predicate (issue #10796). A genuine
 *      bilinear-pairing ABS scheme should replace this path when implemented.
 */
contract AttributeSignature is Ownable {
    using ECDSA for bytes32;

    event PermitVerified(bytes32 indexed manifestHash, string policyPredicate, bool isValid);
    event IssuerUpdated(address indexed issuer, bool trusted);

    /// @dev Attribute authorities allowed to sign attribute-based permits.
    mapping(address => bool) public trustedIssuers;

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Owner registers or removes an attribute authority that may issue
     *      attribute-based signatures.
     */
    function setTrustedIssuer(address issuer, bool trusted) external onlyOwner {
        trustedIssuers[issuer] = trusted;
        emit IssuerUpdated(issuer, trusted);
    }

    /**
     * @dev Verifies that the attribute-based signature is a real ECDSA
     *      signature by a trusted attribute authority over the manifest hash
     *      and policy predicate. The signature binds the credential to these
     *      exact inputs, so a signature valid for one manifest/policy cannot
     *      be replayed for another (a replayed signature recovers a different,
     *      untrusted address).
     */
    function verifyAttributeSignature(
        bytes32 _manifestHash,
        string calldata _policyPredicate,
        bytes calldata _signature
    ) external returns (bool) {
        require(_signature.length == 65, "Invalid signature dimensions for ABS pairing");

        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encode(_manifestHash, _policyPredicate))
            )
        );

        (address recovered, ECDSA.RecoverError err, ) = messageHash.tryRecover(_signature);
        bool isValid = (err == ECDSA.RecoverError.NoError && trustedIssuers[recovered]);
        emit PermitVerified(_manifestHash, _policyPredicate, isValid);
        return isValid;
    }
}
