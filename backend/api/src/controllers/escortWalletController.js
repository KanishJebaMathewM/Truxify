import didService from '../../../did/did.service.js';
import logger from '../middleware/logger.js';
import { supabase } from '../config/db.js';
import { AppError } from '../utils/errors.js';

export const loadCredential = async (req, res, next) => {
    try {
        const { subject, credentialType, schema, validUntil } = req.body;

        // subject is the Escort Driver's address or DID
        // credentialType: e.g., 'EscortCertification', 'Insurance', 'StatePermit'

        // Only an admin (authority) may issue credentials for another subject.
        // Any other user may only load a credential for their own wallet, so a
        // plain customer cannot forge an escort's compliance record.
        if (req.user.role !== 'admin') {
            const { data: profile, error: profileErr } = await supabase
                .from('profiles')
                .select('polygon_wallet_address')
                .eq('id', req.user.id)
                .maybeSingle();

            if (profileErr) {
                throw new AppError('Failed to verify wallet identity', 500);
            }

            const callerWallet = profile?.polygon_wallet_address;
            if (!callerWallet || callerWallet.toLowerCase() !== String(subject).toLowerCase()) {
                throw new AppError('You can only issue credentials for your own wallet address', 403);
            }
        }

        if (validUntil !== undefined && Number(validUntil) < Math.floor(Date.now() / 1000)) {
            throw new AppError('validUntil must not be in the past', 400);
        }

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
