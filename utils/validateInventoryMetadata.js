export const BRANCH_METADATA_RULES = {
  ACEIS: ["item_type"],
  ECEIS: ["serial_number", "item_type", "analog_digital", "condition"],
  CPEIS: ["thesis_title", "authors", "year"],
};

export function validateInventoryMetadata(branchCode, metadata) {
  const requiredFields = BRANCH_METADATA_RULES[branchCode];

  if (!requiredFields) {
    throw new Error(`Unsupported branch: ${branchCode}`);
  }

  if (!metadata || typeof metadata !== "object") {
    throw new Error("Metadata is required and must be an object");
  }

  for (const field of requiredFields) {
    if (
      metadata[field] === undefined ||
      metadata[field] === null ||
      metadata[field] === ""
    ) {
      throw new Error(`Missing required metadata field: ${field}`);
    }
  }

  return true;
}
