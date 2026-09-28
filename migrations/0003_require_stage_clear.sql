-- Records created before this migration did not track whether a stage was
-- actually cleared. Keep globally claimed player names, but reset unverifiable
-- ranking results so every published record follows the new clear requirement.
DELETE FROM all_time_records;
