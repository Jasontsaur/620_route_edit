CREATE TABLE `route_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`note` text NOT NULL,
	`created` text NOT NULL,
	`parent` text,
	`distance` real NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `versions_owner_created` ON `route_versions` (`owner`,`created`);