export interface Session {
  id: string;
  user_id: string;
  context: string | null;
  status: "active" | "completed" | "abandoned";
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  vapi_call_id: string | null;
}

export interface KabirNotes {
  id: string;
  session_id: string;
  user_id: string;
  created_at: string;
  overall_score: number | null;
  summary: string;
  best_moment: string;
  worst_moment: string;
  one_thing_to_fix: string;
}

export interface UserMemory {
  id: string;
  user_id: string;
  phone_number: string | null;
  kabir_memory: string;
  patterns: string[];
  weaknesses: string[];
  improvements: string[];
  total_sessions: number;
  last_session_at: string | null;
  updated_at: string;
}
