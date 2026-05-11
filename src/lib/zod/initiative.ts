import { z } from "zod";

// Conditional validation: jtbd required for blocker/maturity; kill_criteria + hypothesis + success_criteria
// required for experiment. See planning_system_concept.md §3.4.1 / §3.4.2.

export const initiativeTypeSchema = z.enum([
  "client_blocker",
  "product_maturity",
  "tech_debt",
  "experiment",
  "support",
]);

export const initiativeStatusSchema = z.enum(["planned", "in_progress", "done", "killed"]);
export const experimentDecisionSchema = z.enum(["validated", "invalidated", "inconclusive"]);

const baseShape = {
  title: z.string().trim().min(1, "Название обязательно"),
  type: initiativeTypeSchema,
  description: z.string().nullable().optional(),
  jtbd: z.string().nullable().optional(),
  due_period_id: z.string().uuid().nullable().optional(),
  start_period_id: z.string().uuid().nullable().optional(),
  end_period_id: z.string().uuid().nullable().optional(),
  estimate_hours: z.number().nonnegative().nullable().optional(),
  rice_reach: z.number().nonnegative().nullable().optional(),
  rice_impact: z.union([z.literal(0.25), z.literal(0.5), z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(),
  rice_confidence: z.union([z.literal(0.5), z.literal(0.8), z.literal(1.0)]).nullable().optional(),
  key_assumptions: z.array(z.string()).max(3).nullable().optional(),
  kill_criteria: z.string().nullable().optional(),
  hypothesis: z.string().nullable().optional(),
  success_criteria: z.string().nullable().optional(),
  sample_size_or_duration: z.string().nullable().optional(),
  experiment_result: z.string().nullable().optional(),
  experiment_decision: experimentDecisionSchema.nullable().optional(),
  status: initiativeStatusSchema.optional(),
};

export const initiativeFormSchema = z.object(baseShape).superRefine((val, ctx) => {
  if (val.type === "client_blocker" || val.type === "product_maturity") {
    if (!val.jtbd || val.jtbd.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "JTBD обязателен для блокеров и зрелости", path: ["jtbd"] });
    }
  }
  if (val.type === "experiment") {
    if (!val.hypothesis || val.hypothesis.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Гипотеза обязательна для эксперимента", path: ["hypothesis"] });
    }
    if (!val.success_criteria || val.success_criteria.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Критерий успеха обязателен", path: ["success_criteria"] });
    }
    if (!val.kill_criteria || val.kill_criteria.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Kill criteria обязателен", path: ["kill_criteria"] });
    }
  }
});

export type InitiativeFormValues = z.infer<typeof initiativeFormSchema>;

// EN labels по PLAN_PLANNING_REWORK §0: «RICE-лейблы — UI на английском».
export const RICE_IMPACT_OPTIONS = [
  { value: 0.25, label: "Minimal" },
  { value: 0.5,  label: "Small" },
  { value: 1,    label: "Medium" },
  { value: 2,    label: "Large" },
  { value: 3,    label: "Massive" },
] as const;

export const RICE_CONFIDENCE_OPTIONS = [
  { value: 0.5, label: "Low",    percent: "50%" },
  { value: 0.8, label: "Medium", percent: "80%" },
  { value: 1.0, label: "High",   percent: "100%" },
] as const;
