-- Add per-OTP salt column so delivery OTPs can be stored as salted scrypt
-- digests instead of an unsalted SHA-256 that is brute-forceable offline.
alter table delivery_otps
  add column if not exists otp_salt text;
