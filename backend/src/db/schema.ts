import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "admin",
  "accountant",
  "viewer",
]);

export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const documentTypeEnum = pgEnum("document_type", [
  "invoice",
  "bill",
  "payment",
  "receipt",
  "journal",
  "adjustment",
  "other",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "draft",
  "posted",
  "void",
]);

export const journalStatusEnum = pgEnum("journal_status", [
  "draft",
  "posted",
  "void",
]);

export const openItemTypeEnum = pgEnum("open_item_type", [
  "receivable",
  "payable",
]);

export const openItemStatusEnum = pgEnum("open_item_status", [
  "open",
  "partial",
  "closed",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
]);

export const billingEventTypeEnum = pgEnum("billing_event_type", [
  "subscription_created",
  "subscription_renewed",
  "subscription_canceled",
  "payment_succeeded",
  "payment_failed",
  "trial_started",
  "trial_ended",
]);

export const inviteStatusEnum = pgEnum("invite_status", [
  "pending",
  "accepted",
  "expired",
  "revoked",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash"),
  googleSub: text("google_sub"),
  plan: text("plan").notNull().default("trial"),
  subscriptionStatus: text("subscription_status"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  businessType: text("business_type").notNull().default("umkm"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("memberships_org_user_idx").on(table.orgId, table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: accountTypeEnum("type").notNull(),
    isCash: boolean("is_cash").notNull().default(false),
    isSystem: boolean("is_system").notNull().default(false),
    parentId: uuid("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("accounts_org_code_idx").on(table.orgId, table.code)],
);

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  type: text("type").notNull().default("customer"),
  taxId: text("tax_id"),
  address: text("address"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  type: documentTypeEnum("type").notNull(),
  number: text("number").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id),
  date: date("date").notNull(),
  dueDate: date("due_date"),
  status: documentStatusEnum("status").notNull().default("draft"),
  description: text("description"),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").references(() => documents.id),
  entryDate: date("entry_date").notNull(),
  description: text("description").notNull(),
  status: journalStatusEnum("status").notNull().default("draft"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  voidedAt: timestamp("voided_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const journalLines = pgTable("journal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => journalEntries.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  debit: numeric("debit", { precision: 18, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 18, scale: 2 }).notNull().default("0"),
  description: text("description"),
  lineOrder: integer("line_order").notNull().default(0),
});

export const openItems = pgTable("open_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  type: openItemTypeEnum("type").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id),
  documentId: uuid("document_id").references(() => documents.id),
  description: text("description").notNull(),
  originalAmount: numeric("original_amount", { precision: 18, scale: 2 }).notNull(),
  balanceAmount: numeric("balance_amount", { precision: 18, scale: 2 }).notNull(),
  dueDate: date("due_date"),
  status: openItemStatusEnum("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const fixedAssets = pgTable("fixed_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id),
  depreciationAccountId: uuid("depreciation_account_id").references(() => accounts.id),
  accumulatedDepreciationAccountId: uuid(
    "accumulated_depreciation_account_id",
  ).references(() => accounts.id),
  name: text("name").notNull(),
  acquisitionDate: date("acquisition_date").notNull(),
  acquisitionCost: numeric("acquisition_cost", { precision: 18, scale: 2 }).notNull(),
  salvageValue: numeric("salvage_value", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  usefulLifeMonths: integer("useful_life_months").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const depreciationRuns = pgTable("depreciation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  fixedAssetId: uuid("fixed_asset_id")
    .notNull()
    .references(() => fixedAssets.id, { onDelete: "cascade" }),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
  periodDate: date("period_date").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const fiscalPeriods = pgTable(
  "fiscal_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    isClosed: boolean("is_closed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("fiscal_periods_org_dates_idx").on(table.orgId, table.startDate)],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const planCatalog = pgTable("plan_catalog", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  priceMonthly: numeric("price_monthly", { precision: 18, scale: 2 }).notNull(),
  priceYearly: numeric("price_yearly", { precision: 18, scale: 2 }).notNull(),
  maxOrgs: integer("max_orgs").notNull(),
  maxSeats: integer("max_seats").notNull(),
  features: jsonb("features").$type<Record<string, unknown>>().notNull(),
  active: boolean("active").notNull().default(true),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  planCode: text("plan_code")
    .notNull()
    .references(() => planCatalog.code),
  status: subscriptionStatusEnum("status").notNull().default("trialing"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  midtransSubscriptionId: text("midtrans_subscription_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const billingEvents = pgTable("billing_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
  type: billingEventTypeEnum("type").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const licenseKeys = pgTable("license_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  planCode: text("plan_code")
    .notNull()
    .references(() => planCatalog.code),
  maxOrgs: integer("max_orgs").notNull(),
  maxSeats: integer("max_seats").notNull(),
  issuedTo: text("issued_to"),
  activatedByUserId: uuid("activated_by_user_id").references(() => users.id),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const invites = pgTable("invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: membershipRoleEnum("role").notNull().default("viewer"),
  token: text("token").notNull().unique(),
  invitedBy: uuid("invited_by").references(() => users.id),
  status: inviteStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documentSequences = pgTable(
  "document_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentType: documentTypeEnum("document_type").notNull(),
    prefix: text("prefix").notNull().default(""),
    nextNumber: integer("next_number").notNull().default(1),
    padding: integer("padding").notNull().default(4),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("document_sequences_org_type_idx").on(table.orgId, table.documentType),
  ],
);

export const schema = {
  users,
  organizations,
  memberships,
  accounts,
  contacts,
  documents,
  journalEntries,
  journalLines,
  openItems,
  fixedAssets,
  depreciationRuns,
  fiscalPeriods,
  appSettings,
  planCatalog,
  subscriptions,
  billingEvents,
  licenseKeys,
  invites,
  auditLogs,
  documentSequences,
};

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Account = typeof accounts.$inferSelect;
