ALTER TABLE "room_playback" ADD COLUMN "subtitle" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "room_playback" ADD COLUMN "audio" text DEFAULT 'default' NOT NULL;