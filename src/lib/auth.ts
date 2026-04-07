import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import { users, accounts, verificationTokens } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { creditBalance } from "@/lib/services/ledger";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const STARTING_BALANCE = 1000;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
  },
  providers: [
    Google({
      authorization: {
        params: { access_type: "offline", prompt: "consent" },
      },
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email as string;
        const password = credentials.password as string;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (!user || !user.passwordHash) return null;

        // Check lockout before attempting password compare
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);

        if (!isValid) {
          const newAttempts = user.failedLoginAttempts + 1;
          const lockedUntil =
            newAttempts >= MAX_FAILED_ATTEMPTS
              ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
              : null;
          await db
            .update(users)
            .set({
              failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
              lockedUntil,
            })
            .where(eq(users.id, user.id));
          return null;
        }

        // Reset lockout state on successful login
        if (user.failedLoginAttempts > 0 || user.lockedUntil) {
          await db
            .update(users)
            .set({ failedLoginAttempts: 0, lockedUntil: null })
            .where(eq(users.id, user.id));
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      // Credit starting balance inside a transaction with FOR UPDATE + ledger snapshot.
      // The partial unique index on (user_id) WHERE type='signup_bonus' prevents duplicates at DB level.
      try {
        await db.transaction(async (tx) => {
          await creditBalance(tx, user.id!, STARTING_BALANCE, "signup_bonus", {
            referenceId: user.id,
          });
        });
      } catch (err: unknown) {
        // Unique constraint violation = already awarded (idempotent — DB-enforced)
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "23505"
        ) {
          return;
        }
        // Log unexpected errors instead of silently swallowing them
        console.error("[auth] Failed to credit OAuth signup bonus for user", user.id, err);
      }
    },
  },
});
