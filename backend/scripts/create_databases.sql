-- Safe to run more than once. Existing databases and data are left unchanged.
CREATE DATABASE IF NOT EXISTS `InventorySystem`
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

CREATE DATABASE IF NOT EXISTS `inventorysystem_test`
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

-- XAMPP commonly uses the local root account during coursework. For a shared
-- machine or deployment, create dedicated users instead. Replace the example
-- passwords before uncommenting these statements.
--
-- CREATE USER IF NOT EXISTS 'inventory_app'@'127.0.0.1'
--     IDENTIFIED BY 'replace-with-a-strong-app-password';
-- GRANT ALL PRIVILEGES ON `InventorySystem`.*
--     TO 'inventory_app'@'127.0.0.1';
--
-- CREATE USER IF NOT EXISTS 'inventory_test'@'127.0.0.1'
--     IDENTIFIED BY 'replace-with-a-strong-test-password';
-- GRANT ALL PRIVILEGES ON `inventorysystem_test`.*
--     TO 'inventory_test'@'127.0.0.1';
-- FLUSH PRIVILEGES;
