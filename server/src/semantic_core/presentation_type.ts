import { z } from "zod";

const PRESENTATION_TYPES = ["table", "kpi", "line", "bar", "pie"] as const;
export const PRESENTATION_TYPE_SCHEMA = z.enum(PRESENTATION_TYPES);
export type PresentationType = z.infer<typeof PRESENTATION_TYPE_SCHEMA>;
