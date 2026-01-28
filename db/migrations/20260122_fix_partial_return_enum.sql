-- backend/db/migrations/20260122_fix_partial_return_enum.sql
-- Fix old invalid borrow_status values ("PARTIALLY_RETURNED") in borrow_requests
-- so that the return system works with current enum definition

BEGIN;

-- Step 1: Cast enum to text to identify invalid rows
-- These are rows with the old 'PARTIALLY_RETURNED' value
UPDATE borrow_requests
SET status = 'ISSUED'  -- set to a valid enum value
WHERE status::text = 'PARTIALLY_RETURNED';

-- Step 2: Optional check to confirm
-- SELECT id, status FROM borrow_requests WHERE status::text = 'PARTIALLY_RETURNED';

COMMIT;

-- ✅ After this migration, all borrow_requests rows have valid enum values
-- and the return endpoints will stop throwing 22P02 errors.
