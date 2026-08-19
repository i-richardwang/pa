import { z } from "zod";

export const RENDER_SHAPE_SCHEMA = z.enum(["kpi", "line", "bar", "pie", "crosstab", "table"]);

export type RenderShape = z.infer<typeof RENDER_SHAPE_SCHEMA>;
