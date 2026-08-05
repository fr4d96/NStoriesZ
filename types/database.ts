export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      contributor_links: {
        Row: {
          contributor_id: string;
          event_type: string;
          id: string;
          linked_at: string;
          linked_by: string;
          note: string | null;
          user_id: string;
        };
        Insert: {
          contributor_id: string;
          event_type?: string;
          id?: string;
          linked_at?: string;
          linked_by: string;
          note?: string | null;
          user_id: string;
        };
        Update: {
          contributor_id?: string;
          event_type?: string;
          id?: string;
          linked_at?: string;
          linked_by?: string;
          note?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contributor_links_contributor_id_fkey";
            columns: ["contributor_id"];
            isOneToOne: false;
            referencedRelation: "contributors";
            referencedColumns: ["id"];
          },
        ];
      };
      contributors: {
        Row: {
          attribution_type: Database["public"]["Enums"]["attribution_type"];
          avatar_path: string | null;
          bio: string | null;
          created_at: string;
          created_by: string;
          display_name: string;
          id: string;
          linked_user_id: string | null;
          public_slug: string | null;
          public_status: Database["public"]["Enums"]["contributor_status"];
          updated_at: string;
        };
        Insert: {
          attribution_type?: Database["public"]["Enums"]["attribution_type"];
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          created_by: string;
          display_name: string;
          id?: string;
          linked_user_id?: string | null;
          public_slug?: string | null;
          public_status?: Database["public"]["Enums"]["contributor_status"];
          updated_at?: string;
        };
        Update: {
          attribution_type?: Database["public"]["Enums"]["attribution_type"];
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          created_by?: string;
          display_name?: string;
          id?: string;
          linked_user_id?: string | null;
          public_slug?: string | null;
          public_status?: Database["public"]["Enums"]["contributor_status"];
          updated_at?: string;
        };
        Relationships: [];
      };
      destinations: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          region_id: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          region_id: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          region_id?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "destinations_region_id_fkey";
            columns: ["region_id"];
            isOneToOne: false;
            referencedRelation: "regions";
            referencedColumns: ["id"];
          },
        ];
      };
      editorial_actions: {
        Row: {
          action_type: string;
          created_at: string;
          editor_id: string | null;
          id: string;
          revision_id: string | null;
          story_id: string;
          summary: string;
        };
        Insert: {
          action_type: string;
          created_at?: string;
          editor_id?: string | null;
          id?: string;
          revision_id?: string | null;
          story_id: string;
          summary: string;
        };
        Update: {
          action_type?: string;
          created_at?: string;
          editor_id?: string | null;
          id?: string;
          revision_id?: string | null;
          story_id?: string;
          summary?: string;
        };
        Relationships: [
          {
            foreignKeyName: "editorial_actions_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "editorial_actions_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      moderation_action_notes: {
        Row: {
          action_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          internal_note: string;
        };
        Insert: {
          action_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          internal_note: string;
        };
        Update: {
          action_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          internal_note?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moderation_action_notes_action_id_fkey";
            columns: ["action_id"];
            isOneToOne: false;
            referencedRelation: "moderation_actions";
            referencedColumns: ["id"];
          },
        ];
      };
      moderation_actions: {
        Row: {
          created_at: string;
          id: string;
          moderator_id: string | null;
          new_status: Database["public"]["Enums"]["story_revision_status"];
          previous_status: Database["public"]["Enums"]["story_revision_status"];
          revision_id: string;
          story_id: string;
          user_facing_reason: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          moderator_id?: string | null;
          new_status: Database["public"]["Enums"]["story_revision_status"];
          previous_status: Database["public"]["Enums"]["story_revision_status"];
          revision_id: string;
          story_id: string;
          user_facing_reason?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          moderator_id?: string | null;
          new_status?: Database["public"]["Enums"]["story_revision_status"];
          previous_status?: Database["public"]["Enums"]["story_revision_status"];
          revision_id?: string;
          story_id?: string;
          user_facing_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "moderation_actions_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "moderation_actions_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          bio: string | null;
          created_at: string;
          display_name: string;
          home_country_code: string;
          id: string;
          public_profile_enabled: boolean;
          public_slug: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name?: string;
          home_country_code?: string;
          id: string;
          public_profile_enabled?: boolean;
          public_slug?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name?: string;
          home_country_code?: string;
          id?: string;
          public_profile_enabled?: boolean;
          public_slug?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      regions: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          island_or_grouping: string | null;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          island_or_grouping?: string | null;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          island_or_grouping?: string | null;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      stories: {
        Row: {
          archived_at: string | null;
          assigned_editor_id: string | null;
          consent_revoked_at: string | null;
          consent_revoked_by: string | null;
          contributor_id: string;
          created_at: string;
          created_by: string | null;
          current_draft_revision_id: string | null;
          id: string;
          lifecycle_status: Database["public"]["Enums"]["story_lifecycle_status"];
          owner_user_id: string | null;
          published_at: string | null;
          published_revision_id: string | null;
          slug: string;
          source_kind: Database["public"]["Enums"]["story_source_kind"];
          submitted_at: string | null;
          updated_at: string;
          version: number;
          visibility: Database["public"]["Enums"]["story_visibility"];
        };
        Insert: {
          archived_at?: string | null;
          assigned_editor_id?: string | null;
          consent_revoked_at?: string | null;
          consent_revoked_by?: string | null;
          contributor_id: string;
          created_at?: string;
          created_by?: string | null;
          current_draft_revision_id?: string | null;
          id?: string;
          lifecycle_status?: Database["public"]["Enums"]["story_lifecycle_status"];
          owner_user_id?: string | null;
          published_at?: string | null;
          published_revision_id?: string | null;
          slug: string;
          source_kind: Database["public"]["Enums"]["story_source_kind"];
          submitted_at?: string | null;
          updated_at?: string;
          version?: number;
          visibility?: Database["public"]["Enums"]["story_visibility"];
        };
        Update: {
          archived_at?: string | null;
          assigned_editor_id?: string | null;
          consent_revoked_at?: string | null;
          consent_revoked_by?: string | null;
          contributor_id?: string;
          created_at?: string;
          created_by?: string | null;
          current_draft_revision_id?: string | null;
          id?: string;
          lifecycle_status?: Database["public"]["Enums"]["story_lifecycle_status"];
          owner_user_id?: string | null;
          published_at?: string | null;
          published_revision_id?: string | null;
          slug?: string;
          source_kind?: Database["public"]["Enums"]["story_source_kind"];
          submitted_at?: string | null;
          updated_at?: string;
          version?: number;
          visibility?: Database["public"]["Enums"]["story_visibility"];
        };
        Relationships: [
          {
            foreignKeyName: "stories_contributor_id_fkey";
            columns: ["contributor_id"];
            isOneToOne: false;
            referencedRelation: "contributors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stories_current_draft_revision_id_fkey";
            columns: ["current_draft_revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stories_published_revision_id_fkey";
            columns: ["published_revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      story_media: {
        Row: {
          approved_public_storage_path: string | null;
          created_at: string;
          deleted_at: string | null;
          error_code: string | null;
          failure_reason: string | null;
          id: string;
          metadata_removed_at: string | null;
          owner_user_id: string | null;
          private_storage_path: string;
          processed_file_size_bytes: number | null;
          processed_height: number | null;
          processed_mime_type: string | null;
          processed_private_storage_path: string | null;
          processed_width: number | null;
          processing_started_at: string | null;
          processing_state: Database["public"]["Enums"]["story_media_processing_state"];
          reserved_for_revision_id: string | null;
          sha256: string | null;
          source_file_size_bytes: number | null;
          source_height: number | null;
          source_mime_type: string;
          source_width: number | null;
          story_id: string;
          uploaded_by: string | null;
        };
        Insert: {
          approved_public_storage_path?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          error_code?: string | null;
          failure_reason?: string | null;
          id?: string;
          metadata_removed_at?: string | null;
          owner_user_id?: string | null;
          private_storage_path: string;
          processed_file_size_bytes?: number | null;
          processed_height?: number | null;
          processed_mime_type?: string | null;
          processed_private_storage_path?: string | null;
          processed_width?: number | null;
          processing_started_at?: string | null;
          processing_state?: Database["public"]["Enums"]["story_media_processing_state"];
          reserved_for_revision_id?: string | null;
          sha256?: string | null;
          source_file_size_bytes?: number | null;
          source_height?: number | null;
          source_mime_type: string;
          source_width?: number | null;
          story_id: string;
          uploaded_by?: string | null;
        };
        Update: {
          approved_public_storage_path?: string | null;
          created_at?: string;
          deleted_at?: string | null;
          error_code?: string | null;
          failure_reason?: string | null;
          id?: string;
          metadata_removed_at?: string | null;
          owner_user_id?: string | null;
          private_storage_path?: string;
          processed_file_size_bytes?: number | null;
          processed_height?: number | null;
          processed_mime_type?: string | null;
          processed_private_storage_path?: string | null;
          processed_width?: number | null;
          processing_started_at?: string | null;
          processing_state?: Database["public"]["Enums"]["story_media_processing_state"];
          reserved_for_revision_id?: string | null;
          sha256?: string | null;
          source_file_size_bytes?: number | null;
          source_height?: number | null;
          source_mime_type?: string;
          source_width?: number | null;
          story_id?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "story_media_reserved_for_revision_id_fkey";
            columns: ["reserved_for_revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_media_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      story_media_public_copy_attempts: {
        Row: {
          approval_attempt_id: string;
          attempt_count: number;
          content_hash: string;
          created_at: string;
          error_code: string | null;
          id: string;
          media_id: string;
          public_path: string;
          resolution: string | null;
          resolved_at: string | null;
          revision_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          approval_attempt_id: string;
          attempt_count?: number;
          content_hash: string;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          media_id: string;
          public_path: string;
          resolution?: string | null;
          resolved_at?: string | null;
          revision_id: string;
          status: string;
          updated_at?: string;
        };
        Update: {
          approval_attempt_id?: string;
          attempt_count?: number;
          content_hash?: string;
          created_at?: string;
          error_code?: string | null;
          id?: string;
          media_id?: string;
          public_path?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          revision_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_media_public_copy_attempts_approval_attempt_id_fkey";
            columns: ["approval_attempt_id"];
            isOneToOne: false;
            referencedRelation: "story_publication_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_media_public_copy_attempts_media_id_fkey";
            columns: ["media_id"];
            isOneToOne: false;
            referencedRelation: "story_media";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_media_public_copy_attempts_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      story_publication_attempts: {
        Row: {
          created_at: string;
          id: string;
          initiated_by: string;
          resolved_at: string | null;
          revision_id: string;
          status: Database["public"]["Enums"]["story_publication_attempt_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          initiated_by: string;
          resolved_at?: string | null;
          revision_id: string;
          status?: Database["public"]["Enums"]["story_publication_attempt_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          initiated_by?: string;
          resolved_at?: string | null;
          revision_id?: string;
          status?: Database["public"]["Enums"]["story_publication_attempt_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_publication_attempts_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      story_publication_consent_notes: {
        Row: {
          consent_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          internal_note: string;
        };
        Insert: {
          consent_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          internal_note: string;
        };
        Update: {
          consent_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          internal_note?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_publication_consent_notes_consent_id_fkey";
            columns: ["consent_id"];
            isOneToOne: false;
            referencedRelation: "story_publication_consents";
            referencedColumns: ["id"];
          },
        ];
      };
      story_publication_consents: {
        Row: {
          attribution_type: Database["public"]["Enums"]["attribution_type"];
          attribution_value: string;
          confirmation_method: string;
          consent_status: string;
          contributor_id: string;
          created_at: string;
          editorial_assistance_confirmed_at: string | null;
          event_number: number;
          id: string;
          identifiable_people_state: Database["public"]["Enums"]["identifiable_people_state"];
          image_rights_confirmed_at: string | null;
          publication_confirmed_at: string;
          recorded_by: string | null;
          revision_id: string;
          story_id: string;
          terms_version: string;
        };
        Insert: {
          attribution_type: Database["public"]["Enums"]["attribution_type"];
          attribution_value: string;
          confirmation_method: string;
          consent_status?: string;
          contributor_id: string;
          created_at?: string;
          editorial_assistance_confirmed_at?: string | null;
          event_number: number;
          id?: string;
          identifiable_people_state?: Database["public"]["Enums"]["identifiable_people_state"];
          image_rights_confirmed_at?: string | null;
          publication_confirmed_at: string;
          recorded_by?: string | null;
          revision_id: string;
          story_id: string;
          terms_version: string;
        };
        Update: {
          attribution_type?: Database["public"]["Enums"]["attribution_type"];
          attribution_value?: string;
          confirmation_method?: string;
          consent_status?: string;
          contributor_id?: string;
          created_at?: string;
          editorial_assistance_confirmed_at?: string | null;
          event_number?: number;
          id?: string;
          identifiable_people_state?: Database["public"]["Enums"]["identifiable_people_state"];
          image_rights_confirmed_at?: string | null;
          publication_confirmed_at?: string;
          recorded_by?: string | null;
          revision_id?: string;
          story_id?: string;
          terms_version?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_publication_consents_contributor_id_fkey";
            columns: ["contributor_id"];
            isOneToOne: false;
            referencedRelation: "contributors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_publication_consents_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: true;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_publication_consents_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      story_publication_state_actions: {
        Row: {
          action_type: string;
          actor_id: string | null;
          created_at: string;
          id: string;
          note: string | null;
          reason: string | null;
          story_id: string;
        };
        Insert: {
          action_type: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          reason?: string | null;
          story_id: string;
        };
        Update: {
          action_type?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          note?: string | null;
          reason?: string | null;
          story_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_publication_state_actions_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      story_report_notes: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          internal_note: string;
          report_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          internal_note: string;
          report_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          internal_note?: string;
          report_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_report_notes_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "story_reports";
            referencedColumns: ["id"];
          },
        ];
      };
      story_reports: {
        Row: {
          category: string;
          created_at: string;
          details: string | null;
          handled_at: string | null;
          handled_by: string | null;
          id: string;
          published_revision_id: string;
          reporter_id: string | null;
          status: string;
          story_id: string;
        };
        Insert: {
          category: string;
          created_at?: string;
          details?: string | null;
          handled_at?: string | null;
          handled_by?: string | null;
          id?: string;
          published_revision_id: string;
          reporter_id?: string | null;
          status?: string;
          story_id: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          details?: string | null;
          handled_at?: string | null;
          handled_by?: string | null;
          id?: string;
          published_revision_id?: string;
          reporter_id?: string | null;
          status?: string;
          story_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_reports_published_revision_id_fkey";
            columns: ["published_revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_reports_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      story_revision_editor_notes: {
        Row: {
          created_at: string;
          created_by: string | null;
          editor_note: string;
          id: string;
          revision_id: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          editor_note: string;
          id?: string;
          revision_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          editor_note?: string;
          id?: string;
          revision_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_revision_editor_notes_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      story_revision_locations: {
        Row: {
          destination_id: string | null;
          id: string;
          region_id: string;
          revision_id: string;
          sort_order: number;
        };
        Insert: {
          destination_id?: string | null;
          id?: string;
          region_id: string;
          revision_id: string;
          sort_order?: number;
        };
        Update: {
          destination_id?: string | null;
          id?: string;
          region_id?: string;
          revision_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "story_revision_locations_destination_id_fkey";
            columns: ["destination_id"];
            isOneToOne: false;
            referencedRelation: "destinations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_revision_locations_region_id_fkey";
            columns: ["region_id"];
            isOneToOne: false;
            referencedRelation: "regions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_revision_locations_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      story_revision_media: {
        Row: {
          alt_text: string | null;
          caption: string | null;
          decorative: boolean;
          id: string;
          is_cover: boolean;
          media_id: string;
          revision_id: string;
          sort_order: number;
        };
        Insert: {
          alt_text?: string | null;
          caption?: string | null;
          decorative?: boolean;
          id?: string;
          is_cover?: boolean;
          media_id: string;
          revision_id: string;
          sort_order?: number;
        };
        Update: {
          alt_text?: string | null;
          caption?: string | null;
          decorative?: boolean;
          id?: string;
          is_cover?: boolean;
          media_id?: string;
          revision_id?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "story_revision_media_media_id_fkey";
            columns: ["media_id"];
            isOneToOne: false;
            referencedRelation: "story_media";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_revision_media_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      story_revision_tags: {
        Row: {
          revision_id: string;
          tag_id: string;
        };
        Insert: {
          revision_id: string;
          tag_id: string;
        };
        Update: {
          revision_id?: string;
          tag_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_revision_tags_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_revision_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
        ];
      };
      story_revision_work_types: {
        Row: {
          revision_id: string;
          work_type_id: string;
        };
        Insert: {
          revision_id: string;
          work_type_id: string;
        };
        Update: {
          revision_id?: string;
          work_type_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "story_revision_work_types_revision_id_fkey";
            columns: ["revision_id"];
            isOneToOne: false;
            referencedRelation: "story_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "story_revision_work_types_work_type_id_fkey";
            columns: ["work_type_id"];
            isOneToOne: false;
            referencedRelation: "work_types";
            referencedColumns: ["id"];
          },
        ];
      };
      story_revisions: {
        Row: {
          approved_at: string | null;
          content_json: Json;
          contributor_note: string | null;
          created_at: string;
          created_by: string | null;
          currency: string;
          excerpt: string | null;
          id: string;
          revision_number: number;
          revision_status: Database["public"]["Enums"]["story_revision_status"];
          search_vector: unknown;
          story_id: string;
          title: string;
          total_expense_nzd_cents: number | null;
          travel_style: string | null;
          trip_end_date: string | null;
          trip_start_date: string | null;
          trip_year: number | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          approved_at?: string | null;
          content_json?: Json;
          contributor_note?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          excerpt?: string | null;
          id?: string;
          revision_number: number;
          revision_status?: Database["public"]["Enums"]["story_revision_status"];
          search_vector?: unknown;
          story_id: string;
          title: string;
          total_expense_nzd_cents?: number | null;
          travel_style?: string | null;
          trip_end_date?: string | null;
          trip_start_date?: string | null;
          trip_year?: number | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          approved_at?: string | null;
          content_json?: Json;
          contributor_note?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          excerpt?: string | null;
          id?: string;
          revision_number?: number;
          revision_status?: Database["public"]["Enums"]["story_revision_status"];
          search_vector?: unknown;
          story_id?: string;
          title?: string;
          total_expense_nzd_cents?: number | null;
          travel_style?: string | null;
          trip_end_date?: string | null;
          trip_start_date?: string | null;
          trip_year?: number | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "story_revisions_story_id_fkey";
            columns: ["story_id"];
            isOneToOne: false;
            referencedRelation: "stories";
            referencedColumns: ["id"];
          },
        ];
      };
      tags: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          role: Database["public"]["Enums"]["app_role"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      work_types: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      _authorize_revision_edit: {
        Args: { p_revision_id: string };
        Returns: string;
      };
      _can_access_story_media: {
        Args: { p_media_id: string };
        Returns: boolean;
      };
      _can_write_reserved_media_path: {
        Args: { p_object_name: string };
        Returns: boolean;
      };
      _generate_story_slug: { Args: { p_title: string }; Returns: string };
      _is_story_owner: { Args: { p_story_id: string }; Returns: boolean };
      _latest_valid_consent_for_revision: {
        Args: { p_revision_id: string; p_story_id: string };
        Returns: {
          attribution_type: Database["public"]["Enums"]["attribution_type"];
          attribution_value: string;
          confirmation_method: string;
          consent_status: string;
          contributor_id: string;
          created_at: string;
          editorial_assistance_confirmed_at: string | null;
          event_number: number;
          id: string;
          identifiable_people_state: Database["public"]["Enums"]["identifiable_people_state"];
          image_rights_confirmed_at: string | null;
          publication_confirmed_at: string;
          recorded_by: string | null;
          revision_id: string;
          story_id: string;
          terms_version: string;
        };
        SetofOptions: {
          from: "*";
          to: "story_publication_consents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      _require_processed_media: {
        Args: { p_revision_id: string };
        Returns: undefined;
      };
      _revision_is_editable: {
        Args: { p_revision_id: string };
        Returns: boolean;
      };
      _set_contributor_linked_user: {
        Args: {
          p_contributor_id: string;
          p_new_linked_user_id: string;
          p_operation: string;
        };
        Returns: undefined;
      };
      _terminalize_active_revision: {
        Args: { p_story_id: string };
        Returns: undefined;
      };
      admin_set_user_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"];
          p_target_user_id: string;
        };
        Returns: undefined;
      };
      archive_story: {
        Args: {
          p_expected_version: number;
          p_note?: string;
          p_reason: string;
          p_story_id: string;
        };
        Returns: undefined;
      };
      authorize_story_media_preview: {
        Args: { p_media_id: string };
        Returns: undefined;
      };
      begin_story_media_copy_attempt: {
        Args: { p_approval_attempt_id: string; p_media_id: string };
        Returns: {
          content_hash: string;
          public_path: string;
        }[];
      };
      begin_story_media_upload: {
        Args: { p_revision_id: string; p_source_mime_type: string };
        Returns: {
          media_id: string;
          reserved_path: string;
        }[];
      };
      begin_story_publication_attempt: {
        Args: { p_revision_id: string };
        Returns: string;
      };
      can_view_moderation_review: {
        Args: { p_revision_id: string };
        Returns: {
          revision_id: string;
        }[];
      };
      cancel_pending_story_media_upload: {
        Args: { p_media_id: string };
        Returns: undefined;
      };
      create_editorial_import_draft: {
        Args: {
          p_assigned_editor_id?: string;
          p_content_json?: Json;
          p_contributor_id: string;
          p_contributor_note?: string;
          p_excerpt?: string;
          p_title: string;
          p_total_expense_nzd_cents?: number;
          p_travel_style?: string;
          p_trip_end_date?: string;
          p_trip_start_date?: string;
          p_trip_year?: number;
        };
        Returns: {
          revision_id: string;
          story_id: string;
        }[];
      };
      create_next_draft_revision: {
        Args: { p_story_id: string };
        Returns: string;
      };
      create_self_service_draft: {
        Args: {
          p_content_json?: Json;
          p_contributor_note?: string;
          p_excerpt?: string;
          p_title: string;
          p_total_expense_nzd_cents?: number;
          p_travel_style?: string;
          p_trip_end_date?: string;
          p_trip_start_date?: string;
          p_trip_year?: number;
        };
        Returns: {
          revision_id: string;
          story_id: string;
        }[];
      };
      create_story_report: {
        Args: { p_category: string; p_details?: string; p_story_id: string };
        Returns: string;
      };
      current_consent_state: {
        Args: { p_story_id: string };
        Returns: Database["public"]["CompositeTypes"]["consent_state"];
        SetofOptions: {
          from: "*";
          to: "consent_state";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      current_terms_version: { Args: never; Returns: string };
      decline_editorial_publication: {
        Args: { p_note: string; p_story_id: string };
        Returns: undefined;
      };
      detach_story_media: {
        Args: {
          p_expected_version: number;
          p_media_id: string;
          p_revision_id: string;
        };
        Returns: undefined;
      };
      finalize_story_media_upload: {
        Args: { p_expected_version: number; p_media_id: string };
        Returns: undefined;
      };
      finalize_story_publication: {
        Args: {
          p_approval_attempt_id: string;
          p_editor_note?: string;
          p_revision_id: string;
          p_user_facing_reason?: string;
        };
        Returns: undefined;
      };
      get_consent_terms_version: {
        Args: { p_revision_id: string };
        Returns: string;
      };
      get_media_private_path_for_preview: {
        Args: { p_media_id: string };
        Returns: string;
      };
      get_moderation_queue: {
        Args: {
          p_consent_method?: string;
          p_date_from?: string;
          p_date_to?: string;
          p_limit?: number;
          p_offset?: number;
          p_region_id?: string;
          p_source_kind?: string;
          p_status?: string;
          p_work_type_id?: string;
        };
        Returns: {
          is_replacement: boolean;
          revision_id: string;
          slug: string;
          story_id: string;
          submission_kind: string;
          submitted_at: string;
          title: string;
          total_count: number;
        }[];
      };
      get_my_story_with_draft: {
        Args: { p_story_id: string };
        Returns: {
          assigned_editor_id: string;
          content_json: Json;
          contributor_note: string;
          excerpt: string;
          lifecycle_status: Database["public"]["Enums"]["story_lifecycle_status"];
          revision_id: string;
          revision_number: number;
          revision_status: Database["public"]["Enums"]["story_revision_status"];
          slug: string;
          source_kind: Database["public"]["Enums"]["story_source_kind"];
          story_id: string;
          title: string;
          total_expense_nzd_cents: number;
          travel_style: string;
          trip_end_date: string;
          trip_start_date: string;
          trip_year: number;
          version: number;
          visibility: Database["public"]["Enums"]["story_visibility"];
        }[];
      };
      get_public_contributor: {
        Args: { p_slug: string };
        Returns: {
          bio: string;
          contributor_id: string;
          display_name: string;
          public_slug: string;
          published_story_count: number;
        }[];
      };
      get_published_revision_snapshot: {
        Args: { p_story_id: string };
        Returns: {
          content_json: Json;
          excerpt: string;
          revision_id: string;
          title: string;
          total_expense_nzd_cents: number;
          travel_style: string;
          trip_end_date: string;
          trip_start_date: string;
          trip_year: number;
        }[];
      };
      get_published_story: {
        Args: { p_slug: string };
        Returns: {
          attribution_type: Database["public"]["Enums"]["attribution_type"];
          attribution_value: string;
          content_json: Json;
          contributor_slug: string;
          excerpt: string;
          published_at: string;
          regions: Json;
          slug: string;
          story_id: string;
          tags: Json;
          title: string;
          total_expense_nzd_cents: number;
          travel_style: string;
          trip_end_date: string;
          trip_start_date: string;
          trip_year: number;
          work_types: Json;
        }[];
      };
      get_published_story_media: {
        Args: { p_story_id: string };
        Returns: {
          alt_text: string;
          caption: string;
          decorative: boolean;
          is_cover: boolean;
          media_id: string;
          public_url: string;
          sort_order: number;
        }[];
      };
      get_report_notes: {
        Args: { p_report_id: string };
        Returns: {
          created_at: string;
          created_by: string | null;
          id: string;
          internal_note: string;
          report_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "story_report_notes";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      get_revision_selections: {
        Args: { p_revision_id: string };
        Returns: {
          locations: Json;
          tag_ids: string[];
          work_type_ids: string[];
        }[];
      };
      get_story_editorial_history: {
        Args: { p_story_id: string };
        Returns: {
          action_type: string;
          created_at: string;
          editor_id: string;
          id: string;
          revision_id: string;
          summary: string;
        }[];
      };
      get_story_for_editor: {
        Args: { p_story_id: string };
        Returns: {
          editor_note: string;
          editor_note_created_at: string;
          lifecycle_status: Database["public"]["Enums"]["story_lifecycle_status"];
          revision_id: string;
          revision_number: number;
          revision_status: Database["public"]["Enums"]["story_revision_status"];
          slug: string;
          story_id: string;
          title: string;
          version: number;
        }[];
      };
      get_story_for_moderator: {
        Args: { p_revision_id: string };
        Returns: {
          attribution_type: Database["public"]["Enums"]["attribution_type"];
          attribution_value: string;
          confirmation_method: string;
          consent_valid: boolean;
          content_json: Json;
          excerpt: string;
          identifiable_people_state: Database["public"]["Enums"]["identifiable_people_state"];
          image_rights_confirmed_at: string;
          media: Json;
          media_processed: boolean;
          revision_id: string;
          revision_number: number;
          revision_status: Database["public"]["Enums"]["story_revision_status"];
          slug: string;
          story_id: string;
          story_version: number;
          title: string;
          total_expense_nzd_cents: number;
          travel_style: string;
          trip_end_date: string;
          trip_start_date: string;
          trip_year: number;
        }[];
      };
      get_story_moderation_history: {
        Args: { p_story_id: string };
        Returns: {
          action_id: string;
          created_at: string;
          internal_note: string;
          moderator_id: string;
          new_status: Database["public"]["Enums"]["story_revision_status"];
          previous_status: Database["public"]["Enums"]["story_revision_status"];
          revision_id: string;
          user_facing_reason: string;
        }[];
      };
      get_story_preview: {
        Args: { p_story_id: string };
        Returns: {
          attribution_type: Database["public"]["Enums"]["attribution_type"];
          attribution_value: string;
          content_json: Json;
          excerpt: string;
          lifecycle_status: Database["public"]["Enums"]["story_lifecycle_status"];
          media: Json;
          revision_id: string;
          revision_status: Database["public"]["Enums"]["story_revision_status"];
          source_kind: Database["public"]["Enums"]["story_source_kind"];
          story_id: string;
          title: string;
          total_expense_nzd_cents: number;
          travel_style: string;
          trip_end_date: string;
          trip_start_date: string;
          trip_year: number;
          version: number;
          viewer_relationship: string;
        }[];
      };
      has_role: {
        Args: {
          p_role: Database["public"]["Enums"]["app_role"];
          p_user_id: string;
        };
        Returns: boolean;
      };
      link_contributor_to_user: {
        Args: { p_contributor_id: string; p_note?: string; p_user_id: string };
        Returns: undefined;
      };
      list_assigned_editorial_stories: {
        Args: never;
        Returns: {
          contributor_id: string;
          created_at: string;
          id: string;
          lifecycle_status: Database["public"]["Enums"]["story_lifecycle_status"];
          slug: string;
          updated_at: string;
          version: number;
        }[];
      };
      list_distinct_public_travel_styles: {
        Args: never;
        Returns: {
          travel_style: string;
        }[];
      };
      list_editorial_queue: {
        Args: {
          p_limit?: number;
          p_offset?: number;
          p_search?: string;
          p_status?: string;
        };
        Returns: {
          assigned_editor_id: string;
          contributor_id: string;
          created_at: string;
          lifecycle_status: Database["public"]["Enums"]["story_lifecycle_status"];
          slug: string;
          story_id: string;
          title: string;
          total_count: number;
          updated_at: string;
          version: number;
        }[];
      };
      list_my_reports: {
        Args: never;
        Returns: {
          category: string;
          created_at: string;
          details: string | null;
          handled_at: string | null;
          handled_by: string | null;
          id: string;
          published_revision_id: string;
          reporter_id: string | null;
          status: string;
          story_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "story_reports";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      list_my_stories: {
        Args: never;
        Returns: {
          archived_at: string;
          created_at: string;
          current_draft_revision_id: string;
          id: string;
          lifecycle_status: Database["public"]["Enums"]["story_lifecycle_status"];
          published_at: string;
          published_revision_id: string;
          slug: string;
          source_kind: Database["public"]["Enums"]["story_source_kind"];
          submitted_at: string;
          updated_at: string;
          version: number;
          visibility: Database["public"]["Enums"]["story_visibility"];
        }[];
      };
      list_public_contributors: {
        Args: {
          p_cursor_display_name?: string;
          p_cursor_id?: string;
          p_limit?: number;
        };
        Returns: {
          bio: string;
          contributor_id: string;
          display_name: string;
          public_slug: string;
          published_story_count: number;
        }[];
      };
      list_published_stories: {
        Args: {
          p_contributor_id?: string;
          p_cost_band?: string;
          p_cursor_id?: string;
          p_cursor_published_at?: string;
          p_destination_id?: string;
          p_exclude_story_id?: string;
          p_has_reported_expense?: boolean;
          p_limit?: number;
          p_region_id?: string;
          p_search?: string;
          p_tag_id?: string;
          p_travel_style?: string;
          p_trip_year?: number;
          p_work_type_id?: string;
        };
        Returns: {
          attribution_type: Database["public"]["Enums"]["attribution_type"];
          attribution_value: string;
          contributor_slug: string;
          cover_image_path: string;
          excerpt: string;
          published_at: string;
          regions: Json;
          slug: string;
          story_id: string;
          tags: Json;
          title: string;
          total_expense_nzd_cents: number;
          travel_style: string;
          trip_year: number;
          work_types: Json;
        }[];
      };
      list_reports_for_staff: {
        Args: {
          p_category?: string;
          p_date_from?: string;
          p_date_to?: string;
          p_limit?: number;
          p_offset?: number;
          p_status?: string;
          p_story_id?: string;
        };
        Returns: {
          category: string;
          created_at: string;
          details: string | null;
          handled_at: string | null;
          handled_by: string | null;
          id: string;
          published_revision_id: string;
          reporter_id: string | null;
          status: string;
          story_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "story_reports";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      log_editorial_action: {
        Args: {
          p_action_type: string;
          p_revision_id: string;
          p_story_id: string;
          p_summary: string;
        };
        Returns: undefined;
      };
      maintenance_cancel_abandoned_reservation: {
        Args: { p_media_id: string };
        Returns: undefined;
      };
      maintenance_resolve_orphaned_copy_attempt: {
        Args: { p_copy_attempt_id: string };
        Returns: undefined;
      };
      mark_editorial_draft_awaiting_approval: {
        Args: { p_story_id: string };
        Returns: undefined;
      };
      moderate_revision: {
        Args: {
          p_decision: string;
          p_editor_note?: string;
          p_expected_version: number;
          p_revision_id: string;
          p_user_facing_reason?: string;
        };
        Returns: undefined;
      };
      reassign_editorial_story: {
        Args: {
          p_editor_id: string;
          p_expected_version?: number;
          p_note?: string;
          p_story_id: string;
        };
        Returns: undefined;
      };
      record_processed_story_media: {
        Args: {
          p_media_id: string;
          p_processed_file_size_bytes: number;
          p_processed_height: number;
          p_processed_mime_type: string;
          p_processed_private_storage_path: string;
          p_processed_width: number;
          p_sha256: string;
          p_source_height: number;
          p_source_mime_type: string;
          p_source_width: number;
        };
        Returns: undefined;
      };
      record_story_media_copy_failed: {
        Args: {
          p_approval_attempt_id: string;
          p_error_code: string;
          p_media_id: string;
        };
        Returns: undefined;
      };
      record_story_media_copy_verified: {
        Args: { p_approval_attempt_id: string; p_media_id: string };
        Returns: undefined;
      };
      record_story_media_processing_failed: {
        Args: {
          p_error_code?: string;
          p_failure_reason: string;
          p_media_id: string;
        };
        Returns: undefined;
      };
      reorder_story_media: {
        Args: {
          p_expected_version: number;
          p_media_order: string[];
          p_revision_id: string;
        };
        Returns: undefined;
      };
      request_editorial_changes: {
        Args: { p_note: string; p_story_id: string };
        Returns: undefined;
      };
      resolve_report: {
        Args: {
          p_internal_note?: string;
          p_report_id: string;
          p_status: string;
        };
        Returns: undefined;
      };
      revoke_publication_consent: {
        Args: { p_expected_version: number; p_story_id: string };
        Returns: undefined;
      };
      save_revision_draft: {
        Args: {
          p_content_json?: Json;
          p_contributor_note?: string;
          p_excerpt?: string;
          p_expected_version: number;
          p_revision_id: string;
          p_title: string;
          p_total_expense_nzd_cents?: number;
          p_travel_style?: string;
          p_trip_end_date?: string;
          p_trip_start_date?: string;
          p_trip_year?: number;
        };
        Returns: number;
      };
      set_revision_locations: {
        Args: {
          p_expected_version: number;
          p_locations: Json;
          p_revision_id: string;
        };
        Returns: undefined;
      };
      set_revision_tags: {
        Args: {
          p_expected_version: number;
          p_revision_id: string;
          p_tag_ids: string[];
        };
        Returns: undefined;
      };
      set_revision_work_types: {
        Args: {
          p_expected_version: number;
          p_revision_id: string;
          p_work_type_ids: string[];
        };
        Returns: undefined;
      };
      set_story_cover_media: {
        Args: {
          p_expected_version: number;
          p_media_id: string;
          p_revision_id: string;
        };
        Returns: undefined;
      };
      submit_revision_with_consent: {
        Args: {
          p_confirmation_method: string;
          p_editorial_assistance_confirmed?: boolean;
          p_expected_terms_version: string;
          p_expected_version: number;
          p_identifiable_people_state?: Database["public"]["Enums"]["identifiable_people_state"];
          p_image_rights_confirmed?: boolean;
          p_publication_confirmed: boolean;
          p_revision_id: string;
        };
        Returns: undefined;
      };
      unlink_contributor_from_user: {
        Args: { p_contributor_id: string; p_note?: string };
        Returns: undefined;
      };
      update_story_media_caption: {
        Args: {
          p_alt_text: string;
          p_caption: string;
          p_decorative: boolean;
          p_expected_version: number;
          p_media_id: string;
          p_revision_id: string;
        };
        Returns: undefined;
      };
      withdraw_unstarted_submission: {
        Args: { p_story_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      app_role: "user" | "editor" | "moderator" | "admin";
      attribution_type:
        "real_name" | "display_name" | "pseudonym" | "anonymous";
      contributor_status: "private" | "public" | "archived";
      identifiable_people_state:
        "confirmed" | "not_applicable" | "pending" | "declined";
      story_lifecycle_status:
        | "draft"
        | "awaiting_contributor_approval"
        | "pending_review"
        | "changes_requested"
        | "published"
        | "rejected"
        | "archived";
      story_media_processing_state:
        | "pending_upload"
        | "uploaded"
        | "processing"
        | "processed"
        | "failed"
        | "promotion_pending"
        | "promoted";
      story_publication_attempt_status: "active" | "finalized" | "abandoned";
      story_revision_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "changes_requested"
        | "withdrawn"
        | "superseded";
      story_source_kind: "self_submitted" | "editorial_import";
      story_visibility: "private" | "public";
    };
    CompositeTypes: {
      consent_state: {
        consent_status: string | null;
        revision_id: string | null;
        event_number: number | null;
        publication_confirmed_at: string | null;
        attribution_type:
          Database["public"]["Enums"]["attribution_type"] | null;
        attribution_value: string | null;
      };
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["user", "editor", "moderator", "admin"],
      attribution_type: ["real_name", "display_name", "pseudonym", "anonymous"],
      contributor_status: ["private", "public", "archived"],
      identifiable_people_state: [
        "confirmed",
        "not_applicable",
        "pending",
        "declined",
      ],
      story_lifecycle_status: [
        "draft",
        "awaiting_contributor_approval",
        "pending_review",
        "changes_requested",
        "published",
        "rejected",
        "archived",
      ],
      story_media_processing_state: [
        "pending_upload",
        "uploaded",
        "processing",
        "processed",
        "failed",
        "promotion_pending",
        "promoted",
      ],
      story_publication_attempt_status: ["active", "finalized", "abandoned"],
      story_revision_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "changes_requested",
        "withdrawn",
        "superseded",
      ],
      story_source_kind: ["self_submitted", "editorial_import"],
      story_visibility: ["private", "public"],
    },
  },
} as const;
