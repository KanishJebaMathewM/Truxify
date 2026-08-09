import didService from '../../../did/did.service.js';
import logger from '../middleware/logger.js';
import { validationResult } from 'express-validator';
import { AppError } from '../errors/AppError.js';

export const loadCredential = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { subject, credentialType, schema, validUntil } = req.body;
        
        // subject is the Escort Driver's address or DID
        // credentialType: e.g., 'EscortCertification', 'Insurance', 'StatePermit'

        const result = await didService.issueCredential(
            subject,
            credentialType,
            schema,
            validUntil
        );

        if (result.success) {
            return res.status(201).json({
                message: 'Credential successfully issued and loaded into IdentityWallet',
                credentialId: result.credentialId
            });
        }

        throw new AppError('Failed to issue credential', 500);
    } catch (error) {
        logger.error('Error in loadCredential:', error);
        next(error);
    }
};

export const handshake = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { escorts } = req.body;
        
        if (!Array.isArray(escorts) || escorts.length === 0) {
            return res.status(400).json({ error: 'escorts must be a non-empty array of addresses' });
        }

        const complianceStatus = [];
        let allCompliant = true;

        for (const address of escorts) {
            const credentials = await didService.getCredentials(address);
            
            if (!credentials || credentials.length === 0) {
                complianceStatus.push({
                    address,
                    compliant: false,
                    reason: 'No credentials found'
                });
                allCompliant = false;
                continue;
            }

            let escortCompliant = true;
            const validCredentials = [];

            for (const cred of credentials) {
                if (cred.revoked) continue;
                
                // Verify against registry
                const verification = await didService.verifyCredential(cred.id);
                if (verification.isValid) {
                    validCredentials.push(cred);
                }
            }

            if (validCredentials.length === 0) {
                escortCompliant = false;
                allCompliant = false;
            }

            complianceStatus.push({
                address,
                compliant: escortCompliant,
                credentials: validCredentials.map(c => ({
                    id: c.id,
                    type: c.type,
                    validUntil: c.validUntil
                }))
            });
        }

        return res.status(200).json({
            handshake: allCompliant ? 'SUCCESS' : 'FAILED',
            allCompliant,
            convoy: complianceStatus
        });
    } catch (error) {
        logger.error('Error in handshake:', error);
        next(error);
    }
};
