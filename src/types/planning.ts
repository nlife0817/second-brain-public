// Planning system V3 — TypeScript model aligned with migrations 0023 + 0024.

// --- Enums / unions ---

export type PeriodType = "year" | "quarter" | "month" | "week";

export type MetricType = "numeric" | "business" | "delivery";
export type MetricDirection = "up" | "down";
// "kaiten" removed in P0 (PLAN_PLANNING_REWORK §0). Existing rows migrated to "manual".
export type MetricSource =
  | "grafana"
  | "second_brain"
  | "product_analytics"
  | "manual";

export type InitiativeType =
  | "client_blocker"
  | "product_maturity"
  | "tech_debt"
  | "experiment"
  | "support";

export type InitiativeStatus = "planned" | "in_progress" | "done" | "killed";

export type ExperimentDecision = "validated" | "invalidated" | "inconclusive";

export type DealStage = "lead" | "pilot" | "production" | "churned";
export type DealPaymentStatus = "expected" | "confirmed";
export type DealBlockingStage = "pilot" | "production";

// Codes from seed data in `planning_replan_reasons`.
export type ReplanReasonCode =
  | "customer_signal_changed"
  | "discovery_invalidated"
  | "dependency_shifted"
  | "scope_underestimated"
  | "scope_overestimated"
  | "priority_changed"
  | "external_event"
  | "kill_criteria_triggered"
  | "minor_adjustment";

export interface ReplanReason {
  code: ReplanReasonCode;
  text?: string;
}

// --- Entities ---

