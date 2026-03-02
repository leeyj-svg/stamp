ALTER TABLE `PhotoAlbum`
  ADD COLUMN `immichAlbumId` VARCHAR(191) NULL;

ALTER TABLE `AlbumPhoto`
  ADD COLUMN `immichAssetId` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `PhotoAlbum_immichAlbumId_key` ON `PhotoAlbum`(`immichAlbumId`);
CREATE INDEX `AlbumPhoto_immichAssetId_idx` ON `AlbumPhoto`(`immichAssetId`);
