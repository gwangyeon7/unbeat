package com.unbeat.playlist.userplaylist

import org.springframework.data.jpa.repository.JpaRepository

interface PlaylistLikeRepository : JpaRepository<PlaylistLike, Long> {
    fun countByPlaylistId(playlistId: Long): Long
    fun existsByPlaylistIdAndUserId(playlistId: Long, userId: String): Boolean
    fun deleteByPlaylistIdAndUserId(playlistId: Long, userId: String)
}
