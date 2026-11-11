-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` ENUM('TESTER', 'EXPERT', 'ADMIN') NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sample` (
    `id` VARCHAR(191) NOT NULL,
    `batchId` VARCHAR(191) NULL,
    `customer` VARCHAR(191) NULL,
    `fibre` VARCHAR(191) NOT NULL DEFAULT 'silk',
    `construction` VARCHAR(191) NULL,
    `fabricType` ENUM('PLAIN', 'PRINTED') NOT NULL,
    `baseShade` VARCHAR(191) NULL,
    `dominantHue` VARCHAR(191) NULL,
    `dyeClass` VARCHAR(191) NULL,
    `notes` TEXT NULL,

    INDEX `Sample_batchId_idx`(`batchId`),
    INDEX `Sample_customer_idx`(`customer`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Test` (
    `id` VARCHAR(191) NOT NULL,
    `reportNo` VARCHAR(191) NOT NULL,
    `sampleId` VARCHAR(191) NOT NULL,
    `washMethod` VARCHAR(191) NOT NULL,
    `washTempC` DOUBLE NULL,
    `washTimeMin` DOUBLE NULL,
    `adjCount` INTEGER NOT NULL DEFAULT 2,
    `adj1Fibre` VARCHAR(191) NOT NULL DEFAULT 'silk',
    `adj2Fibre` VARCHAR(191) NULL DEFAULT 'cotton',
    `reqGradeChange` DOUBLE NULL,
    `reqGradeStain` DOUBLE NULL,
    `status` ENUM('DRAFT', 'PENDING_WASH', 'READY_TO_GRADE', 'GRADING', 'GRADED_AUTO', 'NEEDS_REVIEW', 'COMPLETED', 'VOID') NOT NULL DEFAULT 'DRAFT',
    `datasetMode` BOOLEAN NOT NULL DEFAULT false,
    `captureDevice` VARCHAR(191) NULL,
    `uploadMode` VARCHAR(191) NOT NULL DEFAULT 'separate',
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `gradingError` TEXT NULL,
    `engineResult` JSON NULL,
    `manualPoints` JSON NULL,
    `voidReason` TEXT NULL,
    `reportPath` VARCHAR(191) NULL,

    UNIQUE INDEX `Test_reportNo_key`(`reportNo`),
    INDEX `Test_status_idx`(`status`),
    INDEX `Test_sampleId_idx`(`sampleId`),
    INDEX `Test_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Image` (
    `id` VARCHAR(191) NOT NULL,
    `testId` VARCHAR(191) NOT NULL,
    `role` ENUM('SPECIMEN_BEFORE', 'SPECIMEN_AFTER', 'ADJ1_BEFORE', 'ADJ1_AFTER', 'ADJ2_BEFORE', 'ADJ2_AFTER', 'COMPOSITE_BEFORE', 'COMPOSITE_AFTER', 'REF_CARD') NOT NULL,
    `side` VARCHAR(191) NULL,
    `path` VARCHAR(191) NOT NULL,
    `previewPath` VARCHAR(191) NULL,
    `fileName` VARCHAR(191) NULL,
    `sizeBytes` INTEGER NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `device` VARCHAR(191) NULL,
    `warnings` JSON NOT NULL,
    `uploadedBy` VARCHAR(191) NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Image_testId_idx`(`testId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Region` (
    `id` VARCHAR(191) NOT NULL,
    `imageId` VARCHAR(191) NOT NULL,
    `piece` ENUM('SPECIMEN', 'ADJ1', 'ADJ2', 'REF_CARD') NOT NULL,
    `polygon` JSON NOT NULL,
    `maskPath` VARCHAR(191) NULL,
    `autoDetected` BOOLEAN NOT NULL DEFAULT true,
    `editedBy` VARCHAR(191) NULL,
    `stats` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Region_imageId_idx`(`imageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Grade` (
    `id` VARCHAR(191) NOT NULL,
    `testId` VARCHAR(191) NOT NULL,
    `kind` ENUM('CHANGE_OVERALL', 'CHANGE_GROUND', 'CHANGE_MOTIF', 'CHANGE_WORST', 'STAIN_ADJ1', 'STAIN_ADJ2', 'STAIN_WORST') NOT NULL,
    `label` VARCHAR(191) NULL,
    `isoRating` DOUBLE NOT NULL,
    `modelRating` DOUBLE NULL,
    `finalRating` DOUBLE NOT NULL,
    `halfGrade` DOUBLE NOT NULL,
    `ciLow` DOUBLE NOT NULL,
    `ciHigh` DOUBLE NOT NULL,
    `confidence` VARCHAR(191) NOT NULL,
    `decision` ENUM('AUTO', 'REVIEW') NOT NULL,
    `pass` BOOLEAN NULL,
    `features` JSON NOT NULL,
    `heatmapPath` VARCHAR(191) NULL,
    `engineVersion` VARCHAR(191) NOT NULL,
    `modelVersion` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Grade_testId_idx`(`testId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpertGrade` (
    `id` VARCHAR(191) NOT NULL,
    `gradeId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `halfGrade` DOUBLE NOT NULL,
    `reason` TEXT NULL,
    `blind` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ExpertGrade_gradeId_idx`(`gradeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModelVersion` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `version` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `metrics` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ModelVersion_name_version_key`(`name`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NOT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Test` ADD CONSTRAINT `Test_sampleId_fkey` FOREIGN KEY (`sampleId`) REFERENCES `Sample`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Test` ADD CONSTRAINT `Test_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Image` ADD CONSTRAINT `Image_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `Test`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Region` ADD CONSTRAINT `Region_imageId_fkey` FOREIGN KEY (`imageId`) REFERENCES `Image`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Grade` ADD CONSTRAINT `Grade_testId_fkey` FOREIGN KEY (`testId`) REFERENCES `Test`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpertGrade` ADD CONSTRAINT `ExpertGrade_gradeId_fkey` FOREIGN KEY (`gradeId`) REFERENCES `Grade`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpertGrade` ADD CONSTRAINT `ExpertGrade_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

