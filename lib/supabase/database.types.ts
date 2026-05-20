export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      sprint_attempts: {
        Row: {
          id: string;
          created_at: string;
          player_name: string;
          score: number;
          correct_count: number;
          attempted_count: number;
          duration_seconds: number;
          max_streak: number;
          average_ms_per_question: number | null;
          accuracy_percent: number;
          mode: "sixty_second_sprint";
          client_metadata: Json;
        };
        Insert: {
          id?: string;
          created_at?: string;
          player_name?: string;
          score: number;
          correct_count: number;
          attempted_count: number;
          duration_seconds?: number;
          max_streak?: number;
          average_ms_per_question?: number | null;
          mode?: "sixty_second_sprint";
          client_metadata?: Json;
        };
        Update: {
          id?: string;
          created_at?: string;
          player_name?: string;
          score?: number;
          correct_count?: number;
          attempted_count?: number;
          duration_seconds?: number;
          max_streak?: number;
          average_ms_per_question?: number | null;
          mode?: "sixty_second_sprint";
          client_metadata?: Json;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
