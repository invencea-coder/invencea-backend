-- 20260122_add_borrow_returns.sql
CREATE TABLE IF NOT EXISTS borrow_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrow_request_id uuid NOT NULL,
  inventory_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  returned_by uuid NOT NULL,
  branch_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- optional foreign keys
-- ALTER TABLE borrow_returns
--   ADD CONSTRAINT fk_borrow_request
--     FOREIGN KEY (borrow_request_id) REFERENCES borrow_requests(id) ON DELETE CASCADE;
-- ALTER TABLE borrow_returns
--   ADD CONSTRAINT fk_inventory
--     FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_borrow_returns_borrow_request ON borrow_returns(borrow_request_id);
CREATE INDEX IF NOT EXISTS idx_borrow_returns_inventory ON borrow_returns(inventory_id);
CREATE INDEX IF NOT EXISTS idx_borrow_returns_returned_by ON borrow_returns(returned_by);
CREATE INDEX IF NOT EXISTS idx_borrow_returns_branch ON borrow_returns(branch_id);
CREATE INDEX IF NOT EXISTS idx_borrow_returns_created_at ON borrow_returns(created_at DESC);
