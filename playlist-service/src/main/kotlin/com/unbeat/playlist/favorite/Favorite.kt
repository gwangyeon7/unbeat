package com.unbeat.playlist.favorite

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import java.time.LocalDateTime

/**
 * 즐겨찾기(찜한 아티스트) 엔티티.
 * FastAPI 쪽 events 테이블과 같은 MariaDB(unbeat DB)를 공유하되,
 * 테이블은 이 서비스가 소유한다 (서비스별 데이터 소유권 분리 연습).
 */
@Entity
@Table(
	name = "favorites",
	uniqueConstraints = [UniqueConstraint(columnNames = ["session_id", "artist_name"])]
)
class Favorite(
	@Column(name = "session_id", nullable = false, length = 64)
	val sessionId: String,

	@Column(name = "artist_name", nullable = false, length = 255)
	val artistName: String,

	@Column(name = "image_url", length = 500)
	val imageUrl: String? = null,

	@Column(name = "created_at", nullable = false)
	val createdAt: LocalDateTime = LocalDateTime.now()
) {
	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	var id: Long? = null
}
