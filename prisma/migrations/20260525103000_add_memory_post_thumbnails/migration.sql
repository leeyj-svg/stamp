ALTER TABLE `MemoryPost`
  ADD COLUMN `thumbnailUrl` VARCHAR(191) NULL;

UPDATE `MemoryPost`
SET `thumbnailUrl` = `mediaUrl`
WHERE `thumbnailUrl` IS NULL
  AND `mediaUrl` IS NOT NULL;

CREATE INDEX `MemoryPost_spaceId_type_createdAt_idx` ON `MemoryPost`(`spaceId`, `type`, `createdAt`);
