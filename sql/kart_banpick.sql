-- MySQL dump 10.13  Distrib 8.0.30, for Win64 (x86_64)
--
-- Host: localhost    Database: kart
-- ------------------------------------------------------
-- Server version	8.0.30

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `banpick`
--

DROP TABLE IF EXISTS `banpick`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `banpick` (
  `game_id` char(6) NOT NULL COMMENT '밴픽이 진행되는 게임의 id',
  `track_id` char(64) NOT NULL,
  `order` tinyint unsigned DEFAULT NULL COMMENT '밴픽 순서',
  `picked` tinyint(1) NOT NULL DEFAULT '0' COMMENT '선택 여부',
  `banned` tinyint(1) NOT NULL DEFAULT '0' COMMENT '금지 여부',
  `round` tinyint unsigned DEFAULT NULL COMMENT '라운드 수, 선택되지 않은 경우 0',
  `user_id` bigint unsigned DEFAULT NULL COMMENT '랜덤으로 밴픽한 게 아닐 경우 밴픽한 유저의 디스코드 id',
  `banpicked_at` bigint unsigned DEFAULT NULL COMMENT '밴픽 트랙 선정 일시 (유닉스 시간)',
  PRIMARY KEY (`game_id`,`track_id`),
  KEY `banpick_track_id_idx` (`track_id`),
  KEY `banpick_round_idx` (`round`),
  CONSTRAINT `banpick_game_id` FOREIGN KEY (`game_id`) REFERENCES `game` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `banpick_track_id` FOREIGN KEY (`track_id`) REFERENCES `track` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `banpick`
--

LOCK TABLES `banpick` WRITE;
/*!40000 ALTER TABLE `banpick` DISABLE KEYS */;
/*!40000 ALTER TABLE `banpick` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2022-10-31  4:42:28
