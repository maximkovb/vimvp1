"use server";

import { db } from "@/db";
import { users, coinTransactions } from "@/db/schema";
import bcrypt from "bcryptjs";
import { signIn } from "@/lib/auth";

const STARTING_BALANCE = "1000";

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
  // bcryptjs silently truncates at 72 bytes — longer inputs add no security but enable DoS
  if (password.length > 72) return { error: "Password must be 72 characters or fewer" };

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = crypto.randomUUID();

  try {
    await db.transaction(async (tx) => {
      // Create user with starting balance
      await tx.insert(users).values({
        id: userId,
        name,
        email,
        passwordHash,
        balance: STARTING_BALANCE,
      });

      // Log signup bonus
      await tx.insert(coinTransactions).values({
        userId,
        amount: STARTING_BALANCE,
        type: "signup_bonus",
        referenceId: userId,
      });
    });
  } catch (err: unknown) {
    // Postgres unique constraint violation
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

  // Auto sign in after registration
  try {
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch {
    // Sign-in after registration may throw a redirect — that's OK
  }

  return { success: true };
}
