CREATE TABLE `entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`date` text NOT NULL,
	`meal` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`food_id` integer,
	`name` text NOT NULL,
	`serving_label` text,
	`servings` real,
	`grams` real,
	`is_estimate` integer DEFAULT false NOT NULL,
	`note` text,
	`photo_id` integer,
	`origin` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`kcal` real,
	`protein_g` real,
	`carb_g` real,
	`fat_g` real,
	`fibre_g` real,
	`sugar_g` real,
	`sodium_mg` real,
	`sat_fat_g` real,
	FOREIGN KEY (`user_id`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`photo_id`) REFERENCES `warren_files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entries_user_date` ON `entries` (`user_id`,`date`);--> statement-breakpoint
CREATE TABLE `entry_edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`action` text NOT NULL,
	`before` text NOT NULL,
	`after` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `entry_edits_entry` ON `entry_edits` (`entry_id`);--> statement-breakpoint
CREATE INDEX `entry_edits_user` ON `entry_edits` (`user_id`);--> statement-breakpoint
CREATE TABLE `foods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`source_ref` text,
	`name` text NOT NULL,
	`brand` text,
	`description` text,
	`category` text,
	`servings` text DEFAULT '[]' NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`deleted_at` integer,
	`kcal` real,
	`protein_g` real,
	`carb_g` real,
	`fat_g` real,
	`fibre_g` real,
	`sugar_g` real,
	`sodium_mg` real,
	`sat_fat_g` real,
	FOREIGN KEY (`created_by`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `foods_source_ref` ON `foods` (`source`,`source_ref`);--> statement-breakpoint
CREATE INDEX `foods_source` ON `foods` (`source`);--> statement-breakpoint
CREATE TABLE `pins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`food_id` integer NOT NULL,
	`serving_label` text,
	`servings` real,
	`grams` real,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`food_id`) REFERENCES `foods`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pins_user` ON `pins` (`user_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`kcal_target` real,
	`protein_target_g` real,
	`carb_target_g` real,
	`fat_target_g` real,
	`reminder_time` text DEFAULT '21:00' NOT NULL,
	`reminded_on` text,
	FOREIGN KEY (`user_id`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_meals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `saved_meals_user` ON `saved_meals` (`user_id`);--> statement-breakpoint
-- The search index over foods. Not a Drizzle table: it is kept in step by the triggers below, so
-- every write to `foods` (the app's, an undo, a reference reload) updates it without code.
CREATE VIRTUAL TABLE food_fts USING fts5(name, extra, tokenize = 'unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER foods_fts_insert AFTER INSERT ON foods WHEN new.deleted_at IS NULL BEGIN
  INSERT INTO food_fts(rowid, name, extra) VALUES (
    new.id, new.name,
    trim(coalesce((SELECT group_concat(value, ' ') FROM json_each(new.aliases)), '') || ' ' || coalesce(new.brand, ''))
  );
END;
--> statement-breakpoint
CREATE TRIGGER foods_fts_update AFTER UPDATE OF name, brand, aliases, deleted_at ON foods BEGIN
  DELETE FROM food_fts WHERE rowid = old.id;
  INSERT INTO food_fts(rowid, name, extra) SELECT
    new.id, new.name,
    trim(coalesce((SELECT group_concat(value, ' ') FROM json_each(new.aliases)), '') || ' ' || coalesce(new.brand, ''))
  WHERE new.deleted_at IS NULL;
END;
--> statement-breakpoint
CREATE TRIGGER foods_fts_delete AFTER DELETE ON foods BEGIN
  DELETE FROM food_fts WHERE rowid = old.id;
END;
