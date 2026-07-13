import { mutation } from "../_generated/server";

export const migrateAndCleanup = mutation({
  handler: async (ctx) => {
    const all = await ctx.db.query("operators").collect();
    for (const op of all) {
      const oldOp = op as any;
      
      // 1. Move data to new fields if they don't exist yet
      const update: any = {};
      if (oldOp.operator_name && !op.display_name) {
        update.display_name = oldOp.operator_name;
        update.operator_names = [oldOp.operator_name];
        update.operator_slugs = [oldOp.operator_slug];
        update.operator_codes = [oldOp.operator_code];
      }

      // 2. Explicitly unset the old fields
      // In Convex, setting a field to undefined in a patch removes it if the schema allows
      update.operator_name = undefined;
      update.operator_slug = undefined;
      update.operator_code = undefined;

      await ctx.db.patch(op._id, update);
    }
  },
});