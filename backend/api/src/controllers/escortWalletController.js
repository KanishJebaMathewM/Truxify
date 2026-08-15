import didService from '../../../did/did.service.js';
import logger from '../middleware/logger.js';
import { AppError } from '../utils/errors.js';
import { supabase, createUserClient } from '../config/db.js';

/**
 * Resolve the resource for the 'escort:issue-credential' ownership check:
 * the normalized subject from the body and the authenticated caller's own
 * polygon wallet address. Administrators bypass the ownership check (see the
 * policy definition), so drivers can only ever issue credentials for their own
 * wallet address/DID.
 */
export const resolveCredentialSubject = async (req) => {
    const userClient = createUserClient(req.token);
    const { data: profile, error } = await userClient
        .from('profiles')
        .select('polygon_wallet_address')
        .eq('id', req.user.id)
        .maybeSingle();

    if (error) {
        throw new AppError('Failed to load profile', 500);
    }

    const callerWallet = (profile?.polygon_wallet_address || '').trim().toLowerCase();
    const subject = typeof req.body.subject === 'string' ? req.body.subject.trim().toLowerCase() : '';
    return { subject, callerWallet };
};

/**
 * Credentials may not be backdated. Returns true when validUntil is omitted
 * (the service applies its default one-year TTL) or is a future point in time.
 */
function isValidFutureValidUntil(validUntil) {
    if (validUntil === undefined || validUntil === null) return true;
    let ms;
    if (typeof validUntil === 'number') {
        // Unix timestamp in seconds, matching didService.issueCredential.
        ms = validUntil * 1000;
    } else if (typeof validUntil === 'string') {
        ms = Date.parse(validUntil);
    } else {
        return false;
    }
    return Number.isFinite(ms) && ms > Date.now();
}

export const loadCredential = async (req, res, next) => {
    try {
        const { subject, credentialType, schema, validUntil } = req.body;

        // subject is the Escort Driver's address or DID
        // credentialType: e.g., 'EscortCertification', 'Insurance', 'StatePermit'

        if (!isValidFutureValidUntil(validUntil)) {
            return res.status(400).json({ error: 'validUntil must be a future date (unix timestamp in seconds or ISO string)' });
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
        logger.error({ err: error }, 'Error in loadCredential');
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
        logger.error({ err: error }, 'Error in handshake');
        next(error);
    }
};
