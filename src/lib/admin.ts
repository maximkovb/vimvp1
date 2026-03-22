import { Session } from "next-auth";

export function isAdmin(session: Session | null): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return false;
  return session?.user?.email === adminEmail;
}

export function requireAdmin(session: Session | null): { error: string } | null {
  if (!isAdmin(session)) return { error: "Unauthorized" };
  return null;
}
