import { v } from "convex/values";
import { query } from "../_generated/server";
import { paginationOptsValidator } from "convex/server";
import { TableNames } from "../_generated/dataModel";

export const list = query({
  args: {
    table: v.string(),
    search: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const targetTable = args.table as TableNames;
    
    // Fallback to basic query scanning if no dynamic index is provided for public queries
    const queryBuilder = ctx.db.query(targetTable);

    const results = await queryBuilder.paginate(args.paginationOpts);

    // Format data into standard { _id, label } objects expected by RelationSelect
    const formattedPage = results.page.map((doc: any) => {
      return {
        _id: doc._id,
        // Adapt this logic to whatever display fields your tables use (e.g., name, service_number, title)
        label: doc.name || doc.service_number || doc.operator || doc.title || String(doc._id),
      };
    });

    return {
      ...results,
      page: formattedPage,
    };
  },
});