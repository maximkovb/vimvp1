"use server";

import { db } from "@/db";
import { users, coinTransactions } from "@/db/schema";
import { eq } from "drizzle-orm";
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

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  // Check if user already exists
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    return { error: "An account with this email already exists" };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = crypto.randomUUID();

  // Create user with starting balance
  await db.insert(users).values({
    id: userId,
    name,
    email,
    passwordHash,
    balance: STARTING_BALANCE,
  });

  // Log signup bonus
  await db.insert(coinTransactions).values({
    userId,
    amount: STARTING_BALANCE,
    type: "signup_bonus",
  });

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
