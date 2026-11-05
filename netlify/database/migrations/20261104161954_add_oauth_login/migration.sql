ALTER TABLE "profiles" ADD COLUMN "oauth_sub" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_oauth_sub_key" UNIQUE("oauth_sub");