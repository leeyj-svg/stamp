-- AlterTable
ALTER TABLE `DevWorkItem`
ADD COLUMN `parentWorkItemId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `DevWorkItem_userId_parentWorkItemId_updatedAt_idx` ON `DevWorkItem`(`userId`, `parentWorkItemId`, `updatedAt`);

-- AddForeignKey
ALTER TABLE `DevWorkItem`
ADD CONSTRAINT `DevWorkItem_parentWorkItemId_fkey`
FOREIGN KEY (`parentWorkItemId`) REFERENCES `DevWorkItem`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
