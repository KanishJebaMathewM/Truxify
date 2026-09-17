import { describe, expect, it } from 'vitest';

import {
    getBiometricThreshold,
    requiresBiometricAuth,
    updateBiometricThreshold,
} from '../../src/services/biometricAuthService.js';

const DEFAULT_THRESHOLD_PAISA = 5_000_000;

describe('biometric threshold policy', () => {
    it('uses the server-configured threshold by default', () => {
        const userId = 'threshold-default-user';

        expect(getBiometricThreshold(userId)).toEqual({
            threshold_paisa: DEFAULT_THRESHOLD_PAISA,
            default_threshold_paisa: DEFAULT_THRESHOLD_PAISA,
        });
        expect(requiresBiometricAuth(userId, DEFAULT_THRESHOLD_PAISA - 1)).toBe(false);
        expect(requiresBiometricAuth(userId, DEFAULT_THRESHOLD_PAISA)).toBe(true);
    });

    it('allows a user to make biometric verification more restrictive', () => {
        const userId = 'threshold-lower-user';

        const updated = updateBiometricThreshold(userId, 1_000_000);

        expect(updated).toEqual({
            threshold_paisa: 1_000_000,
            default_threshold_paisa: DEFAULT_THRESHOLD_PAISA,
        });
        expect(requiresBiometricAuth(userId, 1_000_000)).toBe(true);
        expect(requiresBiometricAuth(userId, 999_999)).toBe(false);
    });

    it('rejects a user threshold above the server-configured security boundary', () => {
        const userId = 'threshold-high-user';

        expect(() => updateBiometricThreshold(userId, DEFAULT_THRESHOLD_PAISA + 1)).toThrow(
            `threshold_paisa must be an integer between 1 and ${DEFAULT_THRESHOLD_PAISA}`
        );
        expect(getBiometricThreshold(userId).threshold_paisa).toBe(DEFAULT_THRESHOLD_PAISA);
        expect(requiresBiometricAuth(userId, DEFAULT_THRESHOLD_PAISA)).toBe(true);
    });

    it('rejects the old maximum of ₹10 lakh as a user-configurable threshold', () => {
        const userId = 'threshold-legacy-max-user';

        expect(() => updateBiometricThreshold(userId, 100_000_000)).toThrow(
            `threshold_paisa must be an integer between 1 and ${DEFAULT_THRESHOLD_PAISA}`
        );
    });

    it('rejects non-positive and non-integer thresholds', () => {
        const userId = 'threshold-invalid-user';

        expect(() => updateBiometricThreshold(userId, 0)).toThrow(
            `threshold_paisa must be an integer between 1 and ${DEFAULT_THRESHOLD_PAISA}`
        );
        expect(() => updateBiometricThreshold(userId, -1)).toThrow(
            `threshold_paisa must be an integer between 1 and ${DEFAULT_THRESHOLD_PAISA}`
        );
        expect(() => updateBiometricThreshold(userId, 100.5)).toThrow(
            `threshold_paisa must be an integer between 1 and ${DEFAULT_THRESHOLD_PAISA}`
        );
    });
});
