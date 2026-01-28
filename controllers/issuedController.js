// backend/controllers/issuedController.js
import { supabase } from '../config/supabaseClient.js';

export async function getIssuedItems(req, res) {
  try {
    const branch_id = req.user?.branch_id;
    if (!branch_id) return res.status(400).json({ message: 'branch_id required' });

    const { data, error } = await supabase.rpc('get_issued_items', { p_branch_id: branch_id });
    if (error) {
      console.error('GET_ISSUED_ITEMS RPC ERROR:', error);
      return res.status(500).json({ message: 'Failed to fetch issued items' });
    }

    return res.json({ issued: data || [] });
  } catch (err) {
    console.error('GET_ISSUED_ITEMS ERROR:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}