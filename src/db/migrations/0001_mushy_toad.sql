CREATE TABLE `emergency_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`email` text,
	`relationship` text NOT NULL,
	`is_primary` integer DEFAULT false,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`time` text NOT NULL,
	`days` text NOT NULL,
	`member_id` integer,
	`type` text NOT NULL,
	`icon` text,
	`color` text DEFAULT 'nori',
	`created_at` integer,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
