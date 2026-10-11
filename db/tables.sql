-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text NOT NULL UNIQUE,
  total_points integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  role text DEFAULT 'traveler'::text,
  is_admin boolean DEFAULT false,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.challenges (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  instructions text NOT NULL,
  month_year text NOT NULL,
  points_worth integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT false,
  category_id uuid,
  tags text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT challenges_pkey PRIMARY KEY (id)
);
CREATE TABLE public.challenge_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT challenge_categories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  challenge_id uuid NOT NULL,
  submission_url text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'::text CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])),
  submitted_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT submissions_pkey PRIMARY KEY (id),
  CONSTRAINT submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT submissions_challenge_id_fkey FOREIGN KEY (challenge_id) REFERENCES public.challenges(id)
);
-- CP-specific policy is stored in cp_problems.allow_multiple_submissions.
-- Accepted CP attempts are idempotently awarded through challenge_awards.
CREATE TABLE public.challenge_awards (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  challenge_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  points integer NOT NULL,
  awarded_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT challenge_awards_pkey PRIMARY KEY (id),
  CONSTRAINT challenge_awards_unique UNIQUE (user_id, challenge_id)
);
CREATE TABLE public.roadmaps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  difficulty text DEFAULT 'Beginner'::text,
  type text DEFAULT 'learn'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT roadmaps_pkey PRIMARY KEY (id)
);
CREATE TABLE public.roadmap_nodes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text,
  required_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_nodes_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_nodes_roadmap_id_fkey FOREIGN KEY (roadmap_id) REFERENCES public.roadmaps(id)
);
CREATE TABLE public.roadmap_node_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  roadmap_id uuid NOT NULL,
  node_id uuid NOT NULL,
  completed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_node_progress_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_node_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT roadmap_node_progress_roadmap_id_fkey FOREIGN KEY (roadmap_id) REFERENCES public.roadmaps(id),
  CONSTRAINT roadmap_node_progress_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.roadmap_nodes(id)
);
CREATE TABLE public.roadmap_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  roadmap_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text,
  resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_steps_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_steps_roadmap_id_fkey FOREIGN KEY (roadmap_id) REFERENCES public.roadmaps(id)
);
CREATE TABLE public.roadmap_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  step_id uuid NOT NULL,
  completed_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT roadmap_progress_pkey PRIMARY KEY (id),
  CONSTRAINT roadmap_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  CONSTRAINT roadmap_progress_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.roadmap_steps(id)
);
CREATE TABLE public.workshop_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workshop_categories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.workshops (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  video_url text NOT NULL,
  duration text,
  published_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workshops_pkey PRIMARY KEY (id),
  CONSTRAINT workshops_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.workshop_categories(id)
);
