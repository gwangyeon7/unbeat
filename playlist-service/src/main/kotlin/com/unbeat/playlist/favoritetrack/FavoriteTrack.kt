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
 *
 * lastOpenedAt: Unbeat은 곡을 직접 스트리밍하지 않고 Last.fm/원곡 링크로 내보내는 구조라
 * "재생" 자체를 관측할 수 없음. 대신 즐겨찾기한 곡 카드를 클릭해서 나간 시점을
 * "재생 의도"의 대리 신호로 기록해서, 나중에 "즐겨찾기한 뒤로 한 번도 안 눌러본 곡"(=
 * createdAt 이후 lastOpenedAt이 null이거나 오래된 곡)을 "안 듣는 곡"으로 분류하는
 * Spring Batch 작업의 입력 데이터로 쓸 계획.
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

    // 즐겨찾기하는 순간 프론트가 갖고 있던 원곡 링크(Last.fm track URL)를 그대로 저장.
    // 이게 없으면 "다시 듣기" 목록에서 곡을 눌러도 어디로 보내줄지 알 수 없음 —
    // 실제로 이 컬럼이 없어서 "다시 듣기" 목록이 눌리지 않는 버그가 있었음.
    @Column(name = "url", length = 500)
    var url: String? = null,

    @Column(name = "created_at", nullable = false)
    val createdAt: LocalDateTime = LocalDateTime.now(),

    @Column(name = "last_opened_at")
    var lastOpenedAt: LocalDateTime? = null
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
}
