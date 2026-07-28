import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireOrg, type OrgVariables } from "../middleware/org.js";
import { assertEntitled, assertWritable } from "../modules/entitlements/index.js";
import {
  createAsset,
  disposeAsset,
  listAssets,
  runDepreciation,
} from "../modules/assets/service.js";

const createAssetSchema = z.object({
  name: z.string().min(1),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  acquisitionCost: z.number().positive(),
  salvageValue: z.number().nonnegative().optional(),
  usefulLifeMonths: z.number().int().positive(),
  accountId: z.string().uuid().optional(),
  payWithCash: z.boolean().optional(),
  cashAccountId: z.string().uuid().optional(),
  memo: z.string().optional(),
});

const depreciateSchema = z.object({
  periodYm: z.string().regex(/^\d{4}-\d{2}$/),
});

const disposeAssetSchema = z.object({
  proceeds: z.number().nonnegative().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  memo: z.string().optional(),
});

const assetsRoutes = new Hono<{ Variables: OrgVariables }>();

assetsRoutes.get("/", requireAuth, requireOrg, async (c) => {
  const orgId = c.get("orgId");
  const assets = await listAssets(orgId);
  return c.json({ assets });
});

assetsRoutes.post("/", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const body = createAssetSchema.parse(await c.req.json());

  await assertEntitled(userId, "manage_fixed_assets");
  await assertWritable(userId, orgId);

  const asset = await createAsset({ orgId, userId, ...body });
  return c.json({ asset }, 201);
});

assetsRoutes.post("/depreciate", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const body = depreciateSchema.parse(await c.req.json());

  await assertEntitled(userId, "manage_fixed_assets");
  await assertWritable(userId, orgId);

  const result = await runDepreciation(orgId, userId, body.periodYm);
  return c.json(result);
});

assetsRoutes.post("/:id/dispose", requireAuth, requireOrg, async (c) => {
  const userId = c.get("user").sub;
  const orgId = c.get("orgId");
  const assetId = c.req.param("id");
  const body = disposeAssetSchema.parse(await c.req.json());

  await assertEntitled(userId, "manage_fixed_assets");
  await assertWritable(userId, orgId);

  const result = await disposeAsset(orgId, userId, assetId, body);
  return c.json(result);
});

export default assetsRoutes;
