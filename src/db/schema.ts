import {
  pgTable,
  text,
  timestamp,
  integer,
  decimal,
  bigint,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Users ──────────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  passwordHash: text("password_hash"),
  image: text("image"),
  balance: decimal("balance", { precision: 12, scale: 2 }).notNull().default("0"),
  loginStreak: integer("login_streak").notNull().default(0),
  lastLoginReward: timestamp("last_login_reward", { mode: "date" }),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  positions: many(positions),
  trades: many(trades),
  coinTransactions: many(coinTransactions),
}));

// ─── Accounts (Auth.js) ────────────────────────────────────────────────────────

export const accounts = pgTable("accounts", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

// ─── Verification Tokens (Auth.js email verification + password reset) ──────

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("verification_tokens_identifier_token_idx").on(
      table.identifier,
      table.token
    ),
  ]
);

// ─── Markets ────────────────────────────────────────────────────────────────────

export type MarketStatus =
  | "draft"
  | "active"
  | "halted"
  | "resolving"
  | "resolved"
  | "cancelled"
  | "failed";

export type QuestionType = "views" | "likes";

export const markets = pgTable(
  "markets",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    youtubeVideoId: text("youtube_video_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    questionType: text("question_type").$type<QuestionType>().notNull(),
    milestoneThreshold: bigint("milestone_threshold", { mode: "bigint" }).notNull(),
    bParameter: decimal("b_parameter", { precision: 10, scale: 2 }).notNull().default("100"),
    quantityYes: decimal("quantity_yes", { precision: 16, scale: 6 }).notNull().default("0"),
    quantityNo: decimal("quantity_no", { precision: 16, scale: 6 }).notNull().default("0"),
    version: integer("version").notNull().default(1),
    status: text("status").$type<MarketStatus>().notNull().default("draft"),
    outcome: integer("outcome"), // null until resolved; 0=YES, 1=NO
    videoMetadata: jsonb("video_metadata").$type<{
      title: string;
      thumbnail: string;
      channelTitle: string;
      channelId?: string;
      description?: string;
    }>(),
    opensAt: timestamp("opens_at", { mode: "date" }),
    haltsAt: timestamp("halts_at", { mode: "date" }),
    resolvesAt: timestamp("resolves_at", { mode: "date" }),
    resolvedAt: timestamp("resolved_at", { mode: "date" }),
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("markets_status_idx").on(table.status),
    index("markets_resolves_at_idx").on(table.resolvesAt),
  ]
);

export const marketsRelations = relations(markets, ({ many }) => ({
  positions: many(positions),
  trades: many(trades),
  priceSnapshots: many(priceSnapshots),
  youtubePolls: many(youtubePolls),
}));

// ─── Positions ──────────────────────────────────────────────────────────────────

export const positions = pgTable(
  "positions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id),
    marketId: text("market_id").notNull().references(() => markets.id),
    outcome: integer("outcome").notNull(), // 0=YES, 1=NO
    shares: decimal("shares", { precision: 16, scale: 6 }).notNull().default("0"),
    avgCostBasis: decimal("avg_cost_basis", { precision: 12, scale: 6 }).notNull().default("0"),
  },
  (table) => [
    uniqueIndex("positions_user_market_outcome_idx").on(
      table.userId,
      table.marketId,
      table.outcome
    ),
    index("positions_user_id_idx").on(table.userId),
    index("positions_market_id_idx").on(table.marketId),
  ]
);

export const positionsRelations = relations(positions, ({ one }) => ({
  user: one(users, { fields: [positions.userId], references: [users.id] }),
  market: one(markets, { fields: [positions.marketId], references: [markets.id] }),
}));

// ─── Trades ─────────────────────────────────────────────────────────────────────

