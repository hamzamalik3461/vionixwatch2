CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"thread_id" uuid NOT NULL,
	"caller_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'ringing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dm_messages" (
	"id" bigserial PRIMARY KEY,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid,
	"kind" text DEFAULT 'text' NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dm_reads" (
	"thread_id" uuid,
	"profile_id" uuid,
	"last_read_id" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "dm_reads_pkey" PRIMARY KEY("thread_id","profile_id")
);
--> statement-breakpoint
CREATE TABLE "dm_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"requester_id" uuid,
	"addressee_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "friendships_pkey" PRIMARY KEY("requester_id","addressee_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY,
	"profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_username_key" UNIQUE("username");--> statement-breakpoint
CREATE INDEX "calls_thread_idx" ON "calls" ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "dm_messages_thread_idx" ON "dm_messages" ("thread_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "dm_threads_pair_idx" ON "dm_threads" ("user_a_id","user_b_id");--> statement-breakpoint
CREATE INDEX "dm_threads_b_idx" ON "dm_threads" ("user_b_id");--> statement-breakpoint
CREATE INDEX "friendships_addressee_idx" ON "friendships" ("addressee_id","status");--> statement-breakpoint
CREATE INDEX "sessions_profile_idx" ON "sessions" ("profile_id");--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_thread_id_dm_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "dm_threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_id_profiles_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_thread_id_dm_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "dm_threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_sender_id_profiles_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "profiles"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "dm_reads" ADD CONSTRAINT "dm_reads_thread_id_dm_threads_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "dm_threads"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dm_reads" ADD CONSTRAINT "dm_reads_profile_id_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dm_threads" ADD CONSTRAINT "dm_threads_user_a_id_profiles_id_fkey" FOREIGN KEY ("user_a_id") REFERENCES "profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dm_threads" ADD CONSTRAINT "dm_threads_user_b_id_profiles_id_fkey" FOREIGN KEY ("user_b_id") REFERENCES "profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_profiles_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_profiles_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_profile_id_profiles_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "sessions" ("token_hash", "profile_id") SELECT "token_hash", "id" FROM "profiles";
