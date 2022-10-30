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
-- Table structure for table `game`
--

DROP TABLE IF EXISTS `game`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game` (
  `id` char(6) NOT NULL COMMENT 'base62 6자로 이루어진 게임의 고유 id',
  `host_id` bigint unsigned NOT NULL COMMENT '게임을 연 사람의 디스코드 id',
  `host_rider_id` int unsigned NOT NULL COMMENT '게임을 연 사람의 카트라이더 access id',
  `opponent_id` bigint unsigned DEFAULT NULL COMMENT '게임 참가자의 디스코드 id',
  `opponent_rider_id` int unsigned DEFAULT NULL COMMENT '게임 참가자의 카트라이더 access id',
  `opened_at` bigint NOT NULL COMMENT '게임이 열린 일시 (유닉스 시간)',
  `banpick_started_at` bigint DEFAULT NULL COMMENT '참가자가 들어오고 밴픽이 시작된 일시 (유닉스 시간)',
  `round_started_at` bigint DEFAULT NULL COMMENT '밴픽이 끝나고 게임이 시작된 일시 (유닉스 시간)',
  `closed_at` bigint DEFAULT NULL COMMENT '게임이 종료된 일시 (유닉스 시간)',
  `channel` varchar(16) NOT NULL COMMENT '카트라이더 api에서 제공하는 channelName 데이터와 같음, 예를 들어 스피드 개인전 무한부스터 모드는 speedIndiInfinit',
  `track_type` varchar(10) NOT NULL COMMENT 'very_easy, easy, normal, hard, very_hard, all, league, new, reverse, crazy 중 하나',
  `banpick_amount` tinyint unsigned NOT NULL COMMENT '밴픽에 사용될 트랙 수',
  `quit_user_id` bigint unsigned DEFAULT NULL COMMENT '나간 유저가 있을 경우 해당 유저의 디스코드 id',
  PRIMARY KEY (`id`),
  KEY `game_host_id_idx` (`host_id`),
  KEY `game_opponent_id_idx` (`opponent_id`),
  KEY `game_quit_user_id_idx` (`quit_user_id`),
  CONSTRAINT `game_host_id` FOREIGN KEY (`host_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `game_opponent_id` FOREIGN KEY (`opponent_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `game_quit_user_id` FOREIGN KEY (`quit_user_id`) REFERENCES `user` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game`
--

LOCK TABLES `game` WRITE;
/*!40000 ALTER TABLE `game` DISABLE KEYS */;
/*!40000 ALTER TABLE `game` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2022-10-31  4:42:29