export const trades = pgTable(
  "trades",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id),
    marketId: text("market_id").notNull().references(() => markets.id),
    outcome: integer("outcome").notNull(), // 0=YES, 1=NO
    shares: decimal("shares", { precision: 16, scale: 6 }).notNull(),
    cost: decimal("cost", { precision: 12, scale: 6 }).notNull(), // positive=buy, negative=sell
    priceBefore: decimal("price_before", { precision: 8, scale: 6 }).notNull(),
    priceAfter: decimal("price_after", { precision: 8, scale: 6 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("trades_user_id_idx").on(table.userId),
    index("trades_market_id_idx").on(table.marketId),
    index("trades_created_at_idx").on(table.createdAt),
  ]
);

export const tradesRelations = relations(trades, ({ one }) => ({
  user: one(users, { fields: [trades.userId], references: [users.id] }),
  market: one(markets, { fields: [trades.marketId], references: [markets.id] }),
}));

// ─── Price Snapshots ────────────────────────────────────────────────────────────

export const priceSnapshots = pgTable(
  "price_snapshots",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    marketId: text("market_id").notNull().references(() => markets.id),
    priceYes: decimal("price_yes", { precision: 8, scale: 6 }).notNull(),
    priceNo: decimal("price_no", { precision: 8, scale: 6 }).notNull(),
    volumeTotal: decimal("volume_total", { precision: 16, scale: 2 }).notNull().default("0"),
    recordedAt: timestamp("recorded_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("price_snapshots_market_id_idx").on(table.marketId),
    index("price_snapshots_recorded_at_idx").on(table.recordedAt),
  ]
);

export const priceSnapshotsRelations = relations(priceSnapshots, ({ one }) => ({
  market: one(markets, { fields: [priceSnapshots.marketId], references: [markets.id] }),
}));

// ─── YouTube Polls ──────────────────────────────────────────────────────────────

export const youtubePolls = pgTable(
  "youtube_polls",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    marketId: text("market_id").notNull().references(() => markets.id),
    viewCount: bigint("view_count", { mode: "bigint" }),
    likeCount: bigint("like_count", { mode: "bigint" }),
    polledAt: timestamp("polled_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("youtube_polls_market_id_idx").on(table.marketId),
    index("youtube_polls_market_polled_idx").on(table.marketId, table.polledAt),
  ]
);

export const youtubePollsRelations = relations(youtubePolls, ({ one }) => ({
  market: one(markets, { fields: [youtubePolls.marketId], references: [markets.id] }),
}));

// ─── Coin Transactions (ledger) ─────────────────────────────────────────────────

export type CoinTransactionType =
  | "signup_bonus"
  | "daily_login"
  | "trade"
  | "payout"
  | "refund";

export const coinTransactions = pgTable(
  "coin_transactions",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id),
    amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
    balanceBefore: decimal("balance_before", { precision: 12, scale: 2 }).notNull(),
    balanceAfter: decimal("balance_after", { precision: 12, scale: 2 }).notNull(),
    type: text("type").$type<CoinTransactionType>().notNull(),
    referenceId: text("reference_id"), // tradeId for 'trade', marketId for payout/refund, date for daily_login, userId for signup_bonus
    // FK to trades — only for 'trade' type; referenceId still holds tradeId for the unique index
    tradeId: text("trade_id").references(() => trades.id),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("coin_transactions_user_id_idx").on(table.userId),
    index("coin_transactions_type_idx").on(table.type),
    uniqueIndex("coin_transactions_user_ref_type_idx").on(
      table.userId,
      table.referenceId,
      table.type
    ),
    // Partial unique index enforced via raw SQL migration — prevents duplicate signup bonuses at DB level
    // CREATE UNIQUE INDEX coin_transactions_signup_bonus_per_user_idx ON coin_transactions (user_id) WHERE type = 'signup_bonus'
  ]
);

export const coinTransactionsRelations = relations(coinTransactions, ({ one }) => ({
  user: one(users, { fields: [coinTransactions.userId], references: [users.id] }),
  trade: one(trades, { fields: [coinTransactions.tradeId], references: [trades.id] }),
}));
