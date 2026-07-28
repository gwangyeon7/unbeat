package com.unbeat.playlist.favoritetrack

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import java.time.LocalDateTime

/**
 * 즐겨찾기한 "곡"(트랙) 엔티티. 기존 Favorite(아티스트 단위)와는 별개 테이블.
 * tags는 Last.fm에서 가져온 상위 태그를 콤마로 이어붙여 저장 (예: "kpop,ballad,sad") —
 * 나중에 Spring Batch가 이 값을 기준으로 무드/장르별 자동 그룹핑을 한다.
 */
@Entity
@Table(
    name = "favorite_tracks",
    uniqueConstraints = [UniqueConstraint(columnNames = ["session_id", "artist_name", "track_name"])]
)
class FavoriteTrack(
    @Column(name = "session_id", nullable = false, length = 64)
    val sessionId: String,

    @Column(name = "artist_name", nullable = false, length = 255)
    val artistName: String,

    @Column(name = "track_name", nullable = false, length = 255)
    val trackName: String,

    @Column(name = "tags", length = 255)
    var tags: String? = null,

    @Column(name = "created_at", nullable = false)
    val createdAt: LocalDateTime = LocalDateTime.now()
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
}
