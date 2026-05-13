CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`date` text NOT NULL,
	`time` text,
	`description` text,
	`member_id` integer,
	`type` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `grocery_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`quantity` text,
	`category` text,
	`priority` text NOT NULL,
	`notes` text,
	`status` text NOT NULL,
	`added_by` integer,
	`created_at` integer,
	FOREIGN KEY (`added_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `meals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`date` text NOT NULL,
	`description` text,
	`nutrition` text,
	`recipe_url` text,
	`member_id` integer,
	`ingredients` text,
	`created_at` integer,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`emoji` text,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `pantry_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text,
	`expiry_date` text,
	`status` text NOT NULL,
	`added_by` integer,
	`created_at` integer,
	FOREIGN KEY (`added_by`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_date` text,
	`priority` text NOT NULL,
	`assigned_to` integer,
	`status` text NOT NULL,
	`recurring` integer DEFAULT false NOT NULL,
	`frequency` text,
	`created_at` integer,
	FOREIGN KEY (`assigned_to`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
