CREATE TABLE `PhotoAlbum` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `slug` VARCHAR(191) NOT NULL,
  `description` VARCHAR(191) NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `PhotoAlbum_name_key`(`name`),
  UNIQUE INDEX `PhotoAlbum_slug_key`(`slug`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AlbumPhoto` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `albumId` INTEGER NOT NULL,
  `imageUrl` VARCHAR(191) NOT NULL,
  `caption` VARCHAR(191) NULL,
  `uploadedByUserId` VARCHAR(191) NULL,
  `uploaderName` VARCHAR(191) NULL,
  `takenAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `AlbumPhoto_albumId_createdAt_idx`(`albumId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AlbumPhoto_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `PhotoAlbum`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `AlbumPhoto_uploadedByUserId_fkey` FOREIGN KEY (`uploadedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CommunityPost` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(191) NOT NULL,
  `content` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,

  INDEX `CommunityPost_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `CommunityPost_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CommunityPostLike` (
  `postId` INTEGER NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `CommunityPostLike_userId_idx`(`userId`),
  PRIMARY KEY (`postId`, `userId`),
  CONSTRAINT `CommunityPostLike_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `CommunityPost`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `CommunityPostLike_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `PhotoAlbum` (`name`, `slug`, `description`, `isActive`, `createdAt`, `updatedAt`)
SELECT '봉사방', 'volunteer-room', '봉사 활동 사진 앨범', true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
  SELECT 1 FROM `PhotoAlbum` WHERE `slug` = 'volunteer-room'
);