export interface PlanningDirection {
  id: string;
  title: string;
  year_focus: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningPeriodRetrospective {
  what_went_well?: string;
  what_didnt?: string;
  what_to_try?: string;
  lessons_learned?: string;
}

export interface PlanningPeriod {
  id: string;
  direction_id: string | null;
  type: PeriodType;
  year: number;
  quarter_n: number | null;
  month_n: number | null;
  week_n: number | null;
  start_date: string;
  end_date: string;
  metric_targets_snapshot: Record<string, unknown> | null;
  capacity_hours: number | null;
  retrospective: PlanningPeriodRetrospective | null;
  created_at: string;
  updated_at: string;
}

export interface PlanningMetric {
  id: string;
  direction_id: string | null;
  title: string;
  type: MetricType;
  unit: string | null;
  direction_value: MetricDirection | null;
  baseline: number | null;
  // P4: годовая цель — input, который пользователь задаёт до distribute.
  // Хранится здесь, а не как target-row с period.type='year'.
  annual_target: number | null;
  source: MetricSource | null;
  source_id: string | null;
  is_cumulative: boolean;
  is_emergent: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningMetricTarget {
  id: string;
  metric_id: string;
  period_id: string;
  target_value: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningMetricTick {
  id: string;
  metric_id: string;
  value: number;
  measured_at: string;
  source: string | null;
  created_at: string;
}

export interface PlanningInitiative {
  id: string;
  direction_id: string | null;
  title: string;
  type: InitiativeType;
  description: string | null;
  jtbd: string | null;
  // due_period_id — legacy back-compat зеркало end_period_id, поддерживается триггером
  // sync_due_period (migration 0028). UI пишет в start/end, читает откуда удобно.
  due_period_id: string | null;
  start_period_id: string | null;
  end_period_id: string | null;
  estimate_hours: number | null;
  rice_reach: number | null;
  rice_impact: number | null;
  rice_confidence: number | null;
  rice_score: number;
  key_assumptions: string[] | null;
  kill_criteria: string | null;
  parent_initiative_id: string | null;
  created_from_task_id: string | null;
  hypothesis: string | null;
  success_criteria: string | null;
  sample_size_or_duration: string | null;
  experiment_result: string | null;
  experiment_decision: ExperimentDecision | null;
  status: InitiativeStatus;
  done_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  // P7.4: denormalized progress (опционально — заполняется только в `listInitiatives`
  // для подсветки at-risk/failed; в `getInitiative` отсутствует).
  tasks_total?: number;
  tasks_done?: number;
}

export interface PlanningInitiativeMetricLink {
  initiative_id: string;
  metric_id: string;
}

export interface PlanningInitiativeDealLink {
  initiative_id: string;
  deal_id: string;
  blocks_stage: DealBlockingStage | null;
}

export interface PlanningInitiativeClientLink {
  initiative_id: string;
  client_id: string;
}

export interface PlanningInitiativeDependency {
  initiative_id: string;
  depends_on_initiative_id: string;
}

export interface PlanningPeriodInitiativeLink {
  period_id: string;
  initiative_id: string;
}

export interface PlanningDeal {
  id: string;
  title: string;
  client_id: string | null;
  icp_segment_id: string | null;
  stage: DealStage;
  stage_changed_at: string;
  pilot_started_at: string | null;
  pilot_default_duration_days: number | null;
  pilot_planned_end_at: string | null;
  pilot_ended_at: string | null;
  production_started_at: string | null;
  min_monthly_amount: number | null;
  expected_actual_amount: number | null;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningDealPayment {
  id: string;
  deal_id: string;
  paid_at: string;
  amount: number;
  note: string | null;
  status: DealPaymentStatus;
  created_at: string;
  updated_at: string;
}

export interface PlanningChangeLogEntry {
  id: string;
  timestamp: string;
  actor_email: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  diff: Record<string, { from: unknown; to: unknown }> | null;
  replan_reason: ReplanReason | null;
  context: Record<string, unknown> | null;
}

export interface PlanningSettings {
  id: "default";
  pilot_default_duration_days: number;
  early_warning_weeks: number;
  strategy_support_ratio: number;
  minor_adjustment_threshold: number;
  daily_capacity_hours: number;
  weekly_capacity_hours: number;
  accent_color: string;
  weekend_days_visible: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanningIcpSegment {
  id: string;
  title: string;
  archived: boolean;
  position: number;
  created_at: string;
}

export interface PlanningReplanReasonDict {
  code: ReplanReasonCode;
  title: string;
  requires_text: boolean;
}

export interface PlanningMetricUnit {
  code: string;
  title: string;
  is_default: boolean;
}

export interface PlanningKaitenBoardMapping {
  kaiten_board_id: string;
  initiative_id: string;
  created_at: string;
}

// --- Auto-distribute ---

export type DistributeCurve =
  | "linear"
  | "s_curve"
  | "front_loaded"
  | "back_loaded"
  | "history"
  | "custom";

// --- Inputs ---

export interface CreateDirectionInput {
  title: string;
  year_focus?: string | null;
  position?: number;
}

export interface UpdateDirectionInput {
  title?: string;
  year_focus?: string | null;
  position?: number;
}

export interface UpsertPeriodInput {
  direction_id?: string | null;
  type: PeriodType;
  year: number;
  quarter_n?: number | null;
  month_n?: number | null;
  week_n?: number | null;
  start_date: string;
  end_date: string;
  capacity_hours?: number | null;
}

export interface CreateMetricInput {
  direction_id?: string | null;
  title: string;
  type: MetricType;
  unit?: string | null;
  direction_value?: MetricDirection | null;
  baseline?: number | null;
  annual_target?: number | null;
  source?: MetricSource | null;
  source_id?: string | null;
  is_cumulative?: boolean;
  is_emergent?: boolean;
  position?: number;
}

export interface UpdateMetricInput {
  title?: string;
  unit?: string | null;
  direction_value?: MetricDirection | null;
  baseline?: number | null;
  annual_target?: number | null;
  source?: MetricSource | null;
  source_id?: string | null;
  is_cumulative?: boolean;
  is_emergent?: boolean;
  position?: number;
}

export interface UpsertMetricTargetInput {
  metric_id: string;
  period_id: string;
  target_value: number;
}

export interface CreateMetricTickInput {
  metric_id: string;
  value: number;
  measured_at: string;
  source?: string | null;
}

export interface CreateInitiativeInput {
  direction_id?: string | null;
  title: string;
  type: InitiativeType;
  description?: string | null;
  jtbd?: string | null;
  due_period_id?: string | null;
  start_period_id?: string | null;
  end_period_id?: string | null;
  estimate_hours?: number | null;
  rice_reach?: number | null;
  rice_impact?: number | null;
  rice_confidence?: number | null;
  key_assumptions?: string[] | null;
  kill_criteria?: string | null;
  parent_initiative_id?: string | null;
  created_from_task_id?: string | null;
  hypothesis?: string | null;
  success_criteria?: string | null;
  sample_size_or_duration?: string | null;
}

export interface UpdateInitiativeInput {
  title?: string;
  type?: InitiativeType;
  description?: string | null;
  jtbd?: string | null;
  due_period_id?: string | null;
  start_period_id?: string | null;
  end_period_id?: string | null;
  estimate_hours?: number | null;
  rice_reach?: number | null;
  rice_impact?: number | null;
  rice_confidence?: number | null;
  key_assumptions?: string[] | null;
  kill_criteria?: string | null;
  parent_initiative_id?: string | null;
  hypothesis?: string | null;
  success_criteria?: string | null;
  sample_size_or_duration?: string | null;
  experiment_result?: string | null;
  experiment_decision?: ExperimentDecision | null;
  status?: InitiativeStatus;
  done_at?: string | null;
  position?: number;
}

export interface CreateDealInput {
  title: string;
  client_id?: string | null;
  icp_segment_id?: string | null;
  stage?: DealStage;
  pilot_default_duration_days?: number | null;
  min_monthly_amount?: number | null;
  expected_actual_amount?: number | null;
  description?: string | null;
  position?: number;
}

export interface UpdateDealInput {
  title?: string;
  client_id?: string | null;
  icp_segment_id?: string | null;
  stage?: DealStage;
  stage_changed_at?: string;
  pilot_started_at?: string | null;
  pilot_default_duration_days?: number | null;
  pilot_planned_end_at?: string | null;
  pilot_ended_at?: string | null;
  production_started_at?: string | null;
  min_monthly_amount?: number | null;
  expected_actual_amount?: number | null;
  description?: string | null;
  position?: number;
}

export interface CreateDealPaymentInput {
  deal_id: string;
  paid_at: string;
  amount: number;
  note?: string | null;
  status?: DealPaymentStatus;
}

export interface UpdateDealPaymentInput {
  paid_at?: string;
  amount?: number;
  note?: string | null;
  status?: DealPaymentStatus;
}

export interface ChangeLogInsertInput {
  actor_email?: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  diff?: Record<string, { from: unknown; to: unknown }> | null;
  replan_reason?: ReplanReason | null;
  context?: Record<string, unknown> | null;
}

export interface UpdatePlanningSettingsInput {
  pilot_default_duration_days?: number;
  early_warning_weeks?: number;
  strategy_support_ratio?: number;
  minor_adjustment_threshold?: number;
  daily_capacity_hours?: number;
  weekly_capacity_hours?: number;
  accent_color?: string;
  weekend_days_visible?: boolean;
}
