// createUsers.js
import bcrypt from "bcrypt";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// --- ENV CHECK ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("❌ Missing Supabase environment variables");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- BRANCH IDS ---
const BRANCH_IDS = {
  CPEIS: "d5128187-70ae-44ab-8aa8-ca60797431a5",
  ACEIS: "e677a91c-28c1-4c94-9a20-3c22e70a39f5",
  ECEIS: "e6c9bb96-a873-4b45-8695-8c364258235e"
};

// --- USERS ---
const users = [
  // CPEIS
  { name: "CPEIS Admin", email: "cpeis_admin@gmail.com", password: "CpeisA1!", role: "admin", branch: "CPEIS" },
  { name: "CPEIS Kiosk", email: "kiosk_cpeis@gmail.com", password: "CpeisK1!", role: "kiosk", branch: "CPEIS" },

  // ECEIS
  { name: "ECEIS Admin 1", email: "eceis_admin1@gmail.com", password: "EceisA1!", role: "admin", branch: "ECEIS" },
  { name: "ECEIS Admin 2", email: "eceis_admin2@gmail.com", password: "EceisA2!", role: "admin", branch: "ECEIS" },
  { name: "ECEIS Kiosk", email: "kiosk_eceis@gmail.com", password: "EceisK1!", role: "kiosk", branch: "ECEIS" },

  // ACEIS
  { name: "ACEIS Admin 1", email: "aceis_admin1@gmail.com", password: "AceisA1!", role: "admin", branch: "ACEIS" },
  { name: "ACEIS Admin 2", email: "aceis_admin2@gmail.com", password: "AceisA2!", role: "admin", branch: "ACEIS" },
  { name: "ACEIS Kiosk", email: "kiosk_aceis@gmail.com", password: "AceisK1!", role: "kiosk", branch: "ACEIS" }
];

async function createUsers() {
  console.log("🔹 Starting user creation...");

  for (const user of users) {
    // 1️⃣ Check if user already exists
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", user.email)
      .single();

    if (existingUser) {
      console.log(`⚠️ Skipped existing user: ${user.email}`);
      continue;
    }

    // 2️⃣ Hash password
    const password_hash = await bcrypt.hash(user.password, 10);

    // 3️⃣ Insert user
    const { error } = await supabase.from("users").insert({
      name: user.name,
      full_name: user.name,
      email: user.email,
      password_hash,
      role: user.role,
      branch: user.branch,
      branch_id: BRANCH_IDS[user.branch],
      mfa_enable: false
    });

    if (error) {
      console.error(`❌ Error creating ${user.email}:`, error.message);
    } else {
      console.log(`✅ Created user: ${user.email}`);
    }
  }

  console.log("🎉 User sync complete.");
}

createUsers();
