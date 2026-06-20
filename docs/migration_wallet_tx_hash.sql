ALTER TABLE wallet_transactions
ADD COLUMN IF NOT EXISTS tx_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS
idx_wallet_transactions_tx_hash
ON wallet_transactions(tx_hash)
WHERE tx_hash IS NOT NULL;

-- Trigger to automatically propagate escrow release transaction hash from orders to wallet_transactions
CREATE OR REPLACE FUNCTION sync_wallet_tx_hash()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.release_tx_hash IS NOT NULL AND (OLD.release_tx_hash IS NULL OR OLD.release_tx_hash <> NEW.release_tx_hash) THEN
    UPDATE wallet_transactions
    SET tx_hash = NEW.release_tx_hash,
        description = 'Escrow payout for ' || NEW.order_display_id
    WHERE order_display_id = NEW.order_display_id
      AND txn_type = 'credit';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_wallet_tx_hash ON orders;
CREATE TRIGGER trigger_sync_wallet_tx_hash
AFTER UPDATE OF release_tx_hash ON orders
FOR EACH ROW
EXECUTE FUNCTION sync_wallet_tx_hash();
