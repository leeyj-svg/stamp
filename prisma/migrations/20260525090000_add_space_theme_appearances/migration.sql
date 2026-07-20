-- Add theme and viewport/surface-specific presentation data for Memory Space.
-- Content stays in MemorySpace/MemoryPost; these tables store only how it is shown.

ALTER TABLE `MemorySpace`
  ADD COLUMN `themeKey` VARCHAR(191) NOT NULL DEFAULT 'galaxy';

CREATE TABLE `MemorySpaceAppearance` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `spaceId` VARCHAR(191) NOT NULL,
  `viewport` ENUM('DESKTOP', 'MOBILE') NOT NULL,
  `surface` ENUM('MEMORY', 'ALBUM') NOT NULL,
  `layoutKey` VARCHAR(191) NOT NULL,
  `config` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `MemorySpaceAppearance_spaceId_viewport_idx`(`spaceId`, `viewport`),
  UNIQUE INDEX `MemorySpaceAppearance_spaceId_viewport_surface_key`(`spaceId`, `viewport`, `surface`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MemoryPostAppearance` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `postId` INTEGER NOT NULL,
  `viewport` ENUM('DESKTOP', 'MOBILE') NOT NULL,
  `surface` ENUM('MEMORY', 'ALBUM') NOT NULL,
  `style` JSON NULL,
  `sortOrder` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `MemoryPostAppearance_viewport_surface_sortOrder_idx`(`viewport`, `surface`, `sortOrder`),
  UNIQUE INDEX `MemoryPostAppearance_postId_viewport_surface_key`(`postId`, `viewport`, `surface`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `MemorySpaceAppearance`
  ADD CONSTRAINT `MemorySpaceAppearance_spaceId_fkey`
  FOREIGN KEY (`spaceId`) REFERENCES `MemorySpace`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MemoryPostAppearance`
  ADD CONSTRAINT `MemoryPostAppearance_postId_fkey`
  FOREIGN KEY (`postId`) REFERENCES `MemoryPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `MemorySpaceAppearance` (`spaceId`, `viewport`, `surface`, `layoutKey`, `config`, `createdAt`, `updatedAt`)
SELECT `id`, 'DESKTOP', 'MEMORY', 'star_map', NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `MemorySpace`;

INSERT INTO `MemorySpaceAppearance` (`spaceId`, `viewport`, `surface`, `layoutKey`, `config`, `createdAt`, `updatedAt`)
SELECT `id`, 'DESKTOP', 'ALBUM', 'polaroid_wall', NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `MemorySpace`;

INSERT INTO `MemorySpaceAppearance` (`spaceId`, `viewport`, `surface`, `layoutKey`, `config`, `createdAt`, `updatedAt`)
SELECT `id`, 'MOBILE', 'MEMORY', 'constellation_stack', NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `MemorySpace`;

INSERT INTO `MemorySpaceAppearance` (`spaceId`, `viewport`, `surface`, `layoutKey`, `config`, `createdAt`, `updatedAt`)
SELECT `id`, 'MOBILE', 'ALBUM', 'photo_story', NULL, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `MemorySpace`;

INSERT INTO `MemoryPostAppearance` (`postId`, `viewport`, `surface`, `style`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT `id`, 'DESKTOP', 'MEMORY', `aiStyle`, `id`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `MemoryPost`
WHERE `type` = 'MESSAGE';

INSERT INTO `MemoryPostAppearance` (`postId`, `viewport`, `surface`, `style`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT `id`, 'MOBILE', 'MEMORY', JSON_OBJECT(), `id`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `MemoryPost`
WHERE `type` = 'MESSAGE';

INSERT INTO `MemoryPostAppearance` (`postId`, `viewport`, `surface`, `style`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT `id`, 'DESKTOP', 'ALBUM', JSON_OBJECT(), `id`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `MemoryPost`
WHERE `type` = 'ALBUM';

INSERT INTO `MemoryPostAppearance` (`postId`, `viewport`, `surface`, `style`, `sortOrder`, `createdAt`, `updatedAt`)
SELECT `id`, 'MOBILE', 'ALBUM', JSON_OBJECT(), `id`, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `MemoryPost`
WHERE `type` = 'ALBUM';
