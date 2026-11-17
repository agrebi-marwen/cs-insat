// Row shapes for the Supabase tables the app reads (see db/*.sql).

export type SubmissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Profile {
  id: string;
  username: string;
  total_points: number | null;
  role?: string | null;
}

export interface ChallengeCategory {
  id: string;
  slug: string;
  name: string;
}

export interface Challenge {
  id: string;
  title: string;
  instructions: string | null;
  month_year: string | null;
  points_worth: number | null;
  is_active: boolean;
  category_id: string | null;
  tags: string | null;
  challenge_categories?: ChallengeCategory | null;
}

export interface CpProblemConfig {
  languages: string[] | null;
  time_limit_ms: number | null;
  memory_limit_mb: number | null;
  allow_multiple_submissions: boolean | null;
}

export interface TestCaseRow {
  index?: number | null;
  input?: string | null;
  expected?: string | null;
  output?: string | null;
  cpu_ms?: number | null;
  memory_kb?: number | null;
  result?: string | null;
}

export interface CpSubmissionDetail {
  language: string | null;
  verdict: string | null;
  code: string | null;
  execution_time_ms: number | null;
  memory_kb: number | null;
  compile_output: string | null;
  run_output: string | null;
  test_results: TestCaseRow[] | null;
}

export interface SubmissionRow {
  id: string;
  submitted_at: string | null;
  submission_url: string | null;
  notes: string | null;
  status: string | null;
  challenges: { title: string } | null;
  // PostgREST returns an object for 1:1 relations and an array otherwise.
  cp_submission_details: CpSubmissionDetail | CpSubmissionDetail[] | null;
}

export interface Resource {
  title?: string | null;
  url?: string | null;
}

export interface Roadmap {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  difficulty: string | null;
}

export interface RoadmapStep {
  id: string;
  title: string;
  description: string | null;
  resources: Resource[] | null;
}

export interface RoadmapNode {
  id: string;
  title: string;
  description: string | null;
  required_tags: string[] | null;
  resources: Resource[] | null;
}

export interface WorkshopCategory {
  id: string;
  slug: string;
  name: string;
}

export interface Workshop {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  duration: string | null;
  published_at: string | null;
  category_id: string | null;
  workshop_categories: WorkshopCategory | null;
}
