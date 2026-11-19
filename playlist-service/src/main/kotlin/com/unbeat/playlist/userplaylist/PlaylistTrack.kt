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
    uniqueConstraints = [UniqueConstraint(name = "uk_playlist_tracks_dup", columnNames = ["playlist_id", "artist_name", "track_name", "dup_index"])]
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

    // (2026-11-19) 같은 곡을 사용자가 "그래도 추가"로 일부러 한 번 더 담는 경우만 1, 2, ...로 올라감. 평소(0)에는 같은 곡이
    // 중복으로 못 들어가게 DB가 막고(UNIQUE에 dup_index 포함), 사용자가 확인한 중복만 이 값으로 구분해서 허용함.
    @Column(name = "dup_index", nullable = false, columnDefinition = "int not null default 0")
    val dupIndex: Int = 0,

    @Column(name = "added_at", nullable = false)
    val addedAt: LocalDateTime = LocalDateTime.now()
) {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    var id: Long? = null
}
