import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

// ============================================================================
// 1. GET DRIVER STATS (DRIVER)
// ============================================================================
router.get('/stats', authenticate, requireRole(['driver']), async (req, res) => {
  try {
    const { data: details, error } = await supabase
      .from('driver_details')
      .select('rating, total_trips, completion_rate, is_online, wallet_confirmed, wallet_pending, wallet_total, truck_id')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch driver stats.', details: error.message });
    }

    if (!details) {
      return res.status(404).json({ error: 'Driver statistics profile not initialized.' });
    }

    // Fetch truck details if assigned
    let truck = null;
    if (details.truck_id) {
      const { data: truckData } = await supabase
        .from('trucks')
        .select('*')
        .eq('id', details.truck_id)
        .maybeSingle();
      truck = truckData;
    }

    res.json({
      stats: details,
      truck
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 2. TOGGLE ONLINE / OFFLINE STATUS (DRIVER)
// ============================================================================
router.put('/online', authenticate, requireRole(['driver']), async (req, res) => {
  const { is_online } = req.body;

  if (typeof is_online !== 'boolean') {
    return res.status(400).json({ error: 'Invalid or missing is_online status.' });
  }

  try {
    const { data: details, error } = await supabase
      .from('driver_details')
      .update({ is_online, updated_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .select('is_online')
      .single();

    if (error) {
      return res.status(500).json({ error: 'Failed to update online state.', details: error.message });
    }

    res.json({
      message: `Driver status marked as ${is_online ? 'online' : 'offline'}.`,
      is_online: details.is_online
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 3. FETCH WALLET TRANSACTION HISTORY (DRIVER)
// ============================================================================
router.get('/wallet/history', authenticate, requireRole(['driver']), async (req, res) => {
  try {
    const { data: transactions, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('driver_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch transaction history.', details: error.message });
    }

    res.json(transactions || []);

  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 4. FETCH Aggregated daily/weekly earnings summaries for chart (DRIVER)
// ============================================================================
router.get('/earnings/summary', authenticate, requireRole(['driver']), async (req, res) => {
  const limitDays = parseInt(req.query.days || '30', 10);

  try {
    // Queries earnings daily table
    const { data: summary, error } = await supabase
      .from('earnings_daily')
      .select('day_date, amount, trip_count')
      .eq('driver_id', req.user.id)
      .order('day_date', { ascending: true });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch earnings summary.', details: error.message });
    }

    // Filter last N days programmatically if needed (or through standard query filters)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - limitDays);
    const filtered = (summary || []).filter(item => {
      return new Date(item.day_date) >= cutoff;
    });

    res.json(filtered);

  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 5. WITHDRAW FUNDS FROM WALLET (DRIVER)
// ============================================================================
router.post('/wallet/withdraw', authenticate, requireRole(['driver']), async (req, res) => {
  const { amount } = req.body; // in paisa

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid withdrawal amount specified.' });
  }

  try {
    // 5.1 Fetch driver confirmed balance
    const { data: details, error: detailsErr } = await supabase
      .from('driver_details')
      .select('wallet_confirmed')
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (detailsErr || !details) {
      return res.status(404).json({ error: 'Driver profile details not found.' });
    }

    if (details.wallet_confirmed < amount) {
      return res.status(400).json({ 
        error: 'Insufficient confirmed balance.', 
        available: details.wallet_confirmed,
        requested: amount
      });
    }

    // 5.2 Perform updates:
    // Update balances
    const { error: balanceErr } = await supabase
      .from('driver_details')
      .update({
        wallet_confirmed: details.wallet_confirmed - amount,
        wallet_pending: (details.wallet_pending || 0) + amount, // Mark as pending payout
        updated_at: new Date().toISOString()
      })
      .eq('user_id', req.user.id);

    if (balanceErr) {
      return res.status(500).json({ error: 'Failed to modify wallet balances.', details: balanceErr.message });
    }

    // Insert pending withdrawal transaction
    const { data: txn, error: txnErr } = await supabase
      .from('wallet_transactions')
      .insert({
        driver_id: req.user.id,
        amount,
        txn_type: 'withdrawal',
        status: 'pending',
        description: 'Withdrawal to registered bank account'
      })
      .select('*')
      .single();

    if (txnErr) {
      console.error('Withdrawal transaction log failure:', txnErr.message);
      return res.status(500).json({ error: 'Failed to record withdrawal transaction.', details: txnErr.message });
    }

    res.status(200).json({
      message: 'Withdrawal request initiated successfully. Funds are pending processing.',
      transaction: txn
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
