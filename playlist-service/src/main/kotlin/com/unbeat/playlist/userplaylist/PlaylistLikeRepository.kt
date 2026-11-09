package com.unbeat.playlist.userplaylist

import org.springframework.data.jpa.repository.JpaRepository

interface PlaylistLikeRepository : JpaRepository<PlaylistLike, Long> {
    fun countByPlaylistId(playlistId: Long): Long
    // "이번 주" 랭킹용 — 지정 시각 이후에 눌린 좋아요 수
    fun countByPlaylistIdAndCreatedAtAfter(playlistId: Long, since: java.time.LocalDateTime): Long
    fun existsByPlaylistIdAndUserId(playlistId: Long, userId: String): Boolean
    fun deleteByPlaylistIdAndUserId(playlistId: Long, userId: String)
}
