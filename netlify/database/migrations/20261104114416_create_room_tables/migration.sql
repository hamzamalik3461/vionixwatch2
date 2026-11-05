CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"token_hash" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"avatar" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_members" (
	"room_id" uuid,
	"profile_id" uuid,
	"removed" boolean DEFAULT false NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "room_members_pkey" PRIMARY KEY("room_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "room_messages" (
	"id" bigserial PRIMARY KEY,
	"room_id" uuid NOT NULL,
	"profile_id" uuid,
	"type" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_playback" (
	"room_id" uuid PRIMARY KEY,
	"video_id" uuid,
	"playing" boolean DEFAULT false NOT NULL,
	"position" real DEFAULT 0 NOT NULL,
	"rate" real DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"room_id" uuid NOT NULL,
	"title" text NOT NULL,
	"src" text NOT NULL,
	"kind" text NOT NULL,
	"duration" integer DEFAULT 0 NOT NULL,
	"thumbnail" text NOT NULL,
	"added_by" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"code" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"password_hash" text,
	"capacity" integer DEFAULT 12 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"owner_id" uuid NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "room_members_seen_idx" ON "room_members" ("room_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "room_messages_room_idx" ON "room_messages" ("room_id","id");--> statement-breakpoint
CREATE INDEX "room_messages_author_idx" ON "room_messages" ("profile_id","created_at");--> statement-breakpoint
CREATE INDEX "room_videos_room_idx" ON "room_videos" ("room_id","sort");--> statement-breakpoint
CREATE INDEX "rooms_owner_idx" ON "rooms" ("owner_id");--> statement-breakpoint
CREATE INDEX "rooms_visibility_idx" ON "rooms" ("visibility","ended_at");--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_profile_id_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_profile_id_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "room_playback" ADD CONSTRAINT "room_playback_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_videos" ADD CONSTRAINT "room_videos_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_owner_id_profiles_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "profiles"("id");