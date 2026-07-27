-- Unbeat 이벤트 로깅 스키마
-- 실행: mysql -u root < schema.sql

CREATE DATABASE IF NOT EXISTS unbeat
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE unbeat;

-- 사용자 행동 이벤트 원본 테이블 (OLTP)
-- 로그인이 없는 서비스라 session_id로 익명 사용자를 구분한다 (프론트에서 localStorage로 발급).
CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(32) NOT NULL,       -- 'search' | 'recommend_click'
  artist_name VARCHAR(255) NOT NULL,
  result_count INT NULL,                  -- search면 검색결과 수, recommend면 추천곡 수
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_id (session_id),
  INDEX idx_event_type (event_type),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
