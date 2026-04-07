"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import bcrypt from "bcryptjs";
import { signIn } from "@/lib/auth";
import { creditBalance } from "@/lib/services/ledger";

const STARTING_BALANCE = 1000;

export async function signUp(formData: FormData) {
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password || !name) {
    return { error: "All fields are required" };
  }

  if (name.length > 100) return { error: "Name is too long" };
  if (email.length > 254 || !email.includes("@")) return { error: "Invalid email address" };
  if (password.length < 8) return { error: "Password must be at least 8 characters" };
  if (password.length > 72) return { error: "Password must be 72 characters or fewer" };

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = crypto.randomUUID();

  try {
    await db.transaction(async (tx) => {
      // Insert user with balance=0 (default); creditBalance will set it to STARTING_BALANCE
      await tx.insert(users).values({ id: userId, name, email, passwordHash });

      // Credit starting balance via ledger — acquires FOR UPDATE, writes snapshot, prevents duplicates
      await creditBalance(tx, userId, STARTING_BALANCE, "signup_bonus", { referenceId: userId });
    });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      return { error: "An account with this email already exists" };
    }
    throw err;
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch {
    // Sign-in after registration may throw a redirect — that's OK
  }

  return { success: true };
}
