CREATE TABLE `shared_route_state` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` text NOT NULL,
	`updated` text NOT NULL,
	`version_id` text,
	`operation_hash` text NOT NULL,
	`payload` text NOT NULL
);
