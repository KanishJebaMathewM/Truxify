/**
 * @fileoverview Message encryption utilities for chat at rest.
 * Uses AES-256-GCM to encrypt message payloads before Supabase insertion.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

// Derive a 32-byte key from the environment variable using PBKDF2
function deriveKey(secret) {
    const salt = crypto.scryptSync(secret, 'truxify-chat-salt', KEY_LENGTH);
    return salt;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * @param {string} text - The plaintext message.
 * @param {string} secret - The encryption secret from env.
 * @returns {string} Hex-encoded string containing IV + Tag + Ciphertext.
 */
export function encryptMessage(text, secret) {
    if (!text || !secret) return text;

    const key = deriveKey(secret);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    // Format: IV (16) + Tag (16) + Ciphertext
    return iv.toString('hex') + tag.toString('hex') + encrypted;
}

/**
 * Decrypts a hex-encoded AES-256-GCM ciphertext.
 * @param {string} encryptedText - The hex string from encryptMessage.
 * @param {string} secret - The encryption secret from env.
 * @returns {string} The decrypted plaintext.
 */
export function decryptMessage(encryptedText, secret) {
    if (!encryptedText || !secret) return encryptedText;

    const key = deriveKey(secret);

    const ivHex = encryptedText.slice(0, IV_LENGTH * 2);
    const tagHex = encryptedText.slice(IV_LENGTH * 2, IV_LENGTH * 2 + TAG_LENGTH * 2);
    const ciphertext = encryptedText.slice(IV_LENGTH * 2 + TAG_LENGTH * 2);

    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

/**
 * Hashes a message for quick integrity checks without decryption.
 * @param {string} text 
 * @returns {string} SHA-256 hash
 */
export function hashMessage(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}
