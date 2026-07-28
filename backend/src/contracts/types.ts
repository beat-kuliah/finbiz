import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createOrgSchema = z.object({
  name: z.string().min(1).max(200),
  businessType: z
    .enum(["umkm", "retail", "service", "dagang", "jasa"])
    .default("umkm")
    .transform((v) => {
      if (v === "dagang") return "retail" as const;
      if (v === "jasa") return "service" as const;
      return v;
    }),
  openingCash: z.number().nonnegative().optional(),
});

export const journalLineSchema = z.object({
  accountId: z.string().uuid(),
  debit: z.number().nonnegative(),
  credit: z.number().nonnegative(),
  description: z.string().optional(),
});

export const postJournalSchema = z.object({
  date: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  description: z.string().min(1),
  lines: z.array(journalLineSchema).min(2),
  documentId: z.string().uuid().optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "accountant", "viewer"]).default("viewer"),
});

export const createAccountSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  type: z.enum(["asset", "liability", "equity", "revenue", "expense"]),
  isCash: z.boolean().optional(),
});

export const updateAccountSchema = z
  .object({
    code: z.string().min(1).max(20).optional(),
    name: z.string().min(1).max(200).optional(),
  })
  .refine((data) => data.code !== undefined || data.name !== undefined, {
    message: "At least one field must be provided",
  });

export const createDocumentSchema = z
  .object({
    kind: z.enum([
      "cash_in",
      "cash_out",
      "transfer",
      "capital",
      "loan_in",
      "loan_payment",
      "invoice",
      "receipt",
    ]),
    amount: z.number().positive(),
    memo: z.string().optional(),
    cashAccountId: z.string().uuid().optional(),
    counterAccountId: z.string().uuid().optional(),
    isPrive: z.boolean().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    contactId: z.string().uuid().optional(),
    openItemId: z.string().uuid().optional(),
    documentId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      (data.kind === "receipt" || data.kind === "loan_payment") &&
      !data.openItemId &&
      !data.documentId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "openItemId or documentId is required",
      });
    }
  });

export const createContactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  type: z.enum(["customer", "vendor", "both"]).default("customer"),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateOrgInput = z.infer<typeof createOrgSchema>;
export type PostJournalInput = z.infer<typeof postJournalSchema>;

export interface AuthUserResponse {
  id: string;
  email: string;
  name: string;
  plan: string;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  isPlatformAdmin: boolean;
}

export interface AuthTokenResponse {
  accessToken: string;
  user: AuthUserResponse;
}

export interface OrgResponse {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  role: string;
  createdAt: string;
}

export interface HealthResponse {
  ok: boolean;
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}
