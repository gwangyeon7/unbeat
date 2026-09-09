package com.unbeat.playlist.userplaylist

import org.springframework.data.jpa.repository.JpaRepository

interface PlaylistTrackRepository : JpaRepository<PlaylistTrack, Long> {
    fun findByPlaylistIdOrderByAddedAtDesc(playlistId: Long): List<PlaylistTrack>
    fun findByPlaylistIdAndArtistNameAndTrackName(
        playlistId: Long,
        artistName: String,
        trackName: String
    ): PlaylistTrack?
    fun countByPlaylistId(playlistId: Long): Long
    fun deleteByPlaylistId(playlistId: Long)
}
