/**
 * Suraksha Grid — Supabase Database types
 *
 * Matches migrations 001–004. Replace with the generated output of:
 *   npx supabase gen types typescript --project-id YOUR_PROJECT_ID
 * after running the migrations against a real Supabase project.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      road_segments: {
        Row: {
          id: string;
          name: string;
          safety_score: number;
          confidence_score: number;
          lighting_score: number;
          pedestrian_activity_score: number;
          emergency_access_score: number;
          emergency_access_label: "Good" | "Fair" | "Limited";
          time_condition: string | null;
          explanation: string | null;
          recent_reports_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          safety_score: number;
          confidence_score?: number;
          lighting_score?: number;
          pedestrian_activity_score?: number;
          emergency_access_score?: number;
          emergency_access_label?: "Good" | "Fair" | "Limited";
          time_condition?: string | null;
          explanation?: string | null;
          recent_reports_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          safety_score?: number;
          confidence_score?: number;
          lighting_score?: number;
          pedestrian_activity_score?: number;
          emergency_access_score?: number;
          emergency_access_label?: "Good" | "Fair" | "Limited";
          time_condition?: string | null;
          explanation?: string | null;
          recent_reports_count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      routes: {
        Row: {
          id: string;
          name: string;
          route_type: "fastest" | "balanced" | "safest";
          distance_m: number;
          duration_s: number;
          safety_score: number;
          confidence: number;
          reason: string | null;
          segment_ids: string[];
          recommended: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          route_type: "fastest" | "balanced" | "safest";
          distance_m: number;
          duration_s: number;
          safety_score: number;
          confidence?: number;
          reason?: string | null;
          segment_ids?: string[];
          recommended?: boolean;
          created_at?: string;
        };
        Update: {
          safety_score?: number;
          confidence?: number;
          recommended?: boolean;
        };
        Relationships: [];
      };
      safety_reports: {
        Row: {
          id: string;
          user_id: string | null;
          road_segment_id: string | null;
          description: string | null;
          category: string;
          severity: number;
          latitude: number;
          longitude: number;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          road_segment_id?: string | null;
          description?: string | null;
          category: string;
          severity?: number;
          latitude: number;
          longitude: number;
          status?: string;
          created_at?: string;
        };
        Update: {
          status?: string;
          description?: string | null;
          severity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "safety_reports_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      street_stories: {
        Row: {
          id: string;
          user_id: string | null;
          road_segment_id: string | null;
          place_name: string | null;
          content: string;
          tags: string[];
          helpful_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          road_segment_id?: string | null;
          place_name?: string | null;
          content: string;
          tags?: string[];
          helpful_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          content?: string;
          tags?: string[];
          helpful_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "street_stories_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      help_points: {
        Row: {
          id: string;
          name: string;
          type: "police" | "hospital" | "help";
          latitude: number;
          longitude: number;
          address: string | null;
          phone: string | null;
          open_24h: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          type: "police" | "hospital" | "help";
          latitude: number;
          longitude: number;
          address?: string | null;
          phone?: string | null;
          open_24h?: boolean;
          created_at?: string;
        };
        Update: {
          name?: string;
          address?: string | null;
          phone?: string | null;
          open_24h?: boolean;
        };
        Relationships: [];
      };
      saved_routes: {
        Row: {
          id: string;
          user_id: string;
          route_id: string;
          label: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          route_id: string;
          label?: string | null;
          created_at?: string;
        };
        Update: {
          label?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "saved_routes_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_helpful: {
        Args: { story_id: string };
        Returns: undefined;
      };
      increment_report_count: {
        Args: { seg_id: string };
        Returns: undefined;
      };
      upsert_segment_scores: {
        Args: {
          p_segment_id: string;
          p_safety_score: number;
          p_confidence_score: number;
          p_lighting_score: number;
          p_pedestrian_activity: number;
          p_explanation: string;
        };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
  };
}