package com.unbeat.playlist.favoritetrack

import org.springframework.data.jpa.repository.JpaRepository

interface FavoriteTrackRepository : JpaRepository<FavoriteTrack, Long> {
    fun findBySessionIdOrderByCreatedAtDesc(sessionId: String): List<FavoriteTrack>
    fun findBySessionIdAndArtistNameAndTrackName(
        sessionId: String,
        artistName: String,
        trackName: String
    ): FavoriteTrack?
}
