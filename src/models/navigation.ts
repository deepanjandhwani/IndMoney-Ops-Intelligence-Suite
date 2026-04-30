export type AppRole = "customer" | "admin";

export type AppModule =
  | "smart-sync-faq"
  | "advisor-scheduler"
  | "review-pulse"
  | "review-trends"
  | "hitl-approval"
  | "evaluation-suite";

export type NavigationItem = {
  label: string;
  module: AppModule;
  href: string;
  roles: AppRole[];
  status: "scaffolded";
};

export const navigationItems: NavigationItem[] = [
  {
    label: "Smart-Sync FAQ",
    module: "smart-sync-faq",
    href: "/customer/faq",
    roles: ["customer"],
    status: "scaffolded"
  },
  {
    label: "Advisor Scheduler",
    module: "advisor-scheduler",
    href: "/customer/scheduler",
    roles: ["customer"],
    status: "scaffolded"
  },
  {
    label: "Smart-Sync FAQ Preview",
    module: "smart-sync-faq",
    href: "/admin/faq-preview",
    roles: ["admin"],
    status: "scaffolded"
  },
  {
    label: "Advisor Scheduler Preview",
    module: "advisor-scheduler",
    href: "/admin/scheduler-preview",
    roles: ["admin"],
    status: "scaffolded"
  },
  {
    label: "Review Pulse",
    module: "review-pulse",
    href: "/admin/review-pulse",
    roles: ["admin"],
    status: "scaffolded"
  },
  {
    label: "Review Trends",
    module: "review-trends",
    href: "/admin/review-trends",
    roles: ["admin"],
    status: "scaffolded"
  },
  {
    label: "HITL Approval Center",
    module: "hitl-approval",
    href: "/admin/hitl",
    roles: ["admin"],
    status: "scaffolded"
  },
  {
    label: "Evaluation Suite",
    module: "evaluation-suite",
    href: "/admin/evals",
    roles: ["admin"],
    status: "scaffolded"
  }
];
