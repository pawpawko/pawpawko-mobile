export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      banned_words: {
        Row: {
          word: string
        }
        Insert: {
          word: string
        }
        Update: {
          word?: string
        }
        Relationships: []
      }
      binder_collaborators: {
        Row: {
          added_by: string | null
          binder_id: string
          created_at: string | null
          user_id: string
        }
        Insert: {
          added_by?: string | null
          binder_id: string
          created_at?: string | null
          user_id: string
        }
        Update: {
          added_by?: string | null
          binder_id?: string
          created_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "binder_collaborators_binder_id_fkey"
            columns: ["binder_id"]
            isOneToOne: false
            referencedRelation: "binders"
            referencedColumns: ["id"]
          },
        ]
      }
      binders: {
        Row: {
          binder_background_url: string | null
          category: string
          created_at: string | null
          description: string | null
          flair: string
          id: string
          layout: string
          name: string
          sleeve_image_url: string | null
          user_id: string
        }
        Insert: {
          binder_background_url?: string | null
          category?: string
          created_at?: string | null
          description?: string | null
          flair?: string
          id?: string
          layout?: string
          name?: string
          sleeve_image_url?: string | null
          user_id: string
        }
        Update: {
          binder_background_url?: string | null
          category?: string
          created_at?: string | null
          description?: string | null
          flair?: string
          id?: string
          layout?: string
          name?: string
          sleeve_image_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      cards: {
        Row: {
          artist: string | null
          attacks: Json | null
          attribute: string | null
          block_number: string | null
          card_code: string
          color: string | null
          cost: number | null
          counter: number | null
          effect_text: string | null
          evolves_from: string | null
          game: string
          hp: number | null
          image_url: string | null
          image_url_lg: string | null
          is_eddiable: boolean | null
          keywords: string[] | null
          legality: string | null
          life: number | null
          name: string
          number: string | null
          power: number | null
          price_updated_at: string | null
          price_usd: number | null
          ram: number | null
          rarity: string | null
          release_order: number | null
          resistance: string | null
          retreat_cost: number | null
          search_meta: Json | null
          series: string | null
          set_id: string | null
          subtypes: string[] | null
          supertype: string | null
          trigger_text: string | null
          type: string | null
          types: string[] | null
          weakness: string | null
        }
        Insert: {
          artist?: string | null
          attacks?: Json | null
          attribute?: string | null
          block_number?: string | null
          card_code: string
          color?: string | null
          cost?: number | null
          counter?: number | null
          effect_text?: string | null
          evolves_from?: string | null
          game?: string
          hp?: number | null
          image_url?: string | null
          image_url_lg?: string | null
          is_eddiable?: boolean | null
          keywords?: string[] | null
          legality?: string | null
          life?: number | null
          name: string
          number?: string | null
          power?: number | null
          price_updated_at?: string | null
          price_usd?: number | null
          ram?: number | null
          rarity?: string | null
          release_order?: number | null
          resistance?: string | null
          retreat_cost?: number | null
          search_meta?: Json | null
          series?: string | null
          set_id?: string | null
          subtypes?: string[] | null
          supertype?: string | null
          trigger_text?: string | null
          type?: string | null
          types?: string[] | null
          weakness?: string | null
        }
        Update: {
          artist?: string | null
          attacks?: Json | null
          attribute?: string | null
          block_number?: string | null
          card_code?: string
          color?: string | null
          cost?: number | null
          counter?: number | null
          effect_text?: string | null
          evolves_from?: string | null
          game?: string
          hp?: number | null
          image_url?: string | null
          image_url_lg?: string | null
          is_eddiable?: boolean | null
          keywords?: string[] | null
          legality?: string | null
          life?: number | null
          name?: string
          number?: string | null
          power?: number | null
          price_updated_at?: string | null
          price_usd?: number | null
          ram?: number | null
          rarity?: string | null
          release_order?: number | null
          resistance?: string | null
          retreat_cost?: number | null
          search_meta?: Json | null
          series?: string | null
          set_id?: string | null
          subtypes?: string[] | null
          supertype?: string | null
          trigger_text?: string | null
          type?: string | null
          types?: string[] | null
          weakness?: string | null
        }
        Relationships: []
      }
      deck_banned_groups: {
        Row: {
          card_code: string
          game: string
          group_id: number
          max_together: number
          note: string | null
        }
        Insert: {
          card_code: string
          game: string
          group_id: number
          max_together?: number
          note?: string | null
        }
        Update: {
          card_code?: string
          game?: string
          group_id?: number
          max_together?: number
          note?: string | null
        }
        Relationships: []
      }
      deck_cards: {
        Row: {
          art_mix: Json
          card_code: string
          deck_id: string
          owned: number
          quantity: number
        }
        Insert: {
          art_mix?: Json
          card_code: string
          deck_id: string
          owned?: number
          quantity: number
        }
        Update: {
          art_mix?: Json
          card_code?: string
          deck_id?: string
          owned?: number
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "deck_cards_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
        ]
      }
      deck_collaborators: {
        Row: {
          added_by: string | null
          created_at: string | null
          deck_id: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string | null
          deck_id: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string | null
          deck_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "deck_collaborators_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
        ]
      }
      deck_legends: {
        Row: {
          card_code: string
          deck_id: string
          owned: number
        }
        Insert: {
          card_code: string
          deck_id: string
          owned?: number
        }
        Update: {
          card_code?: string
          deck_id?: string
          owned?: number
        }
        Relationships: [
          {
            foreignKeyName: "deck_legends_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
        ]
      }
      deck_rule_exceptions: {
        Row: {
          card_code: string
          game: string
          max_copies: number | null
          note: string | null
        }
        Insert: {
          card_code: string
          game: string
          max_copies?: number | null
          note?: string | null
        }
        Update: {
          card_code?: string
          game?: string
          max_copies?: number | null
          note?: string | null
        }
        Relationships: []
      }
      decks: {
        Row: {
          created_at: string | null
          format: string
          game: string
          goals: Json | null
          id: string
          is_public: boolean
          leader_card_code: string
          listing_type: string | null
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          format?: string
          game?: string
          goals?: Json | null
          id?: string
          is_public?: boolean
          leader_card_code: string
          listing_type?: string | null
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          format?: string
          game?: string
          goals?: Json | null
          id?: string
          is_public?: boolean
          leader_card_code?: string
          listing_type?: string | null
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "decks_game_leader_card_code_fkey"
            columns: ["game", "leader_card_code"]
            isOneToOne: false
            referencedRelation: "cards"
            referencedColumns: ["game", "card_code"]
          },
        ]
      }
      listings: {
        Row: {
          binder_id: string | null
          card_code: string
          created_at: string | null
          deck_id: string | null
          id: string
          listing_type: string
          notes: string | null
          quantity: number
          sort_order: number | null
        }
        Insert: {
          binder_id?: string | null
          card_code: string
          created_at?: string | null
          deck_id?: string | null
          id?: string
          listing_type: string
          notes?: string | null
          quantity: number
          sort_order?: number | null
        }
        Update: {
          binder_id?: string | null
          card_code?: string
          created_at?: string | null
          deck_id?: string | null
          id?: string
          listing_type?: string
          notes?: string | null
          quantity?: number
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_binder_id_fkey"
            columns: ["binder_id"]
            isOneToOne: false
            referencedRelation: "binders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listings_deck_id_fkey"
            columns: ["deck_id"]
            isOneToOne: false
            referencedRelation: "decks"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          data: Json
          id: string
          read: boolean
          read_at: string | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          data?: Json
          id?: string
          read?: boolean
          read_at?: string | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          data?: Json
          id?: string
          read?: boolean
          read_at?: string | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          binder_background_url: string | null
          binder_description: string | null
          binder_name: string
          boroughs: string[] | null
          city: string
          created_at: string | null
          deck_limit: number | null
          discord_handle: string | null
          display_name: string
          display_name_changed_at: string
          display_name_set: boolean
          local_shops: string[] | null
          sleeve_image_url: string | null
          slug: string | null
          subway_stops: string[] | null
          user_id: string
        }
        Insert: {
          binder_background_url?: string | null
          binder_description?: string | null
          binder_name?: string
          boroughs?: string[] | null
          city?: string
          created_at?: string | null
          deck_limit?: number | null
          discord_handle?: string | null
          display_name: string
          display_name_changed_at?: string
          display_name_set?: boolean
          local_shops?: string[] | null
          sleeve_image_url?: string | null
          slug?: string | null
          subway_stops?: string[] | null
          user_id: string
        }
        Update: {
          binder_background_url?: string | null
          binder_description?: string | null
          binder_name?: string
          boroughs?: string[] | null
          city?: string
          created_at?: string | null
          deck_limit?: number | null
          discord_handle?: string | null
          display_name?: string
          display_name_changed_at?: string
          display_name_set?: boolean
          local_shops?: string[] | null
          sleeve_image_url?: string | null
          slug?: string | null
          subway_stops?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      rotated_sets: {
        Row: {
          game: string
          note: string | null
          set_prefix: string
        }
        Insert: {
          game: string
          note?: string | null
          set_prefix: string
        }
        Update: {
          game?: string
          note?: string | null
          set_prefix?: string
        }
        Relationships: []
      }
      rotation_exempt_cards: {
        Row: {
          card_code: string
          game: string
          note: string | null
        }
        Insert: {
          card_code: string
          game: string
          note?: string | null
        }
        Update: {
          card_code?: string
          game?: string
          note?: string | null
        }
        Relationships: []
      }
      trade_tap_history: {
        Row: {
          id: string
          match_count: number
          partner_user_id: string
          tapped_at: string
          tapped_on: string | null
          user_id: string
        }
        Insert: {
          id?: string
          match_count?: number
          partner_user_id: string
          tapped_at?: string
          tapped_on?: string | null
          user_id: string
        }
        Update: {
          id?: string
          match_count?: number
          partner_user_id?: string
          tapped_at?: string
          tapped_on?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_presence: {
        Row: {
          event_code: string | null
          expires_at: string
          last_ping: string
          lat: number
          lng: number
          user_id: string
        }
        Insert: {
          event_code?: string | null
          expires_at?: string
          last_ping?: string
          lat: number
          lng: number
          user_id: string
        }
        Update: {
          event_code?: string | null
          expires_at?: string
          last_ping?: string
          lat?: number
          lng?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      binder_collaborators_list: {
        Args: { p_binder_id: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      card_base_code: { Args: { p_code: string }; Returns: string }
      clear_presence: { Args: never; Returns: undefined }
      colors_overlap: { Args: { a: string; b: string }; Returns: boolean }
      contains_banned_word: { Args: { p_text: string }; Returns: boolean }
      cyberpunk_deck_validity: { Args: { p_deck_id: string }; Returns: Json }
      deck_collaborators_list: {
        Args: { p_deck_id: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      deck_pending_invite: {
        Args: { p_deck_id: string }
        Returns: {
          display_name: string
          notification_id: string
          user_id: string
        }[]
      }
      deck_trade_partner: {
        Args: { p_deck_id: string }
        Returns: {
          display_name: string
          user_id: string
        }[]
      }
      deck_validity: { Args: { p_deck_id: string }; Returns: Json }
      dismiss_notification: {
        Args: { p_notification_id: string }
        Returns: undefined
      }
      display_name_acceptable: { Args: { p_name: string }; Returns: boolean }
      display_name_available: { Args: { p_name: string }; Returns: boolean }
      earth: { Args: never; Returns: number }
      get_binder_listings_public: {
        Args: { p_binder_id: string }
        Returns: {
          card_code: string
          created_at: string
          id: string
          listing_type: string
          quantity: number
          sort_order: number
        }[]
      }
      get_binder_public: {
        Args: { p_binder_id: string }
        Returns: {
          binder_background_url: string
          binder_description: string
          binder_name: string
          category: string
          display_name: string
          flair: string
          id: string
          sleeve_image_url: string
          user_id: string
        }[]
      }
      is_binder_member: {
        Args: { p_binder_id: string; p_uid: string }
        Returns: boolean
      }
      is_deck_member: {
        Args: { p_deck_id: string; p_uid: string }
        Returns: boolean
      }
      mark_notifications_read: { Args: never; Returns: undefined }
      nearby_trade_binders: {
        Args: { p_event_code?: string; p_lat: number; p_lng: number }
        Returns: {
          binder_description: string
          binder_id: string
          binder_name: string
          category: string
          display_name: string
          distance_m: number
          flair: string
          last_updated_at: string
          sleeve_image_url: string
          user_id: string
        }[]
      }
      nearby_wishlist_matches: {
        Args: { p_event_code?: string; p_lat: number; p_lng: number }
        Returns: {
          binder_id: string
          category: string
          matched_card_codes: string[]
          owner_display_name: string
          owner_user_id: string
        }[]
      }
      normalize_for_moderation: { Args: { s: string }; Returns: string }
      prune_notifications: { Args: never; Returns: undefined }
      publish_deck: {
        Args: { p_deck_id: string; p_listing_type: string }
        Returns: undefined
      }
      record_trade_tap: {
        Args: { p_match_count: number; p_partner_user_id: string }
        Returns: string
      }
      rescind_deck_invite: { Args: { p_deck_id: string }; Returns: undefined }
      resolve_binder_slug: { Args: { p_slug: string }; Returns: string }
      respond_binder_invite: {
        Args: { p_accept: boolean; p_notification_id: string }
        Returns: undefined
      }
      respond_deck_invite: {
        Args: { p_accept: boolean; p_notification_id: string }
        Returns: undefined
      }
      resync_deck_member_wishlist: {
        Args: { p_deck_id: string; p_member: string }
        Returns: undefined
      }
      search_binders: {
        Args: {
          p_boroughs?: string[]
          p_card_codes?: string[]
          p_category?: string
          p_city?: string
          p_shop?: string
          p_subways?: string[]
        }
        Returns: {
          binder_description: string
          binder_id: string
          binder_name: string
          category: string
          display_name: string
          flair: string
          last_updated_at: string
          matched_card_count: number
          matched_cards: string[]
          sleeve_image_url: string
          user_id: string
        }[]
      }
      share_binder: {
        Args: { p_binder_id: string; p_display_name: string }
        Returns: undefined
      }
      share_deck: {
        Args: { p_deck_id: string; p_display_name: string }
        Returns: undefined
      }
      shared_binders: {
        Args: never
        Returns: {
          binder_background_url: string | null
          category: string
          created_at: string | null
          description: string | null
          flair: string
          id: string
          layout: string
          name: string
          sleeve_image_url: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "binders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      shared_decks: {
        Args: never
        Returns: {
          created_at: string | null
          format: string
          game: string
          goals: Json | null
          id: string
          is_public: boolean
          leader_card_code: string
          listing_type: string | null
          name: string
          updated_at: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "decks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      slugify: { Args: { s: string }; Returns: string }
      standard_legal: {
        Args: { p_code: string; p_game: string }
        Returns: boolean
      }
      trade_matches: {
        Args: { p_partner_user_id: string }
        Returns: {
          card_code: string
          card_image_url: string
          card_name: string
          game: string
          i_want_they_have: boolean
          mutual: boolean
          my_trade_binder_id: string
          their_trade_binder_id: string
          they_want_i_have: boolean
        }[]
      }
      unpublish_deck: { Args: { p_deck_id: string }; Returns: undefined }
      unshare_binder: {
        Args: { p_binder_id: string; p_user_id: string }
        Returns: undefined
      }
      unshare_deck: {
        Args: { p_deck_id: string; p_user_id: string }
        Returns: undefined
      }
      upsert_presence: {
        Args: { p_event_code?: string; p_lat: number; p_lng: number }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
