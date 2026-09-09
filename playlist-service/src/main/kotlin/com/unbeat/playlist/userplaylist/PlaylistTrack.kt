package com.unbeat.playlist.userplaylist

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.UniqueConstraint
import java.time.LocalDateTime

/**
 * 재생목록(Playlist) 안에 담긴 곡 한 줄. FavoriteTrack을 재사용하지 않고 별도 테이블로 둔 이유:
 * 같은 곡이 여러 재생목록에 동시에 들어갈 수 있어야 하는데(예: "출퇴근길"과 "잔잔한 밤" 둘 다에 같은 발라드),
 * FavoriteTrack은 세션당 곡 하나에 행 하나만 허용하는 구조(session_id+artist+track UNIQUE)라 재사용이 안 맞음.
 */
@Entity
@Table(
    name = "playlist_tracks",
    uniqueConstraints = [UniqueConstraint(columnNames = ["playlist_id", "artist_name", "track_name"])]
)
class PlaylistTrack(
    @Column(name = "playlist_id", nullable = false)
    val playlistId: Long,

    @Column(name = "artist_name", nullable = false, length = 255)
    val artistName: String,

    @Column(name = "track_name", nullable = false, length = 255)
    val trackName: String,

    @Column(name = "url", length = 500)
    var url: String? = null,

    @Column(name = "image_url", length = 500)
    var imageUrl: String? = null,

    @Column(name = "added_at", nullable = false)
    val addedAt: LocalDateTime = LocalDateTime.now()
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
}
