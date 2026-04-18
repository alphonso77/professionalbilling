export type Me = {
  user:
    | {
        id: string;
        email: string | null;
        clerk_user_id: string;
        role: "owner" | "admin" | "member";
      }
    | null;
  org: {
    id: string;
    clerk_org_id: string;
    plan: string;
  };
};

export type Client = {
  id: string;
  name: string;
  email: string | null;
  billing_address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateClientInput = {
  name: string;
  email?: string;
  billing_address?: string;
  notes?: string;
};

export type TimeEntry = {
  id: string;
  org_id: string;
  client_id: string | null;
  description: string;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  hourly_rate_cents: number | null;
  created_at: string;
  updated_at: string;
};

export type CreateTimeEntryInput = {
  client_id?: string;
  description: string;
  started_at: string;
  ended_at: string;
  hourly_rate_cents?: number;
};

export type CreateTimeEntryResponse = {
  entry: TimeEntry;
  warnings?: string[];
};

export type DocsEntry = {
  key: string;
  label: string;
  tooltip: string;
  detail: string;
  docSlug: string;
  whatWeMeasure?: string;
  thresholds?: { label: string; range: string; meaning: string }[];
  commonMisunderstanding?: string;
};

export type DocsCategory = {
  key: string;
  title: string;
  description?: string;
  entries: DocsEntry[];
};

export type DocsRegistry = {
  categories: DocsCategory[];
};

export type OAuthAuthorizeResponse = {
  url: string;
};

export type Platform = {
  id: string;
  type: string;
  external_account_id: string;
  created_at: string;
  updated_at: string;
};
