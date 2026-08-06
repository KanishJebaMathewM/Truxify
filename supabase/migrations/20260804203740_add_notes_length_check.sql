-- Add special_instructions column to orders table and enforce max length
ALTER TABLE orders ADD COLUMN IF NOT EXISTS special_instructions TEXT;
ALTER TABLE orders ADD CONSTRAINT chk_special_instructions_length 
  CHECK (char_length(special_instructions) <= 500);